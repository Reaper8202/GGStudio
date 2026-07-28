/**
 * Upgrade hardware: the geometry that makes a part's level readable on the
 * model instead of only in the garage panel.
 *
 * Every unlock in `core/partUpgrades.ts` has a matching piece here, added on
 * top of whatever the part already builds. Nothing is replaced — a fully
 * upgraded part is the base part with five bolted-on additions, so the
 * silhouette grows the way a scavenged rig should. The names in that file
 * describe this geometry; change one and change the other.
 *
 * Two rules keep the kits from all looking the same:
 * - Each model gets its own parts. A sawblade earns a blade guard, a spike ram
 *   earns longer spikes; neither gets the other's.
 * - Steel by default. Lit geometry belongs only to hardware that is actually an
 *   energy device — the ability emitters, the cryo rings, the flame pilots —
 *   never as a generic "this is upgraded" sticker.
 *
 * All of it is detail: no piece carries `userData.placementSurface`, so a drum
 * magazine or an exhaust stack can never become a build face.
 */

import * as THREE from 'three';
import {
  CELL_SIZE,
  type PartDefinition,
  type PlacedPart,
  type WheelDefinition,
} from '../../core/types.ts';
import { footprintCentreM } from '../../core/mass.ts';
import { upgradeTrackFor } from '../../core/partUpgrades.ts';
import {
  DARK_STEEL,
  STEEL,
  edgesOf,
  glowLambert,
  lambert,
  orientationQuaternion,
  shade,
} from './shared.ts';

/** Only for hardware that emits something: cryo rings, pilots, emitters. */
const FROST = 0x8fe3ff;
const PILOT_FLAME = 0xffa03a;
const EMITTER = 0x7ce8ff;
/** The turret's EMP coil arc — the only lit part on a non-energy gun. */
const EMP_ARC = 0x9fd8ff;

/** The level a placed part is actually at, clamped to a sane floor. */
export function placedUpgradeLevel(placed: Pick<PlacedPart, 'config'>): number {
  const level = placed.config.level ?? 1;
  return Number.isFinite(level) ? Math.max(1, Math.floor(level)) : 1;
}

/** Detail box: edged like the part bodies but never a placement surface. */
function greebleBox(
  w: number,
  h: number,
  d: number,
  color: number,
  opacity: number,
): THREE.Group {
  const group = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), lambert(color, opacity));
  group.add(mesh, edgesOf(mesh.geometry, opacity));
  return group;
}

/** Cylinder lying along local +Z (the direction parts call "forward"). */
function tube(
  radiusFront: number,
  radiusBack: number,
  length: number,
  material: THREE.Material,
  segments = 10,
): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(radiusFront, radiusBack, length, segments),
    material,
  );
  mesh.rotation.x = Math.PI / 2;
  return mesh;
}

/** A stack of cooling fins rising along +Y. */
function finStack(
  count: number,
  width: number,
  depth: number,
  spacing: number,
  material: THREE.Material,
): THREE.Group {
  const fins = new THREE.Group();
  const geometry = new THREE.BoxGeometry(width, spacing * 0.34, depth);
  for (let i = 0; i < count; i++) {
    const fin = new THREE.Mesh(geometry, material);
    fin.position.y = i * spacing;
    fins.add(fin);
  }
  return fins;
}

/** Ring of spikes about `axis`, pointing outwards. */
function spikeRing(
  count: number,
  radius: number,
  length: number,
  material: THREE.Material,
  axis: 'x' | 'y' | 'z' = 'y',
): THREE.Group {
  const ring = new THREE.Group();
  const geometry = new THREE.ConeGeometry(length * 0.42, length, 5);
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2;
    const spike = new THREE.Mesh(geometry, material);
    const cos = Math.cos(angle) * radius;
    const sin = Math.sin(angle) * radius;
    // Cone geometry points along +Y; lay it down so it points out of the ring.
    if (axis === 'y') {
      spike.position.set(cos, 0, sin);
      spike.rotation.z = -Math.PI / 2;
      spike.rotation.y = -angle;
    } else if (axis === 'z') {
      spike.position.set(cos, sin, 0);
      spike.rotation.z = angle - Math.PI / 2;
    } else {
      spike.position.set(0, cos, sin);
      spike.rotation.x = angle;
    }
    ring.add(spike);
  }
  return ring;
}

/* ------------------------------------------------------------------ weapons */

interface Muzzle {
  /** Local Z of the barrel crown. */
  z: number;
  radius: number;
  /** Local Y the barrel runs at. */
  y: number;
}

/** Where the gun's main tube ends, so barrel work fits any of them. */
function barrelMuzzle(hardware: THREE.Group): Muzzle | null {
  const barrel = hardware.getObjectByName('weapon-barrel');
  if (!(barrel instanceof THREE.Mesh)) return null;
  const parameters = (barrel.geometry as THREE.CylinderGeometry).parameters as
    | { radiusTop?: number; height?: number }
    | undefined;
  if (parameters?.height === undefined) return null;
  return {
    z: barrel.position.z + parameters.height / 2,
    radius: parameters.radiusTop ?? CELL_SIZE * 0.06,
    y: barrel.position.y,
  };
}

