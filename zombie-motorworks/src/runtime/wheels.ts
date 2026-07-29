/**
 * Per-wheel raycast suspension with approximate Ackermann steering. Each
 * wheel is an independent critically-damped spring applied at its own anchor,
 * so a compressed corner pushes its own side of the chassis back up — that
 * per-corner torque is what absorbs rough terrain, braces the body in
 * corners, and resists pitch/roll under acceleration. Spring rates derive
 * from vehicle mass, so every build settles at the same sag and ride
 * frequency. Tire grip is applied at a point raised toward the centre of
 * mass so grip forces steer the car instead of levering it over.
 * Each wheel integrates its own spin state ω so unloaded driven wheels rev
 * up and locked wheels skid. See docs/vehicle_editor/PHYSICS_MODEL.md.
 */

import RAPIER from '@dimforge/rapier3d-compat';
import type { EnvironmentModifiers } from '../core/biomes.ts';
import type { SurfaceKind } from '../core/surfaces.ts';
import { SURFACES } from '../core/surfaces.ts';
import type { Vec3 } from '../core/types.ts';
import { CELL_SIZE } from '../core/types.ts';
import type { RuntimeWheel } from './assembler.ts';
import { WHEEL_RAY_GROUPS } from './assembler.ts';
import { add, clamp, cross, dot, len, norm, rotateAroundAxis, rotateByQuat, scale, sub, v3 } from './vec.ts';

/** Grid cell centres sit at (i+0.5)·CELL_SIZE, so the lateral mirror plane
 * of a column-0-centred vehicle is x = CELL_SIZE/2, not 0. */
export const MIRROR_PLANE_X_M = CELL_SIZE / 2;

// Central tire-feel tuning. A lower saturation reaches useful grip sooner;
// separate multipliers let cornering feel planted without over-amplifying
// engine force. Per-wheel and per-surface coefficients still preserve the
// standard/off-road and asphalt/dirt/mud differences.
const TIRE_LONGITUDINAL_GRIP_MULTIPLIER = 1.4;
// Lateral grip holds harder and saturates later so the car actually follows
// the steering into a corner instead of washing out into understeer.
const TIRE_LATERAL_GRIP_MULTIPLIER = 1.9;
const LONG_SLIP_SATURATION = 1.15; // m/s of slip for full longitudinal force
const LAT_SLIP_SATURATION = 0.7; // m/s lateral speed for full lateral force
const WHEEL_REST_EPSILON = 0.001; // m/s
const BRAKE_STOP_RESPONSE_STEPS = 1;
const GRAVITY_MPS2 = 9.81;
// Soft-ground drag rises with load relative to the wheel's rated capacity, so
// heavy builds bog down without changing firm-ground handling.
const SINKAGE_LOAD_GAIN = 4;
// Suspension: rest sag sets the base spring rate (k = cornerWeight / sag), so
// the ride frequency is the same for every build (~1.8 Hz) regardless of
// mass. Preset multipliers (light/heavy-duty/off-road) then scale each
// wheel's stiffness, damping, and travel relative to that stable baseline.
// Critical damping (ratio 1) means the springs cannot bounce or oscillate.
const SUSPENSION_REST_SAG_M = 0.08;
const SUSPENSION_DAMPING_RATIO = 1.0;
const SUSPENSION_MAX_FORCE_G = 2.5; // per-wheel cap, multiples of its weight share
const SUSPENSION_RELAX_PER_S = 12; // visual compression decay while airborne
// Tire forces act at a point raised most of the way from the contact patch
// to the CoM height: the horizontal lever arms (and therefore steering yaw)
// are unchanged, but grip can no longer roll the body over in corners or
// pitch-flip it under hard acceleration.
const TIRE_FORCE_ANCHOR_LIFT = 0.75;
// Steering feel. A brisker slew rate makes the wheels reach the commanded
// angle quickly so turn-in no longer lags the key press, and a gentler
// high-speed fade keeps the response consistent instead of going numb.
const STEER_RATE = 9; // rad/s: progressive turn-in avoids an abrupt weight transfer.
const STEER_RETURN_RATE = 18; // rad/s: centring faster makes recovery responsive.
const STEER_SPEED_FADE_REFERENCE_MPS = 26;
const MIN_HIGH_SPEED_STEER_MULTIPLIER = 0.38;

