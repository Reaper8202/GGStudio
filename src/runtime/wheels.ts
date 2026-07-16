/**
 * Raycast suspension + slip-based tire model + approximate Ackermann steering.
 * Forces are applied to the chassis body; each wheel integrates its own spin
 * state ω so unloaded driven wheels rev up and locked wheels skid.
 * See docs/vehicle_editor/PHYSICS_MODEL.md.
 */

import RAPIER from '@dimforge/rapier3d-compat';
import type { RuntimeWheel } from './assembler.ts';
import { WHEEL_RAY_GROUPS } from './assembler.ts';
import type { SurfaceKind } from './surfaces.ts';
import { SURFACES } from './surfaces.ts';
import { add, clamp, cross, dot, len, norm, rotateAroundAxis, rotateByQuat, scale, sub, v3 } from './vec.ts';
import type { Vec3 } from '../core/types.ts';

import { CELL_SIZE } from '../core/types.ts';

/** Grid cell centres sit at (i+0.5)·CELL_SIZE, so the lateral mirror plane
 * of a column-0-centred vehicle is x = CELL_SIZE/2, not 0. */
export const MIRROR_PLANE_X_M = CELL_SIZE / 2;

const LONG_SLIP_SATURATION = 1.6; // m/s of slip for full longitudinal force
const LAT_SLIP_SATURATION = 1.3; // m/s lateral speed for full lateral force
const BUMP_STOP_STIFFNESS_MULT = 3;
const STEER_RATE = 2.6; // rad/s

export interface WheelStepInput {
  throttle: number; // 0..1
  brake: number; // 0..1
  steer: number; // -1..1
  driveTorques: Map<string, number>; // partId -> N·m this step
}

export interface AckermannGeometry {
  wheelbase: number;
  track: number;
  /** partIds of paired steering wheels: [leftId, rightId][] */
  pairs: [string, string][];
}

/** Detect conventional left/right steering pairs (same z, mirrored x). */
export function computeAckermann(wheels: RuntimeWheel[]): AckermannGeometry {
  const steering = wheels.filter((w) => w.steering);
  const zs = wheels.map((w) => w.anchorLocal.z);
  const wheelbase = wheels.length > 1 ? Math.max(...zs) - Math.min(...zs) : 0;
  const xs = wheels.map((w) => w.anchorLocal.x);
  const track = wheels.length > 1 ? Math.max(...xs) - Math.min(...xs) : 0;
  const pairs: [string, string][] = [];
  const used = new Set<string>();
  for (const a of steering) {
    if (used.has(a.partId) || a.anchorLocal.x >= MIRROR_PLANE_X_M) continue;
    const b = steering.find(
      (o) =>
        !used.has(o.partId) &&
        o.partId !== a.partId &&
        Math.abs(o.anchorLocal.z - a.anchorLocal.z) < 1e-6 &&
        Math.abs(o.anchorLocal.x + a.anchorLocal.x - 2 * MIRROR_PLANE_X_M) < 1e-6 &&
        o.anchorLocal.x > MIRROR_PLANE_X_M,
    );
    if (b) {
      pairs.push([a.partId, b.partId]);
      used.add(a.partId);
      used.add(b.partId);
    }
  }
  return { wheelbase: Math.max(wheelbase, 0.4), track: Math.max(track, 0.3), pairs };
}

/** Per-wheel target steer angles with Ackermann correction for detected pairs. */
export function steerTargets(
  wheels: RuntimeWheel[],
  geom: AckermannGeometry,
  steerInput: number,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const w of wheels) {
    if (!w.steering || w.broken) continue;
    const sign = w.steerInverted ? -1 : 1;
    out.set(w.partId, sign * steerInput * (w.wheelDef.maxSteerAngleDeg * Math.PI) / 180);
  }
  const L = geom.wheelbase;
  const T = geom.track;
  for (const [leftId, rightId] of geom.pairs) {
    const left = wheels.find((w) => w.partId === leftId);
    const right = wheels.find((w) => w.partId === rightId);
    if (!left || !right) continue;
    const base = out.get(leftId) ?? 0;
    if (Math.abs(base) < 1e-4) continue;
    const delta = Math.abs(base);
    const inner = Math.atan(L / (L / Math.tan(delta) - T / 2));
    const outer = Math.atan(L / (L / Math.tan(delta) + T / 2));
    const s = Math.sign(base);
    // steering left (s>0 turns toward -x side): left wheel is inner.
    const leftAngle = s > 0 ? inner : outer;
    const rightAngle = s > 0 ? outer : inner;
    out.set(leftId, s * leftAngle);
    out.set(rightId, s * rightAngle);
  }
  return out;
}

export interface WheelTelemetry {
  groundedCount: number;
  meanDrivenOmega: number;
  overloadedWheels: string[];
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
  const targets = steerTargets(wheels, geom, input.steer);
  let groundedCount = 0;
  let drivenOmegaSum = 0;
  let drivenCount = 0;
  const overloaded: string[] = [];