/** Sleeve down the last of the tube plus a brake past the crown. */
function barrelExtension(
  hardware: THREE.Group,
  muzzle: Muzzle,
  s: number,
  opacity: number,
  brakePorts: boolean,
): void {
  const steel = lambert(STEEL, opacity);
  const gunmetal = lambert(DARK_STEEL, opacity);
  const sleeve = tube(muzzle.radius * 1.5, muzzle.radius * 1.8, s * 0.34, steel, 12);
  sleeve.position.set(0, muzzle.y, muzzle.z - s * 0.24);
  hardware.add(sleeve);
  const brake = tube(muzzle.radius * 2.1, muzzle.radius * 2.1, s * 0.2, gunmetal, 10);
  brake.position.set(0, muzzle.y, muzzle.z + s * 0.16);
  hardware.add(brake);
  if (!brakePorts) return;
  for (const side of [-1, 1]) {
    const port = new THREE.Mesh(
      new THREE.BoxGeometry(muzzle.radius * 1.1, muzzle.radius * 3, s * 0.07),
      gunmetal,
    );
    port.position.set(side * muzzle.radius * 2, muzzle.y, muzzle.z + s * 0.16);
    hardware.add(port);
  }
}

/** Hydraulic rams over the breech — the shared "it kicks hard" fitting. */
function recoilRams(
  hardware: THREE.Group,
  s: number,
  opacity: number,
  y: number,
  spread: number,
): void {
  const steel = lambert(STEEL, opacity);
  const gunmetal = lambert(DARK_STEEL, opacity);
  for (const side of [-1, 1]) {
    const ram = tube(s * 0.055, s * 0.055, s * 0.66, steel, 8);
    ram.position.set(side * s * spread, y, s * 0.24);
    hardware.add(ram);
    const collar = tube(s * 0.08, s * 0.08, s * 0.12, gunmetal, 8);
    collar.position.set(side * s * spread, y, s * 0.5);
    hardware.add(collar);
  }
}

/**
 * Zombie Blaster: twin autocannon. Two of its unlocks change how the gun
 * resolves hits — the EMP coil and the piercing rack — so both get hardware a
 * player can point at when asking why this turret shoots through shields.
 */
function addTurretUpgrades(
  hardware: THREE.Group,
  level: number,
  color: number,
  opacity: number,
  s: number,
): void {
  const gunmetal = lambert(DARK_STEEL, opacity);
  const muzzle = barrelMuzzle(hardware);

  if (level >= 2 && muzzle) barrelExtension(hardware, muzzle, s, opacity, true);

  if (level >= 3) {
    const drum = new THREE.Mesh(
      new THREE.CylinderGeometry(s * 0.22, s * 0.22, s * 0.2, 14),
      lambert(shade(color, 0.6), opacity),
    );
    drum.rotation.z = Math.PI / 2;
    drum.position.set(-s * 0.42, -s * 0.04, -s * 0.16);
    hardware.add(drum);
    const chute = greebleBox(s * 0.26, s * 0.1, s * 0.12, 0xb08a3a, opacity);
    chute.position.set(-s * 0.26, s * 0.06, -s * 0.02);
    chute.rotation.z = 0.35;
    hardware.add(chute);
  }

  // 4 — EMP Coil: windings around the shroud and the capacitor driving them.
  // The one lit part on any gun that is not itself an energy weapon, because
  // the shield-stripping effect has to be visible from outside the panel.
  if (level >= 4) {
    for (const z of [0.5, 0.66, 0.82]) {
      const winding = new THREE.Mesh(
        new THREE.TorusGeometry(s * 0.21, s * 0.028, 6, 14),
        lambert(0xa8672f, opacity),
      );
      winding.position.set(0, 0, z * s);
      hardware.add(winding);
    }
    const capacitor = greebleBox(s * 0.18, s * 0.2, s * 0.24, shade(color, 0.62), opacity);
    capacitor.position.set(s * 0.36, s * 0.16, -s * 0.12);
    hardware.add(capacitor);
    const arc = tube(s * 0.05, s * 0.05, s * 0.04, glowLambert(EMP_ARC, opacity, 0.8), 8);
    arc.position.set(s * 0.36, s * 0.3, -s * 0.12);
    hardware.add(arc);
  }

  // 5 — Piercing Rounds: a rack of dart-tipped shells on the loading side.
  if (level >= 5) {
    const rack = greebleBox(s * 0.14, s * 0.1, s * 0.46, shade(color, 0.7), opacity);
    rack.position.set(s * 0.4, -s * 0.12, s * 0.04);
    hardware.add(rack);
    for (const z of [-0.1, 0.04, 0.18]) {
      const round = tube(s * 0.035, s * 0.035, s * 0.2, lambert(0xb08a3a, opacity), 8);
      round.position.set(s * 0.4, s * 0.0, z * s);
      hardware.add(round);
      const dart = new THREE.Mesh(new THREE.ConeGeometry(s * 0.035, s * 0.1, 5), gunmetal);
      dart.rotation.x = Math.PI / 2;
      dart.position.set(s * 0.4, s * 0.0, (z + 0.15) * s);
      hardware.add(dart);
    }
  }

  if (level >= 6) recoilRams(hardware, s, opacity, s * 0.24, 0.22);
}

