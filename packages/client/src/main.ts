import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene.js';
import { GameScene } from './scenes/GameScene.js';
import { UIScene } from './scenes/UIScene.js';
import { RENDER } from './game/config.js';
import { audio } from './audio/engine.js';
import { bindSoundToggle } from './ui/soundToggle.js';

audio.attach();
bindSoundToggle();

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'app',
  backgroundColor: RENDER.COLORS.background,
  // All sound goes through our own AudioEngine; without this Phaser opens a second, unused AudioContext.
  audio: { noAudio: true },
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: RENDER.CANVAS_WIDTH,
    height: RENDER.CANVAS_HEIGHT,
  },
  scene: [BootScene, GameScene, UIScene],
});
