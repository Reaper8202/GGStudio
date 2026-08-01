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
  | 'signatureLightning'
  | 'signatureFireball'
  | 'signatureFireballBurst'
  | 'signatureNukeLaunch'
  | 'signatureNukeBlast'
  | 'abilityFlameLance'
  | 'abilityReinforce'
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
export const SFX_VOLUME_STORAGE_KEY = 'scraprig.sfx.volume';
export const MUSIC_VOLUME_STORAGE_KEY = 'scraprig.music.volume';

const DEFAULT_SFX_VOLUME = 1;
const DEFAULT_MUSIC_VOLUME = 1;
const SFX_MASTER_GAIN = 0.5;
const GARAGE_MUSIC_GAIN = 0.22;

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
  cashRegister: [audioUrl('coin-clink.mp3')],
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
  // Real recorded engine RPM-band loops, prepared specifically for seamless
  // looping (see LICENSES.md) — the standard racing-game technique is to
  // crossfade a small set of purpose-built loops rather than repeat a single
  // one-shot recording, which is what caused the previous "drive away" clip
  // to sound like it was restarting every lap.
  engineIdle: audioUrl('engine-idle.ogg'),
  engineRev: audioUrl('engine-mid.ogg'),
  tireSkid: audioUrl('tire-skid-loop.ogg'),
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
  rev: LoopLayer;
  skid: LoopLayer;
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
let sfxVolume: number | undefined;
let musicVolume: number | undefined;
let platformAudioMuted = false;
let activeVoices = 0;
let driveVoice: DriveVoice | null = null;
let flameVoice: FlameVoice | null = null;
let garageMusicVoice: MusicVoice | null = null;
let garageMusicWanted = false;
let masterBus: MasterBus | null = null;
let latestDriveInput: DriveSfxInput | null = null;
let variationCursor = 0;
// How "revved up" the engine currently is (0 idle, 1 fully revved), purely a
// function of how long the throttle key has been held — winds up quickly on
// press and winds back down slowly on release, independent of car speed.
let driveRevEnvelope = 0;

const buffers = new Map<string, AudioBuffer>();
const loads = new Map<string, Promise<void>>();
const lastCueAt = new Map<string, number>();

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function normalizeVolume(value: number, fallback: number): number {
  return clamp(Number.isFinite(value) ? value : fallback, 0, 1);
}

function effectiveSfxVolume(): number {
  return platformAudioMuted ? 0 : getSfxVolume();
}

function effectiveMusicVolume(): number {
  return platformAudioMuted ? 0 : getMusicVolume();
}

function initializeStoredVolumes(): void {
  if (sfxVolume !== undefined && musicVolume !== undefined) return;
  let legacyMuted = false;
  let storedSfx: string | null = null;
  let storedMusic: string | null = null;
  try {
    if (typeof localStorage !== 'undefined') {
      legacyMuted = localStorage.getItem(SFX_MUTED_STORAGE_KEY) === 'true';
      storedSfx = localStorage.getItem(SFX_VOLUME_STORAGE_KEY);
      storedMusic = localStorage.getItem(MUSIC_VOLUME_STORAGE_KEY);
    }
  } catch {
    // Storage failure falls back to a usable in-memory mix.
  }
  const legacyFallback = legacyMuted ? 0 : 1;
  sfxVolume = normalizeVolume(
    storedSfx === null ? legacyFallback : Number(storedSfx),
    DEFAULT_SFX_VOLUME,
  );
  musicVolume = normalizeVolume(
    storedMusic === null ? legacyFallback : Number(storedMusic),
    DEFAULT_MUSIC_VOLUME,
  );
}

function persistVolume(key: string, value: number): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(key, String(value));
    }
  } catch {
    // Storage failure must not affect the live mix.
  }
}

function persistLegacyMute(value: boolean): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(SFX_MUTED_STORAGE_KEY, String(value));
    }
  } catch {
    // Storage failure must not affect the live mix.
  }
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
    output.gain.value = SFX_MASTER_GAIN * effectiveSfxVolume();

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
  const rev = buffers.get(LOOP_URLS.engineRev);
  const skid = buffers.get(LOOP_URLS.tireSkid);
  if (!idle || !rev || !skid) return null;
  return {
    context,
    idle: createLoopLayer(context, idle),
    rev: createLoopLayer(context, rev),
    skid: createLoopLayer(context, skid),
  };
}

