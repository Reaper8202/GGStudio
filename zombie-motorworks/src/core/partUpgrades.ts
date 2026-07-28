/**
 * Named upgrade unlocks.
 *
 * A part's levels are not anonymous "+1"s. Every level above the base is a
 * specific piece of hardware the player unlocks, with an icon, a name and one
 * line saying what it buys. The chain is strictly ordered: unlock 1 has to be
 * bought before unlock 2, so a part's level and its unlock count are the same
 * number.
 *
 * The same step drives the model. `src/editor/parts/upgradeKit.ts` bolts the
 * matching hardware onto the mesh, so a gun that has bought the ammo drum
 * visibly carries one. Keep the two files in step: if a name changes here, the
 * geometry it describes changes there.
 *
 * Pure data — no engine or DOM imports (see AGENTS.md).
 */

import type { PartDefinition } from './types.ts';

/** Unlocks available on every upgradeable part, i.e. the star rating's cap. */
export const MAX_UPGRADE_STEPS = 5;

/** Highest level any upgradeable part reaches: base level plus every unlock. */
export const MAX_PART_LEVEL = MAX_UPGRADE_STEPS + 1;

/**
 * One chain per kind of hardware. Guns and melee heads split further by model
 * — a sawblade and a spike ram want nothing like the same parts bolted to them,
 * and a chain that fits both fits neither.
 */
export type UpgradeTrackId =
  | 'weapon-turret'
  | 'weapon-cannon'
  | 'weapon-sniper'
  | 'weapon-ice'
  | 'weapon-flame'
  | 'melee-drum'
  | 'melee-spikes'
  | 'melee-blade'
  | 'melee-plow'
  | 'engine'
  | 'wheel'
  | 'armour'
  | 'ability'
  | 'tank'
  | 'frame';

export interface UpgradeStep {
  /** Level this unlock grants. Steps run 2..MAX_PART_LEVEL. */
  level: number;
  /** Single display glyph, in the style of the ability bar's icons. */
  icon: string;
  /** Two or three words naming the hardware. */
  name: string;
  /** A few words on what the player gets. */
  blurb: string;
}

function track(
  steps: readonly [icon: string, name: string, blurb: string][],
): readonly UpgradeStep[] {
  return steps.map(([icon, name, blurb], index) => ({
    level: index + 2,
    icon,
    name,
    blurb,
  }));
}

