// Screen-space layer: temporary HUD bars (M1), crosshair, debug readouts and data-reload errors.
import Phaser from 'phaser';
import { DATA, onDataError, onDataReload } from '../data/config';
import { hexToInt } from '../ui/colors';
import type { GameScene } from './GameScene';

export class UIScene extends Phaser.Scene {
  private gs!: GameScene;
  private g!: Phaser.GameObjects.Graphics;
  private cross!: Phaser.GameObjects.Sprite;
  private info!: Phaser.GameObjects.BitmapText;
  private status!: Phaser.GameObjects.BitmapText;
  private err!: Phaser.GameObjects.BitmapText;

  constructor() {
    super('ui');
  }

  create() {
    this.gs = this.scene.get('game') as GameScene;
    this.g = this.add.graphics();
    this.cross = this.add.sprite(0, 0, 'crosshair', 0);
    this.gs.lib.applyOrigin(this.cross, 'crosshair');
    this.info = this.add.bitmapText(DATA.hud.x, 30, 'pixel', '');
    this.status = this.add.bitmapText(0, 4, 'pixel', '').setTint(hexToInt(DATA.palette.flame2));
    this.err = this.add.bitmapText(4, 4, 'pixel', '').setTint(hexToInt(DATA.palette.blood2)).setDepth(10);
    const offErr = onDataError(msg => this.err.setText(`DATA ERROR (see console)\n${msg.split('\n').slice(0, 6).join('\n')}`));
    const offOk = onDataReload(() => this.err.setText(''));
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      offErr();
      offOk();
    });
  }

  update() {
    const p = this.gs.player;
    const hud = DATA.hud;
    const pal = DATA.palette;
    const g = this.g;
    g.clear();

    const bar = (y: number, w: number, h: number, frac: number, color: string) => {
      g.fillStyle(hexToInt(pal.ink), 1).fillRect(hud.x - 1, y - 1, w + 2, h + 2);
      g.fillStyle(hexToInt(pal.dark2), 1).fillRect(hud.x, y, w, h);
      g.fillStyle(hexToInt(color), 1).fillRect(hud.x, y, Math.round(w * Math.max(0, Math.min(1, frac))), h);
    };
    const hpW = Math.round(DATA.player.maxHp * hud.hpPxPerPoint);
    bar(hud.y, hpW, hud.hpHeight, p.hp / DATA.player.maxHp, pal.blood2);
    const stW = Math.round(p.stamina.max * hud.staminaPxPerPoint);
    const stY = hud.y + hud.hpHeight + hud.gap;
    bar(stY, stW, hud.staminaHeight, p.stamina.value / p.stamina.max, p.stamina.locked ? pal.ember : pal.moss2);

    // Crosshair: mouse position, or the aim point when on a gamepad.
    const cam = this.gs.cameras.main;
    const ptr = this.input.activePointer;
    const onPad = this.gs.controls.device === 'pad';
    const cx = onPad ? p.aimX - cam.scrollX : ptr.x;
    const cy = onPad ? p.aimY - cam.scrollY : ptr.y;
    this.cross.setPosition(Math.round(cx), Math.round(cy));

    const loop = this.gs.loop;
    const st = loop.frozen ? 'FROZEN (F6 STEP, F5 RESUME)' : loop.timeScale !== 1 ? `SLOW X${loop.timeScale}` : '';
    this.status.setText(st).setX(DATA.game.width - this.status.width - 4);

    this.info.setVisible(this.gs.debug.enabled);
    if (this.gs.debug.enabled) {
      this.info.setText(
        [
          `FPS ${Math.round(this.game.loop.actualFps)}  TICK ${this.gs.tickCount}`,
          `STAMINA ${p.stamina.value.toFixed(1)}/${p.stamina.max}${p.stamina.regenDelay ? ` DELAY ${p.stamina.regenDelay}` : ''}`,
          `STATE ${p.sm.name.toUpperCase()} T${p.sm.t}`,
          `SPEED ${Math.hypot(p.vx, p.vy).toFixed(1)}`,
          `DEVICE ${this.gs.controls.device.toUpperCase()}  WEAPON ${p.weaponId.toUpperCase()}`,
          `POS ${p.x.toFixed(1)},${p.y.toFixed(1)}`,
        ].join('\n'),
      );
    }
  }
}