function stopDriveVoice(): void {
  const voice = driveVoice;
  driveVoice = null;
  driveRevEnvelope = 0;
  if (!voice) return;
  stopLoopLayer(voice.idle);
  stopLoopLayer(voice.rev);
  stopLoopLayer(voice.skid);
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
    effectiveMusicVolume() <= 0 ||
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
    gain.connect(context.destination);
    source.start();
    gain.gain.linearRampToValueAtTime(
      GARAGE_MUSIC_GAIN * getMusicVolume(),
      context.currentTime + 1.2,
    );
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
      playCue('cashRegister', { gain: 0.14, playbackRate: rate });
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
    // Build signature strikes. All six are voiced from existing samples,
    // pitched and layered rather than mixed new: the strike sounds have to sit
    // alongside guns already firing, and a bank of unfamiliar one-shots would
    // crowd the mix a run already runs hot on.
    case 'signatureLightning':
      // Fires several times a second, so it is quiet, short, and rate-limited:
      // a loud crack at this cadence would be unbearable inside a minute.
      playCue('electricPulse', {
        gain: 0.22,
        playbackRate: 1.25 * rate,
        cooldownSeconds: 0.1,
      });
      break;
    case 'signatureFireball':
      // The launch: a compressed whoomph as the bolus leaves the core.
      playCue('cannon', { gain: 0.26, playbackRate: 1.2 * rate });
      break;
    case 'signatureFireballBurst':
      playCue('explosion', { gain: 0.34, playbackRate: 1.1 * rate });
      break;
    case 'signatureNukeLaunch':
      // The launch is a thump, deliberately understated — the shell being in
      // the air is what matters, and the payoff is four seconds away.
      playCue('mechanical', { gain: 0.3, playbackRate: 0.7 * rate });
      break;
    case 'signatureNukeBlast':
      // Layered and pitched down: the loudest thing in the game short of the
      // scuttle charge, because it is on a ten-second cooldown and should feel
      // like it was worth waiting for.
      playCue('explosion', { gain: 0.55, playbackRate: 0.66 * rate });
      playCue('heavyImpact', { gain: 0.34, playbackRate: 0.6 * rate });
      break;
    case 'abilityFlameLance':
      playCue('powerUp', { gain: 0.26, playbackRate: 0.76 * rate });
      break;
    case 'abilityReinforce':
      playCue('mechanical', { gain: 0.32, playbackRate: 0.64 * rate });
      playCue('shield', { gain: 0.2, playbackRate: 0.8 * rate });
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
      if (Math.random() < 0.22) playSpatial('zombieGrowl', 0.12);
      break;
    case 'melee':
      playSpatial('zombieAttack', 0.15);
      break;
    case 'gunslinger':
      playSpatial('pistol', 0.4, 1);
      playSpatial('mechanical', 0.08, 1.18);
      break;
    case 'throw':
      playSpatial('zombieAttack', 0.11);
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
      playSpatial('zombieAttack', 0.08, 1.2);
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

  // The engine "revs" purely off the throttle key, never off car speed:
  // winds up quickly on press, winds back down over about a second on
  // release, same as a real driver lifting off the gas. Two purpose-built
  // loop recordings (idle character + a throatier rev character) are
  // equal-power crossfaded across that envelope, which is the standard
  // racing-game technique for a few static loops reading as one continuous
  // engine instead of two samples fighting each other.
  const revTarget = throttle > 0 ? 1 : 0;
  driveRevEnvelope +=
    (revTarget - driveRevEnvelope) * (revTarget > driveRevEnvelope ? 0.12 : 0.05);

  const revAngle = driveRevEnvelope * (Math.PI / 2);
  const idleWeight = Math.cos(revAngle);
  const revWeight = Math.sin(revAngle);
  const bed = driveRevEnvelope * 0.07;

  voice.idle.source.playbackRate.setTargetAtTime(0.97, now, 0.1);
  voice.rev.source.playbackRate.setTargetAtTime(
    1 + driveRevEnvelope * 0.08,
    now,
    0.1,
  );
  voice.idle.gain.gain.setTargetAtTime(bed * idleWeight, now, 0.05);
  voice.rev.gain.gain.setTargetAtTime(bed * revWeight, now, 0.05);

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
}

