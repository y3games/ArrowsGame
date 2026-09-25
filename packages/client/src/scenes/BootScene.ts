import Phaser from 'phaser';
import { RENDER } from '../game/config.js';

const TEXTURE_SIZE = 128;

export class BootScene extends Phaser.Scene {
  constructor() {
    super('BootScene');
  }

  create(): void {
    this.generateArrowTexture();
    this.generateTileTexture();
    this.scene.start('GameScene');
    this.scene.launch('UIScene');
  }

  private generateArrowTexture(): void {
    const g = this.make.graphics({ x: 0, y: 0 }, false);
    g.fillStyle(RENDER.COLORS.arrow, 1);
    // Triangle pointing "up" — other directions are just this texture rotated.
    g.beginPath();
    g.moveTo(TEXTURE_SIZE / 2, TEXTURE_SIZE * 0.1);
    g.lineTo(TEXTURE_SIZE * 0.85, TEXTURE_SIZE * 0.75);
    g.lineTo(TEXTURE_SIZE * 0.15, TEXTURE_SIZE * 0.75);
    g.closePath();
    g.fillPath();
    g.generateTexture('arrow-tri', TEXTURE_SIZE, TEXTURE_SIZE);
    g.destroy();
  }

  private generateTileTexture(): void {
    const g = this.make.graphics({ x: 0, y: 0 }, false);
    g.fillStyle(RENDER.COLORS.tile, 1);
    g.fillRoundedRect(0, 0, TEXTURE_SIZE, TEXTURE_SIZE, 16);
    g.generateTexture('tile-bg', TEXTURE_SIZE, TEXTURE_SIZE);
    g.destroy();
  }
}
