// World-space debug drawing (toggle F1):
//   colliders (yellow), hurtboxes (green; cyan = i-frames; red = vulnerable roll recovery; orange = hyper-armor),
//   active hitboxes (red outline), enemy vision cones, and "STATE tick / HP / poise" labels above actors.
import Phaser from 'phaser';
import { DATA } from '../data/config';
import { DEG } from '../core/math';
import { DEPTH } from '../render/depth';
import { hexToInt } from '../ui/colors';
import { shapeOutline } from '../combat/shapes';
import { COMBAT_STATES, Enemy } from '../enemies/Enemy';
import type { Actor } from '../actors/Actor';
import type { GameScene } from '../scenes/GameScene';

export class DebugOverlay {
  enabled = DATA.debug.overlayOnStart;
  private g: Phaser.GameObjects.Graphics;
  private labels: Phaser.GameObjects.BitmapText[] = [];

  constructor(private scene: Phaser.Scene) {
    this.g = scene.add.graphics().setDepth(DEPTH.overlay);
  }

  draw(gs: GameScene, px: number, py: number) {
    this.g.clear();
    this.labels.forEach(l => l.setVisible(false));
    if (!this.enabled) return;
    const pal = DATA.palette;
    const g = this.g;

    // Hitboxes active this tick
    g.lineStyle(1, hexToInt(pal.blood2), 1);
    for (const s of gs.combat.debugShapes) g.strokePoints(shapeOutline(s).map(([x, y]) => ({ x, y })), false);

    let i = 0;
    for (const a of gs.actors) {
      if (a.team === 'prop') {
        const hb = a.hurtbox;
        box(g, a.x - hb.w / 2, a.y + hb.offsetY - hb.h / 2, hb.w, hb.h, hexToInt(pal.stone4), 0.7);
        continue;
      }
      // Player uses its snapped render position; enemies are close enough using sim position.
      const x = a === gs.player ? px : Math.round(a.x);
      const y = a === gs.player ? py : Math.round(a.y);
      this.drawActor(a, x, y);
      if (a instanceof Enemy && !a.dead && a.def.ai !== 'dummy') {
        this.drawCone(a);
        const path = a.debugPath;
        if (path.length) {
          this.g.lineStyle(1, hexToInt(DATA.palette.cyan), 0.8);
          this.g.strokePoints([{ x: a.x, y: a.y }, ...path], false);
        }
      }
      const label = this.label(i++);
      const tags = [a.invulnerable ? 'IFR' : '', a.hyperArmor ? 'ARMOR' : '', a === gs.player && gs.player.stamina.locked ? 'EXH' : '']
        .filter(Boolean)
        .join(' ');
      const aw = a instanceof Enemy && a.isFighter ? ` A${Math.round(a.awareness * 100)}` : '';
      label
        .setText(`${a.stateName.toUpperCase()} ${a.stateTick}\nHP${Math.ceil(a.hp)} P${Math.round(a.poise.damage)}/${a.poise.max}${aw}${tags ? `\n${tags}` : ''}`)
        .setVisible(true);
      label.setPosition(x - Math.floor(label.width / 2), y - a.hurtbox.h - 34);
    }

    g.lineStyle(1, hexToInt(pal.stone4), 0.35);
    g.lineBetween(px, py + DATA.player.aimOriginY, gs.player.aimX, gs.player.aimY);
  }

  private drawActor(a: Actor, x: number, y: number) {
    const pal = DATA.palette;
    const c = a.collider;
    box(this.g, x - c.w / 2, y - c.h, c.w, c.h, hexToInt(pal.flame2), 0.9);
    const hb = a.hurtbox;
    const rollVuln = a.stateName === 'roll' && !a.invulnerable && a.stateTick > DATA.roll.iframeEnd;
    const color = a.invulnerable ? pal.cyan : rollVuln ? pal.blood2 : a.hyperArmor ? pal.ember : pal.moss2;
    box(this.g, x - hb.w / 2, y + hb.offsetY - hb.h / 2, hb.w, hb.h, hexToInt(color), a.dead ? 0.3 : 1);
  }

  /** Vision cone (sight is unlimited; drawn 120 px long). Colour: pale = unaware, orange = suspicious/combat. */
  private drawCone(e: Enemy) {
    const per = e.def.perception;
    const inCombat = COMBAT_STATES.has(e.stateName);
    const half = inCombat ? Math.PI : per.halfAngleDeg * DEG;
    const r = 120;
    const cx = e.x;
    const cy = e.chestY;
    const pts: { x: number; y: number }[] = half < Math.PI ? [{ x: cx, y: cy }] : [];
    const n = 16;
    for (let i = 0; i <= n; i++) {
      const a = e.facing - half + (2 * half * i) / n;
      pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
    }
    if (half < Math.PI) pts.push({ x: cx, y: cy });
    const alarmed = inCombat || e.awareness >= per.suspicionAt;
    this.g.lineStyle(1, hexToInt(DATA.palette[alarmed ? 'ember' : 'wax1']), e.visible ? 0.7 : 0.3);
    this.g.strokePoints(pts, false);
  }

  private label(i: number) {
    while (this.labels.length <= i) this.labels.push(this.scene.add.bitmapText(0, 0, 'pixel', '').setDepth(DEPTH.overlay));
    return this.labels[i];
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