/** Heavy Cannon: rack, rams, rangefinder, skirts — all turret furniture. */
function addCannonUpgrades(
  hardware: THREE.Group,
  level: number,
  color: number,
  opacity: number,
  s: number,
): void {
  const steel = lambert(STEEL, opacity);
  const muzzle = barrelMuzzle(hardware);

  if (level >= 2 && muzzle) barrelExtension(hardware, muzzle, s, opacity, true);

  if (level >= 3) {
    // Ready rack of shells along the left flank, nose-forward.
    const rack = greebleBox(s * 0.2, s * 0.16, s * 0.5, shade(color, 0.58), opacity);
    rack.position.set(-s * 0.56, s * 0.3, -s * 0.1);
    hardware.add(rack);
    for (const z of [-0.24, -0.08, 0.08]) {
      const shell = tube(s * 0.05, s * 0.05, s * 0.22, lambert(0xb08a3a, opacity), 8);
      shell.position.set(-s * 0.56, s * 0.44, z * s);
      hardware.add(shell);
    }
  }

  if (level >= 4) recoilRams(hardware, s, opacity, s * 0.42, 0.34);

  if (level >= 5) {
    // Coincidence rangefinder: a bar across the roof with a horn each end.
    const bar = greebleBox(s * 1.0, s * 0.1, s * 0.12, shade(color, 0.72), opacity);
    bar.position.set(0, s * 0.62, -s * 0.14);
    hardware.add(bar);
    for (const side of [-1, 1]) {
      const horn = tube(s * 0.07, s * 0.05, s * 0.14, steel, 8);
      horn.position.set(side * s * 0.5, s * 0.62, -s * 0.08);
      hardware.add(horn);
    }
  }

  if (level >= 6) {
    // Skirts hanging off the turret ring, canted out at the bottom.
    for (const side of [-1, 1]) {
      const skirt = greebleBox(s * 0.08, s * 0.42, s * 1.0, shade(color, 0.66), opacity);
      skirt.position.set(side * s * 0.66, -s * 0.24, -s * 0.06);
      skirt.rotation.z = side * -0.16;
      hardware.add(skirt);
    }
  }
}

/** Light Sniper: precision furniture, nothing that adds bulk. */
function addSniperUpgrades(
  hardware: THREE.Group,
  level: number,
  color: number,
  opacity: number,
  s: number,
): void {
  const steel = lambert(STEEL, opacity);
  const gunmetal = lambert(DARK_STEEL, opacity);
  const muzzle = barrelMuzzle(hardware);

  if (level >= 2 && muzzle) barrelExtension(hardware, muzzle, s, opacity, false);

  if (level >= 3) {
    // Deployed feet under the folded bipod the base gun already carries.
    const footGeometry = new THREE.BoxGeometry(s * 0.14, s * 0.04, s * 0.1);
    for (const side of [-1, 1]) {
      const foot = new THREE.Mesh(footGeometry, steel);
      foot.position.set(side * s * 0.2, -s * 0.44, s * 0.72);
      hardware.add(foot);
    }
  }

  if (level >= 4) {
    // Longer scope body ahead of the stock optic, with a lit reticle.
    const glass = tube(s * 0.085, s * 0.085, s * 0.3, gunmetal, 10);
    glass.position.set(0, s * 0.32, s * 0.76);
    hardware.add(glass);
    const reticle = tube(s * 0.06, s * 0.06, s * 0.02, glowLambert(PILOT_FLAME, opacity, 0.7), 8);
    reticle.position.set(0, s * 0.32, s * 0.9);
    hardware.add(reticle);
  }

  if (level >= 5 && muzzle) {
    const can = tube(muzzle.radius * 2.6, muzzle.radius * 2.6, s * 0.44, gunmetal, 10);
    can.position.set(0, muzzle.y, muzzle.z + s * 0.44);
    hardware.add(can);
  }

  if (level >= 6) {
    const rest = greebleBox(s * 0.18, s * 0.12, s * 0.2, shade(color, 0.6), opacity);
    rest.position.set(0, -s * 0.02, -s * 0.5);
    hardware.add(rest);
    const rail = greebleBox(s * 0.08, s * 0.05, s * 0.5, STEEL, opacity);
    rail.position.set(0, s * 0.2, -s * 0.2);
    hardware.add(rail);
  }
}

/** Ice Cannon: everything cold — bottles, condenser, rings, prongs. */
function addIceUpgrades(
  hardware: THREE.Group,
  level: number,
  color: number,
  opacity: number,
  s: number,
): void {
  const steel = lambert(STEEL, opacity);
  const frost = glowLambert(FROST, opacity, 0.7);
  const muzzle = barrelMuzzle(hardware);

  if (level >= 2 && muzzle) barrelExtension(hardware, muzzle, s, opacity, false);

  if (level >= 3) {
    for (const side of [-1, 1]) {
      const bottle = tube(s * 0.1, s * 0.1, s * 0.44, steel, 10);
      bottle.position.set(side * s * 0.34, s * 0.4, s * 0.02);
      hardware.add(bottle);
    }
  }

  if (level >= 4) {
    const fins = finStack(4, s * 0.44, s * 0.1, s * 0.08, lambert(shade(color, 0.7), opacity));
    fins.position.set(0, s * 0.24, -s * 0.34);
    hardware.add(fins);
  }

  if (level >= 5 && muzzle) {
    for (const offset of [-0.3, -0.05]) {
      const ring = tube(muzzle.radius * 2.4, muzzle.radius * 2.4, s * 0.05, frost, 12);
      ring.position.set(0, muzzle.y, muzzle.z + offset * s);
      hardware.add(ring);
    }
  }

  if (level >= 6 && muzzle) {
    const prongs = spikeRing(4, muzzle.radius * 2.2, s * 0.3, steel, 'z');
    prongs.position.set(0, muzzle.y, muzzle.z + s * 0.16);
    hardware.add(prongs);
  }
}

