// Title screen: Continue (if a save exists) / New Game (asks before erasing a save).
import Phaser from 'phaser';
import { DATA } from '../data/config';
import { INPUT } from '../input/instance';
import { SaveSystem } from '../save/SaveSystem';
import { firstEnabled, MenuNav, type Menu, type MenuItem } from '../ui/Menu';
import { MenuRenderer } from '../ui/MenuRenderer';
import { hexToInt } from '../ui/colors';
import { Sfx } from '../audio/Sfx';
import type { GameStartData } from './GameScene';

export class TitleScene extends Phaser.Scene {
  private menu!: Menu;
  private nav = new MenuNav();
  private menuView!: MenuRenderer;
  private sfx = new Sfx();
  private tick = 0;
  private saves = new SaveSystem();

  constructor() {
    super('title');
  }

  create() {
    INPUT.attach(this.game.canvas);
    this.game.canvas.style.cursor = 'default';
    const W = DATA.game.width;
    const pal = DATA.palette;
    const title = this.add.bitmapText(0, 60, 'pixel', 'POWDER & PENANCE').setScale(3).setTint(hexToInt(pal.flame2));
    title.setX(Math.round((W - title.width) / 2));
    const sub = this.add.bitmapText(0, 88, 'pixel', 'a candle-lit trial').setTint(hexToInt(pal.stone4));
    sub.setX(Math.round((W - sub.width) / 2));
    const hint = this.add.bitmapText(0, DATA.game.height - 16, 'pixel', 'W/S OR ARROWS TO CHOOSE  -  ENTER / E / SPACE TO CONFIRM').setTint(hexToInt(pal.stone2));
    hint.setX(Math.round((W - hint.width) / 2));
    this.menuView = new MenuRenderer(this, 5, false);
    this.showMain();
    const unlock = () => this.sfx.unlock();
    window.addEventListener('keydown', unlock, { once: true });
  }

  private showMain() {
    const hasSave = this.saves.exists();
    const items: MenuItem[] = [
      { label: 'CONTINUE', enabled: hasSave, note: 'no save yet', action: () => this.start('continue') },
      { label: 'NEW GAME', enabled: true, action: () => (hasSave ? this.confirmNew() : this.start('new')) },
    ];
    this.menu = { title: '', items, index: firstEnabled(items) };
  }

  private confirmNew() {
    const items: MenuItem[] = [
      { label: 'NO, KEEP IT', enabled: true, action: () => this.showMain() },
      { label: 'YES, ERASE IT', enabled: true, action: () => this.start('new') },
    ];
    this.menu = { title: 'ERASE SAVE?', subtitle: 'Your current progress will be lost.', items, index: 0, onBack: () => this.showMain() };
  }

  private start(mode: 'continue' | 'new') {
    const data: GameStartData = { mode };
    INPUT.clearBuffer();
    this.scene.start('game', data);
  }

  update() {
    INPUT.beginTick(++this.tick);
    const r = this.nav.update(this.menu, INPUT);
    if (r === 'moved') this.sfx.play('menu_move');
    if (r === 'confirmed') this.sfx.play('menu_confirm');
    this.menuView.draw(this.menu, 170);
  }
}
