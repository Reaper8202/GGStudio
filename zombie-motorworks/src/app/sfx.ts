import type {
  ZombieSfxReport,
  ZombieSfxEvent,
} from '../survival/zombies/ZombieSystem.ts';

export type SfxName =
  | 'coinTick'
  | 'badgeStamp'
  | 'waveClear'
  | 'cardIn'
  | 'uiClick'
  | 'uiDeny'
  | 'gunLight'
  | 'gunHeavy'
  | 'gunSniper'
  | 'gunIce'
  | 'flamethrower'
  | 'impactMetal'
  | 'impactRam'
  | 'abilityShield'
  | 'abilityFreeze'
  | 'abilityPulse'
  | 'abilityPhaseOut'
  | 'abilityPhaseIn'
  | 'abilityHellfire'
  | 'abilityOverdrive'
  | 'fuelPickup'
  | 'garagePlace'
  | 'garageRemove'
  | 'garagePurchase'
  | 'garageRepair'
  | 'garageUpgrade'
  | 'partBreak'
  | 'waveCountdown'
  | 'waveStart'
  | 'gameOver'
  | 'mineWarning'
  | 'vehicleRecover'
  | 'selfDestructArm'
  | 'selfDestructBlast';

export const SFX_MUTED_STORAGE_KEY = 'scraprig.sfx.muted';

type AudioContextGlobal = typeof globalThis & {
  webkitAudioContext?: typeof AudioContext;
};

const audioUrl = (file: string): string =>
  `${import.meta.env.BASE_URL}assets/audio/${file}`;

const SAMPLE_URLS = {
  uiClick: [audioUrl('ui-click-real.ogg')],
  uiDeny: [audioUrl('ui-deny.ogg')],
  mechanical: [audioUrl('mechanical-clunk.ogg')],
  pickup: [audioUrl('pickup-ding.ogg')],
  upgrade: [audioUrl('upgrade-confirm.ogg')],
  cashRegister: [audioUrl('cash-register.ogg')],
  waveChime: [audioUrl('wave-chime.ogg')],
  turret: [audioUrl('turret-shot-1.ogg'), audioUrl('turret-shot-2.ogg')],
  cannon: [audioUrl('cannon-shot-1.ogg'), audioUrl('cannon-shot-2.ogg')],
  sniper: [audioUrl('sniper-shot-1.ogg'), audioUrl('sniper-shot-2.ogg')],
  pistol: [audioUrl('pistol-shot-1.ogg'), audioUrl('pistol-shot-2.ogg')],
  freeze: [audioUrl('freeze-burst.ogg')],
  iceShatter: [audioUrl('ice-shatter-1.ogg'), audioUrl('ice-shatter-2.ogg')],
  metalImpact: [audioUrl('impact-metal.ogg')],
  heavyImpact: [audioUrl('impact-heavy.ogg')],
  sceneryImpact: [
    audioUrl('scenery-impact-1.ogg'),
    audioUrl('scenery-impact-2.ogg'),
  ],
  explosion: [audioUrl('explosion-metal.ogg'), audioUrl('explosion.ogg')],
  shield: [audioUrl('shield-impact.ogg')],
  phase: [audioUrl('phase-shift.ogg')],
  overdrive: [audioUrl('overdrive.ogg')],
  electricPulse: [audioUrl('electric-pulse.ogg')],
  powerUp: [audioUrl('power-up.ogg')],
  zombieGrowl: [audioUrl('zombie-growl-1.ogg'), audioUrl('zombie-growl-2.ogg')],
  zombieAttack: [
    audioUrl('zombie-attack-1.ogg'),
    audioUrl('zombie-attack-2.ogg'),
  ],
  zombieDeath: [audioUrl('zombie-death-1.ogg'), audioUrl('zombie-death-2.ogg')],
  gore: [
    audioUrl('gore-hit-1.ogg'),
    audioUrl('gore-hit-2.ogg'),
    audioUrl('gore-hit-3.ogg'),
  ],
} as const;

type SampleCue = keyof typeof SAMPLE_URLS;

const LOOP_URLS = {
  engineIdle: audioUrl('engine-idle.ogg'),
  engineMid: audioUrl('engine-mid.ogg'),
  engineHigh: audioUrl('engine-high.ogg'),
  tireSkid: audioUrl('tire-skid-loop.ogg'),
  surfaceGravel: audioUrl('surface-gravel-loop.ogg'),
  surfaceSand: audioUrl('surface-sand-loop.ogg'),
  surfaceSnow: audioUrl('surface-snow-loop.ogg'),
  flamethrower: audioUrl('flamethrower-loop.ogg'),
  garageMusic: audioUrl('garage-theme.ogg'),
} as const;

