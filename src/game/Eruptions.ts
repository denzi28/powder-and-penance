// The ground erupting under a strike's `eruptions`: iron spikes, wax geysers, pillars of flame, drowning water,
// ember bursts. Each point appears on its turn (`stepTicks` apart), shows a warning ring on the floor for
// `warnTicks`, then bursts: everyone in `radius` (not the attacker's side) is hit. Shields don't help; rolling
// out does. Everything still waiting is called off if the attacker dies. Cleared when the world resets.
import { DATA } from '../data/config';
import { shapeHitsRect } from '../combat/shapes';
import { hexToInt } from '../ui/colors';
import { DEPTH } from '../render/depth';
import { TILE } from '../world/TileGrid';
import type Phaser from 'phaser';
import type { Actor } from '../actors/Actor';
import type { StrikeDef } from '../data/schemas';
import type { GameScene } from '../scenes/GameScene';

type EruptDef = NonNullable<StrikeDef['eruptions']>;
type Fx = EruptDef['fx'];

interface Pending {
  owner: Actor;
  def: EruptDef;
  /** A fixed point, or null: wherever the target stands when its turn comes. */
  at: { x: number; y: number } | null;
  wait: number;
}
interface Warning {
  owner: Actor;
  def: EruptDef;
  x: number;
  y: number;
  t: number;
}
interface Burst {
  x: number;
  y: number;
  fx: Fx;
  radius: number;
  t: number;
}

const BURST_TICKS = 16;
/** Warning ring and burst colours. */
const LOOK: Record<Fx, { ring: string; a: string; b: string }> = {
  spikes: { ring: 'steel1', a: 'stone2', b: 'steel1' },
  wax: { ring: 'wax2', a: 'wax1', b: 'wax2' },
  flame: { ring: 'flame1', a: 'flame1', b: 'flame2' },
  water: { ring: 'teal3', a: 'teal2', b: 'cyan' },
  ember: { ring: 'ember', a: 'ember', b: 'flame1' },
  honey: { ring: 'honey', a: 'honey', b: 'flame2' },
};
const col = (name: string) => hexToInt(DATA.palette[name]);

export class Eruptions {
  private pending: Pending[] = [];
  private warnings: Warning[] = [];
  private bursts: Burst[] = [];
  private g: Phaser.GameObjects.Graphics | null = null;
  private top: Phaser.GameObjects.Graphics | null = null;

  /** Lay out a strike's eruptions, from its attacker toward `target`. */
  start(owner: Actor, def: EruptDef, target: { x: number; y: number } | null, angle: number, gs: GameScene) {
    const t = target ?? { x: owner.x + Math.cos(angle) * 80, y: owner.y + Math.sin(angle) * 80 };
    const dir = Math.atan2(t.y - owner.y, t.x - owner.x);
    const add = (at: { x: number; y: number } | null, wait: number) => {
      if (at && gs.grid.isSolid(Math.floor(at.x / TILE), Math.floor(at.y / TILE))) return; // not inside walls
      this.pending.push({ owner, def, at, wait });
    };
    const out = (a: number, d: number, from: { x: number; y: number } = owner) => ({ x: from.x + Math.cos(a) * d, y: from.y + Math.sin(a) * d * 0.8 });
    switch (def.pattern) {
      case 'line':
        for (let i = 0; i < def.count; i++) add(out(dir, def.spacing * (i + 1)), i * def.stepTicks);
        break;
      case 'star':
        for (let l = 0; l < def.lines; l++)
          for (let i = 0; i < def.count; i++) add(out(dir + (l / def.lines) * Math.PI * 2, def.spacing * (i + 1)), i * def.stepTicks);
        break;
      case 'follow':
        for (let i = 0; i < def.count; i++) add(null, i * def.stepTicks);
        break;
      case 'ring':
        for (let i = 0; i < def.count; i++) add(out(dir + Math.PI + (i / def.count) * Math.PI * 2, def.spacing, t), i * def.stepTicks);
        if (def.centre) add({ x: t.x, y: t.y }, def.count * def.stepTicks);
        break;
      case 'scatter':
        for (let i = 0; i < def.count; i++) {
          const a = Math.random() * Math.PI * 2;
          add(out(a, Math.sqrt(Math.random()) * def.spacing, t), i * def.stepTicks);
        }
        break;
    }
  }

  tick(gs: GameScene) {
    const keep = (o: Actor) => !o.dead;
    this.pending = this.pending.filter(p => keep(p.owner));
    this.warnings = this.warnings.filter(w => keep(w.owner));
    for (const p of this.pending) {
      if (p.wait-- > 0) continue;
      const at = p.at ?? { x: gs.player.x, y: gs.player.y };
      this.warnings.push({ owner: p.owner, def: p.def, x: at.x, y: at.y, t: p.def.warnTicks });
    }
    this.pending = this.pending.filter(p => p.wait >= 0);
    const due = this.warnings.filter(w => --w.t <= 0);
    this.warnings = this.warnings.filter(w => w.t > 0);
    for (const w of due) this.burst(w, gs);
    this.bursts = this.bursts.filter(b => ++b.t < BURST_TICKS);
  }

