import Phaser from 'phaser';
import { Depths, GAME_HEIGHT, GAME_WIDTH } from '../config/constants';

const FONT = '"Segoe UI", system-ui, -apple-system, Roboto, sans-serif';

export function textStyle(
  size: number,
  color = '#f2f5ff',
): Phaser.Types.GameObjects.Text.TextStyle {
  return { fontFamily: FONT, fontSize: `${size}px`, fontStyle: 'bold', color };
}

/** Full-screen dim behind menu/game-over panels. */
export function addDim(scene: Phaser.Scene, alpha = 0.55): Phaser.GameObjects.Rectangle {
  return scene.add
    .rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x05070f, alpha)
    .setDepth(Depths.Overlay);
}

export interface ButtonHandle {
  disable(): void;
  setLabel(label: string): void;
}

/**
 * Rounded-rect button drawn in-canvas. Whole rect is interactive (large touch
 * target). onClick is one-shot-guarded by callers via disable().
 */
export function addButton(
  scene: Phaser.Scene,
  x: number,
  y: number,
  width: number,
  height: number,
  label: string,
  color: number,
  onClick: () => void,
): ButtonHandle {
  const g = scene.add.graphics().setDepth(Depths.Overlay + 1);
  g.fillStyle(color, 1);
  g.fillRoundedRect(x - width / 2, y - height / 2, width, height, 14);
  const text = scene.add
    .text(x, y, label, textStyle(28, '#0b0e1a'))
    .setOrigin(0.5)
    .setDepth(Depths.Overlay + 2);

  const zone = scene.add
    .zone(x, y, width, height)
    .setOrigin(0.5)
    .setDepth(Depths.Overlay + 3)
    .setInteractive({ useHandCursor: true });

  let enabled = true;
  zone.on('pointerdown', () => {
    if (!enabled) return;
    onClick();
  });

  return {
    disable(): void {
      enabled = false;
      g.setAlpha(0.5);
      text.setAlpha(0.6);
    },
    setLabel(label: string): void {
      text.setText(label);
    },
  };
}