/** Flamethrower: fuel and fire, never optics. */
function addFlameUpgrades(
  hardware: THREE.Group,
  level: number,
  color: number,
  opacity: number,
  s: number,
): void {
  const steel = lambert(STEEL, opacity);
  const flame = glowLambert(PILOT_FLAME, opacity, 0.8);
  const muzzle = barrelMuzzle(hardware);

  if (level >= 2 && muzzle) {
    const extension = tube(muzzle.radius * 1.4, muzzle.radius * 1.7, s * 0.4, steel, 12);
    extension.position.set(0, muzzle.y, muzzle.z + s * 0.14);
    hardware.add(extension);
    const flare = tube(muzzle.radius * 2.2, muzzle.radius * 1.4, s * 0.16, steel, 12);
    flare.position.set(0, muzzle.y, muzzle.z + s * 0.4);
    hardware.add(flare);
  }

  if (level >= 3) {
    // Third bottle centred behind the pair the base gun carries.
    const bottle = new THREE.Mesh(
      new THREE.CylinderGeometry(s * 0.13, s * 0.13, s * 0.46, 12),
      steel,
    );
    bottle.position.set(0, s * 0.26, -s * 0.4);
    hardware.add(bottle);
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(s * 0.13, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2),
      steel,
    );
    dome.scale.y = 0.5;
    dome.position.set(0, s * 0.49, -s * 0.4);
    hardware.add(dome);
  }

  if (level >= 4) {
    for (const z of [0.16, 0.34, 0.52]) {
      const rib = tube(s * 0.19, s * 0.19, s * 0.05, lambert(shade(color, 0.72), opacity), 12);
      rib.position.set(0, s * 0.04, z * s);
      hardware.add(rib);
    }
  }

  if (level >= 5 && muzzle) {
    for (const side of [-1, 1]) {
      const pilot = new THREE.Mesh(new THREE.SphereGeometry(s * 0.045, 8, 6), flame);
      pilot.position.set(side * s * 0.14, muzzle.y + s * 0.1, muzzle.z);
      hardware.add(pilot);
    }
  }

  if (level >= 6) {
    const rail = greebleBox(s * 0.12, s * 0.1, s * 0.72, shade(color, 0.6), opacity);
    rail.position.set(-s * 0.34, -s * 0.16, s * 0.04);
    hardware.add(rail);
  }
}

/**
 * Bolt a gun's unlocked hardware onto its aiming group. `scale` is the mount's
 * span in cells, so the heavy cannon's kit grows with its barbette instead of
 * disappearing against a 2x2 turret.
 */
export function addWeaponUpgrades(
  hardware: THREE.Group,
  defId: string,
  level: number,
  color: number,
  opacity: number,
  scale = 1,
): void {
  if (level < 2) return;
  const s = CELL_SIZE * scale;
  switch (defId) {
    case 'cannon-heavy':
      addCannonUpgrades(hardware, level, color, opacity, s);
      break;
    case 'sniper-light':
      addSniperUpgrades(hardware, level, color, opacity, s);
      break;
    case 'ice-cannon':
      addIceUpgrades(hardware, level, color, opacity, s);
      break;
    case 'flamethrower':
      addFlameUpgrades(hardware, level, color, opacity, s);
      break;
    default:
      addTurretUpgrades(hardware, level, color, opacity, s);
      break;
  }
}

/* ------------------------------------------------------------------- wheels */

/**
 * Wheel hardware, added inside the spinning group: local +Y is the axle, so
 * "across the tyre" is Y and the tread runs around XZ.
 */
export function addWheelUpgrades(
  spin: THREE.Group,
  wheel: WheelDefinition,
  level: number,
  color: number,
  opacity: number,
): void {
  if (level < 2) return;
  const radius = wheel.radius;
  const halfWidth = wheel.width / 2;
  const steel = lambert(STEEL, opacity);
  const rim = lambert(shade(color, 1.25), opacity);

  // 2 — Beadlock Rims: a clamped ring on each sidewall.
  for (const side of [-1, 1]) {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(radius * 0.62, radius * 0.06, 6, 18),
      rim,
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = side * halfWidth * 0.94;
    spin.add(ring);
  }

  // 3 — Studded Tread: studs standing proud of the tread blocks.
  if (level >= 3) {
    spin.add(spikeRing(10, radius * 0.98, radius * 0.2, steel, 'y'));
  }

  // 4 — Stiff Sidewalls: ribs spoking out across each wall.
  if (level >= 4) {
    const ribGeometry = new THREE.BoxGeometry(radius * 0.06, radius * 0.05, radius * 0.5);
    for (const side of [-1, 1]) {
      for (let i = 0; i < 6; i++) {
        const rib = new THREE.Mesh(ribGeometry, steel);
        const angle = (i / 6) * Math.PI * 2 + (side > 0 ? 0.26 : 0);
        rib.position.set(
          Math.cos(angle) * radius * 0.72,
          side * halfWidth,
          Math.sin(angle) * radius * 0.72,
        );
        rib.rotation.y = -angle;
        spin.add(rib);
      }
    }
  }

  // 5 — Hub Guards: a bolted disc capping the axle on both sides.
  if (level >= 5) {
    for (const side of [-1, 1]) {
      const guard = new THREE.Mesh(
        new THREE.CylinderGeometry(radius * 0.4, radius * 0.34, wheel.width * 0.1, 8),
        rim,
      );
      guard.position.y = side * halfWidth * 1.2;
      spin.add(guard);
    }
  }

  // 6 — Drive Sprocket: a toothed ring on the drive side of the hub.
  if (level >= 6) {
    const sprocket = new THREE.Mesh(
      new THREE.CylinderGeometry(radius * 0.3, radius * 0.3, wheel.width * 0.12, 12),
      steel,
    );
    sprocket.position.y = -halfWidth * 1.32;
    spin.add(sprocket);
    const teeth = spikeRing(10, radius * 0.32, radius * 0.12, steel, 'y');
    teeth.position.y = -halfWidth * 1.32;
    spin.add(teeth);
  }
}

/* ------------------------------------------------------------------- armour */

/**
 * Plate hardware, added inside the slab: local +Y is the outward face, and
 * `width`/`thickness` are the slab's own so a thin face skin gets a thin kit.
 */
