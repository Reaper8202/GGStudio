import './style.css'
import Phaser from 'phaser'

class GameScene extends Phaser.Scene {
  constructor() {
    super('game')
  }

  create() {
    const { width, height } = this.scale

    this.add
      .text(width / 2, height / 2, 'Car Zombie', {
        color: '#ffffff',
        fontFamily: 'Arial, sans-serif',
        fontSize: '40px',
      })
      .setOrigin(0.5)
  }
}

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'app',
  backgroundColor: '#111111',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: 1280,
    height: 720,
  },
  scene: [GameScene],
})