const ALL_URLS = [
  ...new Set([
    ...Object.values(SAMPLE_URLS).flat(),
    ...Object.values(LOOP_URLS),
  ]),
];

interface DriveSfxInput {
  rpm: number;
  speedKmh: number;
  throttle: number;
  groundedWheels: number;
  wheelSlip?: number;
  terrain?: 'gravel' | 'sand' | 'snow';
}

interface LoopLayer {
  source: AudioBufferSourceNode;
  gain: GainNode;
}

interface DriveVoice {
  context: AudioContext;
  idle: LoopLayer;
  mid: LoopLayer;
  high: LoopLayer;
  skid: LoopLayer;
  gravel: LoopLayer;
  sand: LoopLayer;
  snow: LoopLayer;
}

interface FlameVoice {
  context: AudioContext;
  source: AudioBufferSourceNode;
  gain: GainNode;
  stopTimer: ReturnType<typeof globalThis.setTimeout> | null;
}

interface MusicVoice {
  context: AudioContext;
  source: AudioBufferSourceNode;
  gain: GainNode;
}

interface MasterBus {
  context: AudioContext;
  input: GainNode;
  highpass: BiquadFilterNode;
  presence: BiquadFilterNode;
  compressor: DynamicsCompressorNode;
  output: GainNode;
}

export interface SfxListener {
  x: number;
  z: number;
  forwardX: number;
  forwardZ: number;
}

interface PlayOptions {
  gain?: number;
  playbackRate?: number;
  pan?: number;
  cooldownSeconds?: number;
}

let audioContext: AudioContext | null = null;
let muted: boolean | undefined;
let activeVoices = 0;
let driveVoice: DriveVoice | null = null;
let flameVoice: FlameVoice | null = null;
let garageMusicVoice: MusicVoice | null = null;
let garageMusicWanted = false;
let masterBus: MasterBus | null = null;
let latestDriveInput: DriveSfxInput | null = null;
let variationCursor = 0;

const buffers = new Map<string, AudioBuffer>();
const loads = new Map<string, Promise<void>>();
const lastCueAt = new Map<string, number>();

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function disconnectMasterBus(): void {
  const bus = masterBus;
  masterBus = null;
  if (!bus) return;
  try {
    bus.input.disconnect();
    bus.highpass.disconnect();
    bus.presence.disconnect();
    bus.compressor.disconnect();
    bus.output.disconnect();
  } catch {
    // The owning context may already be closed.
  }
}

/**
 * Every effect shares one restrained cleanup chain. The high-pass removes
 * inaudible rumble, the shelf restores presence lost to browser speakers, and
 * the compressor catches stacked combat transients without flattening them.
 */
function sfxOutput(context: AudioContext): AudioNode {
  if (masterBus?.context === context) return masterBus.input;
  disconnectMasterBus();
  try {
    const input = context.createGain();
    const highpass = context.createBiquadFilter();
    const presence = context.createBiquadFilter();
    const compressor = context.createDynamicsCompressor();
    const output = context.createGain();

    highpass.type = 'highpass';
    highpass.frequency.value = 26;
    highpass.Q.value = 0.7;
    presence.type = 'highshelf';
    presence.frequency.value = 3_200;
    presence.gain.value = 1.35;
    compressor.threshold.value = -9;
    compressor.knee.value = 8;
    compressor.ratio.value = 2.2;
    compressor.attack.value = 0.004;
    compressor.release.value = 0.09;
    output.gain.value = 0.94;

    input.connect(highpass);
    highpass.connect(presence);
    presence.connect(compressor);
    compressor.connect(output);
    output.connect(context.destination);
    masterBus = {
      context,
      input,
      highpass,
      presence,
      compressor,
      output,
    };
    return input;
  } catch {
    disconnectMasterBus();
    return context.destination;
  }
}

function getAudioContext(): AudioContext | null {
  if (audioContext?.state === 'closed') audioContext = null;
  if (audioContext !== null) return audioContext;

  const audioGlobal = globalThis as AudioContextGlobal;
  const AudioContextClass =
    globalThis.AudioContext ?? audioGlobal.webkitAudioContext;
  if (typeof AudioContextClass !== 'function') return null;

  try {
    audioContext = new AudioContextClass();
  } catch {
    audioContext = null;
  }
  return audioContext;
}

