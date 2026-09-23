// Screen-space layer: temporary HUD bars, crosshair, death screen, debug readouts and data-reload errors.
import Phaser from 'phaser';
import { DATA, onDataError, onDataReload } from '../data/config';
import { hexToInt } from '../ui/colors';
import { MenuRenderer, wrap } from '../ui/MenuRenderer';
import { TrailBar } from '../ui/TrailBar';
import { MapView } from '../ui/MapView';
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
  private phialIcons: Phaser.GameObjects.Sprite[] = [];
  private tallowIcon!: Phaser.GameObjects.Sprite;
  private tallowText!: Phaser.GameObjects.BitmapText;
  private tallowShown = 0;
  private toastTitle!: Phaser.GameObjects.BitmapText;
  private toastBody!: Phaser.GameObjects.BitmapText;
  private toastNote!: Phaser.GameObjects.BitmapText;
  private toastPanel!: Phaser.GameObjects.Rectangle;
  private areaText!: Phaser.GameObjects.BitmapText;
  private mapView!: MapView;
  private menuUi!: MenuRenderer;
  private hpTrail!: TrailBar;
  private vignette!: Phaser.GameObjects.Graphics;

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
    this.info = this.add.bitmapText(DATA.hud.x, 44, 'pixel', '');
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
    this.tallowIcon = this.add.sprite(0, 0, 'tallow_icon', 0).setOrigin(0, 0).setDepth(2);
    this.tallowText = this.add.bitmapText(0, 0, 'pixel', '0').setTint(hexToInt(DATA.palette.wax2)).setDepth(2);
    this.tallowShown = this.gs.player.tallow;
    this.toastTitle = this.add.bitmapText(0, 0, 'pixel', '').setTint(hexToInt(DATA.palette.flame2)).setDepth(15);
    this.toastBody = this.add.bitmapText(0, 0, 'pixel', '').setTint(hexToInt(DATA.palette.wax2)).setDepth(15);
    this.toastNote = this.add.bitmapText(0, 0, 'pixel', '').setTint(hexToInt(DATA.palette.stone4)).setDepth(15);
    this.toastPanel = this.add.rectangle(0, 0, 10, 10, hexToInt(DATA.palette.ink), 0.7).setOrigin(0, 0).setDepth(14);
    this.areaText = this.add.bitmapText(0, 0, 'pixel', '').setTint(hexToInt(DATA.palette.wax2)).setDepth(16);
    this.mapView = new MapView(this);
    this.menuUi = new MenuRenderer(this, 16);
    this.hpTrail = new TrailBar(this.gs.player.hp);
    this.vignette = this.add.graphics().setDepth(12);
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

    const bar = (y: number, w: number, h: number, frac: number, color: string, trail = frac) => {
      const px = (f: number) => Math.round(w * Math.max(0, Math.min(1, f)));
      g.fillStyle(hexToInt(pal.ink), 1).fillRect(hud.x - 1, y - 1, w + 2, h + 2);
      g.fillStyle(hexToInt(pal.dark2), 1).fillRect(hud.x, y, w, h);
      if (trail > frac) g.fillStyle(hexToInt(pal.wax2), 1).fillRect(hud.x, y, px(trail), h); // recent damage
      g.fillStyle(hexToInt(color), 1).fillRect(hud.x, y, px(frac), h);
    };
    const fb = DATA.juice.hitFeedback;
    const dt = this.game.loop.delta;
    this.hpTrail.update(p.hp, p.maxHp, dt, fb.trailHoldMs, fb.trailDrainPerSec);
    const hpW = Math.round(DATA.player.maxHp * hud.hpPxPerPoint);
    bar(hud.y, hpW, hud.hpHeight, p.hp / p.maxHp, pal.blood2, this.hpTrail.value / p.maxHp);
    this.drawVignette();
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

    this.drawPhials(stY + hud.staminaHeight + 3);
    this.drawTallow();
    this.drawLoadout();
    this.drawPrompt();
    this.drawToast();
    this.drawAreaBanner();
    this.mapView.update(this.gs, dt);
    this.menuUi.draw(this.gs.menu);
    this.drawDeath();
  }

  /**
   * Red screen-edge flash when hit: every edge a little, the edge facing the attacker a lot (so off-screen
   * hits still tell you where they came from). Plus a slow pulse while HP is low.
   */
  private drawVignette() {
    const g = this.vignette;
    g.clear();
    const fb = DATA.juice.hitFeedback;
    const p = this.gs.player;
    const W = DATA.game.width;
    const H = DATA.game.height;
    const red = hexToInt(DATA.palette.blood2);
    const sides: { nx: number; ny: number; a: number }[] = [
      { nx: -1, ny: 0, a: 0 },
      { nx: 1, ny: 0, a: 0 },
      { nx: 0, ny: -1, a: 0 },
      { nx: 0, ny: 1, a: 0 },
    ];
    const hurt = this.gs.hurt;
    if (hurt && hurt.t < fb.vignetteMs) {
      const fade = 1 - hurt.t / fb.vignetteMs;
      const dx = Math.cos(hurt.angle);
      const dy = Math.sin(hurt.angle);
      for (const s of sides) s.a += fb.vignetteAlpha * hurt.strength * fade * (0.3 + 0.7 * Math.max(0, s.nx * dx + s.ny * dy));
    }
    if (!p.dead && p.hp > 0 && p.hp / p.maxHp <= fb.lowHpThreshold) {
      const pulse = 0.12 + 0.1 * Math.sin(this.time.now / 180);
      for (const s of sides) s.a = Math.max(s.a, pulse);
    }
    const bands = 6;
    const bw = 3;
    for (const s of sides) {
      if (s.a <= 0.01) continue;
      for (let i = 0; i < bands; i++) {
        g.fillStyle(red, s.a * (1 - i / bands));
        const o = i * bw;
        if (s.nx < 0) g.fillRect(o, 0, bw, H);
        else if (s.nx > 0) g.fillRect(W - o - bw, 0, bw, H);
        else if (s.ny < 0) g.fillRect(0, o, W, bw);
        else g.fillRect(0, H - o - bw, W, bw);
      }
    }
  }

  /** Phial charges under the bars: lit icon per charge left, dark icon per spent charge. */
  private drawPhials(y: number) {
    const p = this.gs.player.phials;
    while (this.phialIcons.length < p.max) this.phialIcons.push(this.add.sprite(0, 0, 'phial_icon', 0).setOrigin(0, 0).setDepth(2));
    this.phialIcons.forEach((s, i) => {
      s.setVisible(i < p.max);
      s.setFrame(i < p.charges ? 0 : 1).setPosition(DATA.hud.x + i * 8, y);
    });
  }

  /** Top-right: carried Tallow; the number rolls toward the real value. */
  private drawTallow() {
    const target = this.gs.player.tallow;
    const diff = target - this.tallowShown;
    this.tallowShown = Math.abs(diff) < 1 ? target : this.tallowShown + Math.sign(diff) * Math.max(1, Math.abs(diff) * 0.15);
    const W = DATA.game.width;
    this.tallowText.setText(String(Math.round(this.tallowShown)));
    this.tallowText.setPosition(W - 8 - this.tallowText.width, 14);
    this.tallowIcon.setPosition(W - 8 - this.tallowText.width - 10, 13);
  }

  /** The area's name on arrival, between two thin rules, fading in and out. */
  private drawAreaBanner() {
    const b = this.gs.menu ? null : this.gs.areaBanner;
    this.areaText.setVisible(!!b);
    if (!b) return;
    const cfg = DATA.hud.areaBanner;
    const inT = 25;
    const outT = 50;
    const a = b.t < inT ? b.t / inT : b.t > cfg.ticks - outT ? Math.max(0, (cfg.ticks - b.t) / outT) : 1;
    const W = DATA.game.width;
    this.areaText.setScale(cfg.scale).setText(b.name.toUpperCase()).setAlpha(a);
    const x = Math.round((W - this.areaText.width) / 2);
    this.areaText.setPosition(x, cfg.y);
    const ruleY = cfg.y + Math.round(this.areaText.height / 2);
    const len = 40;
    this.g.fillStyle(hexToInt(DATA.palette.flame1), a);
    this.g.fillRect(x - 8 - len, ruleY, len, 1);
    this.g.fillRect(x + this.areaText.width + 8, ruleY, len, 1);
  }

  private drawToast() {
    const t = this.gs.menu ? null : this.gs.toast; // menus take the centre of the screen
    for (const o of [this.toastTitle, this.toastBody, this.toastNote, this.toastPanel]) o.setVisible(!!t);
    if (!t) return;
    const a = t.t < 15 ? t.t / 15 : t.t > t.life - 40 ? Math.max(0, (t.life - t.t) / 40) : 1;
    const W = DATA.game.width;
    const cfg = DATA.hud.toast;
    const top = cfg.y + 3; // text starts 3 px inside the panel
    this.toastTitle.setScale(cfg.titleScale).setText(t.title).setAlpha(a);
    this.toastTitle.setPosition(Math.round((W - this.toastTitle.width) / 2), top);
    const bodyY = top + this.toastTitle.height + 3;
    this.toastBody.setText(wrap(t.body, cfg.cols)).setAlpha(a);
    this.toastBody.setPosition(Math.round((W - this.toastBody.width) / 2), bodyY);
    const noteY = bodyY + this.toastBody.height + 2;
    this.toastNote.setText(t.note ? wrap(t.note, cfg.cols) : '').setAlpha(a);
    this.toastNote.setPosition(Math.round((W - this.toastNote.width) / 2), noteY);
    const bottom = t.note ? noteY + this.toastNote.height : bodyY + this.toastBody.height;
    const w = Math.max(this.toastTitle.width, this.toastBody.width, this.toastNote.width) + 10;
    this.toastPanel.setPosition(Math.round((W - w) / 2), cfg.y).setSize(w, bottom - cfg.y + 3).setAlpha(a);
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
      const disabled = p.isSlotDisabled(i); // a two-handed weapon occupies both hands
      g.fillStyle(hexToInt(pal.ink), 0.75).fillRect(x, y, bw, bh);
      g.fillStyle(hexToInt(active ? pal.wax2 : pal.stone2), disabled ? 0.4 : 1);
      g.fillRect(x, y, bw, 1).fillRect(x, y + bh - 1, bw, 1).fillRect(x, y, 1, bh).fillRect(x + bw - 1, y, 1, bh);
      const icon = this.slotIcons[i];
      const def = DATA.weapons[id];
      icon.setVisible(!def.view.hidden); // bare hands = empty slot
      if (icon.texture.key !== def.view.sprite) icon.setTexture(def.view.sprite, 0);
      icon.setPosition(x + bw / 2, y + bh / 2).setAlpha(active ? 1 : disabled ? 0.2 : 0.5);
      if (disabled) {
        g.lineStyle(1, hexToInt(pal.ember), 0.9);
        g.lineBetween(x + 3, y + bh - 3, x + bw - 3, y + 3);
      }
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
    const target = gs.player.dead ? null : gs.nearestInteractable();
    this.prompt.setVisible(!!target);
    if (!target) return;
    const key = gs.controls.device === 'pad' ? 'A' : 'E';
    this.prompt.setText(`[${key}] ${target.label.toUpperCase()}`);
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
    } else if (gs.travel) {
      veil = gs.travel.t / gs.travel.fade;
    } else if (gs.respawnT >= 0) {
      veil = 1 - gs.respawnT / d.fadeBackTicks;
    }
    this.veil.setAlpha(veil);
    this.deathText.setText(d.text).setAlpha(text);
    const w = this.deathText.width;
    this.deathText.setPosition(Math.round((DATA.game.width - w) / 2), Math.round(DATA.game.height / 2 - 12));
  }
}