export function stopDriveSfx(): void {
  stopDriveVoice();
  stopFlameVoice();
  latestDriveInput = null;
}

/**
 * Ramps the drive loops down to silence in place, without tearing down the
 * underlying audio nodes. Physics ticks (and therefore syncDriveSfx calls)
 * stop the instant a wave clears or the run ends, which would otherwise
 * leave the engine loop frozen at its last volume instead of fading out.
 */
export function fadeOutDriveSfx(durationSeconds = 1.2): void {
  const voice = driveVoice;
  if (!voice) return;
  const now = voice.context.currentTime;
  const timeConstant = durationSeconds / 4;
  for (const layer of [voice.idle, voice.rev, voice.skid]) {
    layer.gain.gain.setTargetAtTime(0, now, timeConstant);
  }
  driveRevEnvelope = 0;
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

export function getSfxVolume(): number {
  initializeStoredVolumes();
  return sfxVolume ?? DEFAULT_SFX_VOLUME;
}

export function setSfxVolume(value: number): void {
  const previous = getSfxVolume();
  sfxVolume = normalizeVolume(value, previous);
  persistVolume(SFX_VOLUME_STORAGE_KEY, sfxVolume);
  // Keep the legacy key truthful for older builds that may read the same save.
  persistLegacyMute(sfxVolume <= 0);

  const context = audioContext;
  if (masterBus && context && masterBus.context === context) {
    masterBus.output.gain.setTargetAtTime(
      SFX_MASTER_GAIN * effectiveSfxVolume(),
      context.currentTime,
      0.015,
    );
  }
  if (effectiveSfxVolume() <= 0) {
    stopDriveVoice();
    stopFlameVoice();
  } else if (previous <= 0) {
    if (latestDriveInput) syncDriveSfx(latestDriveInput);
  }
}

export function getMusicVolume(): number {
  initializeStoredVolumes();
  return musicVolume ?? DEFAULT_MUSIC_VOLUME;
}

export function setMusicVolume(value: number): void {
  const previous = getMusicVolume();
  musicVolume = normalizeVolume(value, previous);
  persistVolume(MUSIC_VOLUME_STORAGE_KEY, musicVolume);

  const voice = garageMusicVoice;
  if (effectiveMusicVolume() <= 0) {
    stopGarageMusicVoice(0.08);
    return;
  }
  if (voice) {
    voice.gain.gain.setTargetAtTime(
      GARAGE_MUSIC_GAIN * effectiveMusicVolume(),
      voice.context.currentTime,
      0.03,
    );
    return;
  }
  const context = audioContext;
  if (previous <= 0 && context) ensureGarageMusic(context);
}

export function isSfxMuted(): boolean {
  return effectiveSfxVolume() <= 0;
}

/**
 * CrazyGames' platform mute overrides the live mix without rewriting either
 * player preference. Clearing it restores the exact saved levels.
 */
export function setPlatformAudioMuted(value: boolean): void {
  const next = Boolean(value);
  if (platformAudioMuted === next) return;
  platformAudioMuted = next;

  const context = audioContext;
  if (masterBus && context && masterBus.context === context) {
    masterBus.output.gain.setTargetAtTime(
      SFX_MASTER_GAIN * effectiveSfxVolume(),
      context.currentTime,
      0.015,
    );
  }
  if (platformAudioMuted) {
    stopDriveVoice();
    stopFlameVoice();
    stopGarageMusicVoice(0.08);
    return;
  }
  if (latestDriveInput && getSfxVolume() > 0) syncDriveSfx(latestDriveInput);
  if (context && getMusicVolume() > 0) ensureGarageMusic(context);
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