export const UPGRADE_TRACKS: Record<UpgradeTrackId, readonly UpgradeStep[]> = {
  // The Zombie Blaster, and the chain any future belt-fed gun falls back to.
  // Two of its links change how the gun resolves hits rather than just its
  // numbers, so a gun joining this track has to wire up `turretEmpLevel` and
  // `turretPiercingLevel` as well.
  'weapon-turret': track([
    ['⌖', 'Long Barrels', 'Longer tubes and a flash brake'],
    ['⊙', 'Ammo Drum', 'Drum mag feeds the breech faster'],
    ['⌁', 'EMP Coil', 'Shots punch through bubble shields'],
    ['⌗', 'Piercing Rounds', 'Shots carry into a second zombie'],
    ['⌸', 'Recoil Rig', 'Hydraulic rams steady the burst'],
  ]),
  'weapon-cannon': track([
    ['⌖', 'Bored Tube', 'Longer tube and a bigger brake'],
    ['▤', 'Shell Rack', 'Ready rack down the turret flank'],
    ['⌸', 'Recoil Rams', 'Twin rams soak up the kick'],
    ['◎', 'Rangefinder', 'Optical horns range the shot'],
    ['◈', 'Turret Skirts', 'Bolted skirts armour the ring'],
  ]),
  'weapon-sniper': track([
    ['⌖', 'Match Barrel', 'Fluted tube and a tuned brake'],
    ['▂', 'Bipod Feet', 'Braced feet steady the shot'],
    ['◎', 'Big Glass', 'Longer scope, lit reticle'],
    ['⌇', 'Suppressor', 'Can hides the muzzle flash'],
    ['▮', 'Cheek Rig', 'Rear rest and a longer rail'],
  ]),
  'weapon-ice': track([
    ['⌖', 'Long Emitter', 'Longer emitter, tighter cone'],
    ['⊙', 'Coolant Bottles', 'Extra bottles run it longer'],
    ['≣', 'Condenser Fins', 'Fins dump the pumped heat'],
    ['❄', 'Frost Rings', 'Charged rings widen the freeze'],
    ['◈', 'Aperture Prongs', 'Extra prongs shape the blast'],
  ]),
  'weapon-flame': track([
    ['⌖', 'Long Nozzle', 'Longer nozzle throws further'],
    ['⊙', 'Pressure Bottle', 'A third bottle feeds it longer'],
    ['≣', 'Heat Shroud', 'Ribbed shroud takes the heat'],
    ['♨', 'Pilot Cluster', 'Extra pilots unlock the Hellfire ability'],
    ['▮', 'Fuel Rail', 'Armoured line off the tank'],
  ]),
  'melee-drum': track([
    ['▲', 'Grinder Teeth', 'More teeth around the roller'],
    ['⊙', 'Drive Motor', 'Motor can spins the drum harder'],
    ['≣', 'Scraper Bar', 'Bar strips the drum clean'],
    ['▤', 'End Discs', 'Discs stop the mess wrapping'],
    ['▮', 'Hardened Shell', 'Thicker shell takes the beating'],
  ]),
  'melee-spikes': track([
    ['▲', 'Longer Spikes', 'Deeper points reach further in'],
    ['≣', 'Backing Plate', 'Plate spreads the impact back'],
    ['✖', 'Cross Bar', 'Braced bar ties the points together'],
    ['◤', 'Side Horns', 'Outer horns catch what slips past'],
    ['▮', 'Hardened Tips', 'Cased points stop blunting'],
  ]),
  'melee-blade': track([
    ['▲', 'Carbide Teeth', 'Tipped teeth chew instead of slap'],
    ['⊙', 'Drive Belt', 'Belt and motor spin it up harder'],
    ['◠', 'Blade Guard', 'Hood keeps the mess off the rig'],
    ['⌗', 'Second Disc', 'A second disc doubles the bite'],
    ['▮', 'Hardened Rim', 'Thicker rim survives the bone'],
  ]),
  'melee-plow': track([
    ['◤', 'Tall Mouldboard', 'Higher blade scoops more at once'],
    ['◣', 'Side Wings', 'Wings stop the pile spilling out'],
    ['≣', 'Bracing Ribs', 'Ribs stiffen the blade face'],
    ['▂', 'Skid Shoes', 'Shoes let it ride the ground'],
    ['▮', 'Cutting Edge', 'Bolt-on edge bites the road'],
  ]),
  engine: track([
    ['⊙', 'Turbocharger', 'Boost pressure adds torque'],
    ['≣', 'Intercooler', 'Cool air, more power up top'],
    ['⌇', 'Exhaust Stacks', 'Free-flowing pipes, higher revs'],
    ['▣', 'Race Cams', 'Redline climbs and pull gets mean'],
    ['◈', 'Nitrous Plate', 'Bottled shot of chemical power'],
  ]),
  wheel: track([
    ['◎', 'Beadlock Rims', 'Rim clamps the tyre onto the hub'],
    ['▲', 'Studded Tread', 'Chunky studs claw at the dirt'],
    ['≣', 'Stiff Sidewalls', 'Ribbed wall stops the tyre folding'],
    ['◈', 'Hub Guards', 'Bolted disc shields the axle'],
    ['⌗', 'Drive Sprocket', 'Toothed sprocket hooks the drive up'],
  ]),
  armour: track([
    ['▤', 'Bolted Layer', 'Second plate bolted over the first'],
    ['▲', 'Spike Studs', 'Studded face punishes rammers'],
    ['≣', 'Ribbed Backing', 'Ribs spread the impact out'],
    ['◈', 'Ablative Bricks', 'Bolt-on blocks eat the blow'],
    ['◤', 'Sloped Cheeks', 'Angled cheeks deflect the hit'],
  ]),
  ability: track([
    ['◈', 'Focus Ring', 'Tighter field, cleaner effect'],
    ['⊙', 'Capacitor Bank', 'Stored charge runs it longer'],
    ['≣', 'Heat Sink', 'Finned stack sheds the waste heat'],
    ['✦', 'Emitter Prongs', 'Extra prongs push the field wider'],
    ['⚡', 'Reactor Core', 'Lit core drives it to full power'],
  ]),
  tank: track([
    ['⊙', 'Reserve Bottle', 'Spare bottle strapped on top'],
    ['≣', 'Baffle Bands', 'Banding stops the fuel sloshing'],
    ['▤', 'Armoured Skin', 'Bolted plating up both flanks'],
    ['⌇', 'Filler Neck', 'Fat neck for a quicker refill'],
    ['▮', 'Blast Cage', 'Steel cage around the whole tank'],
  ]),
  frame: track([
    ['▤', 'Bolted Plating', 'Extra skin bolted over the box'],
    ['≣', 'Cross Bracing', 'Diagonal braces stiffen the cell'],
    ['▲', 'Corner Gussets', 'Gusseted corners resist twisting'],
    ['◈', 'Impact Padding', 'Crush pads soak up the shock'],
    ['▮', 'Roll Cage', 'Tube cage wrapped over the block'],
  ]),
};

/**
 * Which unlock chain a part runs. A gun that also carries an ability (the
 * flamethrower's Hellfire) still upgrades as a gun — the hardware the player
 * sees bolted on is the gun's.
 */
export function upgradeTrackFor(def: PartDefinition): UpgradeTrackId {
  if (def.weapon) {
    switch (def.id) {
      case 'cannon-heavy':
        return 'weapon-cannon';
      case 'sniper-light':
        return 'weapon-sniper';
      case 'ice-cannon':
        return 'weapon-ice';
      case 'flamethrower':
        return 'weapon-flame';
      default:
        return 'weapon-turret';
    }
  }
  if (def.melee) {
    switch (def.melee.visual) {
      case 'spikes':
        return 'melee-spikes';
      case 'blade':
        return 'melee-blade';
      case 'plow':
        return 'melee-plow';
      default:
        return 'melee-drum';
    }
  }
  if (def.wheel) return 'wheel';
  if (def.engine) return 'engine';
  if (def.armour) return 'armour';
  if (def.ability) return 'ability';
  if (def.fuelCapacity !== undefined) return 'tank';
  return 'frame';
}

/** The unlock chain for a part, trimmed to the levels it can actually reach. */
export function upgradeStepsFor(def: PartDefinition): readonly UpgradeStep[] {
  const maxLevel = def.upgrade?.maxLevel ?? 1;
  return UPGRADE_TRACKS[upgradeTrackFor(def)].filter(
    (step) => step.level <= maxLevel,
  );
}

/** The unlock that grants `level`, or undefined for the base level. */
export function upgradeStepFor(
  def: PartDefinition,
  level: number,
): UpgradeStep | undefined {
  return upgradeStepsFor(def).find((step) => step.level === level);
}

/**
 * Stars earned: one per unlock bought, so an untouched part shows none and a
 * maxed one shows all five.
 */
export function upgradeStars(level: number): number {
  return Math.max(0, Math.min(MAX_UPGRADE_STEPS, Math.floor(level) - 1));
}
