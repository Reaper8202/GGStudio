/**
 * Threat pointer: a skull and chevron riding a ring around the rig, always
 * aimed at the nearest live zombie.
 *
 * The follow camera only shows the wedge of graveyard ahead of the vehicle, so
 * the horde closing in from behind is invisible until it is already chewing on
 * the rear armour. This marks the bearing of the closest threat on the ground
 * beside the car, where the player is already looking, and warms from amber to
 * the minimap's horde red as that threat gets close.
 *
 * Presentation only: it reads zombie render positions and never writes to
 * gameplay state.
 */

import * as THREE from 'three';

/**
 * Half-width of the chevron, vehicle-local metres. Kept small on purpose: this
 * is a glance-target at the edge of vision, not something to read instead of
 * the fight.
 */
const CHEVRON_HALF_WIDTH_M = 0.26;
/** Tip-to-tail length of the chevron, metres. */
const CHEVRON_LENGTH_M = 0.42;
/** How deep the notch in the chevron's tail cuts, as a fraction of its length. */
const CHEVRON_NOTCH = 0.34;
/** Height of the skull icon riding inside the chevron, metres. */
const SKULL_HEIGHT_M = 0.62;
/** Gap between the skull's crown and the chevron's tail, metres. */
const SKULL_GAP_M = 0.12;
/** Height above the chassis origin the marker floats at, metres. */
const HEIGHT_OFFSET_M = 0.15;

/** Orbit radius is clamped to this band, so no rig hides or outruns the marker. */
const MIN_ORBIT_RADIUS_M = 4;
const MAX_ORBIT_RADIUS_M = 10;
/** Clearance between the chassis footprint and the marker's orbit, metres. */
export const ORBIT_MARGIN_M = 3.2;

/** At or inside this distance the marker is fully hot. */
const URGENT_DISTANCE_M = 6;
/** At or beyond this distance the marker is fully calm. */
const CALM_DISTANCE_M = 34;
/** Calm tint: the minimap's mine-warning amber. */
const CALM_COLOR = 0xffae3d;
/** Hot tint: the minimap's horde red. */
const URGENT_COLOR = 0xff3b30;
const CALM_OPACITY = 0.22;
const URGENT_OPACITY = 0.62;
/** Urgency-scaled throb, so a zombie on top of the rig reads as an alarm. */
const PULSE_HZ = 2.6;
const PULSE_DEPTH = 0.22;

/**
 * Seconds for the marker to cover most of the way to a new bearing. Short
 * enough to feel attached to the threat, long enough that two zombies trading
 * the "nearest" spot make it swing rather than flicker.
 */
const TURN_TAU_SECONDS = 0.07;
/** Seconds the marker takes to fade in or out as threats appear and die. */
const FADE_TAU_SECONDS = 0.12;

/**
 * Half-extent of `chassis` on the ground plane, measured from its own origin
 * rather than from the centre of its box: the marker orbits the point the rig's
 * transform sits on, so a lopsided build must not let the far corner poke
 * through the ring.
 */
export function chassisFootprintRadiusM(chassis: THREE.Object3D): number {
  const box = new THREE.Box3().setFromObject(chassis);
  if (box.isEmpty()) return MIN_ORBIT_RADIUS_M;
  return Math.max(
    Math.abs(box.min.x),
    Math.abs(box.max.x),
    Math.abs(box.min.z),
    Math.abs(box.max.z),
  );
}

/** Anything with a world render position can be pointed at. */
export interface ThreatTarget {
  /** World position; only x and z are read. */
  readonly position: THREE.Vector3;
}

export interface ThreatBearing {
  /** World yaw of the threat from the rig, matching `Math.atan2(dx, dz)`. */
  readonly bearingRad: number;
  /** Ground-plane distance to the threat, metres. */
  readonly distanceM: number;
}

/**
 * Bearing and range of the closest target on the ground plane, or null when
 * nothing is left to point at. Height is deliberately ignored: the marker lies
 * flat, so a zombie on a ramp should not read as further away than one beside
 * it.
 */
export function nearestThreat(
  targets: readonly ThreatTarget[],
  originX: number,
  originZ: number,
): ThreatBearing | null {
  let nearestDistanceSq = Infinity;
  let nearestX = 0;
  let nearestZ = 0;
  for (const target of targets) {
    const dx = target.position.x - originX;
    const dz = target.position.z - originZ;
    const distanceSq = dx * dx + dz * dz;
    if (distanceSq >= nearestDistanceSq) continue;
    nearestDistanceSq = distanceSq;
    nearestX = dx;
    nearestZ = dz;
  }
  if (nearestDistanceSq === Infinity) return null;
  // A zombie standing exactly on the origin has no bearing to report; keep the
  // marker where it is rather than snapping it to +Z.
  if (nearestDistanceSq < 1e-8) return null;
  return {
    bearingRad: Math.atan2(nearestX, nearestZ),
    distanceM: Math.sqrt(nearestDistanceSq),
  };
}

