export type SfxName =
  'coinTick' | 'badgeStamp' | 'waveClear' | 'cardIn' | 'uiClick';

export const SFX_MUTED_STORAGE_KEY = 'scraprig.sfx.muted';

type AudioContextGlobal = typeof globalThis & {
  webkitAudioContext?: typeof AudioContext;
};

let audioContext: AudioContext | null = null;
let muted: boolean | undefined;
let activeVoices = 0;

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

function pitchMultiplier(pitch: number | undefined): number {
  if (pitch === undefined || !Number.isFinite(pitch)) return 1;
  return Math.min(4, Math.max(0.25, pitch));
}

function envelope(
  gain: AudioParam,
  start: number,
  attack: number,
  end: number,
  peak: number,
): void {
  const fadeEnd = Math.max(start + attack, end - 0.003);
  gain.setValueAtTime(0, start);
  gain.linearRampToValueAtTime(Math.min(0.25, peak), start + attack);
  gain.exponentialRampToValueAtTime(0.0001, fadeEnd);
  gain.linearRampToValueAtTime(0, end);
}

interface Voice {
  track(source: AudioScheduledSourceNode, nodes: readonly AudioNode[]): void;
}

function playVoice(context: AudioContext, build: (voice: Voice) => void): void {
  if (activeVoices >= 8) return;

  activeVoices += 1;
  let remainingSources = 0;
  let building = true;
  let released = false;

  const release = (): void => {
    if (released || building || remainingSources > 0) return;
    released = true;
    if (audioContext === context) activeVoices = Math.max(0, activeVoices - 1);
  };

  const voice: Voice = {
    track(source, nodes) {
      remainingSources += 1;
      source.onended = () => {
        try {
          source.disconnect();
          for (const node of nodes) node.disconnect();
        } catch {
          // Browsers differ on whether disconnecting an ended node may throw.
        }
        remainingSources -= 1;
        release();
      };
    },
  };

  try {
    build(voice);
  } catch {
    // Audio failures are presentation-only and must never reach the game loop.
  } finally {
    building = false;
    release();
  }
}

function oscillator(
  context: AudioContext,
  voice: Voice,
  options: {
    type: OscillatorType;
    start: number;
    duration: number;
    frequency: number;
    endFrequency?: number;
    peak: number;
    attack?: number;
  },
): void {
  const source = context.createOscillator();
  const gain = context.createGain();
  const end = options.start + options.duration;

  source.type = options.type;
  source.frequency.setValueAtTime(options.frequency, options.start);
  if (options.endFrequency !== undefined) {
    source.frequency.exponentialRampToValueAtTime(options.endFrequency, end);
  }
  envelope(
    gain.gain,
    options.start,
    options.attack ?? 0.003,
    end,
    options.peak,
  );
  source.connect(gain);
  gain.connect(context.destination);
  voice.track(source, [gain]);
  source.start(options.start);
  source.stop(end + 0.005);
}

function noise(
  context: AudioContext,
  voice: Voice,
  options: {
    start: number;
    duration: number;
    peak: number;
    filterFrequency: number;
    endFilterFrequency?: number;
  },
): void {
  const frameCount = Math.max(
    1,
    Math.ceil(context.sampleRate * options.duration),
  );
  const buffer = context.createBuffer(1, frameCount, context.sampleRate);
  const samples = buffer.getChannelData(0);
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = Math.random() * 2 - 1;
  }

  const source = context.createBufferSource();
  const filter = context.createBiquadFilter();
  const gain = context.createGain();
  const end = options.start + options.duration;

  source.buffer = buffer;
  filter.type = 'bandpass';
  filter.Q.value = 0.8;
  filter.frequency.setValueAtTime(options.filterFrequency, options.start);
  if (options.endFilterFrequency !== undefined) {
    filter.frequency.exponentialRampToValueAtTime(
      options.endFilterFrequency,
      end,
    );
  }
  envelope(gain.gain, options.start, 0.003, end, options.peak);
  source.connect(filter);
  filter.connect(gain);
  gain.connect(context.destination);
  voice.track(source, [filter, gain]);
  source.start(options.start);
  source.stop(end + 0.005);
}

function buildCue(
  context: AudioContext,
  voice: Voice,
  name: SfxName,
  pitch: number,
): void {
  const now = context.currentTime + 0.005;

  switch (name) {
    case 'coinTick':
      oscillator(context, voice, {
        type: 'square',
        start: now,
        duration: 0.04,
        frequency: 880 * pitch,
        endFrequency: 1_050 * pitch,
        peak: 0.09,
      });
      break;
    case 'badgeStamp':
      oscillator(context, voice, {
        type: 'sine',
        start: now,
        duration: 0.12,
        frequency: 190 * pitch,
        endFrequency: 125 * pitch,
        peak: 0.22,
      });
      noise(context, voice, {
        start: now,
        duration: 0.055,
        peak: 0.08,
        filterFrequency: 1_400 * pitch,
      });
      break;
    case 'waveClear':
      [1, 1.25, 1.5].forEach((ratio, index) => {
        oscillator(context, voice, {
          type: 'triangle',
          start: now + index * 0.065,
          duration: 0.09,
          frequency: 523.25 * ratio * pitch,
          peak: 0.12,
          attack: 0.006,
        });
      });
      break;
    case 'cardIn':
      oscillator(context, voice, {
        type: 'sine',
        start: now,
        duration: 0.18,
        frequency: 260 * pitch,
        endFrequency: 780 * pitch,
        peak: 0.11,
        attack: 0.012,
      });
      break;
    case 'uiClick':
      oscillator(context, voice, {
        type: 'triangle',
        start: now,
        duration: 0.025,
        frequency: 1_200 * pitch,
        endFrequency: 900 * pitch,
        peak: 0.04,
      });
      break;
  }
}

/**
 * Play a cue. Safe to call anywhere: no-ops in node, when muted, or before the
 * browser has granted audio.
 */
export function playSfx(name: SfxName, options: { pitch?: number } = {}): void {
  try {
    if (isSfxMuted()) return;
    const context = getAudioContext();
    if (context === null || context.state !== 'running') return;
    playVoice(context, (voice) => {
      buildCue(context, voice, name, pitchMultiplier(options.pitch));
    });
  } catch {
    // Reward audio must remain safe on incomplete or restrictive Web Audio APIs.
  }
}

export function setSfxMuted(value: boolean): void {
  muted = value;
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(SFX_MUTED_STORAGE_KEY, String(value));
  } catch {
    // Muting still applies in memory when persistence is unavailable.
  }
}

export function isSfxMuted(): boolean {
  if (muted !== undefined) return muted;

  muted = false;
  try {
    if (typeof localStorage === 'undefined') return muted;
    muted = localStorage.getItem(SFX_MUTED_STORAGE_KEY) === 'true';
  } catch {
    // Unavailable or corrupt storage falls back to the unmuted default.
  }
  return muted;
}

/** Resume the context from inside a user gesture handler. Idempotent. */
export function unlockAudio(): void {
  try {
    const context = getAudioContext();
    if (context?.state === 'suspended') {
      void context.resume().catch(() => {
        // A rejected resume simply leaves reward audio unavailable.
      });
    }
  } catch {
    // Unsupported audio implementations must not block the user gesture.
  }
}

/** Release the audio context. Called when the game tears down. */
export function disposeSfx(): void {
  const context = audioContext;
  audioContext = null;
  activeVoices = 0;
  if (context === null) return;

  try {
    void context.close().catch(() => {
      // Closing is best-effort because teardown must always complete.
    });
  } catch {
    // Some partial Web Audio implementations throw synchronously on close.
  }
}