export function addArmourUpgrades(
  slab: THREE.Group,
  width: number,
  thickness: number,
  level: number,
  color: number,
  opacity: number,
): void {
  if (level < 2) return;
  const face = thickness / 2;
  const steel = lambert(STEEL, opacity);

  // 2 — Bolted Layer: a second plate sitting proud of the first.
  const layer = greebleBox(width * 0.6, thickness * 0.5, width * 0.6, shade(color, 1.16), opacity);
  layer.position.y = face + thickness * 0.24;
  slab.add(layer);

  // 3 — Spike Studs: a face that hurts to hit.
  if (level >= 3) {
    const studGeometry = new THREE.ConeGeometry(width * 0.05, thickness * 1.1, 5);
    for (const x of [-1, 1]) {
      for (const z of [-1, 1]) {
        const stud = new THREE.Mesh(studGeometry, steel);
        stud.position.set(x * width * 0.22, face + thickness * 0.9, z * width * 0.22);
        slab.add(stud);
      }
    }
  }

  // 4 — Ribbed Backing: ribs across the mounting side, spreading the load.
  if (level >= 4) {
    const ribGeometry = new THREE.BoxGeometry(width * 0.86, thickness * 0.5, width * 0.07);
    for (const z of [-0.28, 0, 0.28]) {
      const rib = new THREE.Mesh(ribGeometry, lambert(shade(color, 0.7), opacity));
      rib.position.set(0, -face - thickness * 0.2, z * width);
      slab.add(rib);
    }
  }

  // 5 — Ablative Bricks: bolt-on blocks tiled across the corners.
  if (level >= 5) {
    for (const x of [-1, 1]) {
      for (const z of [-1, 1]) {
        const brick = greebleBox(
          width * 0.2,
          thickness * 0.7,
          width * 0.2,
          shade(color, 0.55),
          opacity,
        );
        brick.position.set(x * width * 0.34, face + thickness * 0.3, z * width * 0.34);
        slab.add(brick);
      }
    }
  }

  // 6 — Sloped Cheeks: angled wedges down two edges, to glance a hit away.
  if (level >= 6) {
    for (const side of [-1, 1]) {
      const cheek = greebleBox(
        width * 0.94,
        thickness * 0.6,
        width * 0.18,
        shade(color, 0.78),
        opacity,
      );
      cheek.position.set(0, face + thickness * 0.1, side * width * 0.4);
      cheek.rotation.x = side * -0.5;
      slab.add(cheek);
    }
  }
}

/* --------------------------------------------------------------------- melee */

/** Barrel Drum: a grinder roller. Teeth, motor, scraper, end discs, shell. */
function addDrumUpgrades(
  kit: THREE.Group,
  level: number,
  color: number,
  opacity: number,
): void {
  const s = CELL_SIZE;
  const steel = lambert(STEEL, opacity);

  const teeth = spikeRing(8, s * 0.42, s * 0.16, steel, 'x');
  kit.add(teeth);

  if (level >= 3) {
    const motor = new THREE.Mesh(
      new THREE.CylinderGeometry(s * 0.13, s * 0.13, s * 0.22, 10),
      lambert(shade(color, 0.6), opacity),
    );
    motor.rotation.z = Math.PI / 2;
    motor.position.set(-s * 0.5, -s * 0.16, 0);
    kit.add(motor);
  }

  if (level >= 4) {
    const bar = greebleBox(s * 0.9, s * 0.07, s * 0.07, STEEL, opacity);
    bar.position.set(0, -s * 0.34, -s * 0.3);
    kit.add(bar);
  }

  if (level >= 5) {
    for (const side of [-1, 1]) {
      const disc = new THREE.Mesh(
        new THREE.CylinderGeometry(s * 0.46, s * 0.46, s * 0.05, 14),
        lambert(shade(color, 0.7), opacity),
      );
      disc.rotation.z = Math.PI / 2;
      disc.position.x = side * s * 0.46;
      kit.add(disc);
    }
  }

  if (level >= 6) {
    const shell = new THREE.Mesh(
      new THREE.CylinderGeometry(s * 0.4, s * 0.4, s * 0.86, 14, 1, true),
      lambert(shade(color, 1.15), opacity),
    );
    shell.rotation.z = Math.PI / 2;
    kit.add(shell);
  }
}

/** Spike Ram: points and the steel holding them. Nothing else. */
function addSpikeUpgrades(
  kit: THREE.Group,
  level: number,
  color: number,
  opacity: number,
): void {
  const s = CELL_SIZE;
  const steel = lambert(STEEL, opacity);

  // 2 — Longer Spikes: three points reaching past the stock ones.
  const spikeGeometry = new THREE.ConeGeometry(s * 0.07, s * 0.44, 5);
  for (const x of [-0.26, 0, 0.26]) {
    const spike = new THREE.Mesh(spikeGeometry, steel);
    spike.position.set(x * s, 0, s * 0.6);
    spike.rotation.x = Math.PI / 2;
    kit.add(spike);
  }

  // 3 — Backing Plate: the slab the points are welded through.
  if (level >= 3) {
    const plate = greebleBox(s * 0.9, s * 0.62, s * 0.1, shade(color, 0.72), opacity);
    plate.position.z = -s * 0.06;
    kit.add(plate);
  }

  // 4 — Cross Bar: one bar tying the points together.
  if (level >= 4) {
    const bar = greebleBox(s * 0.96, s * 0.09, s * 0.09, STEEL, opacity);
    bar.position.set(0, 0, s * 0.42);
    kit.add(bar);
  }

  // 5 — Side Horns: outer points angled out to catch a glancing body.
  if (level >= 5) {
    for (const side of [-1, 1]) {
      const horn = new THREE.Mesh(new THREE.ConeGeometry(s * 0.07, s * 0.4, 5), steel);
      horn.position.set(side * s * 0.44, 0, s * 0.3);
      horn.rotation.set(Math.PI / 2, 0, side * 0.5, 'ZYX');
      kit.add(horn);
    }
  }

  // 6 — Hardened Tips: dark caps on the ends of the long spikes.
  if (level >= 6) {
    const capGeometry = new THREE.ConeGeometry(s * 0.05, s * 0.16, 5);
    for (const x of [-0.26, 0, 0.26]) {
      const cap = new THREE.Mesh(capGeometry, lambert(DARK_STEEL, opacity));
      cap.position.set(x * s, 0, s * 0.86);
      cap.rotation.x = Math.PI / 2;
      kit.add(cap);
    }
  }
}

