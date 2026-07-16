# Item System (`src/items/`)

Items are the persistent, customizable parts a player attaches to their car —
engines, wheels, turrets, armor. Each item levels up incrementally (Engine
level 1, 2, 3, …), gaining stats every level and unlocking **abilities** at
specific levels (e.g. the Basic Engine unlocks **boost** at level 7).

> Not to be confused with `src/config/upgradeDefs.ts` — those are the
> run-scoped upgrades bought in the between-wave panel, and they reset every
> run. Items are the permanent garage/customization layer.

## Architecture

| Piece | File | Responsibility |
|---|---|---|
| `ItemDefinition` | `src/items/types.ts` | Plain data describing one item: slot, pricing, per-level stat scaling, ability unlocks |
| `ItemRegistry` | `src/items/ItemRegistry.ts` | Catalog of every item in the game; validates and freezes definitions at boot |
| `CarLoadout` | `src/items/CarLoadout.ts` | What's equipped on the car and at what level; aggregates stats and abilities |
| Definitions | `src/items/definitions/*.ts` | One file per item; `definitions/index.ts` lists them all |
| `createItemSystem()` | `src/items/index.ts` | Boot helper: registry + starter loadout (default wheels, basic turret, basic engine at level 1) |

Definitions are **pure data** — no callbacks, no game-state mutation. All the
math (level scaling, price curves, stat aggregation) lives in the shared
helpers, so every item behaves consistently and a new item can't break the
rules.

## Adding a new item

**1. Create `src/items/definitions/yourItem.ts`:**

```ts
/** Heavy plating for the front of the car. */
import type { ItemDefinition } from "../types";

export const SPIKED_RAM: ItemDefinition = {
  id: "spiked-ram",            // unique, kebab-case
  name: "Spiked Ram",
  description: "A steel wedge that turns the bumper into a weapon.",
  slot: "armor",               // engine | wheels | weapon | armor | utility
  maxLevel: 6,
  basePrice: 120,              // price of the level 1 -> 2 upgrade
  priceGrowth: 1.5,            // price(level) = round(basePrice * growth^(level-1))
  stats: [
    { stat: "maxHealth", flatPerLevel: 20 },              // +20 HP per level
    { stat: "damageResistance", flatPerLevel: 0.03, maxFlat: 0.15 },
  ],
  unlocks: [
    {
      level: 4,
      ability: "boost",        // must be an AbilityId (see below)
      name: "Ram Charge",
      description: "Slam forward through the horde.",
    },
  ],
};
```

**2. Register it in `src/items/definitions/index.ts`:**

```ts
import { SPIKED_RAM } from "./spikedRam";

export const ALL_ITEMS: readonly ItemDefinition[] = [
  BASIC_ENGINE,
  DEFAULT_WHEELS,
  BASIC_TURRET,
  SPIKED_RAM,   // <-- add here
];
```

That's it — the item now exists in the game. Add its id to
`STARTER_ITEM_IDS` in the same file if every new car should begin with it.

The registry validates every definition at boot (duplicate ids, unlock levels
past `maxLevel`, scalings that modify nothing, bad pricing) and throws
immediately, so a mistake shows up as a crash on load, not a subtle balance bug.

## Stat scaling

Each `StatScaling` entry describes how one stat grows with the item's level:

```ts
{ stat: "enginePower", percentPerLevel: 0.1 }
// level 1: +0%   level 2: +10%   level 5: +40%

{ stat: "maxHealth", baseFlat: 10, flatPerLevel: 20, maxFlat: 100 }
// level 1: +10 HP   level 2: +30 HP   ...capped at +100 HP
```

- **Level 1 is the baseline.** `base*` values (default 0) apply at level 1;
  each level past 1 adds the `*PerLevel` values. Starter items at level 1
  therefore leave the car exactly at its base tuning.
- `percent*` fields are fractional bonuses (`0.1` = +10%). Across all
  equipped items they **stack additively** into one multiplier per stat.
- `flat*` fields are absolute amounts (HP, resistance fraction) and sum.
- `maxPercent` / `maxFlat` cap that scaling's total contribution.

Available stat keys (`ItemStatKey` in `src/items/types.ts`):

| Key | Meaning |
|---|---|
| `enginePower` | Acceleration multiplier |
| `topSpeed` | Maximum forward speed multiplier |
| `grip` | Lateral grip / steering feel multiplier |
| `weaponDamage` | Turret damage multiplier |
| `weaponFireRate` | Turret fire-rate multiplier |
| `weaponRange` | Turret range multiplier |
| `maxHealth` | Extra max HP (use `flat*`) |
| `damageResistance` | Fraction of incoming damage ignored, 0..1 (use `flat*`) |

Need a stat no key covers? Add the key to the `ItemStatKey` union **and** the
`ITEM_STAT_KEYS` array in `src/items/types.ts`, then have the consuming
system read it from `CarLoadout.computeStats()`.

## Abilities

Abilities are level-gated unlocks, not stat changes — e.g. boost at engine
level 7. An item declares them in `unlocks`; gameplay systems ask the loadout:

```ts
if (loadout.hasAbility("boost")) { /* enable the boost input */ }
```

Valid ability names live in the `AbilityId` union in `src/items/types.ts`
(currently just `"boost"`). To introduce a new ability:

1. Add its name to the `AbilityId` union.
2. Reference it from an item's `unlocks`.
3. Implement the behavior in the relevant gameplay system, gated on
   `loadout.hasAbility(...)`.

## Using the loadout

```ts
import { createItemSystem } from "./items";

const { registry, loadout } = createItemSystem(); // starter items equipped at level 1

loadout.upgrade("basic-engine");            // level 1 -> 2 (throws at max level)
loadout.nextUpgradePrice("basic-engine");   // cost of the next level, null at max
loadout.getLevel("basic-engine");           // 2 (0 = not equipped)
loadout.equip("spiked-ram");                // attach a new item at level 1
loadout.unequip("spiked-ram");

loadout.computeStats();
// -> { enginePower: { flat: 0, multiplier: 1.1 }, topSpeed: {...}, ... }
// Apply as: final = (baseValue + flat) * multiplier

loadout.unlockedAbilities();                // AbilityUnlock[] currently active
registry.inSlot("engine");                  // every engine in the catalog (for shop UI)
```

`CarLoadout` deliberately does **not** touch money — the economy checks
`nextUpgradePrice` and spends before calling `upgrade`. It also doesn't
persist itself; save/load will serialize `equipped()` (id + level pairs).

## Trying it in the browser

`main.ts` exposes the system on `window.__game`:

```js
__game.loadout.computeStats()
__game.loadout.upgrade("basic-engine")
__game.itemRegistry.all().map(d => d.id)
```

## Not built yet (intentionally)

- The customization/garage UI and attaching items to blueprint positions.
- Wiring `computeStats()` into the vehicle/turret systems (they currently
  read the run-scoped `state.modifiers` only).
- Ability implementations (boost itself) and loadout save/load.
