// Prints one clip's bone rotations as `name:rx,ry,rz` degree triples, ready to
// paste into render_pose.py. Run with Node 24+ (native TypeScript stripping):
//
//   node verify/emit_pose.ts walk 0.22              # necromancer (default)
//   node verify/emit_pose.ts cast 0.45
//   node verify/emit_pose.ts gunslinger walk 0.22
//   node verify/emit_pose.ts gunslinger shoot 0.435
import { castPose, walkPose } from '../../zombie-motorworks/src/tools/necromancerPose.ts';
import {
  shootPose,
  walkPose as gunWalkPose,
} from '../../zombie-motorworks/src/tools/gunslingerPose.ts';
import type { CharacterPose } from '../../zombie-motorworks/src/tools/rigPose.ts';

const CLIPS: Record<string, Record<string, (t: number) => CharacterPose>> = {
  necromancer: { walk: walkPose, cast: castPose },
  gunslinger: { walk: gunWalkPose, shoot: shootPose },
};

const degrees = (radians: number): string => ((radians * 180) / Math.PI).toFixed(3);

function toArgs(pose: CharacterPose): string {
  return Object.entries(pose.bones)
    .map(([name, b]) => `${name}:${degrees(b!.rx)},${degrees(b!.ry)},${degrees(b!.rz)}`)
    .join(' ');
}

// The character argument is optional and defaults to the necromancer, so the
// original two-argument form keeps working.
const args = process.argv.slice(2);
const character = args[0] in CLIPS ? args.shift()! : 'necromancer';
const [clip, t] = args;

const clips = CLIPS[character];
if (!clip || !(clip in clips)) {
  console.error(
    `usage: node verify/emit_pose.ts [${Object.keys(CLIPS).join('|')}] <clip> <t>\n` +
      Object.entries(CLIPS)
        .map(([name, c]) => `  ${name}: ${Object.keys(c).join(', ')}`)
        .join('\n'),
  );
  process.exit(1);
}
console.log(toArgs(clips[clip](Number(t ?? 0))));
