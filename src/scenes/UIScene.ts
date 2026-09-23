// Screen-space layer: temporary HUD bars, crosshair, death screen, debug readouts and data-reload errors.
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
  private veil!: Phaser.GameObjects.Rectangle;
  private deathText!: Phaser.GameObjects.BitmapText;
  private slotIcons: Phaser.GameObjects.Sprite[] = [];
  private ammoText!: Phaser.GameObjects.BitmapText;
  private shieldIcon!: Phaser.GameObjects.Sprite;
  private prompt!: Phaser.GameObjects.BitmapText;

  constructor() {
    super('ui');
  }

  create() {
    this.gs = this.scene.get('game') as GameScene;
    const W = DATA.game.width;
    const H = DATA.game.height;
    this.g = this.add.graphics();
    this.cross = this.add.sprite(0, 0, 'crosshair', 0);
    this.gs.lib.applyOrigin(this.cross, 'crosshair');
    this.info = this.add.bitmapText(DATA.hud.x, 30, 'pixel', '');
    this.status = this.add.bitmapText(0, 4, 'pixel', '').setTint(hexToInt(DATA.palette.flame2));
    this.veil = this.add.rectangle(0, 0, W, H, 0x000000, 1).setOrigin(0, 0).setAlpha(0).setDepth(20);
    this.deathText = this.add
      .bitmapText(0, 0, 'pixel', '')
      .setScale(DATA.death.textScale)
      .setTint(hexToInt(DATA.palette.ember))
      .setDepth(21)
      .setAlpha(0);
    this.err = this.add.bitmapText(4, 4, 'pixel', '').setTint(hexToInt(DATA.palette.blood2)).setDepth(30);
    for (let i = 0; i < 2; i++) this.slotIcons.push(this.add.sprite(0, 0, '__DEFAULT').setOrigin(0.5).setDepth(2));
    this.shieldIcon = this.add.sprite(0, 0, '__DEFAULT').setOrigin(0.5).setDepth(2);
    this.ammoText = this.add.bitmapText(0, 0, 'pixel', '').setDepth(2);
    this.prompt = this.add.bitmapText(0, 0, 'pixel', '').setTint(hexToInt(DATA.palette.wax2)).setDepth(2);
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
    this.cross.setPosition(Math.round(cx), Math.round(cy)).setVisible(!p.dead);

    const loop = this.gs.loop;
    const st = [
      p.god ? 'GOD' : '',
      loop.frozen ? 'FROZEN (F6 STEP, F5 RESUME)' : loop.timeScale !== 1 ? `SLOW X${loop.timeScale}` : '',
    ]
      .filter(Boolean)
      .join('  ');
    this.status.setText(st).setX(DATA.game.width - this.status.width - 4);

    this.info.setVisible(this.gs.debug.enabled);
    if (this.gs.debug.enabled) {
      this.info.setText(
        [
          `FPS ${Math.round(this.game.loop.actualFps)}  TICK ${this.gs.simTick}  HITSTOP ${this.gs.hitstop}`,
          `STAMINA ${p.stamina.value.toFixed(1)}/${p.stamina.max}${p.stamina.regenDelay ? ` DELAY ${p.stamina.regenDelay}` : ''}`,
          `POISE ${Math.round(p.poise.damage)}/${p.poise.max}  HP ${p.hp}/${p.maxHp}`,
          `STATE ${p.sm.name.toUpperCase()} T${p.sm.t}${p.runner ? ` ${p.runner.phase.toUpperCase()} ${p.runner.t}` : ''}${p.charge ? ` CHARGE ${p.charge}` : ''}`,
          `DEVICE ${this.gs.controls.device.toUpperCase()}  WEAPON ${p.weaponId.toUpperCase()}`,
          `ENEMIES ${this.gs.enemies.length}  TOKENS ${this.gs.tokens.count}/${DATA.ai.maxAttackers}`,
        ].join('\n'),
      );
    }

    this.drawLoadout();
    this.drawPrompt();
    this.drawDeath();
  }

  /** Bottom-right: two weapon slots (active highlighted), ammo, reload bar, shield icon. */
  private drawLoadout() {
    const p = this.gs.player;
    const pal = DATA.palette;
    const g = this.g;
    const W = DATA.game.width;
    const H = DATA.game.height;
    const bw = 32;
    const bh = 18;
    const y = H - 8 - bh;
    const xs = [W - 8 - bw * 2 - 3, W - 8 - bw];
    p.slots.forEach((id, i) => {
      const x = xs[i];
      const active = i === p.slot;
      g.fillStyle(hexToInt(pal.ink), 0.75).fillRect(x, y, bw, bh);
      g.fillStyle(hexToInt(active ? pal.wax2 : pal.stone2), 1);
      g.fillRect(x, y, bw, 1).fillRect(x, y + bh - 1, bw, 1).fillRect(x, y, 1, bh).fillRect(x + bw - 1, y, 1, bh);
      const icon = this.slotIcons[i];
      const sprite = DATA.weapons[id].view.sprite;
      if (icon.texture.key !== sprite) icon.setTexture(sprite, 0);
      icon.setPosition(x + bw / 2, y + bh / 2).setAlpha(active ? 1 : 0.5);
    });

    const w = p.weapon;
    const ax = xs[p.slot];
    if (w.ranged) {
      const a = p.ammoFor(p.weaponId);
      this.ammoText
        .setText(`${a.clip}/${a.reserve}`)
        .setTint(hexToInt(a.clip === 0 ? pal.ember : pal.wax2))
        .setVisible(true);
      this.ammoText.setPosition(ax + bw - this.ammoText.width, y - 9);
    } else this.ammoText.setVisible(false);
    if (p.reloadProgress >= 0) {
      g.fillStyle(hexToInt(pal.dark2), 1).fillRect(ax + 2, y + bh - 3, bw - 4, 1);
      g.fillStyle(hexToInt(pal.flame2), 1).fillRect(ax + 2, y + bh - 3, Math.round((bw - 4) * Math.min(1, p.reloadProgress)), 1);
    }

    const sh = p.shieldId ? DATA.shields[p.shieldId] : null;
    this.shieldIcon.setVisible(!!sh);
    if (sh) {
      if (this.shieldIcon.texture.key !== sh.sprite) this.shieldIcon.setTexture(sh.sprite, 0);
      // Dimmed while a two-handed weapon is out (shield stowed).
      this.shieldIcon.setPosition(xs[0] - 9, y + bh / 2).setAlpha(p.shield ? 1 : 0.3);
    }
  }

  private drawPrompt() {
    const gs = this.gs;
    const p = gs.player;
    const rack = !p.dead && ['idle', 'move', 'sprint'].includes(p.stateName) ? gs.racks.nearest(p.x, p.y) : null;
    this.prompt.setVisible(!!rack);
    if (!rack) return;
    const key = gs.controls.device === 'pad' ? 'A' : 'E';
    const name = rack.id ? (rack.kind === 'weapon' ? DATA.weapons[rack.id].name : DATA.shields[rack.id].name) : 'no shield';
    this.prompt.setText(`[${key}] TAKE ${name.toUpperCase()}`);
    this.prompt.setPosition(Math.round((DATA.game.width - this.prompt.width) / 2), DATA.game.height - 40);
  }

  private drawDeath() {
    const d = DATA.death;
    const gs = this.gs;
    let veil = 0;
    let text = 0;
    if (gs.deathT >= 0) {
      const t = gs.deathT - d.overlayDelayTicks;
      if (t >= 0) {
        if (t < d.fadeInTicks) {
          veil = 0.6 * (t / d.fadeInTicks);
          text = t / d.fadeInTicks;
        } else if (t < d.fadeInTicks + d.holdTicks) {
          veil = 0.6;
          text = 1;
        } else {
          const k = Math.min(1, (t - d.fadeInTicks - d.holdTicks) / d.fadeOutTicks);
          veil = 0.6 + 0.4 * k;
          text = 1 - k;
        }
      }
    } else if (gs.respawnT >= 0) {
      veil = 1 - gs.respawnT / d.fadeBackTicks;
    }
    this.veil.setAlpha(veil);
    this.deathText.setText(d.text).setAlpha(text);
    const w = this.deathText.width;
    this.deathText.setPosition(Math.round((DATA.game.width - w) / 2), Math.round(DATA.game.height / 2 - 12));
  }
}