/** Sawblade: teeth, drive, guard, a second disc, a thicker rim. */
function addBladeUpgrades(
  kit: THREE.Group,
  level: number,
  color: number,
  opacity: number,
): void {
  const s = CELL_SIZE;
  const steel = lambert(STEEL, opacity);

  // 2 — Carbide Teeth: tips set around the disc's rim.
  const teeth = spikeRing(12, s * 0.46, s * 0.14, steel, 'x');
  kit.add(teeth);

  // 3 — Drive Belt: motor can and belt on the inboard side.
  if (level >= 3) {
    const motor = new THREE.Mesh(
      new THREE.CylinderGeometry(s * 0.12, s * 0.12, s * 0.2, 10),
      lambert(shade(color, 0.6), opacity),
    );
    motor.rotation.z = Math.PI / 2;
    motor.position.set(-s * 0.4, -s * 0.3, 0);
    kit.add(motor);
    const belt = new THREE.Mesh(
      new THREE.TorusGeometry(s * 0.3, s * 0.03, 6, 14),
      lambert(DARK_STEEL, opacity),
    );
    belt.rotation.y = Math.PI / 2;
    belt.position.set(-s * 0.4, -s * 0.16, 0);
    kit.add(belt);
  }

  // 4 — Blade Guard: a hood over the top half of the disc.
  if (level >= 4) {
    const guard = new THREE.Mesh(
      new THREE.CylinderGeometry(s * 0.54, s * 0.54, s * 0.22, 14, 1, true, 0, Math.PI),
      lambert(shade(color, 0.8), opacity),
    );
    guard.rotation.z = Math.PI / 2;
    kit.add(guard);
  }

  // 5 — Second Disc: a smaller blade behind the first.
  if (level >= 5) {
    const disc = new THREE.Mesh(
      new THREE.CylinderGeometry(s * 0.34, s * 0.34, s * 0.04, 14),
      lambert(shade(color, 1.1), opacity),
    );
    disc.rotation.z = Math.PI / 2;
    disc.position.set(s * 0.2, 0, -s * 0.2);
    kit.add(disc);
  }

  // 6 — Hardened Rim: a thicker band around the main disc.
  if (level >= 6) {
    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(s * 0.44, s * 0.05, 6, 18),
      lambert(DARK_STEEL, opacity),
    );
    rim.rotation.y = Math.PI / 2;
    kit.add(rim);
  }
}

/** Dozer Blade: mouldboard furniture, sized off its three-cell nose. */
function addPlowUpgrades(
  kit: THREE.Group,
  level: number,
  color: number,
  opacity: number,
): void {
  const s = CELL_SIZE;
  const steel = lambert(STEEL, opacity);

  // 2 — Tall Mouldboard: a strip raising the top of the blade.
  const lip = greebleBox(s * 2.7, s * 0.3, s * 0.12, shade(color, 0.86), opacity);
  lip.position.set(0, s * 0.52, s * 0.2);
  lip.rotation.x = -0.3;
  kit.add(lip);

  // 3 — Side Wings: end plates angled in to hold the pile.
  if (level >= 3) {
    for (const side of [-1, 1]) {
      const wing = greebleBox(s * 0.12, s * 0.8, s * 0.6, shade(color, 0.72), opacity);
      wing.position.set(side * s * 1.42, s * 0.1, s * 0.14);
      wing.rotation.y = side * -0.34;
      kit.add(wing);
    }
  }

  // 4 — Bracing Ribs: vertical ribs up the back of the blade.
  if (level >= 4) {
    for (const x of [-0.9, 0, 0.9]) {
      const rib = greebleBox(s * 0.1, s * 0.7, s * 0.1, STEEL, opacity);
      rib.position.set(x * s, s * 0.02, -s * 0.26);
      kit.add(rib);
    }
  }

  // 5 — Skid Shoes: pads under each end so it rides instead of digs.
  if (level >= 5) {
    for (const side of [-1, 1]) {
      const shoe = greebleBox(s * 0.24, s * 0.1, s * 0.44, shade(color, 0.6), opacity);
      shoe.position.set(side * s * 1.2, -s * 0.44, 0);
      kit.add(shoe);
    }
  }

  // 6 — Cutting Edge: a hardened bar bolted along the bottom lip.
  if (level >= 6) {
    const edge = new THREE.Mesh(
      new THREE.BoxGeometry(s * 2.8, s * 0.14, s * 0.12),
      lambert(DARK_STEEL, opacity),
    );
    edge.position.set(0, -s * 0.42, s * 0.3);
    kit.add(edge);
    const wear = new THREE.Mesh(new THREE.BoxGeometry(s * 2.8, s * 0.05, s * 0.05), steel);
    wear.position.set(0, -s * 0.36, s * 0.36);
    kit.add(wear);
  }
}

/* -------------------------------------------------------------- block parts */