export interface WheelStepInput {
  throttle: number; // 0..1
  brake: number; // 0..1
  steer: number; // -1..1
  driveTorques: Map<string, number>; // partId -> N·m this step
  env: EnvironmentModifiers;
}

export interface AckermannGeometry {
  wheelbase: number;
  track: number;
  /** partIds of paired steering wheels: [leftId, rightId][] */
  pairs: [string, string][];
}

export function steeringSpeedMultiplier(speedMps: number): number {
  return clamp(
    1 / (1 + Math.max(0, speedMps) / STEER_SPEED_FADE_REFERENCE_MPS),
    MIN_HIGH_SPEED_STEER_MULTIPLIER,
    1,
  );
}

/**
 * Turn-in is deliberately slower than centring, so a corner loads up
 * progressively while recovery stays sharp. "Returning" means the step moves
 * the hub back toward straight: winding off, releasing to centre, or crossing
 * through centre to the opposite lock. Starting a turn from dead centre is
 * turn-in, not a sign flip — Math.sign(0) is 0, so that case has to be
 * excluded explicitly or every turn begun from straight would use the fast
 * centring rate and feel twitchy.
 */
export function steeringActuatorRate(target: number, current: number): number {
  if (current === 0) return STEER_RATE;
  if (target === 0) return STEER_RETURN_RATE;
  if (Math.sign(target) !== Math.sign(current)) return STEER_RETURN_RATE;
  return Math.abs(target) < Math.abs(current) ? STEER_RETURN_RATE : STEER_RATE;
}

/** Detect conventional left/right axle pairs (same z, mirrored x). */
export function computeAckermann(wheels: RuntimeWheel[]): AckermannGeometry {
  const zs = wheels.map((w) => w.anchorLocal.z);
  const wheelbase = wheels.length > 1 ? Math.max(...zs) - Math.min(...zs) : 0;
  const xs = wheels.map((w) => w.anchorLocal.x);
  const track = wheels.length > 1 ? Math.max(...xs) - Math.min(...xs) : 0;
  const pairs: [string, string][] = [];
  const used = new Set<string>();
  for (const a of wheels) {
    if (used.has(a.partId) || a.anchorLocal.x >= MIRROR_PLANE_X_M) continue;
    const b = wheels.find(
      (o) =>
        !used.has(o.partId) &&
        o.partId !== a.partId &&
        Math.abs(o.anchorLocal.z - a.anchorLocal.z) < 1e-6 &&
        Math.abs(o.anchorLocal.x + a.anchorLocal.x - 2 * MIRROR_PLANE_X_M) < 1e-6 &&
        o.anchorLocal.x > MIRROR_PLANE_X_M,
    );
    if (b) {
      if (a.steering && b.steering) pairs.push([a.partId, b.partId]);
      used.add(a.partId);
      used.add(b.partId);
    }
  }
  return {
    wheelbase: Math.max(wheelbase, 0.4),
    track: Math.max(track, 0.3),
    pairs,
  };
}

/**
 * Per-wheel Ackermann targets. This solves each wheel against one shared turn
 * centre, so no left/right pairing is needed when wheels are asymmetric.
 */
