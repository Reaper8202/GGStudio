import { deserializeBlueprint } from './serialize.ts';
import { PART_CATALOG } from './parts.ts';
import {
  type PaintColor,
  type PartConfig,
  type SuspensionPreset,
  type VehicleBlueprint,
} from './types.ts';

export class ShareCodeError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'ShareCodeError';
  }
}

// These arrays are APPEND-ONLY: a member's index is its value on the wire, so
// reordering or inserting one silently repaints (or re-springs) every build
// code ever shared. Add new members at the end and nowhere else.
//
// Both are written out by hand rather than derived from the catalog on
// purpose. Deriving `PAINT_COLORS_LIST` from `Object.keys(PAINT_COLORS)` would
// tie the wire format to the declaration order of an object nobody thinks of
// as a wire format, and the test guarding it could only ever compare the list
// to itself. Spelled out here, the paired test genuinely fails when someone
// adds a colour without considering existing codes.
export const SUSPENSION_PRESETS = Object.freeze([
  'light',
  'standard',
  'heavy-duty',
  'off-road',
] as const satisfies readonly SuspensionPreset[]);
export const PAINT_COLORS_LIST = Object.freeze([
  'scrap',
  'red',
  'blue',
  'green',
  'yellow',
  'purple',
] as const satisfies readonly PaintColor[]);

const MAGIC = new TextEncoder().encode('ZMB1');
const CONFIG_BITS = {
  level: 1,
  driven: 2,
  steering: 4,
  steerInverted: 8,
  braking: 16,
  activeAbility: 32,
  abilitySlot: 64,
  suspensionPreset: 128,
  paint: 256,
} as const;

function varint(value: number): number[] {
  const bytes: number[] = [];
  do {
    const next = value % 128;
    value = Math.floor(value / 128);
    bytes.push(next | (value ? 128 : 0));
  } while (value);
  return bytes;
}

function zigzag(value: number): number {
  return value < 0 ? -value * 2 - 1 : value * 2;
}

function text(value: string): number[] {
  const bytes = [...new TextEncoder().encode(value)];
  return [...varint(bytes.length), ...bytes];
}

function configBytes(config: PartConfig): number[] {
  let mask = 0;
  for (const [key, bit] of Object.entries(CONFIG_BITS) as [
    keyof PartConfig,
    number,
  ][]) {
    if (config[key] !== undefined) mask |= bit;
  }
  const bytes = varint(mask);
  if (mask & CONFIG_BITS.level) bytes.push(...varint(config.level!));
  for (const key of [
    'driven',
    'steering',
    'steerInverted',
    'braking',
    'activeAbility',
  ] as const) {
    if (mask & CONFIG_BITS[key]) bytes.push(config[key] ? 1 : 0);
  }
  if (mask & CONFIG_BITS.abilitySlot)
    bytes.push(...varint(config.abilitySlot! + 1));
  if (mask & CONFIG_BITS.suspensionPreset)
    bytes.push(SUSPENSION_PRESETS.indexOf(config.suspensionPreset!));
  if (mask & CONFIG_BITS.paint)
    bytes.push(PAINT_COLORS_LIST.indexOf(config.paint!));
  return bytes;
}

export function encodeShareCode(bp: VehicleBlueprint): string {
  const defs = [...new Set(bp.parts.map((part) => part.defId))];
  const bytes = [
    ...MAGIC,
    bp.schemaVersion,
    ...text(bp.name),
    ...text(bp.id),
    ...varint(defs.length),
  ];
  for (const defId of defs) bytes.push(...text(defId));
  bytes.push(...varint(bp.parts.length));
  for (const part of bp.parts) {
    bytes.push(...text(part.id), ...varint(defs.indexOf(part.defId)));
    bytes.push(
      ...varint(zigzag(part.pos.x)),
      ...varint(zigzag(part.pos.y)),
      ...varint(zigzag(part.pos.z)),
      part.orient,
    );
    bytes.push(...configBytes(part.config));
  }
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
}