function loadUrl(context: AudioContext, url: string): Promise<void> {
  if (buffers.has(url)) return Promise.resolve();
  const existing = loads.get(url);
  if (existing) return existing;

  const load = fetch(url)
    .then(async (response) => {
      if (!response.ok) throw new Error(`Unable to load ${url}`);
      const buffer = await context.decodeAudioData(
        await response.arrayBuffer(),
      );
      if (audioContext === context) buffers.set(url, buffer);
    })
    .catch(() => {
      // Audio is presentation-only. A missing file must not break gameplay.
    })
    .finally(() => {
      loads.delete(url);
    });
  loads.set(url, load);
  return load;
}

function preload(context: AudioContext): void {
  for (const url of ALL_URLS) void loadUrl(context, url);
}

function cueUrl(cue: SampleCue): string {
  const urls = SAMPLE_URLS[cue] as readonly string[];
  variationCursor = (variationCursor + 1) % 997;
  return urls[variationCursor % urls.length];
}

function playUrl(cueKey: string, url: string, options: PlayOptions = {}): void {
  if (isSfxMuted() || activeVoices >= 24) return;
  const context = getAudioContext();
  if (context === null || context.state !== 'running') return;

  const cooldown = options.cooldownSeconds ?? 0;
  const last = lastCueAt.get(cueKey) ?? -Infinity;
  if (context.currentTime - last < cooldown) return;
  lastCueAt.set(cueKey, context.currentTime);

  const buffer = buffers.get(url);
  if (!buffer) {
    void loadUrl(context, url);
    return;
  }

  try {
    const source = context.createBufferSource();
    const gain = context.createGain();
    const pan = context.createStereoPanner();
    source.buffer = buffer;
    source.playbackRate.value = clamp(options.playbackRate ?? 1, 0.65, 1.45);
    gain.gain.value = clamp(options.gain ?? 0.25, 0, 0.8);
    pan.pan.value = clamp(options.pan ?? 0, -1, 1);
    source.connect(gain);
    gain.connect(pan);
    pan.connect(sfxOutput(context));
    activeVoices += 1;
    source.onended = () => {
      activeVoices = Math.max(0, activeVoices - 1);
      try {
        source.disconnect();
        gain.disconnect();
        pan.disconnect();
      } catch {
        // Cleanup after a context close is best-effort.
      }
    };
    source.start();
  } catch {
    // Restrictive Web Audio implementations may reject individual nodes.
  }
}

function playCue(cue: SampleCue, options: PlayOptions = {}): void {
  playUrl(cue, cueUrl(cue), options);
}

function createLoopLayer(
  context: AudioContext,
  buffer: AudioBuffer,
): LoopLayer {
  const source = context.createBufferSource();
  const gain = context.createGain();
  source.buffer = buffer;
  source.loop = true;
  gain.gain.value = 0;
  source.connect(gain);
  gain.connect(sfxOutput(context));
  source.start();
  return { source, gain };
}

function stopLoopLayer(layer: LoopLayer): void {
  try {
    layer.source.stop();
    layer.source.disconnect();
    layer.gain.disconnect();
  } catch {
    // The owning context may already be closed.
  }
}

function startDriveVoice(context: AudioContext): DriveVoice | null {
  const idle = buffers.get(LOOP_URLS.engineIdle);
  const mid = buffers.get(LOOP_URLS.engineMid);
  const high = buffers.get(LOOP_URLS.engineHigh);
  const skid = buffers.get(LOOP_URLS.tireSkid);
  const gravel = buffers.get(LOOP_URLS.surfaceGravel);
  const sand = buffers.get(LOOP_URLS.surfaceSand);
  const snow = buffers.get(LOOP_URLS.surfaceSnow);
  if (!idle || !mid || !high || !skid || !gravel || !sand || !snow) {
    return null;
  }
  return {
    context,
    idle: createLoopLayer(context, idle),
    mid: createLoopLayer(context, mid),
    high: createLoopLayer(context, high),
    skid: createLoopLayer(context, skid),
    gravel: createLoopLayer(context, gravel),
    sand: createLoopLayer(context, sand),
    snow: createLoopLayer(context, snow),
  };
}

function stopDriveVoice(): void {
  const voice = driveVoice;
  driveVoice = null;
  if (!voice) return;
  stopLoopLayer(voice.idle);
  stopLoopLayer(voice.mid);
  stopLoopLayer(voice.high);
  stopLoopLayer(voice.skid);
  stopLoopLayer(voice.gravel);
  stopLoopLayer(voice.sand);
  stopLoopLayer(voice.snow);
}

