import { describe, expect, it } from 'vitest';
import { orientationFromSteps } from '../src/core/grid.ts';
import { getPartDef } from '../src/core/parts.ts';
import {
  blueprintMatchesTutorialPrefix,
  createTutorialChassisBlueprint,
  createTutorialStarterBodyBlueprint,
  deriveStarterTutorialProgress,
  garageTourSnapshot,
  nextStarterTutorialAction,
  nextTutorialRotationOrientation,
  partMatchesTutorialSpec,
  STARTER_TUTORIAL_INVENTORY,
  STARTER_TUTORIAL_STEPS,
  starterTutorialActionAllowed,
  starterTutorialBodyComplete,
  starterTutorialComplete,
  starterTutorialPlacementAllowed,
  TUTORIAL_COMPLETE_VEHICLE_SPECS,
  TUTORIAL_STARTER_BODY_SPECS,
  TUTORIAL_TURRET_SPEC,
  tutorialRecipePrefixLength,
  type GarageTourSnapshot,
  type TutorialPartSpec,
} from '../src/core/tutorial.ts';
import { validateBlueprint } from '../src/core/placement.ts';
import type {
  PartConfig,
  PlacedPart,
  VehicleBlueprint,
} from '../src/core/types.ts';

function placed(piece: TutorialPartSpec, index: number): PlacedPart {
  return {
    id: `test-${index}`,
    defId: piece.defId,
    pos: { ...piece.pos },
    orient: piece.orient,
    config: { ...piece.config },
  };
}

function blueprintWithPrefix(length: number): VehicleBlueprint {
  const bp = createTutorialChassisBlueprint();
  return {
    ...bp,
    parts: TUTORIAL_COMPLETE_VEHICLE_SPECS.slice(0, length).map(placed),
  };
}

function snapshot(
  bp: VehicleBlueprint,
  inventory: Readonly<Record<string, number>> = {},
  armedDefId: string | null = null,
  armedOrient: number | null = null,
  rotationTurnsCompleted = 0,
): GarageTourSnapshot {
  return garageTourSnapshot(
    bp,
    inventory,
    getPartDef,
    armedDefId,
    armedOrient,
    rotationTurnsCompleted,
  );
}

describe('canonical starter tutorial recipe', () => {
  it('matches the exact spawned starter body layout', () => {
    expect(
      TUTORIAL_STARTER_BODY_SPECS.map(({ defId, pos, orient }) => ({
        defId,
        pos,
        orient,
      })),
    ).toEqual([
      { defId: 'chassis-core', pos: { x: 0, y: 1, z: 0 }, orient: 0 },
      { defId: 'frame-box', pos: { x: 0, y: 1, z: 1 }, orient: 0 },
      { defId: 'frame-box', pos: { x: 0, y: 1, z: -1 }, orient: 0 },
      { defId: 'frame-box', pos: { x: 1, y: 1, z: -1 }, orient: 0 },
      { defId: 'frame-box', pos: { x: -1, y: 1, z: -1 }, orient: 0 },
      {
        defId: 'wheel-standard',
        pos: { x: 0, y: 1, z: 2 },
        orient: 0,
      },
      {
        defId: 'wheel-standard',
        pos: { x: 2, y: 1, z: -1 },
        orient: 4,
      },
      {
        defId: 'wheel-standard',
        pos: { x: -2, y: 1, z: -1 },
        orient: 0,
      },
      { defId: 'engine-small', pos: { x: 0, y: 2, z: -1 }, orient: 0 },
      { defId: 'fuel-tank', pos: { x: 0, y: 2, z: 0 }, orient: 0 },
    ]);
    expect(STARTER_TUTORIAL_INVENTORY).toEqual({
      'frame-box': 4,
      'wheel-standard': 3,
      'engine-small': 1,
      'fuel-tank': 1,
    });

    const body = createTutorialStarterBodyBlueprint();
    expect(starterTutorialBodyComplete(body)).toBe(true);
    expect(starterTutorialComplete(body)).toBe(false);
    expect(validateBlueprint(body, getPartDef).errors).toEqual([]);
  });

  it('accepts every exact prefix independent of generated IDs and array order', () => {
    for (
      let length = 1;
      length <= TUTORIAL_COMPLETE_VEHICLE_SPECS.length;
      length++
    ) {
      const bp = blueprintWithPrefix(length);
      bp.parts.reverse();
      expect(blueprintMatchesTutorialPrefix(bp, length)).toBe(true);
      expect(tutorialRecipePrefixLength(bp)).toBe(length);
    }
  });

  it('rejects wrong part, cell, orientation, early part, and extra part', () => {
    const wrongPart = blueprintWithPrefix(2);
    wrongPart.parts[1] = { ...wrongPart.parts[1], defId: 'fuel-tank' };
    expect(tutorialRecipePrefixLength(wrongPart)).toBeNull();

    const wrongCell = blueprintWithPrefix(2);
    wrongCell.parts[1] = {
      ...wrongCell.parts[1],
      pos: { x: 1, y: 1, z: 0 },
    };
    expect(tutorialRecipePrefixLength(wrongCell)).toBeNull();

    const wrongOrientation = blueprintWithPrefix(7);
    wrongOrientation.parts[6] = { ...wrongOrientation.parts[6], orient: 0 };
    expect(tutorialRecipePrefixLength(wrongOrientation)).toBeNull();

    const earlyTurret = blueprintWithPrefix(2);
    earlyTurret.parts[1] = placed(TUTORIAL_TURRET_SPEC, 1);
    expect(tutorialRecipePrefixLength(earlyTurret)).toBeNull();

    const extraPart = createTutorialStarterBodyBlueprint();
    extraPart.parts.push({
      id: 'extra',
      defId: 'frame-box',
      pos: { x: 0, y: 1, z: 2 },
      orient: 0,
      config: {},
    });
    expect(starterTutorialBodyComplete(extraPart)).toBe(false);
    expect(starterTutorialComplete(extraPart)).toBe(false);
  });
});

