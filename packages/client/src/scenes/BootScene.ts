import Phaser from 'phaser';

/** Arrows are drawn with Graphics, so there are no textures to generate — this only starts the scenes. */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('BootScene');
  }

  create(): void {
    this.scene.start('GameScene');
    this.scene.launch('UIScene');
  }
}
