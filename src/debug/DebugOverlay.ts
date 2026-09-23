// World-space debug drawing: colliders, hurtboxes (cyan = i-frames, red = vulnerable roll recovery),
// aim line and "state tick" labels above actors. Toggle with F1.
import Phaser from 'phaser';
import { DATA } from '../data/config';
import { DEPTH } from '../render/depth';
import { hexToInt } from '../ui/colors';
import type { Player } from '../player/Player';

export class DebugOverlay {
  enabled = DATA.debug.overlayOnStart;
  private g: Phaser.GameObjects.Graphics;
  private label: Phaser.GameObjects.BitmapText;

  constructor(scene: Phaser.Scene) {
    this.g = scene.add.graphics().setDepth(DEPTH.overlay);
    this.label = scene.add.bitmapText(0, 0, 'pixel', '').setDepth(DEPTH.overlay);
  }

  draw(p: Player, px: number, py: number) {
    this.g.clear();
    this.label.setVisible(this.enabled);
    if (!this.enabled) return;
    const pal = DATA.palette;

    const c = DATA.player.collider;
    box(this.g, px - c.w / 2, py - c.h, c.w, c.h, hexToInt(pal.flame2), 0.9);

    const hb = DATA.player.hurtbox;
    const rollVuln = p.sm.name === 'roll' && !p.invulnerable && p.sm.t > DATA.roll.iframeEnd;
    const hurtColor = p.invulnerable ? pal.cyan : rollVuln ? pal.blood2 : pal.moss2;
    box(this.g, px - hb.w / 2, py + hb.offsetY - hb.h / 2, hb.w, hb.h, hexToInt(hurtColor), 1);

    this.g.lineStyle(1, hexToInt(pal.stone4), 0.35);
    this.g.lineBetween(px, py + DATA.player.aimOriginY, p.aimX, p.aimY);

    const tags = [p.invulnerable ? 'IFR' : '', p.stamina.locked ? 'EXH' : ''].filter(Boolean).join(' ');
    this.label.setText(`${p.sm.name.toUpperCase()} ${p.sm.t}${tags ? `\n${tags}` : ''}`);
    this.label.setPosition(px - Math.floor(this.label.width / 2), py - 44);
  }
}

/** Crisp 1px rectangle outline built from filled strips (strokeRect straddles pixels). */
function box(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number, color: number, alpha: number) {
  x = Math.round(x);
  y = Math.round(y);
  w = Math.round(w);
  h = Math.round(h);
  g.fillStyle(color, alpha);
  g.fillRect(x, y, w, 1);
  g.fillRect(x, y + h - 1, w, 1);
  g.fillRect(x, y + 1, 1, h - 2);
  g.fillRect(x + w - 1, y + 1, 1, h - 2);
}
