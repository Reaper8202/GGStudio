/**
 * Collision group constants shared by all systems (orchestrator-owned, FROZEN).
 *
 * Rapier interaction groups pack two 16-bit masks: high bits = membership,
 * low bits = filter (which groups this collider interacts with).
 */
export const Group = {
  Static: 0x0001, // ground, buildings, barriers, ramp
  Vehicle: 0x0002,
  Zombie: 0x0004,
  Projectile: 0x0008,
  Prop: 0x0010, // small movable/destructible props
} as const;

export function interactionGroups(membership: number, filter: number): number {
  return ((membership & 0xffff) << 16) | (filter & 0xffff);
}

/** Preset interaction groups per collider kind. */
export const CollisionGroups = {
  static: interactionGroups(
    Group.Static,
    Group.Vehicle | Group.Zombie | Group.Projectile | Group.Prop
  ),
  vehicle: interactionGroups(
    Group.Vehicle,
    Group.Static | Group.Zombie | Group.Prop
  ),
  zombie: interactionGroups(
    Group.Zombie,
    Group.Static | Group.Vehicle | Group.Zombie | Group.Projectile | Group.Prop
  ),
  projectile: interactionGroups(Group.Projectile, Group.Static | Group.Zombie),
  prop: interactionGroups(
    Group.Prop,
    Group.Static | Group.Vehicle | Group.Zombie | Group.Prop
  ),
} as const;