function stopFlameVoice(): void {
  const voice = flameVoice;
  flameVoice = null;
  if (!voice) return;
  if (voice.stopTimer !== null) globalThis.clearTimeout(voice.stopTimer);
  try {
    voice.source.stop();
    voice.source.disconnect();
    voice.gain.disconnect();
  } catch {
    // The owning context may already be closed.
  }
}

function stopGarageMusicVoice(fadeSeconds = 0.35): void {
  const voice = garageMusicVoice;
  garageMusicVoice = null;
  if (!voice) return;
  try {
    const now = voice.context.currentTime;
    const stopAt = now + Math.max(0, fadeSeconds);
    voice.gain.gain.cancelScheduledValues(now);
    voice.gain.gain.setValueAtTime(voice.gain.gain.value, now);
    voice.gain.gain.linearRampToValueAtTime(0, stopAt);
    voice.source.stop(stopAt + 0.02);
    voice.source.onended = () => {
      try {
        voice.source.disconnect();
        voice.gain.disconnect();
      } catch {
        // The owning context may already be closed.
      }
    };
  } catch {
    try {
      voice.source.stop();
      voice.source.disconnect();
      voice.gain.disconnect();
    } catch {
      // The owning context may already be closed.
    }
  }
}

function ensureGarageMusic(context: AudioContext): void {
  if (
    !garageMusicWanted ||
    isSfxMuted() ||
    context.state !== 'running' ||
    garageMusicVoice?.context === context
  ) {
    return;
  }
  if (garageMusicVoice) stopGarageMusicVoice(0);
  const buffer = buffers.get(LOOP_URLS.garageMusic);
  if (!buffer) {
    void loadUrl(context, LOOP_URLS.garageMusic).then(() =>
      ensureGarageMusic(context),
    );
    return;
  }

  try {
    const source = context.createBufferSource();
    const gain = context.createGain();
    source.buffer = buffer;
    source.loop = true;
    gain.gain.value = 0;
    source.connect(gain);
    gain.connect(sfxOutput(context));
    source.start();
    gain.gain.linearRampToValueAtTime(0.22, context.currentTime + 1.2);
    garageMusicVoice = { context, source, gain };
  } catch {
    // Music is presentation-only; editor operation must remain unaffected.
  }
}

function pulseFlamethrower(overcharged: boolean): void {
  if (isSfxMuted()) return;
  const context = getAudioContext();
  if (context === null || context.state !== 'running') return;
  const buffer = buffers.get(LOOP_URLS.flamethrower);
  if (!buffer) {
    void loadUrl(context, LOOP_URLS.flamethrower);
    return;
  }

  if (flameVoice?.context !== context) {
    stopFlameVoice();
    const source = context.createBufferSource();
    const gain = context.createGain();
    source.buffer = buffer;
    source.loop = true;
    source.playbackRate.value = overcharged ? 0.92 : 1;
    gain.gain.value = 0;
    source.connect(gain);
    gain.connect(sfxOutput(context));
    source.start();
    flameVoice = { context, source, gain, stopTimer: null };
  }

  const voice = flameVoice;
  if (!voice) return;
  voice.source.playbackRate.setTargetAtTime(
    overcharged ? 0.92 : 1,
    context.currentTime,
    0.03,
  );
  voice.gain.gain.setTargetAtTime(
    overcharged ? 0.28 : 0.2,
    context.currentTime,
    0.025,
  );
  if (voice.stopTimer !== null) globalThis.clearTimeout(voice.stopTimer);
  voice.stopTimer = globalThis.setTimeout(() => {
    if (flameVoice !== voice) return;
    voice.gain.gain.setTargetAtTime(0, context.currentTime, 0.035);
    voice.stopTimer = globalThis.setTimeout(() => stopFlameVoice(), 120);
  }, 180);
}

