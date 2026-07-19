import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';

const SRC_DIR = '/Users/josephliao/Projects/GGStudio/Shared/voxel/characters/ZombieAsset/obj/zombie_worker';
const OUT_DIR = '/Users/josephliao/Projects/GGStudio/zombie-motorworks/public/assets/zombies';

// Torso spans x 5.3..6.65; anything beyond is arm. Shoulder pivot at arm top.
const LEFT_X = 5.25, RIGHT_X = 6.65, PIVOT_Y = 9.4;
const ARM_Z_CENTRE = -2.55;
const DOWN = (55 * Math.PI) / 180;   // swing arms down from T-pose
const FORWARD = (30 * Math.PI) / 180; // then raise toward +z (zombie reach)

function rotateArm(x, y, z, pivotX, down) {
  // About Z at the shoulder: T-pose (±x) -> mostly down.
  let dx = x - pivotX, dy = y - PIVOT_Y, dz = z;
  const cz = Math.cos(down), sz = Math.sin(down);
  [dx, dy] = [dx * cz - dy * sz, dx * sz + dy * cz];
  // About X at the shoulder: swing the lowered arm toward +z.
  const cx = Math.cos(-FORWARD), sx = Math.sin(-FORWARD);
  const zRel = dz - ARM_Z_CENTRE;
  [dy, dz] = [dy * cx - zRel * sx, ARM_Z_CENTRE + (dy * sx + zRel * cx)];
  return [pivotX + dx, PIVOT_Y + dy, dz];
}

const out = readFileSync(`${SRC_DIR}/zombie_worker.obj`, 'utf8').split('\n').map((line) => {
  if (!line.startsWith('v ')) return line;
  const parts = line.split(/\s+/);
  let [x, y, z] = parts.slice(1, 4).map(Number);
  if (x < LEFT_X) [x, y, z] = rotateArm(x, y, z, LEFT_X, +DOWN);
  else if (x > RIGHT_X) [x, y, z] = rotateArm(x, y, z, RIGHT_X, -DOWN);
  else return line;
  return `v ${x.toFixed(4)} ${y.toFixed(4)} ${z.toFixed(4)}`;
});
writeFileSync(`${OUT_DIR}/zombie_worker.obj`, out.join('\n'));
copyFileSync(`${SRC_DIR}/zombie_worker.mtl`, `${OUT_DIR}/zombie_worker.mtl`);
copyFileSync(`${SRC_DIR}/zombie_worker.png`, `${OUT_DIR}/zombie_worker.png`);
console.log('posed obj written');
