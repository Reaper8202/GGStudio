/**
 * Typed, cached access to the data-driven tuning files. All tunables live in
 * src/data/*.json; this module is the single typed gateway to them so no system
 * ever hardcodes a designer-tunable number.
 */
import type {
  AnimalDef,
  BalanceDef,
  QuestDef,
  ResourceDef,
  ResourceKind,
  ShelterDef,
  ZoneId,
} from '../data/types';

import animalsJson from '../data/animals.json';
import balanceJson from '../data/balance.json';
import questsJson from '../data/quests.json';
import resourcesJson from '../data/resources.json';
import sheltersJson from '../data/shelters.json';

export const ANIMALS = animalsJson as unknown as AnimalDef[];
export const SHELTERS = sheltersJson as unknown as ShelterDef[];
export const RESOURCES = resourcesJson as unknown as ResourceDef[];
export const QUESTS = questsJson as unknown as QuestDef[];
export const BALANCE = balanceJson as unknown as BalanceDef;

const animalById = new Map<string, AnimalDef>(ANIMALS.map((a) => [a.id, a]));
const shelterById = new Map<string, ShelterDef>(SHELTERS.map((s) => [s.id, s]));
const resourceByKind = new Map<ResourceKind, ResourceDef>(
  RESOURCES.map((r) => [r.kind, r]),
);

export function getAnimal(id: string): AnimalDef {
  const def = animalById.get(id);
  if (!def) throw new Error(`Unknown animal id: ${id}`);
  return def;
}

export function tryAnimal(id: string): AnimalDef | undefined {
  return animalById.get(id);
}

export function getShelter(id: string): ShelterDef {
  const def = shelterById.get(id);
  if (!def) throw new Error(`Unknown shelter id: ${id}`);
  return def;
}

export function getResource(kind: ResourceKind): ResourceDef {
  const def = resourceByKind.get(kind);
  if (!def) throw new Error(`Unknown resource kind: ${kind}`);
  return def;
}

export function animalsInZone(zone: ZoneId): AnimalDef[] {
  return ANIMALS.filter((a) => a.zone === zone && !a.adGated);
}

/** Ad-gated legendary variants (Spirit Horse, Golden Stag, ...). */
export const LEGENDARIES = ANIMALS.filter((a) => a.tier === 'legendary');
/** Mythic dinos in unlock order. */
export const MYTHICS = ANIMALS.filter((a) => a.tier === 'mythic').sort(
  (a, b) => (a.mythicOrder ?? 0) - (b.mythicOrder ?? 0),
);

export const RESOURCE_KINDS: ResourceKind[] = ['berry', 'hay', 'forage', 'water'];

/** Skins available per species — base skin + any tinted legendary variants that
 * reuse this species' rig, exposed in the ZooPedia as ad-locked cosmetics. */
export function skinsForSpecies(
  speciesId: string,
): { skinId: string; name: string; tint?: string; emissive?: string; adLocked: boolean }[] {
  const base = { skinId: 'default', name: 'Natural', adLocked: false };
  const variants = ANIMALS.filter((a) => a.variantOf === speciesId).map((v) => ({
    skinId: v.id,
    name: v.name,
    tint: v.tint,
    emissive: v.emissive,
    adLocked: true,
  }));
  return [base, ...variants];
}