export function playSfx(name: SfxName, options: { pitch?: number } = {}): void {
  const rate = clamp(options.pitch ?? 1, 0.75, 1.35);
  switch (name) {
    case 'coinTick':
    case 'fuelPickup':
      playCue('pickup', { gain: 0.16, playbackRate: rate });
      break;
    case 'badgeStamp':
    case 'cardIn':
    case 'garagePlace':
    case 'garageRemove':
    case 'garageRepair':
      playCue('mechanical', { gain: 0.18, playbackRate: rate });
      break;
    case 'garagePurchase':
      playCue('cashRegister', { gain: 0.3, playbackRate: rate });
      break;
    case 'garageUpgrade':
      playCue('upgrade', { gain: 0.34, playbackRate: rate });
      break;
    case 'waveClear':
      playCue('waveChime', { gain: 0.22, playbackRate: rate });
      break;
    case 'uiClick':
      playCue('uiClick', {
        gain: 0.11,
        playbackRate: rate,
        cooldownSeconds: 0.025,
      });
      break;
    case 'uiDeny':
      playCue('uiDeny', { gain: 0.15, playbackRate: rate });
      break;
    case 'gunLight':
      playCue('turret', { gain: 0.3, playbackRate: rate });
      break;
    case 'gunHeavy':
      playCue('cannon', { gain: 0.52, playbackRate: rate });
      break;
    case 'gunSniper':
      playCue('sniper', { gain: 0.45, playbackRate: rate });
      break;
    case 'gunIce':
      playCue('freeze', {
        gain: 0.24,
        playbackRate: rate,
        cooldownSeconds: 0.12,
      });
      break;
    case 'flamethrower':
      pulseFlamethrower(false);
      break;
    case 'impactMetal':
      playCue('metalImpact', { gain: 0.25, playbackRate: rate });
      break;
    case 'impactRam':
      playCue('heavyImpact', { gain: 0.38, playbackRate: rate });
      break;
    case 'abilityShield':
      playCue('shield', { gain: 0.28, playbackRate: rate });
      break;
    case 'abilityFreeze':
      playCue('freeze', { gain: 0.36, playbackRate: rate });
      break;
    case 'abilityPulse':
      playCue('electricPulse', { gain: 0.32, playbackRate: rate });
      break;
    case 'abilityPhaseOut':
      playCue('phase', { gain: 0.28, playbackRate: 0.92 * rate });
      break;
    case 'abilityPhaseIn':
      playCue('phase', { gain: 0.28, playbackRate: 1.08 * rate });
      break;
    case 'abilityHellfire':
      playCue('powerUp', { gain: 0.25, playbackRate: 0.82 * rate });
      break;
    case 'abilityOverdrive':
      playCue('overdrive', { gain: 0.3, playbackRate: rate });
      break;
    case 'partBreak':
      playCue('metalImpact', { gain: 0.36, playbackRate: 0.82 * rate });
      break;
    case 'waveCountdown':
      playCue('uiClick', {
        gain: 0.13,
        playbackRate: 0.78 * rate,
        cooldownSeconds: 0.25,
      });
      break;
    case 'waveStart':
      playCue('mechanical', { gain: 0.2, playbackRate: 0.72 * rate });
      playCue('powerUp', { gain: 0.18, playbackRate: 0.9 * rate });
      break;
    case 'gameOver':
      playCue('heavyImpact', { gain: 0.38, playbackRate: 0.72 * rate });
      playCue('phase', { gain: 0.14, playbackRate: 0.72 * rate });
      break;
    case 'mineWarning':
      playCue('uiDeny', {
        gain: 0.13,
        playbackRate: 0.82 * rate,
        cooldownSeconds: 0.18,
      });
      break;
    case 'vehicleRecover':
      playCue('heavyImpact', { gain: 0.27, playbackRate: 0.8 * rate });
      playCue('mechanical', { gain: 0.12, playbackRate: 0.88 * rate });
      break;
    case 'selfDestructArm':
      playCue('powerUp', { gain: 0.3, playbackRate: 0.76 * rate });
      break;
    case 'selfDestructBlast':
      playCue('explosion', { gain: 0.65, playbackRate: 0.78 * rate });
      break;
  }
}

export function playWeaponSfx(
  weaponDefId: string,
  options: { overcharged?: boolean } = {},
): void {
  if (weaponDefId === 'flamethrower') {
    pulseFlamethrower(options.overcharged === true);
  } else if (weaponDefId === 'cannon-heavy') {
    playCue('cannon', { gain: 0.54, playbackRate: 0.92 });
  } else if (weaponDefId === 'ice-cannon') {
    playCue('freeze', {
      gain: 0.24,
      playbackRate: 1.08,
      cooldownSeconds: 0.12,
    });
  } else if (weaponDefId === 'sniper-light') {
    playCue('sniper', { gain: 0.43, playbackRate: 1.01 });
  } else {
    playCue('turret', {
      gain: 0.28,
      playbackRate: 0.98 + Math.random() * 0.025,
      cooldownSeconds: 0.035,
    });
  }
}

