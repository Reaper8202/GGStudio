/**
 * Mobility ability meshes: the nitro injector and the phase drive.
 *
 * Both are propulsion hardware rather than field devices, so they read as
 * plumbing bolted to a deck — a cradled pressure bottle venting out the back,
 * and a coil rail firing forward along its own length.
 *
 * Modelled in part-local axes (+Z forward, +Y up) and rotated by the placed
 * orientation, so the nozzle and the muzzle always point where the part is
 * aimed. Only the cradle/deck bodies carry `placementSurface`, and there is one
 * per occupied cell so every flank still resolves as a build face.
 */

import * as THREE from 'three';
import { CELL_SIZE, type PlacedPart } from '../../core/types.ts';
import { cellCentreM } from '../../core/mass.ts';
import {
  DARK_STEEL,
  STEEL,
  boltRing,
  edgesOf,
  glowLambert,
  lambert,
  orientationQuaternion,
  shade,
} from './shared.ts';

const EXHAUST_HEAT = 0xffb347;
/** Charge decal and armed light on the injector — an accent, not a body colour. */
const NITRO_GREEN = 0x3fbd7a;

/** Charge bleeding out of the phase drive's joints. */
const COIL_TURQUOISE = 0x2fe3d0;
/** The blink itself: the muzzle aperture only. */
const PHASE_BLUE = 0x3f9dff;

/**
 * A bolted deck pan filling one cell's footprint at the bottom of that cell:
 * the structural body of both parts, and the only thing they offer the editor's
 * face raycast.
 */
function deckPan(color: number, opacity: number, z: number): THREE.Group {
  const s = CELL_SIZE;
  const group = new THREE.Group();

  const pan = new THREE.Mesh(
    new THREE.BoxGeometry(s * 0.98, s * 0.32, s * 0.98),
    lambert(shade(color, 0.58), opacity),
  );
  pan.position.set(0, -s * 0.5 + s * 0.16, z);
  pan.userData.placementSurface = true;
  group.add(pan);
  const panEdges = edgesOf(pan.geometry, opacity);
  panEdges.position.copy(pan.position);
  group.add(panEdges);

  group.add(
    boltRing({
      count: 4,
      radius: s * 0.39 * Math.SQRT2,
      headRadius: s * 0.045,
      length: s * 0.06,
      axis: new THREE.Vector3(0, 1, 0),
      centre: new THREE.Vector3(0, -s * 0.33, z),
      phase: Math.PI / 4,
      opacity,
    }),
  );
  return group;
}

/**
 * Nitro injector: twin pressure bottles strapped into a cradle over a vent.
 *
 * The bottles are the silhouette, the straps say "field-fitted", and the flared
 * nozzle out the back is what makes it obvious which way the shove goes.
 */