function addEngineUpgrades(
  kit: THREE.Group,
  level: number,
  color: number,
  opacity: number,
): void {
  const s = CELL_SIZE;
  const steel = lambert(STEEL, opacity);
  const gunmetal = lambert(DARK_STEEL, opacity);

  // 2 — Turbocharger: snail and compressor housing hung off the right bank.
  const snail = new THREE.Mesh(new THREE.TorusGeometry(s * 0.13, s * 0.07, 6, 12), steel);
  snail.rotation.y = Math.PI / 2;
  snail.position.set(s * 0.5, s * 0.06, s * 0.1);
  kit.add(snail);

  // 3 — Intercooler: a finned core across the nose.
  if (level >= 3) {
    const core = greebleBox(s * 0.7, s * 0.24, s * 0.1, shade(color, 0.6), opacity);
    core.position.set(0, -s * 0.08, -s * 0.5);
    kit.add(core);
    const fins = finStack(3, s * 0.66, s * 0.08, s * 0.07, steel);
    fins.position.set(0, -s * 0.14, -s * 0.5);
    kit.add(fins);
  }

  // 4 — Exhaust Stacks: pipes up out of the manifolds.
  if (level >= 4) {
    for (const side of [-1, 1]) {
      const stack = new THREE.Mesh(
        new THREE.CylinderGeometry(s * 0.06, s * 0.07, s * 0.6, 8),
        gunmetal,
      );
      stack.position.set(side * s * 0.34, s * 0.5, -s * 0.16);
      kit.add(stack);
      const tip = new THREE.Mesh(
        new THREE.CylinderGeometry(s * 0.08, s * 0.06, s * 0.08, 8),
        steel,
      );
      tip.position.set(side * s * 0.34, s * 0.82, -s * 0.16);
      kit.add(tip);
    }
  }

  // 5 — Race Cams: ribbed covers over both banks.
  if (level >= 5) {
    for (const side of [-1, 1]) {
      const cover = greebleBox(s * 0.16, s * 0.1, s * 0.62, shade(color, 1.2), opacity);
      cover.position.set(side * s * 0.24, s * 0.42, 0);
      kit.add(cover);
    }
  }

  // 6 — Nitrous Plate: a plain bottle plumbed into the valley.
  if (level >= 6) {
    const bottle = new THREE.Mesh(
      new THREE.CylinderGeometry(s * 0.11, s * 0.11, s * 0.5, 10),
      lambert(0x2f5f8a, opacity),
    );
    bottle.rotation.x = Math.PI / 2;
    bottle.position.set(-s * 0.46, s * 0.3, 0);
    kit.add(bottle);
    const valve = new THREE.Mesh(
      new THREE.CylinderGeometry(s * 0.04, s * 0.05, s * 0.1, 6),
      gunmetal,
    );
    valve.rotation.x = Math.PI / 2;
    valve.position.set(-s * 0.46, s * 0.3, s * 0.29);
    kit.add(valve);
  }
}

function addAbilityUpgrades(
  kit: THREE.Group,
  level: number,
  color: number,
  opacity: number,
): void {
  const s = CELL_SIZE;
  const steel = lambert(STEEL, opacity);

  // 2 — Focus Ring: a collar around the emitter.
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(s * 0.3, s * 0.045, 6, 16),
    lambert(shade(color, 1.2), opacity),
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = s * 0.52;
  kit.add(ring);

  // 3 — Capacitor Bank: charge cans strapped to the flank.
  if (level >= 3) {
    for (const z of [-0.2, 0.2]) {
      const can = new THREE.Mesh(
        new THREE.CylinderGeometry(s * 0.08, s * 0.08, s * 0.34, 8),
        lambert(shade(color, 0.6), opacity),
      );
      can.position.set(-s * 0.5, s * 0.06, z * s);
      kit.add(can);
    }
  }

  // 4 — Heat Sink: a finned stack on the opposite flank.
  if (level >= 4) {
    const fins = finStack(4, s * 0.1, s * 0.44, s * 0.08, steel);
    fins.position.set(s * 0.48, -s * 0.14, 0);
    kit.add(fins);
  }

  // 5 — Emitter Prongs: prongs reaching up past the dome.
  if (level >= 5) {
    for (let i = 0; i < 4; i++) {
      const angle = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const prong = new THREE.Mesh(new THREE.ConeGeometry(s * 0.04, s * 0.3, 5), steel);
      prong.position.set(Math.cos(angle) * s * 0.3, s * 0.66, Math.sin(angle) * s * 0.3);
      prong.rotation.set(Math.sin(angle) * 0.3, 0, -Math.cos(angle) * 0.3);
      kit.add(prong);
    }
  }

  // 6 — Reactor Core: the one part of the whole catalog that is meant to glow —
  // an ability block is an energy device, so its top unlock lights up.
  if (level >= 6) {
    const lens = new THREE.Mesh(
      new THREE.CylinderGeometry(s * 0.2, s * 0.2, s * 0.05, 12),
      glowLambert(EMITTER, opacity, 0.9),
    );
    lens.position.y = s * 0.72;
    kit.add(lens);
  }
}