export function playImpactSfx(forceMagnitude: number): void {
  if (!Number.isFinite(forceMagnitude) || forceMagnitude < 55) return;
  const intensity = clamp(forceMagnitude / 900, 0, 1);
  playCue(intensity > 0.46 ? 'heavyImpact' : 'metalImpact', {
    gain: 0.14 + intensity * 0.3,
    playbackRate: 1.04 - intensity * 0.14,
    cooldownSeconds: 0.1,
  });
}

export function playVehicleDamageSfx(damage: number): void {
  if (!Number.isFinite(damage) || damage <= 0) return;
  const intensity = clamp(damage / 140, 0, 1);
  const cue: SampleCue = intensity > 0.52 ? 'heavyImpact' : 'metalImpact';
  playUrl(`vehicleDamage:${cue}`, cueUrl(cue), {
    gain: 0.14 + intensity * 0.24,
    playbackRate: 1.02 - intensity * 0.17,
    cooldownSeconds: 0.085,
  });
}

/**
 * Audio counterpart to one floating damage number. It is intentionally quiet
 * and heavily rate-limited: automatic weapons should read as a tactile stream,
 * while a kill gets one lower, firmer confirmation.
 */
export function playDamageNumberSfx(amount: number, killing = false): void {
  if (!Number.isFinite(amount) || amount <= 0) return;
  const intensity = clamp(amount / 100, 0, 1);
  playUrl('damageNumber:gore', cueUrl('gore'), {
    gain: killing ? 0.15 : 0.045 + intensity * 0.055,
    playbackRate: killing ? 0.78 : 1.12 - intensity * 0.14,
    cooldownSeconds: killing ? 0.04 : 0.028,
  });
  if (killing) {
    playUrl('damageNumber:kill', cueUrl('mechanical'), {
      gain: 0.065,
      playbackRate: 0.78,
      cooldownSeconds: 0.055,
    });
  }
}

export function playSceneryImpactSfx(forceMagnitude: number): void {
  if (!Number.isFinite(forceMagnitude) || forceMagnitude < 65) return;
  const intensity = clamp(forceMagnitude / 1_100, 0, 1);
  playCue('sceneryImpact', {
    gain: 0.16 + intensity * 0.3,
    playbackRate: 1.04 - intensity * 0.14,
    cooldownSeconds: 0.12,
  });
  if (intensity > 0.48) {
    playCue('heavyImpact', {
      gain: 0.08 + intensity * 0.14,
      playbackRate: 0.88,
      cooldownSeconds: 0.12,
    });
  }
}

export function playExplosionSfx(
  options: { gain?: number; playbackRate?: number } = {},
): void {
  playCue('explosion', {
    gain: options.gain ?? 0.48,
    playbackRate: options.playbackRate ?? 1,
    cooldownSeconds: 0.045,
  });
}

function zombiePitch(kind: ZombieSfxReport['kind']): number {
  switch (kind) {
    case 'behemoth':
      return 0.78;
    case 'necromancer':
      return 0.82;
    case 'kamikaze':
      return 1.2;
    case 'worker':
      return 0.94;
    case 'gunslinger':
      return 0.9;
    case 'thrower':
      return 1.08;
    case 'phone-addict':
      return 1.14;
    case 'zamboni':
      // Machine-borne and heavier than a behemoth, so it sits under everything.
      return 0.72;
    case 'boss':
      return 0.68;
    case 'walker':
      return 0.99 + Math.random() * 0.035;
  }
}

function spatialOptions(
  report: ZombieSfxReport,
  listener: SfxListener,
  baseGain: number,
): { gain: number; pan: number } | null {
  const dx = report.x - listener.x;
  const dz = report.z - listener.z;
  const distance = Math.hypot(dx, dz);
  if (distance > 88) return null;
  // Nearby specialists need to cut through the engine and gun mix, but their
  // abilities should fall away decisively instead of carrying across the map.
  const attenuation = 1.35 / (1 + (distance / 22) ** 2.25);
  const forwardLength = Math.hypot(listener.forwardX, listener.forwardZ) || 1;
  const rightX = -listener.forwardZ / forwardLength;
  const rightZ = listener.forwardX / forwardLength;
  const directionLength = distance || 1;
  const pan = (dx * rightX + dz * rightZ) / directionLength;
  return { gain: baseGain * attenuation, pan };
}