export function buildNitroInjectorMesh(
  placed: PlacedPart,
  color: number,
  opacity = 1,
): THREE.Group {
  const s = CELL_SIZE;
  const group = new THREE.Group();
  const centre = cellCentreM(placed.pos);
  group.position.set(centre.x, centre.y, centre.z);
  group.quaternion.copy(orientationQuaternion(placed.orient));
  group.add(deckPan(color, opacity, 0));

  const bottleMaterial = lambert(color, opacity);
  const bandMaterial = lambert(shade(color, 0.6), opacity);
  const decalMaterial = lambert(NITRO_GREEN, opacity);
  const steel = lambert(STEEL, opacity);
  const darkSteel = lambert(DARK_STEEL, opacity);

  // Twin bottles lying fore-aft, domed at the nose so they read as pressure
  // vessels rather than pipes.
  const bottleGeometry = new THREE.CylinderGeometry(s * 0.15, s * 0.15, s * 0.62, 12);
  const domeGeometry = new THREE.SphereGeometry(s * 0.15, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2);
  const bandGeometry = new THREE.CylinderGeometry(s * 0.16, s * 0.16, s * 0.06, 12);
  const decalGeometry = new THREE.CylinderGeometry(s * 0.155, s * 0.155, s * 0.1, 12);
  const neckGeometry = new THREE.CylinderGeometry(s * 0.07, s * 0.09, s * 0.06, 8);
  const valveGeometry = new THREE.CylinderGeometry(s * 0.05, s * 0.06, s * 0.08, 6);
  const wheelGeometry = new THREE.TorusGeometry(s * 0.06, s * 0.018, 5, 8);
  const saddleGeometry = new THREE.TorusGeometry(s * 0.17, s * 0.025, 4, 8, Math.PI);
  for (const side of [-1, 1]) {
    const x = side * s * 0.19;

    const bottle = new THREE.Mesh(bottleGeometry, bottleMaterial);
    bottle.position.set(x, s * 0.02, s * 0.02);
    bottle.rotation.x = Math.PI / 2;
    group.add(bottle);

    const dome = new THREE.Mesh(domeGeometry, bottleMaterial);
    dome.position.set(x, s * 0.02, s * 0.33);
    dome.rotation.x = Math.PI / 2;
    group.add(dome);

    // Bottle neck, valve and handwheel: the fiddly end that says "pressurised"
    // without needing the whole tank painted a warning colour.
    const neck = new THREE.Mesh(neckGeometry, bandMaterial);
    neck.position.set(x, s * 0.02, s * 0.37);
    neck.rotation.x = Math.PI / 2;
    group.add(neck);

    const valve = new THREE.Mesh(valveGeometry, darkSteel);
    valve.position.set(x, s * 0.02, s * 0.43);
    valve.rotation.x = Math.PI / 2;
    group.add(valve);

    const handwheel = new THREE.Mesh(wheelGeometry, darkSteel);
    handwheel.position.set(x, s * 0.02, s * 0.46);
    group.add(handwheel);

    for (const band of [-0.16, 0.2]) {
      const ring = new THREE.Mesh(bandGeometry, bandMaterial);
      ring.position.set(x, s * 0.02, s * band);
      ring.rotation.x = Math.PI / 2;
      group.add(ring);
    }

    // The one bit of colour left on the tank: a charge decal between the bands.
    const decal = new THREE.Mesh(decalGeometry, decalMaterial);
    decal.position.set(x, s * 0.02, s * 0.02);
    decal.rotation.x = Math.PI / 2;
    group.add(decal);

    // Cradle saddles the bottle rests in, bolted to the pan. Half a ring, in
    // the plane across the bottle, flipped to hold it from underneath.
    for (const z of [-0.14, 0.22]) {
      const saddle = new THREE.Mesh(saddleGeometry, steel);
      saddle.position.set(x, s * 0.02, s * z);
      saddle.rotation.z = Math.PI;
      group.add(saddle);
    }

    // Braided feed line down the outside of each tank into the solenoid.
    const hose = new THREE.Mesh(
      new THREE.CylinderGeometry(s * 0.03, s * 0.03, s * 0.62, 6),
      darkSteel,
    );
    hose.position.set(side * s * 0.38, s * 0.02, s * 0.06);
    hose.rotation.x = Math.PI / 2;
    group.add(hose);

    // Elbows tying that line to the valve at the front and the block at the
    // back, so the plumbing reads as connected rather than glued on. Each turn
    // is a quarter ring laid flat, spun by a pivot: laying it flat and aiming
    // it are rotations about different axes, and Euler order would apply them
    // the wrong way round on a single object.
    for (const [z, turn] of [
      [0.33, side > 0 ? 0 : -Math.PI / 2],
      [-0.22, side > 0 ? Math.PI / 2 : Math.PI],
    ] as const) {
      const pivot = new THREE.Group();
      pivot.position.set(side * s * 0.28, s * 0.02, s * z);
      pivot.rotation.y = turn;
      const elbow = new THREE.Mesh(
        new THREE.TorusGeometry(s * 0.1, s * 0.03, 5, 6, Math.PI / 2),
        darkSteel,
      );
      elbow.rotation.x = Math.PI / 2;
      pivot.add(elbow);
      group.add(pivot);
    }
  }

  // Retaining straps across both bottles, each with a buckle over the centre.
  const strapGeometry = new THREE.BoxGeometry(s * 0.78, s * 0.05, s * 0.07);
  const buckleGeometry = new THREE.BoxGeometry(s * 0.09, s * 0.07, s * 0.1);
  for (const z of [-0.14, 0.22]) {
    const strap = new THREE.Mesh(strapGeometry, darkSteel);
    strap.position.set(0, s * 0.19, s * z);
    group.add(strap);

    const buckle = new THREE.Mesh(buckleGeometry, steel);
    buckle.position.set(0, s * 0.21, s * z);
    group.add(buckle);
  }

  // Solenoid block: where both feed lines land and the shot is metered out.
  const manifold = new THREE.Mesh(new THREE.BoxGeometry(s * 0.56, s * 0.18, s * 0.16), steel);
  manifold.position.set(0, s * 0.04, -s * 0.32);
  group.add(manifold);

  const solenoid = new THREE.Mesh(
    new THREE.CylinderGeometry(s * 0.07, s * 0.07, s * 0.14, 8),
    darkSteel,
  );
  solenoid.position.set(-s * 0.16, s * 0.16, -s * 0.32);
  group.add(solenoid);

  const indicator = new THREE.Mesh(
    new THREE.CylinderGeometry(s * 0.04, s * 0.04, s * 0.03, 6),
    glowLambert(NITRO_GREEN, opacity, 0.9),
  );
  indicator.position.set(-s * 0.16, s * 0.24, -s * 0.32);
  group.add(indicator);

  // Pressure dial, tipped up towards the driver.
  const dialCase = new THREE.Mesh(
    new THREE.CylinderGeometry(s * 0.085, s * 0.085, s * 0.05, 10),
    darkSteel,
  );
  dialCase.position.set(s * 0.14, s * 0.17, -s * 0.3);
  dialCase.rotation.x = -Math.PI / 5;
  group.add(dialCase);

  const dialFace = new THREE.Mesh(
    new THREE.CircleGeometry(s * 0.065, 10),
    glowLambert(0xd8e2e8, opacity, 0.5),
  );
  dialFace.position.set(s * 0.14, s * 0.19, -s * 0.28);
  dialFace.rotation.x = -Math.PI / 5 - Math.PI / 2;
  group.add(dialFace);

  // Blast shield around the nozzle: a scorched plate keeping the jet off the
  // block behind, and the frame that makes the throat read as hot.
  const shield = new THREE.Mesh(
    new THREE.CylinderGeometry(s * 0.3, s * 0.3, s * 0.04, 4),
    lambert(shade(color, 0.45), opacity),
  );
  shield.position.set(0, s * 0.04, -s * 0.44);
  // Stood up to face the jet (X), then spun about its own axis (Y) to square
  // the plate — in that order, which is what Euler XYZ gives.
  shield.rotation.set(Math.PI / 2, Math.PI / 4, 0);
  group.add(shield);

  // Flared nozzle out the back, with the throat lit: the tell for which way the
  // shove points once the part has been rotated. Kept inside the cell — nothing
  // reserves the block behind an injector, so an overhanging bell would clip it.
  const nozzle = new THREE.Mesh(
    new THREE.CylinderGeometry(s * 0.19, s * 0.1, s * 0.16, 12, 1, true),
    lambert(shade(color, 0.5), opacity),
  );
  nozzle.position.set(0, s * 0.04, -s * 0.4);
  nozzle.rotation.x = Math.PI / 2;
  nozzle.material.side = THREE.DoubleSide;
  group.add(nozzle);

  const throat = new THREE.Mesh(
    new THREE.CircleGeometry(s * 0.16, 12),
    glowLambert(EXHAUST_HEAT, opacity, 1),
  );
  throat.position.set(0, s * 0.04, -s * 0.478);
  throat.rotation.y = Math.PI;
  group.add(throat);

  return group;
}