/** Shortest signed rotation from `from` to `to`, in (-PI, PI]. */
export function angleDelta(from: number, to: number): number {
  let delta = (to - from) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
}

/** 0 at {@link CALM_DISTANCE_M} or further, 1 at {@link URGENT_DISTANCE_M} or closer. */
export function threatUrgency(distanceM: number): number {
  const t =
    (CALM_DISTANCE_M - distanceM) / (CALM_DISTANCE_M - URGENT_DISTANCE_M);
  return Math.min(1, Math.max(0, t));
}

/** Exponential approach that is stable at any frame rate. */
function approach(current: number, target: number, tau: number, dt: number) {
  if (dt <= 0) return current;
  return current + (target - current) * (1 - Math.exp(-dt / tau));
}

export class ThreatPointer {
  /** Scene node holding both marker pieces; exposed so captures can hide it. */
  readonly root = new THREE.Group();
  private readonly material: THREE.MeshBasicMaterial;
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly calmColor = new THREE.Color(CALM_COLOR);
  private readonly urgentColor = new THREE.Color(URGENT_COLOR);
  /** Smoothed bearing actually drawn, world radians. */
  private bearing = 0;
  /** Whether `bearing` has ever been aimed; the first threat snaps to it. */
  private aimed = false;
  /** Smoothed 0..1 urgency, so a kill next to the rig does not snap to calm. */
  private urgency = 0;
  /** Smoothed 0..1 presence, driving the fade in and out. */
  private presence = 0;
  private pulsePhase = 0;

