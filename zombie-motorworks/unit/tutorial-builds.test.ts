import { describe, expect, it } from 'vitest';
import { getPartDef } from '../src/core/parts.ts';
import { canPlacePart, validateBlueprint } from '../src/core/placement.ts';
import {
  BUILD_IDS,
  buildStarterRig,
  isSignatureDefId,
} from '../src/core/builds.ts';
import {
  deriveGarageTourProgress,
  garageTourActionAllowed,
  garageTourSnapshot,
  nextStarterTutorialAction,
  starterTutorialBlueprintForBuild,
  tutorialBodySpecsForBuild,
  tutorialStagedInventoryForBuild,
  tutorialStepsForBuild,
} from '../src/core/tutorial.ts';
import type { PlacedPart, Vec3i } from '../src/core/types.ts';

const cellKey = (part: { defId: string; pos: Vec3i }): string =>
  `${part.defId}@${part.pos.x},${part.pos.y},${part.pos.z}`;

describe('build-aware guided first build', () => {
  for (const buildId of BUILD_IDS) {
    it(`coaches the whole ${buildId} rig, block by block`, () => {
      const specs = tutorialBodySpecsForBuild(buildId);
      const steps = tutorialStepsForBuild(buildId);
      const inventory: Record<string, number> = {
        ...tutorialStagedInventoryForBuild(buildId),
      };

      // Welcome + one step per block the player fits + the hand-off to combat.
      expect(steps.length).toBe(specs.length + 1);
      expect(steps[0].kind).toBe('welcome');
      expect(steps.at(-1)?.kind).toBe('fight');
      // Every block but the Chassis Core is staged free, weapon included.
      expect(specs[0].defId).toBe('chassis-core');
      expect(isSignatureDefId(specs.at(-1)!.defId)).toBe(true);
      expect(Object.values(inventory).reduce((sum, n) => sum + n, 0)).toBe(
        specs.length - 1,
      );
      expect(inventory['chassis-core']).toBeUndefined();

      const bp = starterTutorialBlueprintForBuild(buildId);
      expect(bp.parts).toHaveLength(1);
      expect(
        deriveGarageTourProgress(
          garageTourSnapshot(bp, inventory, getPartDef),
          specs,
          steps,
          false,
        ).step?.kind,
      ).toBe('welcome');

      for (let index = 1; index < specs.length; index++) {
        const piece = specs[index];
        const progress = deriveGarageTourProgress(
          garageTourSnapshot(bp, inventory, getPartDef),
          specs,
          steps,
          true,
        );
        expect(progress.valid).toBe(true);
        const step = progress.step!;
        expect(step.piece).toEqual(piece);
        expect(inventory[piece.defId]).toBeGreaterThan(0);

        // Grabbing from the Store always starts the part unturned.
        expect(
          garageTourActionAllowed(
            step,
            { kind: 'arm', defId: piece.defId },
            garageTourSnapshot(bp, inventory, getPartDef),
            specs,
          ),
        ).toBe(true);

        // Follow the coach: rotate exactly as often as it asks, then place.
        let orient = 0;
        let turns = 0;
        for (let guard = 0; guard <= 4; guard++) {
          const snapshot = garageTourSnapshot(
            bp,
            inventory,
            getPartDef,
            piece.defId,
            orient,
            turns,
          );
          const action = nextStarterTutorialAction(step, snapshot)!;
          expect(garageTourActionAllowed(step, action, snapshot, specs)).toBe(
            true,
          );
          if (action.kind === 'place') break;
          expect(action.kind).toBe('rotate');
          orient = (action as { orient: number }).orient;
          turns += 1;
        }

        // The prescribed cell has to be legal on the ordinary build rules too,
        // or the coach would be pointing at a spot nothing can go in.
        const placement = canPlacePart(
          bp,
          getPartDef,
          piece.defId,
          piece.pos,
          piece.orient,
          {},
        );
        expect(placement.ok).toBe(true);

        const part: PlacedPart = {
          id: `p${index + 1}`,
          defId: piece.defId,
          pos: { ...piece.pos },
          orient: piece.orient,
          config: { ...piece.config },
        };
        bp.parts.push(part);
        inventory[piece.defId] -= 1;
      }

      const finished = garageTourSnapshot(bp, inventory, getPartDef);
      const last = deriveGarageTourProgress(finished, specs, steps, true);
      expect(last.step?.kind).toBe('fight');
      expect(
        garageTourActionAllowed(last.step!, { kind: 'fight' }, finished, specs),
      ).toBe(true);
      expect(validateBlueprint(bp, getPartDef).errors).toEqual([]);

      // What the player built is the rig the picker promised them, cell for
      // cell — the tutorial is never a weaker version of the chosen build.
      const promised = buildStarterRig(buildId);
      expect(bp.parts.map(cellKey).sort()).toEqual(
        promised.parts.map(cellKey).sort(),
      );
      for (const part of promised.parts) {
        const built = bp.parts.find(
          (other) => cellKey(other) === cellKey(part),
        );
        expect(built?.orient).toBe(part.orient);
        expect(built?.config).toMatchObject(part.config);
      }
    });
  }

  it('names the build and its weapon in the generated copy', () => {
    const steps = tutorialStepsForBuild('light');
    expect(steps[0].title).toContain('Sparkrunner');
    expect(steps.at(-2)?.title).toContain('Lightning Mast');
    // Exactly one step asks for a rotation: the inward-facing rear wheel.
    const rotations = steps.filter((step) => step.action?.includes('Rotate'));
    expect(rotations).toHaveLength(1);
    expect(rotations[0].action).toBe(
      'Drag the Speedy Wheel in, then Rotate twice',
    );
    // Nothing is ever bought during a guided build.
    expect(steps.some((step) => step.kind === 'buy')).toBe(false);
  });
});