  for (const w of wheels) {
    if (w.broken) continue;
    // Rate-limited steering.
    const target = targets.get(w.partId) ?? 0;
    const dSteer = clamp(target - w.steerAngle, -STEER_RATE * dt, STEER_RATE * dt);
    w.steerAngle += dSteer;

    const anchorW = add(v3(bodyPos.x, bodyPos.y, bodyPos.z), rotateByQuat(rot, w.anchorLocal));
    const suspDirW = norm(rotateByQuat(rot, w.suspDirLocal));
    const up = scale(suspDirW, -1);
    let axleW = norm(rotateByQuat(rot, w.axleLocal));
    if (w.steerAngle !== 0) axleW = rotateAroundAxis(axleW, up, -w.steerAngle);
    const forward = cross(axleW, up);
    const forwardLen = len(forward);

    const rayLen = w.suspension.restLength + w.radius;
    const ray = new RAPIER.Ray(anchorW, suspDirW);
    const hit = world.castRayAndGetNormal(ray, rayLen, true, undefined, WHEEL_RAY_GROUPS, undefined, body);

    if (!hit) {
      // Airborne: no ground forces; drive torque just spins the wheel.
      w.grounded = false;
      w.contactPointW = null;
      w.loadN = 0;
      w.compression = Math.max(0, w.compression - 4 * dt * w.suspension.travel);
      const drive = input.driveTorques.get(w.partId) ?? 0;
      const brakeT = w.braking ? input.brake * w.wheelDef.brakeTorque : 0;
      w.omega += (drive / w.inertia) * dt;
      w.omega = applyBrake(w.omega, brakeT, w.inertia, dt);
      continue;
    }

    const dist = hit.timeOfImpact;
    let compression = rayLen - dist - w.radius + w.suspension.restLength * 0; // = restLength - (dist - radius)
    compression = w.suspension.restLength - (dist - w.radius);
    compression = clamp(compression, 0, w.suspension.restLength);
    const compressionRate = (compression - w.compression) / dt;
    w.compression = compression;

    // Damper clamped so landing/pitch spikes can't launch the chassis.
    const maxSpring = w.suspension.stiffness * w.suspension.travel;
    const damperForce = clamp(w.suspension.damping * compressionRate, -maxSpring, maxSpring);
    let springForce = w.suspension.stiffness * compression + damperForce;
    // Bump stop: compression beyond travel adds a hard extra spring.
    const overTravel = compression - w.suspension.travel;
    if (overTravel > 0) {
      springForce += w.suspension.stiffness * BUMP_STOP_STIFFNESS_MULT * overTravel;
    }
    const N = clamp(springForce, 0, 2.5 * maxSpring);
    w.loadN = N;
    w.grounded = N > 0;
    if (w.grounded) groundedCount++;
    if (N > w.suspension.maxLoad || N > w.wheelDef.maxLoad) overloaded.push(w.partId);

    const contactW = add(anchorW, scale(suspDirW, dist));
    w.contactPointW = contactW;

    // Suspension force at the anchor (where the strut meets the chassis).
    body.applyImpulseAtPoint(scale(up, N * dt), anchorW, true);

    // Degenerate wheel orientation (axle parallel to suspension axis): the
    // wheel lies flat — it cannot roll. Natural failure: no tire forces.
    if (forwardLen < 0.35) {
      w.omega *= 1 - clamp(3 * dt, 0, 1);
      continue;
    }
    const fwd = scale(forward, 1 / forwardLen);
    const lat = axleW;

    const surface = SURFACES[surfaceOf(hit.collider.handle)];
    const muLong = w.wheelDef.frictionLong * surface.muLong;
    const muLat = w.wheelDef.frictionLat * surface.muLat;

    // Velocity of the chassis at the contact point.
    const rVec = sub(contactW, v3(com.x, com.y, com.z));
    const vContact = add(v3(linvel.x, linvel.y, linvel.z), cross(v3(angvel.x, angvel.y, angvel.z), rVec));
    const vLong = dot(vContact, fwd);
    const vLat = dot(vContact, lat);

    // Longitudinal: slip between wheel surface speed and ground speed.
    const slip = w.omega * w.radius - vLong;
    const fLong = muLong * N * clamp(slip / LONG_SLIP_SATURATION, -1, 1);
    // Lateral: resist sliding, saturating at μN.
    const fLat = -muLat * N * clamp(vLat / LAT_SLIP_SATURATION, -1, 1);

    const impulse = add(scale(fwd, fLong * dt), scale(lat, fLat * dt));
    body.applyImpulseAtPoint(impulse, contactW, true);

    // Wheel spin integration: drive + ground reaction + rolling resistance,
    // then brake as a no-reversal clamp (locks cleanly instead of
    // oscillating when brakeTorque·dt/I exceeds ω).
    const drive = input.driveTorques.get(w.partId) ?? 0;
    const brakeT = w.braking ? input.brake * w.wheelDef.brakeTorque : 0;
    const rollRes = surface.rollingResistance * N * w.radius;
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
  const ext = w.grounded ? w.suspension.restLength - w.compression : w.suspension.restLength;
  return add(anchorW, scale(suspDirW, ext));
}