const ZOMBIE_EVENT_COOLDOWN: Record<ZombieSfxEvent, number> = {
  spawn: 0.22,
  melee: 0.09,
  gunslinger: 0.06,
  throw: 0.08,
  projectileImpact: 0.05,
  summon: 0.18,
  minePlant: 0.08,
  mineExplosion: 0.05,
  kamikazeTick: 0.16,
  kamikaze: 0.05,
  behemoth: 0.08,
  vehicleImpact: 0.06,
  shield: 0.04,
  death: 0.055,
};

export function playZombieSfx(
  report: ZombieSfxReport,
  listener: SfxListener,
): void {
  const pitch = zombiePitch(report.kind);
  const cooldownSeconds = ZOMBIE_EVENT_COOLDOWN[report.event];
  const key = `zombie:${report.kind}:${report.event}`;
  const playSpatial = (
    cue: SampleCue,
    baseGain: number,
    playbackRate = pitch,
  ): void => {
    const spatial = spatialOptions(report, listener, baseGain);
    if (!spatial) return;
    playUrl(`${key}:${cue}`, cueUrl(cue), {
      ...spatial,
      playbackRate,
      cooldownSeconds,
    });
  };

  switch (report.event) {
    case 'spawn':
      if (Math.random() < 0.22) playSpatial('zombieGrowl', 0.24);
      break;
    case 'melee':
      playSpatial('zombieAttack', 0.3);
      break;
    case 'gunslinger':
      playSpatial('pistol', 0.4, 1);
      playSpatial('mechanical', 0.08, 1.18);
      break;
    case 'throw':
      playSpatial('zombieAttack', 0.22);
      playSpatial('phase', 0.1, 1.36);
      break;
    case 'projectileImpact':
      playSpatial('sceneryImpact', 0.3, 1.04);
      break;
    case 'summon':
      playSpatial('phase', 0.28, 0.76);
      playSpatial('electricPulse', 0.2, 0.9);
      break;
    case 'minePlant':
      playSpatial('mechanical', 0.2, 0.9);
      playSpatial('uiClick', 0.08, 1.28);
      break;
    case 'mineExplosion':
      playSpatial('explosion', 0.5, 1.04);
      playSpatial('metalImpact', 0.12, 1.18);
      break;
    case 'kamikazeTick':
      playSpatial('uiClick', 0.13, 1.4);
      break;
    case 'kamikaze':
      playSpatial('explosion', 0.62, 0.84);
      playSpatial('zombieAttack', 0.16, 1.2);
      break;
    case 'behemoth':
      playSpatial('heavyImpact', 0.58, 0.74);
      playSpatial('sceneryImpact', 0.18, 0.72);
      break;
    case 'vehicleImpact':
      playSpatial('gore', 0.3, pitch);
      playSpatial('heavyImpact', 0.13, 0.9);
      break;
    case 'shield':
      playSpatial('shield', 0.26, 1);
      playSpatial('electricPulse', 0.08, 1.2);
      break;
    case 'death':
      playSpatial('gore', 0.24, pitch);
      if (Math.random() < 0.62) playSpatial('zombieDeath', 0.28, pitch);
      break;
  }
}

