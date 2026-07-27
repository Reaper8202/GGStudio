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
  smoke: 0x6e7379,
  smokeDark: 0x24282d,
  dust: 0x8b8577,
  brass: 0xd6a13c,
  /** Matches the Ice Cannon freeze glow. */
  ice: 0x8fd8ff,
  iceDeep: 0x2e6f9e,
  /** Near-white cold core for ice beams, frost motes, and sniper cracks. */
  frost: 0xe9f8ff,
  /** Matches the phone-addict shield bubble. */
  shield: 0x35d7ff,
  /** Matches the Long Spikes pike. */
  steel: 0xb7bcc2,
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