/** Geometry and materials shared by every vertebra in one spine. */
interface VertebraKit {
  bead: THREE.BufferGeometry;
  collar: THREE.BufferGeometry;
  lobe: THREE.BufferGeometry;
  bolt: THREE.BufferGeometry;
  chrome: THREE.Material;
  band: THREE.Material;
  steel: THREE.Material;
}

function vertebraKit(color: number, opacity: number): VertebraKit {
  const s = CELL_SIZE;
  return {
    // Eight-sided so the bead catches a highlight edge-on.
    bead: new THREE.CylinderGeometry(s * 0.15, s * 0.15, s * 0.19, 8),
    collar: new THREE.CylinderGeometry(s * 0.175, s * 0.175, s * 0.09, 8),
    // Tapered outwards: the scale is thick at the spine and thin at its tip.
    lobe: new THREE.CylinderGeometry(s * 0.06, s * 0.12, s * 0.17, 6),
    bolt: new THREE.CylinderGeometry(s * 0.045, s * 0.05, s * 0.05, 6),
    chrome: lambert(shade(color, 1.22), opacity),
    band: lambert(shade(color, 0.92), opacity),
    steel: lambert(DARK_STEEL, opacity),
  };
}

/**
 * One vertebra of the phase drive's spine: a chromed centre bead in a collar,
 * flanked by two scale lobes with a bolt head sunk into each outer face.
 *
 * `scale` widens the segment without lengthening it, so the row can get chunkier
 * towards the muzzle while the joint spacing stays even.
 */
