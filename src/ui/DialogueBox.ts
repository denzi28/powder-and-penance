// The dialogue box along the bottom of the screen: portrait, speaker name, typewriter text, and choices.
// Reads GameScene.story.dialogue; draws nothing when there is no line to show. Drawn above the fade veil so
// narration can play over a black screen.
import Phaser from 'phaser';
import { DATA } from '../data/config';
import { hexToInt } from './colors';
import { wrap } from './MenuRenderer';
import type { GameScene } from '../scenes/GameScene';

const MARGIN = 40;
const PAD = 7;
const PORTRAIT = 32;
const LINE = 9;

export class DialogueBox {
  private g: Phaser.GameObjects.Graphics;
  private portrait: Phaser.GameObjects.Sprite;
  private name: Phaser.GameObjects.BitmapText;
  private text: Phaser.GameObjects.BitmapText;
  private choices: Phaser.GameObjects.BitmapText[] = [];
  private more: Phaser.GameObjects.BitmapText;
  private t = 0;

  constructor(private scene: Phaser.Scene) {
    const pal = DATA.palette;
    this.g = scene.add.graphics().setDepth(22);
    this.portrait = scene.add.sprite(0, 0, 'portraits', 0).setOrigin(0, 0).setDepth(23);
    this.name = scene.add.bitmapText(0, 0, 'pixel', '').setTint(hexToInt(pal.flame2)).setDepth(23);
    this.text = scene.add.bitmapText(0, 0, 'pixel', '').setTint(hexToInt(pal.wax2)).setDepth(23);
    this.more = scene.add.bitmapText(0, 0, 'pixel', '>').setTint(hexToInt(pal.flame2)).setDepth(23);
  }

  update(gs: GameScene, deltaMs: number) {
    this.t += deltaMs;
    const d = gs.story.dialogue;
    this.g.clear();
    const show = !!d && !gs.mapOpen;
    for (const o of [this.portrait, this.name, this.text, this.more]) o.setVisible(show);
    this.choices.forEach(c => c.setVisible(false));
    if (!d || !show) return;

    const pal = DATA.palette;
    const W = DATA.game.width;
    const H = DATA.game.height;
    const boxW = W - MARGIN * 2;
    const hasPortrait = d.portrait !== null;
    const textX = MARGIN + PAD + (hasPortrait ? PORTRAIT + PAD : 0);
    const cols = Math.floor((MARGIN + boxW - PAD - textX) / 6);

    const body = wrap(d.text.slice(0, Math.floor(d.shown)), cols);
    const fullLines = d.text ? wrap(d.text, cols).split('\n').length : 0; // size the box for the whole line
    const choiceLines = d.choices?.length ?? 0;
    const lines = fullLines + choiceLines + (fullLines && choiceLines ? 1 : 0);
    const inner = Math.max(hasPortrait ? PORTRAIT : 0, lines * LINE);
    const boxH = inner + PAD * 2;
    const boxY = H - 10 - boxH;

    // panel
    this.g.fillStyle(hexToInt(pal.ink), 0.9).fillRect(MARGIN, boxY, boxW, boxH);
    this.g.lineStyle(1, hexToInt(pal.stone2), 1).strokeRect(MARGIN + 0.5, boxY + 0.5, boxW - 1, boxH - 1);

    // speaker tab above the panel
    this.name.setText(d.speaker ? d.speaker.toUpperCase() : '').setVisible(!!d.speaker);
    if (d.speaker) {
      const tw = this.name.width + 10;
      this.g.fillStyle(hexToInt(pal.ink), 0.9).fillRect(MARGIN + 6, boxY - 11, tw, 11);
      this.g.lineStyle(1, hexToInt(pal.stone2), 1).strokeRect(MARGIN + 6.5, boxY - 10.5, tw - 1, 11);
      this.name.setPosition(MARGIN + 11, boxY - 8);
    }

    this.portrait.setVisible(hasPortrait);
    if (hasPortrait) this.portrait.setFrame(d.portrait!).setPosition(MARGIN + PAD, boxY + PAD);

    this.text.setText(body).setPosition(textX, boxY + PAD);

    // choices under the text, the selected one marked
    if (d.choices) {
      const y0 = boxY + PAD + (fullLines ? (fullLines + 1) * LINE : 0);
      d.choices.forEach((c, i) => {
        const t = this.choice(i);
        const sel = i === d.selected;
        t.setText(`${sel ? '> ' : '  '}${c.toUpperCase()}`)
          .setTint(hexToInt(sel ? pal.flame2 : pal.stone4))
          .setPosition(textX, y0 + i * LINE)
          .setVisible(true);
      });
    }

    // "more" marker once the line is fully shown
    const done = d.shown >= d.text.length && !d.choices;
    this.more.setVisible(done && Math.floor(this.t / 400) % 2 === 0);
    this.more.setPosition(MARGIN + boxW - PAD - 5, boxY + boxH - PAD - 7);
  }

  private choice(i: number) {
    while (this.choices.length <= i) this.choices.push(this.scene.add.bitmapText(0, 0, 'pixel', '').setDepth(23));
    return this.choices[i];
  }
}
