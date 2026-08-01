/**
 * Tunables and palette for the voxel VFX layer.
 *
 * Every colour here is either an existing scene hex (tracer gold, flame
 * orange, ice blue, phone-addict shield cyan, spike steel) or a close relative
 * of one, so effects read as part of the same night-graveyard world rather
 * than as a bolted-on particle demo.
 */

export const VFX_PALETTE = {
  /** Zombie blood: dark crimson, kept bright enough to read at night. */
  gore: 0xa3232a,
  goreDark: 0x45111a,
  /** Rotten flesh chunk tint, sampled from the walker body tints. */
  flesh: 0x6f8f45,
  bone: 0xd8d2bd,
  /** Matches the existing hitscan tracer. */
  spark: 0xffd76e,
  sparkHot: 0xfff3c4,
  /** Matches the existing flamethrower tracer. */
  ember: 0xff6b2b,
  emberDark: 0x7a1c05,
  /**
   * Hellfire: the overcharged nozzle pushes the flame's orange apart into a
   * hotter yellow core and a deep red body, so an overcharged spray reads as a
   * different fire from across the graveyard rather than as a bigger one.
   */
  hellYellow: 0xffe14a,
  hellAmber: 0xffa412,
  hellRed: 0xe22208,
  hellRedDark: 0x5e0c02,
  smoke: 0x6e7379,
  smokeDark: 0x24282d,
  dust: 0x8b8577,
  /** Broken ground/rubble chunk, for a physical ground-pound rather than a blast. */
  rubble: 0x5c4d3d,
  brass: 0xd6a13c,
  /**
   * Ice Cannon turquoise. One family drives the whole weapon: its tracer, its
   * muzzle mist, its impacts, and the shell around a frozen zombie — so a
   * turquoise glow anywhere on screen means "cold" and nothing else.
   */
  ice: 0x40e0d0,
  /** Near-white rime at the heart of a freeze, and of a sniper crack. */
  frost: 0xd9fff9,
  iceDeep: 0x0f5f6b,
  /** Matches the phone-addict shield bubble. */
  shield: 0x35d7ff,
  /** Matches the Long Spikes pike. */
  steel: 0xb7bcc2,
  /**
   * Necromancer violet. The only purple in the game, so a purple glow anywhere
   * on screen means one thing — something is raising the dead — the way
   * turquoise means cold and orange means fire.
   */
  necro: 0x9b4dff,
  /** Pale witch-light at the heart of a raise. */
  necroPale: 0xe6ccff,
  necroDeep: 0x2c0a52,
  /** Kamikaze's chest-light blink — the one thing that reads as "about to go off". */
  kamikazeWarn: 0xff2a00,
  /** Matches the Alchemist boss's own tint and its acid puddles — one family for every toxin. */
  acid: 0x9dff5c,
  acidDeep: 0x2e5c14,
  /**
   * The Alchemist's gas cloud, on the additive `glow` layer. Deliberately dim
   * and only lightly saturated: additive blending sums overlapping puffs, so a
   * bright green here clipped to flat white after two or three of them. At
   * this value a thin wisp reads as translucent haze and only a deep, dense
   * pocket of gas brightens toward white.
   */
  acidSmoke: 0x4f7a45,
  /** Near-black tail for the gas puffs — on the glow layer black is a clean fade-out. */
  acidFade: 0x101a0c,
  /**
   * Storm Rod arc blue. Shares the Tesla Coil's electric family on purpose:
   * blue lightning already means "something got shocked", and the signature
   * strike is the same idea at a bigger scale. The pale core is the channel
   * itself, which is nearly white at the moment of the strike.
   */
  arc: 0x7fd4ff,
  arcPale: 0xeaf9ff,
  arcDeep: 0x123a63,
  /**
   * Fallout Silo warning green. It marks the ring a shell is falling into, and
   * nothing else on the field is this colour — a green circle on the ground
   * means exactly one thing, which is the point of telegraphing at all.
   */
  fallout: 0x9dff5c,
  falloutDeep: 0x24471a,
  /** Charred flesh and ash left where a fire blast landed. */
  char: 0x1b1410,
  ash: 0x585049,
} as const;

/**
 * Instance capacity per layer. Both layers are one draw call each, so these
 * bound memory and per-frame matrix work rather than draw calls.
 */
export const LIT_PARTICLE_CAPACITY = 640;
export const GLOW_PARTICLE_CAPACITY = 512;

/**
 * Hard ceiling on new particles per rendered frame across every emitter. A
 * grinder drum parked inside a horde would otherwise ask for thousands.
 */
export const FRAME_SPAWN_BUDGET = 240;

/** Full particle counts within this distance of the camera, m. */
export const LOD_FULL_DISTANCE_M = 26;
/** Half counts out to here, quarter beyond it, m. */
export const LOD_HALF_DISTANCE_M = 46;
/** Nothing is emitted past this distance from the camera, m. */
export const LOD_CULL_DISTANCE_M = 78;

/** Flat graveyard/chamber ground plane that particles bounce and settle on. */
export const VFX_GROUND_Y = 0;

/** Settled splat cubes are squashed to this fraction of their edge length. */
export const SPLAT_FLATTEN = 0.22;
/** And widened by this factor, so a settled cube reads as a splat, not a brick. */
export const SPLAT_SPREAD = 1.45;