export function steerTargets(
  wheels: RuntimeWheel[],
  geom: AckermannGeometry,
  steerInput: number,
): Map<string, number> {
  const out = new Map<string, number>();
  if (Math.abs(steerInput) < 1e-6) {
    for (const w of wheels) if (w.steering && !w.broken) out.set(w.partId, 0);
    return out;
  }
  const s = Math.sign(steerInput);
  const live = wheels.filter((w) => !w.broken);
  const steered = live.filter((w) => w.steering);
  const maxAngleOf = (w: RuntimeWheel): number =>
    (w.wheelDef.maxSteerAngleDeg * Math.PI) / 180;
  // Commanded centreline angle. A wheel sitting on the centreline would take
  // exactly this angle; the geometry below spreads the others around it.
  const delta =
    Math.abs(steerInput) * Math.max(...steered.map(maxAngleOf), 0);
  const tanDelta = Math.tan(delta);

  // The turn centre lies on the axle that does not steer. With every wheel
  // steering (a single-axle rig, or a build where the player ticked steering
  // on everything) there is no such reference and Ackermann is undefined, so
  // fall back to giving each hub the commanded angle directly. Without this
  // the pivot line would pass through the steered wheels themselves, their
  // longitudinal offset would be zero, and the rig would refuse to turn at
  // all — single-axle rigs are explicitly supported by the layout deriver.
  const pivotWheels = live.filter((w) => !w.steering);
  const uniform = pivotWheels.length === 0 || Math.abs(tanDelta) <= 1e-6;
  const pivotZ = uniform
    ? 0
    : pivotWheels.reduce((sum, w) => sum + w.anchorLocal.z, 0) /
      pivotWheels.length;
  const radius = uniform ? 0 : geom.wheelbase / tanDelta;

  for (const w of steered) {
    const max = maxAngleOf(w);
    const sign = w.steerInverted ? -1 : 1;
    if (uniform) {
      out.set(w.partId, sign * s * Math.min(delta, max));
      continue;
    }
    // Distance from this hub to the turn centre, measured across the vehicle.
    // The inner hub sits closer to the centre, so it needs the larger angle.
    const lateral = radius + s * (w.anchorLocal.x - MIRROR_PLANE_X_M);
    const longitudinal = w.anchorLocal.z - pivotZ;
    const raw =
      Math.abs(lateral) > 1e-6
        ? s * Math.atan2(longitudinal, Math.abs(lateral))
        : (s * Math.PI) / 2;
    out.set(w.partId, sign * clamp(raw, -max, max));
  }
  return out;
}

export interface WheelContactSample {
  partId: string;
  /** World-space contact point. */
  point: { x: number; y: number; z: number };
  surface: SurfaceKind;
  /** Combined slip magnitude, already normalised to roughly 0..1. */
  slip: number;
  loadN: number;
}

export interface WheelTelemetry {
  groundedCount: number;
  meanDrivenOmega: number;
  overloadedWheels: string[];
  contacts: WheelContactSample[];
}