  constructor(
    private readonly scene: THREE.Scene,
    /** Distance from the chassis origin the marker orbits at, metres. */
    orbitRadiusM: number,
  ) {
    const radius = Math.min(
      MAX_ORBIT_RADIUS_M,
      Math.max(
        MIN_ORBIT_RADIUS_M,
        Number.isFinite(orbitRadiusM) ? orbitRadiusM : MIN_ORBIT_RADIUS_M,
      ),
    );
    this.material = new THREE.MeshBasicMaterial({
      color: CALM_COLOR,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    // Both pieces are built lying in the XZ plane pointing along local +Z, so
    // aiming the marker is a single yaw on the group.
    const chevron = new THREE.Mesh(this.chevronGeometry(radius), this.material);
    chevron.name = 'threat-pointer-chevron';
    const skull = new THREE.Mesh(this.skullGeometry(radius), this.material);
    skull.name = 'threat-pointer-skull';
    this.root.name = 'threat-pointer';
    this.root.add(chevron, skull);
    this.root.visible = false;
    // Drawn after the ground and the chassis so a marker that grazes either
    // still reads as a HUD mark rather than sinking into the scenery.
    this.root.renderOrder = 4;
    this.scene.add(this.root);
  }

  /**
   * Aim, tint, and fade the marker for this frame. `targets` is the live
   * targetable set — charmed allies are already absent from it, so the marker
   * only ever points at something hostile.
   */
  update(
    frameDt: number,
    vehicleX: number,
    vehicleY: number,
    vehicleZ: number,
    targets: readonly ThreatTarget[],
  ): void {
    const threat = nearestThreat(targets, vehicleX, vehicleZ);
    if (threat !== null) {
      // The first threat of a wave appears at its true bearing instead of
      // sweeping in from whatever the last wave left behind.
      this.bearing = this.aimed
        ? this.bearing +
          approach(
            0,
            angleDelta(this.bearing, threat.bearingRad),
            TURN_TAU_SECONDS,
            frameDt,
          )
        : threat.bearingRad;
      this.aimed = true;
      this.urgency = approach(
        this.urgency,
        threatUrgency(threat.distanceM),
        FADE_TAU_SECONDS,
        frameDt,
      );
    }
    this.presence = approach(
      this.presence,
      threat === null ? 0 : 1,
      FADE_TAU_SECONDS,
      frameDt,
    );
    if (this.presence < 0.01) {
      this.root.visible = false;
      return;
    }

    this.pulsePhase =
      (this.pulsePhase + frameDt * PULSE_HZ * Math.PI * 2) % (Math.PI * 2);
    const pulse =
      1 - PULSE_DEPTH * this.urgency * (0.5 - 0.5 * Math.cos(this.pulsePhase));

    this.root.visible = true;
    this.root.position.set(vehicleX, vehicleY + HEIGHT_OFFSET_M, vehicleZ);
    this.root.rotation.y = this.bearing;
    this.material.color
      .copy(this.calmColor)
      .lerp(this.urgentColor, this.urgency);
    this.material.opacity =
      (CALM_OPACITY + (URGENT_OPACITY - CALM_OPACITY) * this.urgency) *
      this.presence *
      pulse;
  }

  /** Drop the marker between waves so it does not sweep in from a stale bearing. */
  reset(): void {
    this.aimed = false;
    this.presence = 0;
    this.urgency = 0;
    this.root.visible = false;
    this.material.opacity = 0;
  }

  dispose(): void {
    this.scene.remove(this.root);
    for (const geometry of this.geometries) geometry.dispose();
    this.geometries.length = 0;
    this.material.dispose();
  }

  /** Flat arrowhead sitting just outside the orbit, tip pointing along +Z. */
  private chevronGeometry(radius: number): THREE.BufferGeometry {
    const tail = radius;
    const tip = radius + CHEVRON_LENGTH_M;
    const notch = tail + CHEVRON_LENGTH_M * CHEVRON_NOTCH;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(
        [
          0,
          0,
          tip,
          -CHEVRON_HALF_WIDTH_M,
          0,
          tail,
          0,
          0,
          notch,

          0,
          0,
          tip,
          0,
          0,
          notch,
          CHEVRON_HALF_WIDTH_M,
          0,
          tail,
        ],
        3,
      ),
    );
    this.geometries.push(geometry);
    return geometry;
  }

  /**
   * Flat zombie skull sitting just inside the chevron, crown pointing outward.
   *
   * Authored as one silhouette in icon space — x right, y up, roughly one unit
   * tall — with the sockets, nose, and tooth gaps punched through as holes, so
   * the ground shows through them instead of the icon needing a second colour.
   * The sockets are deliberately mismatched: a clean symmetrical skull reads as
   * a pirate flag, a lopsided one reads as something that used to be a person.
   */
  private skullGeometry(radius: number): THREE.BufferGeometry {
    const shape = new THREE.Shape();
    // Cranium: temples up over a domed crown, then down past the cheekbones.
    shape.moveTo(-0.5, 0.06);
    shape.quadraticCurveTo(-0.5, 0.56, 0, 0.56);
    shape.quadraticCurveTo(0.5, 0.56, 0.5, 0.06);
    // Cheeks pinching in to the jaw.
    shape.lineTo(0.4, -0.16);
    shape.lineTo(0.27, -0.24);
    shape.lineTo(0.27, -0.5);
    shape.lineTo(-0.27, -0.5);
    shape.lineTo(-0.27, -0.24);
    shape.lineTo(-0.4, -0.16);
    shape.closePath();

    const socket = (x: number, y: number, rx: number, ry: number): THREE.Path =>
      new THREE.Path().absellipse(x, y, rx, ry, 0, Math.PI * 2, true, 0);
    const slot = (x: number, halfWidth: number): THREE.Path => {
      const path = new THREE.Path();
      path.moveTo(x - halfWidth, -0.5);
      path.lineTo(x - halfWidth, -0.28);
      path.lineTo(x + halfWidth, -0.28);
      path.lineTo(x + halfWidth, -0.5);
      path.closePath();
      return path;
    };
    shape.holes.push(
      socket(-0.22, 0.16, 0.17, 0.15),
      socket(0.23, 0.18, 0.13, 0.12),
      // Nose: a narrow wedge between the sockets.
      (() => {
        const nose = new THREE.Path();
        nose.moveTo(0, 0.02);
        nose.lineTo(-0.08, -0.14);
        nose.lineTo(0.08, -0.14);
        nose.closePath();
        return nose;
      })(),
      slot(-0.09, 0.03),
      slot(0.09, 0.03),
    );

    const geometry = new THREE.ShapeGeometry(shape, 12);
    geometry.scale(SKULL_HEIGHT_M, SKULL_HEIGHT_M, 1);
    // Icon space is XY; this lays it flat with icon-up along +Z, so the crown
    // faces the same way the chevron points.
    geometry.rotateX(Math.PI / 2);
    // Crown (y = 0.56 before scaling) tucked under the chevron's tail.
    geometry.translate(
      0,
      0,
      radius - SKULL_GAP_M - 0.56 * SKULL_HEIGHT_M,
    );
    this.geometries.push(geometry);
    return geometry;
  }
}