function spineVertebra(kit: VertebraKit, scale: number): THREE.Group {
  const s = CELL_SIZE;
  const group = new THREE.Group();

  const bead = new THREE.Mesh(kit.bead, kit.chrome);
  bead.rotation.x = Math.PI / 2;
  bead.scale.set(scale, 1, scale);
  group.add(bead);

  const collar = new THREE.Mesh(kit.collar, kit.band);
  collar.rotation.x = Math.PI / 2;
  collar.scale.set(scale, 1, scale);
  group.add(collar);

  // Lateral lobes: the scales. Yawed a little so the row reads as overlapping
  // plates rather than a stack of pipes.
  for (const side of [-1, 1]) {
    const lobe = new THREE.Mesh(kit.lobe, kit.chrome);
    lobe.position.set(side * s * 0.19 * scale, -s * 0.02, 0);
    lobe.rotation.z = (side * Math.PI) / 2;
    lobe.rotation.y = Math.PI / 6;
    lobe.scale.set(scale, scale, scale);
    group.add(lobe);

    const bolt = new THREE.Mesh(kit.bolt, kit.steel);
    bolt.position.set(side * s * 0.25 * scale, -s * 0.02, 0);
    bolt.rotation.z = (side * Math.PI) / 2;
    group.add(bolt);
  }

  return group;
}

/**
 * Phase drive: a two-cell accelerator rail carrying a chromed spine.
 *
 * A row of vertebrae — bead, scales, bolts — runs the length of the rail in a
 * lit trough, each joint bleeding turquoise and the muzzle burning blue. Grey
 * chrome does the reading; the colour is only ever in the gaps, which is what
 * keeps it looking like hardware under charge rather than a neon prop.
 */
