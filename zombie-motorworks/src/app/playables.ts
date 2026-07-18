/**
 * Thin wrapper around the YouTube Playables SDK (`window.ytgame`). The SDK
 * script in index.html only defines `ytgame` when served inside YouTube, so
 * every call degrades to a no-op in local dev and on plain static hosting.
 */

interface YtGame {
  readonly IN_PLAYABLES_ENV: boolean;
  readonly game: {
    firstFrameReady(): void;
    gameReady(): void;
    loadData(): Promise<string>;
    saveData(data: string): Promise<void>;
  };
  readonly system: {
    isAudioEnabled(): boolean;
    onAudioEnabledChange(cb: (enabled: boolean) => void): void;
    onPause(cb: () => void): void;
    onResume(cb: () => void): void;
  };
}

function sdk(): YtGame | null {
  const yt = (globalThis as { ytgame?: YtGame }).ytgame;
  return yt && yt.IN_PLAYABLES_ENV ? yt : null;
}

export const playables = {
  get active(): boolean {
    return sdk() !== null;
  },

  /** Signal that the first frame has been rendered behind the loading screen. */
  firstFrameReady(): void {
    sdk()?.game.firstFrameReady();
  },

  /** Signal that the game is fully interactive; must follow firstFrameReady. */
  gameReady(): void {
    sdk()?.game.gameReady();
  },

  /** YouTube may evict a paused game — persist anything unsaved in `cb`. */
  onPause(cb: () => void): void {
    sdk()?.system.onPause(cb);
  },

  onResume(cb: () => void): void {
    sdk()?.system.onResume(cb);
  },

  /** Cloud save blob for the signed-in YouTube user; null outside Playables. */
  async loadData(): Promise<string | null> {
    const yt = sdk();
    return yt ? await yt.game.loadData() : null;
  },

  async saveData(data: string): Promise<void> {
    await sdk()?.game.saveData(data);
  },

  /** The game has no audio yet; wired so future audio respects YouTube mute. */
  isAudioEnabled(): boolean {
    return sdk()?.system.isAudioEnabled() ?? true;
  },

  onAudioEnabledChange(cb: (enabled: boolean) => void): void {
    sdk()?.system.onAudioEnabledChange(cb);
  },
};
