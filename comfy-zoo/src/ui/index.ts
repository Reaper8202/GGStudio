/**
 * UI entry point. mountUI(bus, adapter, query) builds the whole HTML/CSS overlay
 * into #ui-root and returns UIHandles with the live joystick object the core
 * reads every frame. Signature + UIHandles shape are the shared contract — keep
 * them identical to the stub.
 *
 * UI only listens to bus events + polls GameQuery, and emits ONLY 'ui:*' events.
 * It never imports game internals (only types/classes from core/EventBus).
 */

import type { EventBus, GameQuery, JoystickState } from '../core/EventBus';
import type { PlatformAdapter } from '../platform/PlatformAdapter';
import type { UIContext } from './context';
import { BuildMenu } from './BuildMenu';
import { HUD } from './HUD';
import { Onboarding } from './Onboarding';
import { RewardModal } from './RewardModal';
import { Settings } from './Settings';
import { Sfx } from './Sfx';
import { Thumbnails } from './Thumbnails';
import { ZooPedia } from './ZooPedia';

export interface UIHandles {
  /** Core reads this every frame for touch movement. */
  joystick: JoystickState;
}

export function mountUI(bus: EventBus, adapter: PlatformAdapter, query: GameQuery): UIHandles {
  const root = document.getElementById('ui-root') ?? document.body;
  const joystick: JoystickState = { x: 0, y: 0, active: false };

  const sfx = new Sfx();
  const thumbs = new Thumbnails();

  let touchSeen = false;
  window.addEventListener(
    'touchstart',
    () => {
      touchSeen = true;
    },
    { passive: true, once: true },
  );

  const ctx: UIContext = {
    bus,
    adapter,
    query,
    sfx,
    thumbs,
    root,
    isTouch: () => touchSeen,
  };

  sfx.bind(bus);

  // Summoned menus (created hidden; opened from the HUD radial).
  const buildMenu = new BuildMenu(ctx);
  const zooPedia = new ZooPedia(ctx);
  const settings = new Settings(ctx);
  new RewardModal(ctx);
  new Onboarding(ctx);

  // Only one summoned surface at a time.
  const closeAll = () => {
    if (buildMenu.isOpen()) buildMenu.close();
    if (zooPedia.isOpen()) zooPedia.close();
    if (settings.isOpen()) settings.close();
  };

  const hud = new HUD(ctx, joystick, {
    openBuild: () => {
      closeAll();
      buildMenu.show();
    },
    openZooPedia: () => {
      closeAll();
      zooPedia.show();
    },
    openSettings: () => {
      closeAll();
      settings.show();
    },
  });
  void hud; // HUD self-registers its listeners/RAF; reference retained here.

  // First-play chime.
  bus.once('game:ready', () => sfx.play('start', 0.8));

  return { joystick };
}