  private burst(w: Warning, gs: GameScene) {
    const d = w.def;
    this.bursts.push({ x: w.x, y: w.y, fx: d.fx, radius: d.radius, t: 0 });
    gs.bus.emit('erupted', { x: w.x, y: w.y, radius: d.radius, fx: d.fx, sfx: d.sfx });
    if (d.damage <= 0) return;
    const shape = { kind: 'circle' as const, cx: w.x, cy: w.y - 6, radius: d.radius };
    for (const a of gs.actors) {
      if (a.dead || a.team === w.owner.team || a.team === 'prop' || !shapeHitsRect(shape, a.hurtRect())) continue;
      gs.combat.applyHit(
        {
          owner: w.owner,
          kind: 'projectile',
          damage: d.damage,
          poise: d.poise,
          knockback: d.knockback,
          hitstop: 4,
          shake: 0.2,
          angle: Math.atan2(a.y - w.y, a.x - w.x),
          unblockable: true, // it comes up from under you: a shield doesn't help, rolling out does
          unparryable: true,
        },
        a,
        gs.bus,
      );
    }
  }

  /** Warning rings on the floor, and the bursts standing up out of it. */
  draw(scene: Phaser.Scene) {
    this.g ??= scene.add.graphics().setDepth(DEPTH.shadow + 2);
    this.top ??= scene.add.graphics();
    const g = this.g.clear();
    const top = this.top.clear();
    for (const w of this.warnings) {
      const k = 1 - w.t / w.def.warnTicks;
      const r = w.def.radius;
      // the same red ring for every kind (this ground is about to go up), filling with the kind's colour
      const c = col(LOOK[w.def.fx].ring);
      const pulse = w.t < 10 && w.t % 4 < 2 ? 1 : 0.7;
      g.lineStyle(1, col('blood2'), (0.5 + 0.5 * k) * pulse);
      g.strokeEllipse(w.x, w.y, r * 2, r * 1.3);
      g.fillStyle(c, 0.12 + 0.3 * k);
      g.fillEllipse(w.x, w.y, r * 2 * k, r * 1.3 * k);
    }
    for (const b of this.bursts) {
      const k = b.t / BURST_TICKS; // 0 -> 1 over the burst
      const rise = k < 0.3 ? k / 0.3 : 1 - (k - 0.3) / 0.7; // up fast, sinks slowly
      const L = LOOK[b.fx];
      const a = col(L.a);
      const hi = col(L.b);
      const r = b.radius;
      top.setDepth(DEPTH.actor(b.y) + 1);
      g.fillStyle(col('ink'), 0.3 * (1 - k)).fillEllipse(b.x, b.y, r * 2, r * 1.3); // scorch / wet ground
      if (b.fx === 'spikes') {
        // a cluster of iron stakes punching up: dark outline, iron body, a bright edge catching the light
        const ink = col('ink');
        for (const [dx, h, w] of [[-r * 0.55, 0.8, 4], [r * 0.5, 0.85, 4], [0, 1.25, 6], [-r * 0.25, 0.6, 3], [r * 0.2, 0.65, 3]]) {
          const hh = h * r * 1.9 * rise;
          const x = b.x + dx;
          top.fillStyle(ink, 1).fillTriangle(x - w - 1, b.y + 1, x + w + 1, b.y + 1, x, b.y - hh - 2);
          top.fillStyle(a, 1).fillTriangle(x - w, b.y, x + w, b.y, x, b.y - hh);
          top.fillStyle(hi, 1).fillTriangle(x - 1, b.y - 1, x + 1, b.y - 1, x, b.y - hh);
          top.fillStyle(col('steel2'), 1).fillRect(x - 1, b.y - hh, 1, Math.max(1, hh * 0.35));
        }
      } else if (b.fx === 'ember') {
        const rr = r * (0.4 + k);
        top.lineStyle(2, a, 1 - k).strokeEllipse(b.x, b.y, rr * 2, rr * 1.3);
        top.fillStyle(hi, 0.8 * (1 - k)).fillEllipse(b.x, b.y - 4 * rise, r * rise, r * 0.8 * rise);
      } else {
        // a column: wax geyser, flame pillar, water spout; wider at the foot, a rounded crest
        const h = r * (b.fx === 'flame' ? 2.4 : 2) * rise;
        const w = r * (b.fx === 'flame' ? 0.8 : 1.1);
        top.fillStyle(a, 0.95).fillRect(b.x - w / 2, b.y - h, w, h);
        top.fillStyle(a, 0.95).fillEllipse(b.x, b.y - h, w, w * 0.6);
        top.fillStyle(hi, 0.9).fillRect(b.x - w / 5, b.y - h, w / 3, h);
        top.fillStyle(a, 0.8).fillEllipse(b.x, b.y, w * 1.6, w * 0.7);
        if (b.fx === 'flame') top.fillStyle(col('white'), 0.6 * rise).fillEllipse(b.x, b.y - h * 0.6, w * 0.3, h * 0.4);
      }
    }
  }

  clear() {
    this.pending = [];
    this.warnings = [];
    this.bursts = [];
    this.g?.clear();
    this.top?.clear();
  }
}
