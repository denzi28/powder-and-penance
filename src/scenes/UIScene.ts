// Screen-space layer: temporary HUD bars, crosshair, death screen, debug readouts and data-reload errors.
import Phaser from 'phaser';
import { SETTINGS, keysFor, shortKey } from '../game/Settings';
import { DATA, onDataError, onDataReload } from '../data/config';
import { FINE, type FineItem } from '../render/FineText';
import { hexToInt } from '../ui/colors';
import { MenuRenderer, wrap } from '../ui/MenuRenderer';
import { GearView } from '../ui/GearView';
import { TrailBar } from '../ui/TrailBar';
import { MapView, minimapShown } from '../ui/MapView';
import { DialogueBox } from '../ui/DialogueBox';
import { BossBar } from '../ui/BossBar';
import { warpVeil } from '../game/Warp';
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
  private ammoTexts: Phaser.GameObjects.BitmapText[] = [];
  private handKeys: Phaser.GameObjects.BitmapText[] = [];
  private shieldIcon!: Phaser.GameObjects.Sprite;
  private beltIcon!: Phaser.GameObjects.Image;
  private beltText!: Phaser.GameObjects.BitmapText;
  private beltKey!: Phaser.GameObjects.BitmapText;
  private buffIcons: Phaser.GameObjects.Image[] = [];
  /** Where the message panel ends (0 when none), so banners can sit below it. */
  private toastBottom = 0;
  private prompt!: Phaser.GameObjects.BitmapText;
  private phialIcons: Phaser.GameObjects.Sprite[] = [];
  private tallowIcon!: Phaser.GameObjects.Sprite;
  private tallowText!: Phaser.GameObjects.BitmapText;
  private tallowShown = 0;
  private areaText!: Phaser.GameObjects.BitmapText;
  private cardTitle!: Phaser.GameObjects.BitmapText;
  private cardSub!: Phaser.GameObjects.BitmapText;
  private mapView!: MapView;
  private dialogueBox!: DialogueBox;
  private bossBar!: BossBar;
  private menuUi!: MenuRenderer;
  private gearView!: GearView;
  /** Letterbox bars (under the dialogue box), and full-screen flashes (over everything). */
  private cinema!: Phaser.GameObjects.Graphics;
  private flashG!: Phaser.GameObjects.Graphics;
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
    this.beltIcon = this.add.image(0, 0, 'icons', 0).setOrigin(0, 0).setDepth(2);
    this.beltText = this.add.bitmapText(0, 0, 'pixel', '').setTint(hexToInt(DATA.palette.wax2)).setDepth(3);
    this.beltKey = this.add.bitmapText(0, 0, 'pixel', '').setTint(hexToInt(DATA.palette.stone3)).setDepth(3);
    for (let i = 0; i < 2; i++) {
      this.ammoTexts.push(this.add.bitmapText(0, 0, 'pixel', '').setDepth(2));
      this.handKeys.push(this.add.bitmapText(0, 0, 'pixel', '').setTint(hexToInt(DATA.palette.stone3)).setDepth(2));
    }
    this.prompt = this.add.bitmapText(0, 0, 'pixel', '').setTint(hexToInt(DATA.palette.wax2)).setDepth(2);
    this.tallowIcon = this.add.sprite(0, 0, 'tallow_icon', 0).setOrigin(0, 0).setDepth(2);
    this.tallowText = this.add.bitmapText(0, 0, 'pixel', '0').setTint(hexToInt(DATA.palette.wax2)).setDepth(2);
    this.tallowShown = this.gs.player.tallow;
    this.areaText = this.add.bitmapText(0, 0, 'pixel', '').setTint(hexToInt(DATA.palette.wax2)).setDepth(16);
    this.cardTitle = this.add.bitmapText(0, 0, 'pixel', '').setScale(2).setTint(hexToInt(DATA.palette.flame2)).setDepth(22);
    this.cardSub = this.add.bitmapText(0, 0, 'pixel', '').setTint(hexToInt(DATA.palette.stone4)).setDepth(22);
    this.mapView = new MapView(this);
    this.dialogueBox = new DialogueBox(this);
    this.bossBar = new BossBar(this);
    this.menuUi = new MenuRenderer(this, 16);
    this.gearView = new GearView(this, 100); // over everything else in the HUD
    this.hpTrail = new TrailBar(this.gs.player.hp);
    this.vignette = this.add.graphics().setDepth(12);
    this.cinema = this.add.graphics().setDepth(21);
    this.flashG = this.add.graphics().setDepth(30);
    const offErr = onDataError(msg => this.err.setText(`DATA ERROR (see console)\n${msg.split('\n').slice(0, 6).join('\n')}`));
    const offOk = onDataReload(() => this.err.setText(''));
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      offErr();
      offOk();
      FINE.set('toast', []);
      FINE.set('gear', []);
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
    const hpW = Math.min(HP_BAR_MAX, Math.round(p.maxHp * hud.hpPxPerPoint)); // more HP, a longer bar, up to a point
    bar(hud.y, hpW, hud.hpHeight, p.hp / p.maxHp, pal.blood2, this.hpTrail.value / p.maxHp);
    this.drawVignette();
    const stW = Math.min(STAMINA_BAR_MAX, Math.round(p.stamina.max * hud.staminaPxPerPoint));
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
    this.drawBuffs(stY + hud.staminaHeight + 13);
    this.drawBelt();
    this.drawTallow();
    this.drawLoadout();
    this.drawPrompt();
    // A staged cutscene has the screen to itself: bars, phials, belt, hands, Tallow and crosshair step aside
    if (this.gs.story.cinematic)
      for (const o of [this.g, this.cross, this.beltIcon, this.beltText, this.beltKey, this.tallowIcon, this.tallowText, this.shieldIcon, ...this.phialIcons, ...this.buffIcons, ...this.slotIcons, ...this.ammoTexts, ...this.handKeys])
        o.setVisible(false);
    else this.g.setVisible(true);
    this.drawToast();
    this.drawAreaBanner();
    this.mapView.update(this.gs, dt);
    this.dialogueBox.update(this.gs, dt);
    this.bossBar.update(this.gs, dt);
    this.menuUi.draw(this.gs.menu);
    this.gearView.draw(this.gs.gear, this.gs.player);
    this.drawDeath();
    this.drawCard();
    this.drawCinema();
  }

  /** Letterbox bars sliding in from top and bottom, and a flash over the whole screen. */
  private drawCinema() {
    const fx = this.gs.screenFx;
    const W = DATA.game.width;
    const H = DATA.game.height;
    const g = this.cinema.clear();
    const h = Math.round(24 * (1 - (1 - fx.bars) ** 2));
    if (h > 0) {
      g.fillStyle(0x000000, 1).fillRect(0, 0, W, h).fillRect(0, H - h, W, h);
    }
    const f = this.flashG.clear();
    const a = fx.flashAlpha;
    if (a > 0.01 && fx.flash) f.fillStyle(fx.flash.color, a).fillRect(0, 0, W, H);
  }

  /** A script's title card (`card` step): big and centred, fading in and out, over whatever fade is up. */
  private drawCard() {
    const c = this.gs.story.card;
    this.cardTitle.setVisible(!!c);
    this.cardSub.setVisible(!!c);
    if (!c) return;
    const edge = Math.min(40, c.ticks / 3);
    const a = Math.max(0, Math.min(1, c.t / edge, (c.ticks - c.t) / edge));
    const W = DATA.game.width;
    const y = Math.round(DATA.game.height / 2 - 14);
    this.cardTitle.setText(c.title).setAlpha(a);
    this.cardTitle.setPosition(Math.round((W - this.cardTitle.width) / 2), y);
    this.cardSub.setText(c.sub ?? '').setAlpha(a * 0.9);
    this.cardSub.setPosition(Math.round((W - this.cardSub.width) / 2), y + this.cardTitle.height + 8);
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
    this.drawBlind(g);
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

  /** Smoke in your eyes: the dark closes in to a small ring round you, and opens again as it clears. */
  private drawBlind(g: Phaser.GameObjects.Graphics) {
    const p = this.gs.player;
    if (p.blind <= 0 || p.dead) return;
    const k = Math.min(1, p.blind / 40) * Math.min(1, (this.blindT = p.blind > this.blindLast ? 0 : this.blindT + 1) / 8 + 0.2);
    this.blindLast = p.blind;
    const cam = this.gs.cameras.main;
    const sx = (p.x - cam.worldView.x) * cam.zoom;
    const sy = (p.y - 12 - cam.worldView.y) * cam.zoom;
    const r0 = (30 + (1 - k) * 260) * cam.zoom;
    const smoke = hexToInt(DATA.palette.ink);
    const rings = 10;
    const step = 5 * cam.zoom;
    for (let i = 0; i < rings; i++) g.lineStyle(step + 1, smoke, 0.9 * k * ((i + 1) / rings) ** 1.4).strokeCircle(sx, sy, r0 + i * step);
    const outer = r0 + rings * step;
    const far = Math.hypot(DATA.game.width, DATA.game.height) * 1.2;
    g.lineStyle(far, smoke, 0.92 * k).strokeCircle(sx, sy, outer + far / 2 - 1);
  }
  private blindT = 0;
  private blindLast = 0;

  /** Phial charges under the bars: lit icon per charge left, dark icon per spent charge. */
  private drawPhials(y: number) {
    const p = this.gs.player.phials;
    while (this.phialIcons.length < p.max) this.phialIcons.push(this.add.sprite(0, 0, 'phial_icon', 0).setOrigin(0, 0).setDepth(2));
    this.phialIcons.forEach((s, i) => {
      s.setVisible(i < p.max);
      s.setFrame(i < p.charges ? 0 : 1).setPosition(DATA.hud.x + i * 8, y);
    });
  }

  /** Timed effects under the phials: each one's icon with a bar that drains as it wears off. */
  private drawBuffs(y0: number) {
    const p = this.gs.player;
    const pal = DATA.palette;
    const n = p.buffs.length + (p.regen ? 1 : 0);
    while (this.buffIcons.length < n) this.buffIcons.push(this.add.image(0, 0, 'icons', 0).setOrigin(0, 0).setScale(0.625).setDepth(2));
    this.buffIcons.forEach((s, i) => s.setVisible(i < n));
    const items: { id: string; frac: number; colour: string }[] = p.buffs.map(b => {
      const u = DATA.consumables[b.id]?.use;
      return { id: b.id, frac: b.ticks / b.total, colour: u?.type === 'buff' ? u.colour : 'wax2' };
    });
    if (p.regen) items.push({ id: p.regen.id, frac: p.regen.left / p.regen.total, colour: 'flame2' });
    items.forEach((b, i) => {
      // a row of BUFFS_PER_ROW, then the next row underneath
      const x = DATA.hud.x + (i % BUFFS_PER_ROW) * 13;
      const y = y0 + Math.floor(i / BUFFS_PER_ROW) * 15;
      const blink = b.frac < 0.15 && Math.floor(this.time.now / 200) % 2 === 0; // about to wear off
      this.buffIcons[i].setFrame(DATA.consumables[b.id]?.icon ?? 0).setPosition(x, y).setAlpha(blink ? 0.4 : 1);
      this.g.fillStyle(hexToInt(pal.dark2), 1).fillRect(x, y + 11, 10, 1);
      this.g.fillStyle(hexToInt(pal[b.colour] ?? pal.wax2), 1).fillRect(x, y + 11, Math.max(1, Math.round(10 * b.frac)), 1);
    });
  }

  /**
   * The belt, at the left of the equipment row (bottom-right): the item, how many you carry, and a dot for each
   * other kind you could cycle to. Its button sits above it when hints are on.
   */
  private drawBelt() {
    const p = this.gs.player;
    const pal = DATA.palette;
    const g = this.g;
    const { x, y, w, h } = beltBox();
    const id = p.belt && p.count(p.belt) > 0 ? p.belt : null;
    const carried = this.gs.gear || this.gs.menu ? 0 : p.beltable.length; // hidden under the menus
    this.beltIcon.setVisible(!!id);
    this.beltText.setVisible(!!id);
    this.beltKey.setVisible(carried > 0 && SETTINGS.hints);
    if (!carried) return;
    g.fillStyle(hexToInt(pal.ink), 0.75).fillRect(x, y, w, h);
    g.fillStyle(hexToInt(p.stateName === 'useItem' ? pal.flame2 : pal.stone2), 1);
    g.fillRect(x, y, w, 1).fillRect(x, y + h - 1, w, 1).fillRect(x, y, 1, h).fillRect(x + w - 1, y, 1, h);
    for (let i = 1; i < Math.min(carried, 6); i++) g.fillStyle(hexToInt(pal.stone3), 1).fillRect(x - 4, y + h - i * 3, 2, 2);
    if (!id) return;
    this.beltIcon.setFrame(DATA.consumables[id].icon).setPosition(x + 2, y + 1);
    this.beltText.setText(String(p.count(id))).setPosition(x + w - this.beltText.width - 1, y + h - 7);
    const pad = this.gs.controls.device === 'pad';
    this.beltKey.setText(pad ? 'D-R' : shortKey(keysFor('useItem', DATA.input.keyboard)[0])).setPosition(x, y - 9);
  }

  /** Top-right: carried Tallow; the number rolls toward the real value. */
  private drawTallow() {
    const target = this.gs.player.tallow;
    const diff = target - this.tallowShown;
    this.tallowShown = Math.abs(diff) < 1 ? target : this.tallowShown + Math.sign(diff) * Math.max(1, Math.abs(diff) * 0.15);
    const W = DATA.game.width;
    this.tallowText.setText(String(Math.round(this.tallowShown))).setVisible(true);
    this.tallowIcon.setVisible(true);
    this.tallowText.setPosition(W - 8 - this.tallowText.width, 14);
    this.tallowIcon.setPosition(W - 8 - this.tallowText.width - 10, 13);
  }

  /** The area's name on arrival, between two thin rules, fading in and out. */
  private drawAreaBanner() {
    const b = this.gs.menu ? null : this.gs.areaBanner;
    this.areaText.setVisible(!!b);
    if (!b) return;
    const cfg = DATA.hud.areaBanner;
    const bannerY = Math.max(cfg.y, this.toastBottom + 8); // below a message that's showing
    const inT = 25;
    const outT = 50;
    const a = b.t < inT ? b.t / inT : b.t > cfg.ticks - outT ? Math.max(0, (cfg.ticks - b.t) / outT) : 1;
    const W = DATA.game.width;
    this.areaText.setScale(cfg.scale).setText(b.name.toUpperCase()).setAlpha(a);
    const x = Math.round((W - this.areaText.width) / 2);
    this.areaText.setPosition(x, bannerY);
    const ruleY = bannerY + Math.round(this.areaText.height / 2);
    const len = 40;
    this.g.fillStyle(hexToInt(DATA.palette.flame1), a);
    this.g.fillRect(x - 8 - len, ruleY, len, 1);
    this.g.fillRect(x + this.areaText.width + 8, ruleY, len, 1);
  }

  /**
   * Item and event messages, at the top between your bars (left) and the minimap (right), so they never cover
   * your health or your character. Banners (area names, minibosses) drop below a message that's showing.
   */
  private drawToast() {
    const g = this.gs;
    const t = g.menu || g.gear || g.mapOpen ? null : g.toast; // menus take the centre of the screen
    this.toastBottom = 0;
    if (!t) {
      FINE.set('toast', []);
      return;
    }
    // In fine print (FineText): the game's own font, a third smaller, on the overlay above the game.
    const a = t.t < 15 ? t.t / 15 : t.t > t.life - 40 ? Math.max(0, (t.life - t.t) / 40) : 1;
    const cfg = DATA.hud.toast;
    const left = DATA.hud.x + HP_BAR_MAX + 6;
    // the minimap's column on the right, or at least room for the Tallow counter
    const right = DATA.game.width - 8 - Math.max(minimapShown(this.gs) ? DATA.hud.minimap.w + 6 : 0, 64);
    const cols = Math.min(cfg.cols, Math.floor((right - left - 8) / FINE.charW));
    const cx = (left + right) / 2;
    const col = (name: string) => hexToInt(DATA.palette[name]);
    const parts = [
      { text: wrap(t.title, cols), color: col('flame2'), gap: 0 },
      { text: wrap(t.body, cols), color: col('wax2'), gap: 1.5 },
    ];
    const items: FineItem[] = [];
    let y = cfg.y + 2; // text starts inside the panel
    let w = 0;
    for (const p of parts) {
      y += p.gap;
      const m = FINE.measure(p.text);
      w = Math.max(w, m.w);
      items.push({ kind: 'text', x: cx - m.w / 2, y, text: p.text, color: p.color, alpha: a });
      y += m.h;
    }
    const bottom = y + 1.5;
    w += 8;
    items.unshift({ kind: 'rect', x: cx - w / 2, y: cfg.y, w, h: bottom - cfg.y, color: col('ink'), alpha: 0.7 * a });
    FINE.set('toast', items);
    this.toastBottom = bottom;
  }


  /** Bottom-right: two weapon slots (active highlighted), ammo, reload bar, shield icon. */
  /**
   * Bottom-right: the right hand (left click) and the left hand (right click), each with the button that uses
   * it above. The hand in use is outlined; a gun shows its loaded/spare rounds. A two-handed weapon fills both.
   */
  private drawLoadout() {
    const p = this.gs.player;
    const pal = DATA.palette;
    const g = this.g;
    const H = DATA.game.height;
    const bw = 32;
    const bh = 18;
    const y = H - 8 - bh;
    const xs = [HANDS_X(), HANDS_X() + bw + 3]; // right hand, left hand (in mouse-button order)
    const pad = this.gs.controls.device === 'pad';
    const two = p.twoHanding;
    for (let i = 0; i < 2; i++) {
      const x = xs[i];
      const inUse = i === p.slot && !(i === 1 && !p.leftWeapon);
      g.fillStyle(hexToInt(pal.ink), 0.75).fillRect(x, y, bw, bh);
      g.fillStyle(hexToInt(inUse ? pal.wax2 : pal.stone2), 1);
      g.fillRect(x, y, bw, 1).fillRect(x, y + bh - 1, bw, 1).fillRect(x, y, 1, bh).fillRect(x + bw - 1, y, 1, bh);
      const bound = shortKey(keysFor(i === 0 ? 'light' : 'block', DATA.input.keyboard)[0]);
      this.handKeys[i].setText(pad ? (i === 0 ? 'RT' : 'LT') : bound).setPosition(x, y - 9).setVisible(SETTINGS.hints);
      const icon = this.slotIcons[i];
      // what the hand holds: a weapon, the shield, or (two-handing) the same weapon's other end
      const id = i === 0 || two ? p.slots[0] : p.leftWeapon;
      const sh = i === 1 && !two && p.shieldId ? DATA.shields[p.shieldId] : null;
      const sprite = sh ? sh.sprite : id && !DATA.weapons[id].view.hidden ? DATA.weapons[id].view.sprite : null;
      icon.setVisible(!!sprite);
      if (sprite && icon.texture.key !== sprite) icon.setTexture(sprite, 0);
      icon.setPosition(x + bw / 2, y + bh / 2).setAlpha(i === 1 && two ? 0.25 : 1);
      if (i === 1 && two) g.fillStyle(hexToInt(pal.stone2), 1).fillRect(xs[0] + bw, y + bh / 2, xs[1] - xs[0] - bw, 1); // one weapon, both hands
      const r = id && !(i === 1 && two) ? DATA.weapons[id].ranged : null;
      const text = this.ammoTexts[i];
      if (r) {
        const a = p.ammoFor(id!);
        text.setText(`${a.clip}/${a.reserve}`).setTint(hexToInt(a.clip === 0 ? pal.ember : pal.wax2)).setVisible(true);
        text.setPosition(x + bw - text.width, y - 9);
      } else text.setVisible(false);
      // the button hint sits beside the rounds when there's room, else above them
      const key = this.handKeys[i];
      if (r && key.width + text.width + 3 > bw) key.setY(y - 18);
    }
    this.shieldIcon.setVisible(false);
    if (p.reloadProgress >= 0) {
      const ax = xs[p.slot];
      g.fillStyle(hexToInt(pal.dark2), 1).fillRect(ax + 2, y + bh - 3, bw - 4, 1);
      g.fillStyle(hexToInt(pal.flame2), 1).fillRect(ax + 2, y + bh - 3, Math.round((bw - 4) * Math.min(1, p.reloadProgress)), 1);
    }
  }


  private drawPrompt() {
    const gs = this.gs;
    const target = gs.player.dead || gs.story.active || gs.mapOpen || gs.warp ? null : gs.nearestInteractable();
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
    this.veil.setAlpha(Math.max(veil, gs.story.fadeAlpha, warpVeil(gs)));
    this.deathText.setText(d.text).setAlpha(text);
    const w = this.deathText.width;
    this.deathText.setPosition(Math.round((DATA.game.width - w) / 2), Math.round(DATA.game.height / 2 - 12));
  }
}

/** The HUD's longest bars (px): past these, more HP or stamina fills the same bar. */
const HP_BAR_MAX = 180;
const STAMINA_BAR_MAX = 150;
/** Effect timers per row under the phials. */
const BUFFS_PER_ROW = 6;
/** The equipment row, bottom-right: belt (22 wide), then the right and left hands (32 each), 3 px apart. */
const HANDS_X = () => DATA.game.width - 8 - 32 * 2 - 3;
function beltBox() {
  const h = 18;
  return { x: HANDS_X() - 3 - 22 - 4, y: DATA.game.height - 8 - h, w: 22, h };
}
