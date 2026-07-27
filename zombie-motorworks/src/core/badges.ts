export type BadgeTier = 'common' | 'rare' | 'epic';

export interface BadgeDefinition {
  id: string;
  /** Short all-caps display name, e.g. 'FASTEST CLEAR'. */
  name: string;
  /** Single emoji. */
  icon: string;
  /** One short sentence explaining how it is earned. Player-facing. */
  description: string;
  tier: BadgeTier;
}

export const BADGES: readonly BadgeDefinition[] = [
  {
    id: 'untouched',
    name: 'UNTOUCHED',
    icon: '🛡',
    description: 'Finish a wave with no damage or lost parts.',
    tier: 'epic',
  },
  {
    id: 'iron-streak',
    name: 'IRON STREAK',
    icon: '👑',
    description: 'Clear seven waves in a row without losing a part.',
    tier: 'epic',
  },
  {
    id: 'fastest-clear',
    name: 'FASTEST CLEAR',
    icon: '⚡',
    description: 'Beat your best clear time for this wave.',
    tier: 'rare',
  },
  {
    id: 'close-call',
    name: 'CLOSE CALL',
    icon: '😬',
    description: 'Finish a wave with 15% integrity or less.',
    tier: 'rare',
  },
  {
    id: 'deep-run',
    name: 'DEEP RUN',
    icon: '🌊',
    description: 'Clear wave 10 or higher.',
    tier: 'rare',
  },
  {
    id: 'on-a-roll',
    name: 'ON A ROLL',
    icon: '🔥',
    description: 'Clear three waves in a row without losing a part.',
    tier: 'rare',
  },
  {
    id: 'speed-demon',
    name: 'SPEED DEMON',
    icon: '🏁',
    description: 'Clear a wave in 45 seconds or less.',
    tier: 'common',
  },
  {
    id: 'big-payday',
    name: 'BIG PAYDAY',
    icon: '💰',
    description: 'Earn at least $500 in one wave.',
    tier: 'common',
  },
  {
    id: 'all-parts-intact',
    name: 'RIG INTACT',
    icon: '🔧',
    description: 'Finish a wave without losing a part.',
    tier: 'common',
  },
  {
    id: 'overkill',
    name: 'OVERKILL',
    icon: '💥',
    description: 'Clear at least 30 zombies in one wave.',
    tier: 'common',
  },
];

export function getBadge(id: string): BadgeDefinition | undefined {
  return BADGES.find((badge) => badge.id === id);
}

/** Everything the badge rules need to judge one cleared wave. */
export interface WaveResultStats {
  wave: number;
  killsThisWave: number;
  elapsedSeconds: number;
  moneyEarned: number;
  /** Vehicle integrity at wave end, 0..100. */
  integrityPct: number;
  /** Vehicle integrity at wave start, 0..100. */
  startIntegrityPct: number;
  partsLost: number;
  damagedParts: number;
  /** Best previous clear time for THIS wave number, or null if never cleared. */
  bestSecondsForWave: number | null;
  /** Consecutive cleared waves with no parts lost, counting this one. */
  cleanWaveStreak: number;
}

function finite(value: number): boolean {
  return Number.isFinite(value);
}

function earned(badge: BadgeDefinition, stats: WaveResultStats): boolean {
  switch (badge.id) {
    case 'untouched':
      return (
        finite(stats.integrityPct) &&
        finite(stats.startIntegrityPct) &&
        finite(stats.partsLost) &&
        finite(stats.damagedParts) &&
        stats.integrityPct >= stats.startIntegrityPct &&
        stats.partsLost === 0 &&
        stats.damagedParts === 0
      );
    case 'iron-streak':
      return finite(stats.cleanWaveStreak) && stats.cleanWaveStreak >= 7;
    case 'fastest-clear':
      return (
        stats.bestSecondsForWave !== null &&
        finite(stats.elapsedSeconds) &&
        finite(stats.bestSecondsForWave) &&
        stats.elapsedSeconds < stats.bestSecondsForWave
      );
    case 'close-call':
      return (
        finite(stats.integrityPct) &&
        stats.integrityPct > 0 &&
        stats.integrityPct <= 15
      );
    case 'deep-run':
      return finite(stats.wave) && stats.wave >= 10;
    case 'on-a-roll':
      return finite(stats.cleanWaveStreak) && stats.cleanWaveStreak >= 3;
    case 'speed-demon':
      return finite(stats.elapsedSeconds) && stats.elapsedSeconds <= 45;
    case 'big-payday':
      return finite(stats.moneyEarned) && stats.moneyEarned >= 500;
    case 'all-parts-intact':
      return finite(stats.partsLost) && stats.partsLost === 0;
    case 'overkill':
      return finite(stats.killsThisWave) && stats.killsThisWave >= 30;
    default:
      return false;
  }
}

/** Pure rules engine. Returns the badges earned by one cleared wave. */
export function evaluateWaveBadges(stats: WaveResultStats): BadgeDefinition[] {
  return BADGES.filter((badge) => earned(badge, stats));
}