function addTankUpgrades(
  kit: THREE.Group,
  level: number,
  color: number,
  opacity: number,
): void {
  const s = CELL_SIZE;
  const steel = lambert(STEEL, opacity);

  // 2 — Reserve Bottle: a spare strapped along the top.
  const bottle = new THREE.Mesh(
    new THREE.CylinderGeometry(s * 0.11, s * 0.11, s * 0.62, 10),
    lambert(shade(color, 0.7), opacity),
  );
  bottle.rotation.x = Math.PI / 2;
  bottle.position.set(s * 0.3, s * 0.44, 0);
  kit.add(bottle);

  // 3 — Baffle Bands: banding around the tank.
  if (level >= 3) {
    for (const z of [-0.26, 0.26]) {
      const band = greebleBox(s * 1.02, s * 1.02, s * 0.06, shade(color, 0.62), opacity);
      band.position.z = z * s;
      kit.add(band);
    }
  }

  // 4 — Armoured Skin: bolted plating up both flanks.
  if (level >= 4) {
    for (const side of [-1, 1]) {
      const plate = greebleBox(s * 0.08, s * 0.7, s * 0.8, shade(color, 1.18), opacity);
      plate.position.x = side * s * 0.5;
      kit.add(plate);
    }
  }

  // 5 — Filler Neck: a fat neck and cap on the top face.
  if (level >= 5) {
    const neck = new THREE.Mesh(
      new THREE.CylinderGeometry(s * 0.11, s * 0.13, s * 0.16, 10),
      steel,
    );
    neck.position.set(-s * 0.28, s * 0.56, -s * 0.2);
    kit.add(neck);
    const cap = new THREE.Mesh(
      new THREE.CylinderGeometry(s * 0.14, s * 0.14, s * 0.06, 8),
      lambert(DARK_STEEL, opacity),
    );
    cap.position.set(-s * 0.28, s * 0.66, -s * 0.2);
    kit.add(cap);
  }

  // 6 — Blast Cage: uprights and a top ring boxing the tank in.
  if (level >= 6) {
    for (const x of [-1, 1]) {
      for (const z of [-1, 1]) {
        const post = greebleBox(s * 0.08, s * 1.06, s * 0.08, STEEL, opacity);
        post.position.set(x * s * 0.5, 0, z * s * 0.5);
        kit.add(post);
      }
    }
    const hoop = new THREE.Mesh(
      new THREE.TorusGeometry(s * 0.62, s * 0.04, 6, 4),
      steel,
    );
    hoop.rotation.set(Math.PI / 2, 0, Math.PI / 4);
    hoop.position.y = s * 0.52;
    kit.add(hoop);
  }
}

function addFrameUpgrades(
  kit: THREE.Group,
  level: number,
  color: number,
  opacity: number,
): void {
  const s = CELL_SIZE;
  const steel = lambert(STEEL, opacity);

  // 2 — Bolted Plating: a skin panel over two faces.
  for (const side of [-1, 1]) {
    const panel = greebleBox(s * 0.06, s * 0.72, s * 0.72, shade(color, 1.2), opacity);
    panel.position.x = side * s * 0.51;
    kit.add(panel);
  }

  // 3 — Cross Bracing: a welded X over the front face.
  if (level >= 3) {
    for (const tilt of [0.7, -0.7]) {
      const brace = greebleBox(s * 0.09, s * 1.1, s * 0.06, STEEL, opacity);
      brace.position.z = s * 0.51;
      brace.rotation.z = tilt;
      kit.add(brace);
    }
  }

  // 4 — Corner Gussets: triangles tying the vertical edges together.
  if (level >= 4) {
    const gussetGeometry = new THREE.ConeGeometry(s * 0.13, s * 0.22, 3);
    for (const x of [-1, 1]) {
      for (const z of [-1, 1]) {
        for (const y of [-1, 1]) {
          const gusset = new THREE.Mesh(gussetGeometry, steel);
          gusset.position.set(x * s * 0.44, y * s * 0.44, z * s * 0.44);
          gusset.rotation.set(y > 0 ? 0 : Math.PI, 0, 0);
          kit.add(gusset);
        }
      }
    }
  }

  // 5 — Impact Padding: crush pads on the top face.
  if (level >= 5) {
    for (const x of [-1, 1]) {
      const pad = greebleBox(s * 0.34, s * 0.1, s * 0.78, shade(color, 0.55), opacity);
      pad.position.set(x * s * 0.24, s * 0.52, 0);
      kit.add(pad);
    }
  }

  // 6 — Roll Cage: tube hoops wrapped over the block.
  if (level >= 6) {
    for (const z of [-0.3, 0.3]) {
      const hoop = new THREE.Mesh(
        new THREE.TorusGeometry(s * 0.56, s * 0.045, 6, 4),
        steel,
      );
      hoop.rotation.z = Math.PI / 4;
      hoop.position.z = z * s;
      kit.add(hoop);
    }
  }
}

/**
 * Upgrade hardware for parts that are not guns, wheels or plates: engines,
 * melee heads, ability devices, fuel tanks and plain frame blocks.
 *
 * Returns a group already sitting at the part's footprint centre in the placed
 * orientation, or null when the part has nothing unlocked. Callers append it to
 * the part's mesh group.
 */
export function buildBlockUpgrades(
  def: PartDefinition,
  placed: PlacedPart,
  color: number,
  opacity = 1,
): THREE.Group | null {
  const level = placedUpgradeLevel(placed);
  if (level < 2 || def.upgrade === undefined) return null;

  const kit = new THREE.Group();
  kit.name = 'upgrade-kit';
  const centre = footprintCentreM(def, placed);
  kit.position.set(centre.x, centre.y, centre.z);
  kit.quaternion.copy(orientationQuaternion(placed.orient));

  switch (upgradeTrackFor(def)) {
    case 'engine':
      addEngineUpgrades(kit, level, color, opacity);
      break;
    case 'melee-drum':
      addDrumUpgrades(kit, level, color, opacity);
      break;
    case 'melee-spikes':
      addSpikeUpgrades(kit, level, color, opacity);
      break;
    case 'melee-blade':
      addBladeUpgrades(kit, level, color, opacity);
      break;
    case 'melee-plow':
      addPlowUpgrades(kit, level, color, opacity);
      break;
    case 'ability':
      addAbilityUpgrades(kit, level, color, opacity);
      break;
    case 'tank':
      addTankUpgrades(kit, level, color, opacity);
      break;
    default:
      addFrameUpgrades(kit, level, color, opacity);
      break;
  }
  return kit.children.length > 0 ? kit : null;
}