export function syncDriveSfx(input: DriveSfxInput): void {
  latestDriveInput = input;
  if (isSfxMuted()) {
    stopDriveVoice();
    return;
  }

  const context = getAudioContext();
  if (context === null || context.state !== 'running') return;
  preload(context);
  if (driveVoice?.context !== context) {
    stopDriveVoice();
    driveVoice = startDriveVoice(context);
  }
  const voice = driveVoice;
  if (!voice) return;

  const now = context.currentTime;
  const rpm = clamp(Number.isFinite(input.rpm) ? input.rpm : 0, 0, 9_000);
  const speed = clamp(
    Number.isFinite(input.speedKmh) ? input.speedKmh : 0,
    0,
    180,
  );
  const throttle = clamp(
    Number.isFinite(input.throttle) ? input.throttle : 0,
    0,
    1,
  );
  const slip = clamp(
    Number.isFinite(input.wheelSlip) ? (input.wheelSlip ?? 0) : 0,
    0,
    1,
  );
  const running = rpm > 250;

  const rev = clamp((rpm - 650) / 5_800, 0, 1);
  const idleWeight = clamp(1 - rev * 2, 0, 1);
  const midWeight = 1 - Math.abs(rev - 0.5) * 2;
  const highWeight = clamp((rev - 0.42) / 0.58, 0, 1);
  const bed = running ? 0.09 + throttle * 0.055 : 0;

  voice.idle.source.playbackRate.setTargetAtTime(0.96 + rev * 0.04, now, 0.06);
  voice.mid.source.playbackRate.setTargetAtTime(0.97 + rev * 0.045, now, 0.06);
  voice.high.source.playbackRate.setTargetAtTime(0.98 + rev * 0.05, now, 0.06);
  voice.idle.gain.gain.setTargetAtTime(bed * idleWeight, now, 0.08);
  voice.mid.gain.gain.setTargetAtTime(bed * midWeight, now, 0.08);
  voice.high.gain.gain.setTargetAtTime(
    bed * highWeight * (0.8 + throttle * 0.25),
    now,
    0.07,
  );

  // Loose terrain produces crunch and spray, not the continuous asphalt
  // squeal that made ordinary steering sound like a permanent drift. Keep
  // screech for genuinely severe high-speed slip on an unspecified hard
  // surface (currently the asphalt test chamber).
  const skidAmount =
    input.terrain === undefined && input.groundedWheels > 0 && speed > 28
      ? clamp((slip - 0.82) / 0.16, 0, 1)
      : 0;
  voice.skid.source.playbackRate.setTargetAtTime(
    0.88 + clamp(speed / 130, 0, 1) * 0.24,
    now,
    0.06,
  );
  voice.skid.gain.gain.setTargetAtTime(0.1 * skidAmount, now, 0.08);

  const rollingAmount =
    input.groundedWheels > 0
      ? clamp((speed - 4) / 52, 0, 1) * clamp(input.groundedWheels / 4, 0.35, 1)
      : 0;
  const surfaceRate = 0.82 + clamp(speed / 95, 0, 1) * 0.35;
  voice.gravel.source.playbackRate.setTargetAtTime(surfaceRate, now, 0.08);
  voice.sand.source.playbackRate.setTargetAtTime(surfaceRate * 0.9, now, 0.08);
  voice.snow.source.playbackRate.setTargetAtTime(surfaceRate * 0.94, now, 0.08);
  voice.gravel.gain.gain.setTargetAtTime(
    input.terrain === 'gravel' ? rollingAmount * 0.075 : 0,
    now,
    0.12,
  );
  voice.sand.gain.gain.setTargetAtTime(
    input.terrain === 'sand' ? rollingAmount * 0.06 : 0,
    now,
    0.12,
  );
  voice.snow.gain.gain.setTargetAtTime(
    input.terrain === 'snow' ? rollingAmount * 0.065 : 0,
    now,
    0.12,
  );
}

export function stopDriveSfx(): void {
  stopDriveVoice();
  stopFlameVoice();
  latestDriveInput = null;
}

export function startGarageMusic(): void {
  garageMusicWanted = true;
  const context = getAudioContext();
  if (!context) return;
  preload(context);
  ensureGarageMusic(context);
}

export function stopGarageMusic(): void {
  garageMusicWanted = false;
  stopGarageMusicVoice();
}

export function setSfxMuted(value: boolean): void {
  muted = value;
  if (value) {
    stopDriveVoice();
    stopFlameVoice();
    stopGarageMusicVoice(0.08);
  } else {
    if (latestDriveInput) syncDriveSfx(latestDriveInput);
    const context = getAudioContext();
    if (context) ensureGarageMusic(context);
  }
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(SFX_MUTED_STORAGE_KEY, String(value));
    }
  } catch {
    // Storage failure must not affect the live mix.
  }
}

export function isSfxMuted(): boolean {
  if (muted !== undefined) return muted;
  try {
    muted =
      typeof localStorage !== 'undefined' &&
      localStorage.getItem(SFX_MUTED_STORAGE_KEY) === 'true';
  } catch {
    muted = false;
  }
  return muted;
}

export function unlockAudio(): void {
  try {
    const context = getAudioContext();
    if (!context) return;
    preload(context);
    if (context.state === 'suspended') {
      void context.resume().then(() => {
        if (latestDriveInput) syncDriveSfx(latestDriveInput);
        ensureGarageMusic(context);
      });
    } else {
      ensureGarageMusic(context);
    }
  } catch {
    // Browsers without a usable Web Audio implementation stay silent.
  }
}

export function disposeSfx(): void {
  const context = audioContext;
  audioContext = null;
  stopDriveVoice();
  stopFlameVoice();
  garageMusicWanted = false;
  stopGarageMusicVoice(0);
  disconnectMasterBus();
  latestDriveInput = null;
  activeVoices = 0;
  buffers.clear();
  loads.clear();
  lastCueAt.clear();
  if (!context) return;
  try {
    void context.close();
  } catch {
    // Closing an already-closed context is harmless.
  }
}
