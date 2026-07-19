import Phaser from 'phaser';
import { RegistryKeys, SceneKeys } from '../config/constants';
import type { PlatformSDK } from '../platform/PlatformSDK';

/**
 * All art/audio is procedural, so there is nothing to fetch — but the scene
 * still owns the SDK loading handshake (progress + finished) so a future
 * real asset load slots in here without touching anything else.
 */
export class PreloadScene extends Phaser.Scene {
  constructor() {
    super(SceneKeys.Preload);
  }

  create(): void {
    const platform = this.registry.get(RegistryKeys.Platform) as PlatformSDK;
    platform.loadingProgress(0);
    platform.loadingProgress(1);
    platform.loadingFinished();
    this.scene.start(SceneKeys.Menu);
  }
}
