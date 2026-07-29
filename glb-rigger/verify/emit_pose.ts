// Prints one clip's bone rotations as `name:rx,ry,rz` degree triples, ready to
// paste into render_pose.py. Run with Node 24+ (native TypeScript stripping):
//
//   node verify/emit_pose.ts walk 0.22
//   node verify/emit_pose.ts cast 0.45
import {
  castPose,
  walkPose,
  type CharacterPose,
} from '../../zombie-motorworks/src/tools/necromancerPose.ts';

const degrees = (radians: number): string => ((radians * 180) / Math.PI).toFixed(3);

function toArgs(pose: CharacterPose): string {
  return Object.entries(pose.bones)
    .map(([name, b]) => `${name}:${degrees(b!.rx)},${degrees(b!.ry)},${degrees(b!.rz)}`)
    .join(' ');
}

const clip = process.argv[2];
const t = Number(process.argv[3] ?? 0);
if (clip !== 'walk' && clip !== 'cast') {
  console.error('usage: node verify/emit_pose.ts <walk|cast> <t>');
  process.exit(1);
}
console.log(toArgs(clip === 'walk' ? walkPose(t) : castPose(t)));