export function stepWheels(
  world: RAPIER.World,
  body: RAPIER.RigidBody,
  wheels: RuntimeWheel[],
  geom: AckermannGeometry,
  input: WheelStepInput,
  dt: number,
  surfaceOf: (colliderHandle: number) => SurfaceKind,
): WheelTelemetry {
  const rot = body.rotation();
  const bodyPos = body.translation();
  const linvel = body.linvel();
  const angvel = body.angvel();
  const com = body.worldCom();
  const horizontalSpeed = Math.hypot(linvel.x, linvel.z);
  const steeringMultiplier = steeringSpeedMultiplier(horizontalSpeed);
  const targets = steerTargets(
    wheels,
    geom,
    input.steer * steeringMultiplier,
  );
  let groundedCount = 0;
  let drivenOmegaSum = 0;
  let drivenCount = 0;
  const overloaded: string[] = [];
  const contacts: WheelContactSample[] = [];

  const linvelV = v3(linvel.x, linvel.y, linvel.z);
  const angvelV = v3(angvel.x, angvel.y, angvel.z);
  const comV = v3(com.x, com.y, com.z);

  // Mass-normalised spring rates: each unbroken wheel is sized to carry an
  // equal share of the vehicle's weight at SUSPENSION_REST_SAG_M compression.
  const activeWheelCount = wheels.reduce(
    (count, wheel) => count + (wheel.broken ? 0 : 1),
    0,
  );
  const cornerMass = body.mass() / Math.max(1, activeWheelCount);
  const cornerWeight = cornerMass * GRAVITY_MPS2;
  const baseStiffness = cornerWeight / SUSPENSION_REST_SAG_M;
  const maxSpringForce = cornerWeight * SUSPENSION_MAX_FORCE_G;

  for (const w of wheels) {
    if (w.broken) continue;
    // Rate-limited steering.
    const target = targets.get(w.partId) ?? 0;
    const rate = steeringActuatorRate(target, w.steerAngle);
    const dSteer = clamp(target - w.steerAngle, -rate * dt, rate * dt);
    w.steerAngle += dSteer;

    const anchorW = add(v3(bodyPos.x, bodyPos.y, bodyPos.z), rotateByQuat(rot, w.anchorLocal));
    const suspDirW = norm(rotateByQuat(rot, w.suspDirLocal));
    const up = scale(suspDirW, -1);
    let axleW = norm(rotateByQuat(rot, w.axleLocal));
    if (w.steerAngle !== 0) axleW = rotateAroundAxis(axleW, up, -w.steerAngle);
    const forward = cross(axleW, up);
    const forwardLen = len(forward);

    const travel = w.suspension.travel;
    const hit = world.castRayAndGetNormal(
      new RAPIER.Ray(anchorW, suspDirW),
      w.mountOffset + w.radius + travel,
      true,
      undefined,
      WHEEL_RAY_GROUPS,
      undefined,
      body,
    );

    if (hit === null) {
      // Airborne: no ground forces; drive torque just spins the wheel.
      w.compression *= Math.exp(-SUSPENSION_RELAX_PER_S * dt);
      w.grounded = false;
      w.contactPointW = null;
      w.loadN = 0;
      const drive = input.driveTorques.get(w.partId) ?? 0;
      const brakeT = w.braking ? input.brake * w.wheelDef.brakeTorque : 0;
      w.omega += (drive / w.inertia) * dt;
      w.omega = applyBrake(w.omega, brakeT, w.inertia, dt);
      continue;
    }

    const dist = hit.timeOfImpact;
    w.compression = clamp(w.mountOffset + w.radius - dist, 0, travel);

    // Spring/damper along the suspension axis, applied at this wheel's
    // anchor: a compressed corner pushes its own side of the chassis back
    // up. Damping uses the anchor's velocity toward the ground, so chassis
    // roll and pitch motion is damped per corner as well. The ratios of the
    // preset-scaled params to the base params recover the pure preset
    // multipliers, applied on top of the mass-normalised base rates.
    const stiffness =
      baseStiffness * (w.suspension.stiffness / w.wheelDef.suspension.stiffness);
    const damping =
      2 *
      SUSPENSION_DAMPING_RATIO *
      Math.sqrt(stiffness * cornerMass) *
      (w.suspension.damping / w.wheelDef.suspension.damping);
    const vAnchor = add(linvelV, cross(angvelV, sub(anchorW, comV)));
    const compressionSpeed = dot(vAnchor, suspDirW);
    const springForce = clamp(
      stiffness * w.compression + damping * compressionSpeed,
      0,
      maxSpringForce,
    );
    body.applyImpulseAtPoint(scale(up, springForce * dt), anchorW, true);

    const N = springForce;
    w.loadN = N;
    w.grounded = true;
    groundedCount++;
    if (N > w.wheelDef.maxLoad) overloaded.push(w.partId);

    const contactW = add(anchorW, scale(suspDirW, dist));
    w.contactPointW = contactW;

    // Degenerate wheel orientation (axle parallel to suspension axis): the
    // wheel lies flat — it cannot roll. Natural failure: no tire forces.
    if (forwardLen < 0.35) {
      w.omega *= 1 - clamp(3 * dt, 0, 1);
      continue;
    }
    const fwd = scale(forward, 1 / forwardLen);
    const lat = axleW;

    const surfaceKind = surfaceOf(hit.collider.handle);
    const surface = SURFACES[surfaceKind];
    const muLong =
      w.wheelDef.frictionLong *
      surface.muLong *
      TIRE_LONGITUDINAL_GRIP_MULTIPLIER *
      input.env.gripLongMul;
    const muLat =
      w.wheelDef.frictionLat *
      surface.muLat *
      TIRE_LATERAL_GRIP_MULTIPLIER *
      input.env.gripLatMul;

    // Velocity of the chassis at the contact point.
    const vContact = add(linvelV, cross(angvelV, sub(contactW, comV)));
    const vLong = dot(vContact, fwd);
    const vLat = dot(vContact, lat);

    const drive = input.driveTorques.get(w.partId) ?? 0;
    const wheelSurfaceSpeed = w.omega * w.radius;
    const atRest =
      drive === 0 &&
      Math.abs(wheelSurfaceSpeed) < WHEEL_REST_EPSILON &&
      Math.abs(vLong) < WHEEL_REST_EPSILON;
    if (atRest) w.omega = 0;

    // Longitudinal: slip between wheel surface speed and ground speed. At rest,
    // suppress tiny residual slip so the tire cannot manufacture creep.
    const slip = w.omega * w.radius - vLong;
    const slipMagnitude = Math.min(
      1,
      Math.hypot(
        slip / LONG_SLIP_SATURATION,
        vLat / LAT_SLIP_SATURATION,
      ),
    );
    contacts.push({
      partId: w.partId,
      point: contactW,
      surface: surfaceKind,
      slip: slipMagnitude,
      loadN: N,
    });
    let fLong = atRest
      ? 0
      : muLong * N * clamp(slip / LONG_SLIP_SATURATION, -1, 1);
    if (!atRest && w.braking && input.brake > 0) {
      const brakeAmount = clamp(input.brake, 0, 1);
      const maxBrakeGrip = Math.min(
        muLong * N * brakeAmount,
        (w.wheelDef.brakeTorque * brakeAmount) / w.radius,
      );
      const stopForce =
        (-vLong * cornerMass) / (dt * BRAKE_STOP_RESPONSE_STEPS);
      fLong = clamp(stopForce, -maxBrakeGrip, maxBrakeGrip);
    }
    // Lateral: resist sliding, saturating at μN.
    const fLat = -muLat * N * clamp(vLat / LAT_SLIP_SATURATION, -1, 1);

    const impulse = add(scale(fwd, fLong * dt), scale(lat, fLat * dt));
    // Raise the application point toward CoM height: same yaw response,
    // far less roll/pitch leverage from grip.
    const gripPointW = v3(
      contactW.x,
      contactW.y + (comV.y - contactW.y) * TIRE_FORCE_ANCHOR_LIFT,
      contactW.z,
    );
    body.applyImpulseAtPoint(impulse, gripPointW, true);

    // Wheel spin integration: drive + ground reaction + rolling resistance,
    // then brake as a no-reversal clamp (locks cleanly instead of
    // oscillating when brakeTorque·dt/I exceeds ω).
    const brakeT = w.braking ? input.brake * w.wheelDef.brakeTorque : 0;
    const loadRatio = N / Math.max(1, w.wheelDef.maxLoad);
    const sinkageFactor =
      1 + surface.sinkage * loadRatio * SINKAGE_LOAD_GAIN;
    const rollRes =
      surface.rollingResistance *
      input.env.rollingResistanceMul *
      sinkageFactor *
      N *
      w.radius;
    w.omega +=
      ((drive - fLong * w.radius - Math.sign(w.omega) * Math.min(rollRes, (Math.abs(w.omega) * w.inertia) / dt)) /
        w.inertia) *
      dt;
    w.omega = applyBrake(w.omega, brakeT, w.inertia, dt);

    if (w.driven) {
      drivenOmegaSum += Math.abs(w.omega);
      drivenCount++;
    }
  }

  return {
    groundedCount,
    meanDrivenOmega: drivenCount > 0 ? drivenOmegaSum / drivenCount : 0,
    overloadedWheels: overloaded,
    contacts,
  };
}

/** Brake torque opposes spin but can never reverse it within a step. */
function applyBrake(omega: number, brakeTorque: number, inertia: number, dt: number): number {
  if (brakeTorque <= 0) return omega;
  const dOmega = (brakeTorque / inertia) * dt;
  if (Math.abs(omega) <= dOmega) return 0;
  return omega - Math.sign(omega) * dOmega;
}

/** Current world-space wheel visual centre (for rendering). */
export function wheelVisualCentre(body: RAPIER.RigidBody, w: RuntimeWheel): Vec3 {
  const rot = body.rotation();
  const pos = body.translation();
  const anchorW = add(v3(pos.x, pos.y, pos.z), rotateByQuat(rot, w.anchorLocal));
  const suspDirW = norm(rotateByQuat(rot, w.suspDirLocal));
  return add(
    anchorW,
    scale(suspDirW, w.mountOffset - w.compression),
  );
}