export function buildPhaseDriveMesh(placed: PlacedPart, color: number, opacity = 1): THREE.Group {
  const s = CELL_SIZE;
  const group = new THREE.Group();
  const centre = cellCentreM(placed.pos);
  group.position.set(centre.x, centre.y, centre.z);
  group.quaternion.copy(orientationQuaternion(placed.orient));

  // One pan per occupied cell: the origin cell and the one ahead of it.
  group.add(deckPan(color, opacity, 0));
  group.add(deckPan(color, opacity, s));

  const steel = lambert(STEEL, opacity);
  const darkSteel = lambert(DARK_STEEL, opacity);
  const spineY = s * 0.06;

  // Trough the spine lies in: a dark bed with a turquoise floor, so the light
  // spills out from under the vertebrae along the whole rail.
  const bed = new THREE.Mesh(new THREE.BoxGeometry(s * 0.66, s * 0.14, s * 1.9), darkSteel);
  bed.position.set(0, -s * 0.16, s * 0.5);
  group.add(bed);
  const glowFloor = new THREE.Mesh(
    new THREE.BoxGeometry(s * 0.52, s * 0.03, s * 1.84),
    glowLambert(COIL_TURQUOISE, opacity, 0.9),
  );
  glowFloor.position.set(0, -s * 0.08, s * 0.5);
  group.add(glowFloor);

  // Rear housing: the block the spine grows out of, and the visual anchor that
  // stops the rail looking like it floats off the back of the pan.
  const housing = new THREE.Mesh(
    new THREE.CylinderGeometry(s * 0.3, s * 0.34, s * 0.26, 8),
    steel,
  );
  housing.position.set(0, spineY, -s * 0.36);
  housing.rotation.x = Math.PI / 2;
  group.add(housing);

  // The spine: seven vertebrae marching forward, each a little chunkier than
  // the last, with a lit disc packed into every joint between them.
  const segments = 7;
  const first = -0.2;
  const step = 0.25;
  const kit = vertebraKit(color, opacity);
  const jointGeometry = new THREE.CylinderGeometry(s * 0.13, s * 0.13, s * 0.07, 8);
  const jointMaterial = glowLambert(COIL_TURQUOISE, opacity, 1);
  for (let i = 0; i < segments; i++) {
    const z = (first + i * step) * s;
    const scale = 0.92 + (i / (segments - 1)) * 0.42;

    const vertebra = spineVertebra(kit, scale);
    vertebra.position.set(0, spineY, z);
    group.add(vertebra);

    if (i < segments - 1) {
      const joint = new THREE.Mesh(jointGeometry, jointMaterial);
      joint.position.set(0, spineY, z + (step / 2) * s);
      joint.rotation.x = Math.PI / 2;
      group.add(joint);
    }
  }

  // Feed conduits running the length of the rail, over the outer lobes: the
  // cabling that ties the spine back into the housing.
  const conduitGeometry = new THREE.CylinderGeometry(s * 0.04, s * 0.04, s * 1.6, 6);
  for (const side of [-1, 1]) {
    const conduit = new THREE.Mesh(conduitGeometry, darkSteel);
    conduit.position.set(side * s * 0.36, s * 0.18, s * 0.42);
    conduit.rotation.x = Math.PI / 2;
    group.add(conduit);
  }

  // Muzzle: a chromed collar around a blue aperture, the one place the drive is
  // allowed to burn a colour other than the turquoise in its joints.
  const collar = new THREE.Mesh(
    new THREE.TorusGeometry(s * 0.3, s * 0.055, 6, 16),
    lambert(shade(color, 1.1), opacity),
  );
  collar.position.set(0, spineY, s * 1.34);
  group.add(collar);

  const aperture = new THREE.Mesh(
    new THREE.CircleGeometry(s * 0.28, 16),
    glowLambert(PHASE_BLUE, opacity, 1.1),
  );
  aperture.position.set(0, spineY, s * 1.36);
  group.add(aperture);

  const iris = new THREE.Mesh(
    new THREE.CircleGeometry(s * 0.12, 16),
    glowLambert(shade(COIL_TURQUOISE, 1.5), opacity, 1.2),
  );
  iris.position.set(0, spineY, s * 1.37);
  group.add(iris);

  return group;
}