class Reader {
  private offset = 0;
  constructor(private readonly bytes: Uint8Array) {}
  byte(): number {
    if (this.offset >= this.bytes.length)
      throw new ShareCodeError('truncated buffer');
    return this.bytes[this.offset++];
  }
  varint(): number {
    let value = 0;
    let multiplier = 1;
    for (let i = 0; i < 6; i++) {
      const byte = this.byte();
      value += (byte & 127) * multiplier;
      if (!(byte & 128)) return value;
      multiplier *= 128;
    }
    throw new ShareCodeError('invalid varint');
  }
  string(): string {
    const length = this.varint();
    const end = this.offset + length;
    if (end > this.bytes.length) throw new ShareCodeError('truncated buffer');
    try {
      const value = new TextDecoder('utf-8', { fatal: true }).decode(
        this.bytes.slice(this.offset, end),
      );
      this.offset = end;
      return value;
    } catch {
      throw new ShareCodeError('invalid UTF-8');
    }
  }
  done(): boolean {
    return this.offset === this.bytes.length;
  }
}

export function decodeShareCode(code: string): VehicleBlueprint {
  try {
    if (!code || !/^[A-Za-z0-9_-]+$/.test(code))
      throw new ShareCodeError('invalid base64');
    const normalized = code.replaceAll('-', '+').replaceAll('_', '/');
    const binary = atob(
      normalized + '='.repeat((4 - (normalized.length % 4)) % 4),
    );
    const reader = new Reader(
      Uint8Array.from(binary, (char) => char.charCodeAt(0)),
    );
    if (MAGIC.some((byte) => reader.byte() !== byte))
      throw new ShareCodeError('bad magic');
    const schemaVersion = reader.byte();
    const name = reader.string();
    const id = reader.string();
    const defCount = reader.varint();
    const defs = Array.from({ length: defCount }, () => reader.string());
    const parts = Array.from({ length: reader.varint() }, (_, index) => {
      const partId = reader.string();
      const defIndex = reader.varint();
      if (defIndex >= defs.length)
        throw new ShareCodeError('unknown defId table index');
      const pos = {
        x: reader.varint(),
        y: reader.varint(),
        z: reader.varint(),
      };
      const decodeZigzag = (value: number) =>
        value & 1 ? -(value + 1) / 2 : value / 2;
      const orient = reader.byte();
      if (orient > 23)
        throw new ShareCodeError(`invalid orientation in part ${index}`);
      const mask = reader.varint();
      const config: PartConfig = {};
      for (const key of ['level'] as const)
        if (mask & CONFIG_BITS[key]) config[key] = reader.varint();
      for (const key of [
        'driven',
        'steering',
        'steerInverted',
        'braking',
        'activeAbility',
      ] as const)
        if (mask & CONFIG_BITS[key]) {
          const value = reader.byte();
          if (value > 1) throw new ShareCodeError('invalid boolean');
          config[key] = value === 1;
        }
      if (mask & CONFIG_BITS.abilitySlot)
        config.abilitySlot = reader.varint() - 1;
      if (mask & CONFIG_BITS.suspensionPreset) {
        const value = reader.byte();
        if (value >= SUSPENSION_PRESETS.length)
          throw new ShareCodeError('invalid suspension preset');
        config.suspensionPreset = SUSPENSION_PRESETS[value];
      }
      if (mask & CONFIG_BITS.paint) {
        const value = reader.byte();
        if (value >= PAINT_COLORS_LIST.length)
          throw new ShareCodeError('invalid paint');
        config.paint = PAINT_COLORS_LIST[value];
      }
      return {
        id: partId,
        defId: defs[defIndex],
        pos: {
          x: decodeZigzag(pos.x),
          y: decodeZigzag(pos.y),
          z: decodeZigzag(pos.z),
        },
        orient,
        config,
      };
    });
    if (!reader.done()) throw new ShareCodeError('trailing bytes');
    return deserializeBlueprint(
      JSON.stringify({ schemaVersion, id, name, parts }),
    );
  } catch (error) {
    if (error instanceof ShareCodeError) throw error;
    throw new ShareCodeError(
      error instanceof Error ? error.message : 'malformed share code',
    );
  }
}

export function lockedDefIdsFor(
  bp: VehicleBlueprint,
  unlockedDefIds: readonly string[],
): string[] {
  const unlocked = new Set(unlockedDefIds);
  const used = new Set(bp.parts.map((part) => part.defId));
  return Object.keys(PART_CATALOG).filter(
    (defId) => used.has(defId) && !unlocked.has(defId),
  );
}