describe('tutorial config matching', () => {
  const wheel = TUTORIAL_STARTER_BODY_SPECS[5];

  function wheelPart(config: PartConfig): PlacedPart {
    return { ...placed(wheel, 0), config };
  }

  it('normalizes omitted and explicit standard wheel defaults', () => {
    expect(
      partMatchesTutorialSpec(
        wheelPart({
          driven: true,
          braking: true,
          steerInverted: false,
          suspensionPreset: 'standard',
        }),
        wheel,
      ),
    ).toBe(true);
    expect(partMatchesTutorialSpec(wheelPart({}), wheel)).toBe(true);
  });

  it('rejects functional changes even when part and cell match', () => {
    expect(partMatchesTutorialSpec(wheelPart({ driven: false }), wheel)).toBe(
      false,
    );
    expect(partMatchesTutorialSpec(wheelPart({ steering: true }), wheel)).toBe(
      false,
    );
    expect(partMatchesTutorialSpec(wheelPart({ level: 2 }), wheel)).toBe(false);
    expect(partMatchesTutorialSpec(wheelPart({ paint: 'red' }), wheel)).toBe(
      false,
    );
  });
});

describe('starter tutorial state and action gate', () => {
  it('requires buying and exactly placing the turret before Fight', () => {
    const body = createTutorialStarterBodyBlueprint();
    const buy = deriveStarterTutorialProgress(snapshot(body), true);
    expect(buy.valid).toBe(true);
    expect(buy.step?.id).toBe('buy-turret');

    const place = deriveStarterTutorialProgress(
      snapshot(body, { turret: 1 }),
      true,
    );
    expect(place.step?.id).toBe('place-turret');

    const complete = blueprintWithPrefix(11);
    expect(starterTutorialComplete(complete)).toBe(true);
    expect(validateBlueprint(complete, getPartDef).errors).toEqual([]);
    expect(
      deriveStarterTutorialProgress(snapshot(complete), true).step?.id,
    ).toBe('fight');
  });

  it('allows only prescribed arm, placement, purchase, and fight actions', () => {
    const chassis = createTutorialChassisBlueprint();
    const firstStep = STARTER_TUTORIAL_STEPS[1];
    const firstSnapshot = snapshot(chassis, STARTER_TUTORIAL_INVENTORY);

    expect(
      starterTutorialActionAllowed(
        firstStep,
        { kind: 'arm', defId: 'frame-box' },
        firstSnapshot,
      ),
    ).toBe(true);
    expect(
      starterTutorialActionAllowed(
        firstStep,
        { kind: 'arm', defId: 'wheel-standard' },
        firstSnapshot,
      ),
    ).toBe(false);
    expect(
      starterTutorialPlacementAllowed(
        firstStep,
        'frame-box',
        { x: 0, y: 1, z: 1 },
        0,
      ),
    ).toBe(true);
    expect(
      starterTutorialPlacementAllowed(
        firstStep,
        'frame-box',
        { x: 1, y: 1, z: 0 },
        0,
      ),
    ).toBe(false);
    expect(
      starterTutorialActionAllowed(
        firstStep,
        {
          kind: 'place',
          defId: 'frame-box',
          pos: { x: 0, y: 1, z: 1 },
          orient: 0,
          config: {},
        },
        snapshot(chassis, STARTER_TUTORIAL_INVENTORY, 'frame-box', 0),
      ),
    ).toBe(true);
    expect(
      starterTutorialActionAllowed(
        firstStep,
        { kind: 'buy', defId: 'turret' },
        firstSnapshot,
      ),
    ).toBe(false);

    const body = createTutorialStarterBodyBlueprint();
    const buyStep = STARTER_TUTORIAL_STEPS[10];
    const bodySnapshot = snapshot(body);
    expect(
      starterTutorialActionAllowed(
        buyStep,
        { kind: 'buy', defId: 'turret' },
        bodySnapshot,
      ),
    ).toBe(true);
    expect(
      starterTutorialActionAllowed(
        buyStep,
        { kind: 'buy', defId: 'sawblade' },
        bodySnapshot,
      ),
    ).toBe(false);

    const complete = blueprintWithPrefix(11);
    const fightStep = STARTER_TUTORIAL_STEPS[12];
    expect(
      starterTutorialActionAllowed(
        fightStep,
        { kind: 'fight' },
        snapshot(complete),
      ),
    ).toBe(true);
    expect(
      starterTutorialActionAllowed(fightStep, { kind: 'fight' }, bodySnapshot),
    ).toBe(false);
  });

  it('requires each explicit quarter turn before an oriented wheel can place', () => {
    const yaw90 = orientationFromSteps(0, 1, 0);
    const yaw180 = orientationFromSteps(0, 2, 0);
    const yaw270 = orientationFromSteps(0, 3, 0);
    const beforeRightWheel = blueprintWithPrefix(6);
    const rightWheelStep = STARTER_TUTORIAL_STEPS[6];
    const rightWheel = rightWheelStep.piece!;
    const placeRight = {
      kind: 'place' as const,
      defId: rightWheel.defId,
      pos: { ...rightWheel.pos },
      orient: rightWheel.orient,
      config: { ...rightWheel.config },
    };

    const facingOut = snapshot(
      beforeRightWheel,
      { 'wheel-standard': 2 },
      'wheel-standard',
      0,
    );
    expect(nextTutorialRotationOrientation(0, yaw180)).toBe(yaw90);
    expect(nextStarterTutorialAction(rightWheelStep, facingOut)).toEqual({
      kind: 'rotate',
      defId: 'wheel-standard',
      orient: yaw90,
    });
    expect(
      starterTutorialActionAllowed(
        rightWheelStep,
        { kind: 'rotate', defId: 'wheel-standard', orient: yaw90 },
        facingOut,
      ),
    ).toBe(true);
    expect(
      starterTutorialActionAllowed(
        rightWheelStep,
        { kind: 'rotate', defId: 'wheel-standard', orient: yaw180 },
        facingOut,
      ),
    ).toBe(false);
    expect(
      starterTutorialActionAllowed(rightWheelStep, placeRight, facingOut),
    ).toBe(false);

    const turnedOnce = snapshot(
      beforeRightWheel,
      { 'wheel-standard': 2 },
      'wheel-standard',
      yaw90,
      1,
    );
    expect(nextStarterTutorialAction(rightWheelStep, turnedOnce)).toEqual({
      kind: 'rotate',
      defId: 'wheel-standard',
      orient: yaw180,
    });
    expect(
      starterTutorialActionAllowed(
        rightWheelStep,
        { kind: 'rotate', defId: 'wheel-standard', orient: yaw180 },
        turnedOnce,
      ),
    ).toBe(true);

    const facingIn = snapshot(
      beforeRightWheel,
      { 'wheel-standard': 2 },
      'wheel-standard',
      yaw180,
      2,
    );
    expect(nextStarterTutorialAction(rightWheelStep, facingIn)).toEqual(
      placeRight,
    );
    expect(
      starterTutorialActionAllowed(rightWheelStep, placeRight, facingIn),
    ).toBe(true);
    expect(
      starterTutorialPlacementAllowed(
        rightWheelStep,
        placeRight.defId,
        placeRight.pos,
        placeRight.orient,
        placeRight.config,
      ),
    ).toBe(false);
    expect(
      starterTutorialPlacementAllowed(
        rightWheelStep,
        placeRight.defId,
        placeRight.pos,
        placeRight.orient,
        placeRight.config,
        2,
      ),
    ).toBe(true);

    const autoRotated = snapshot(
      beforeRightWheel,
      { 'wheel-standard': 2 },
      'wheel-standard',
      yaw180,
      0,
    );
    expect(nextStarterTutorialAction(rightWheelStep, autoRotated)).toEqual({
      kind: 'arm',
      defId: 'wheel-standard',
    });
    expect(
      starterTutorialActionAllowed(rightWheelStep, placeRight, autoRotated),
    ).toBe(false);

    // Editor keeps Wheel armed after placing while stock remains. Exact left
    // wheel placement therefore teaches two more quarter turns back to zero.
    const beforeLeftWheel = blueprintWithPrefix(7);
    const leftWheelStep = STARTER_TUTORIAL_STEPS[7];
    const stillFacingIn = snapshot(
      beforeLeftWheel,
      { 'wheel-standard': 1 },
      'wheel-standard',
      yaw180,
    );
    expect(nextStarterTutorialAction(leftWheelStep, stillFacingIn)).toEqual({
      kind: 'rotate',
      defId: 'wheel-standard',
      orient: yaw270,
    });
    expect(
      nextStarterTutorialAction(
        leftWheelStep,
        snapshot(
          beforeLeftWheel,
          { 'wheel-standard': 1 },
          'wheel-standard',
          yaw270,
        ),
      ),
    ).toEqual({
      kind: 'rotate',
      defId: 'wheel-standard',
      orient: 0,
    });
  });
});
