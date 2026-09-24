// Powder: lit fuses that burst. A broken keg (prop `explode`) or a dead Powder Mule (enemy `deathBlast`) arms a
// fuse; it hisses and throws sparks for `fuseTicks`, then bursts: everyone within `radius` is hit (you too),
// and every keg in reach is broken, lighting its own fuse. Cleared when the world resets.
import { DATA } from '../data/config';
import { shapeHitsRect } from '../combat/shapes';
import type { Actor } from '../actors/Actor';
import type { BlastDef } from '../data/schemas';
import type { GameScene } from '../scenes/GameScene';

interface Fuse {
  x: number;
  y: number;
  t: number;
  blast: BlastDef;
  /** Who it counts as coming from (the keg, the mule): never hit by its own blast. */
  source: Actor;
}

export class Explosions {
  list: Fuse[] = [];

  arm(x: number, y: number, blast: BlastDef, source: Actor, gs: GameScene) {
    this.list.push({ x, y, t: blast.fuseTicks, blast, source });
    if (blast.fuseTicks > 0) gs.bus.emit('sfx', { id: 'e_fuse', x, y });
  }

  tick(gs: GameScene) {
    const due: Fuse[] = [];
    for (const f of this.list) {
      if (f.t-- > 0) {
        if (f.t % 3 === 0) gs.particles.burst(f.x, f.y, 10, -Math.PI / 2, 1.2, 2, 50, f.t % 6 ? 'flame2' : 'wax2', false); // sparks
      } else due.push(f);
    }
    if (!due.length) return;
    this.list = this.list.filter(f => !due.includes(f));
    for (const f of due) this.burst(f, gs);
  }

  private burst(f: Fuse, gs: GameScene) {
    const b = f.blast;
    gs.bus.emit('blast', { x: f.x, y: f.y, radius: b.radius, sfx: b.sfx });
    const shape = { kind: 'circle' as const, cx: f.x, cy: f.y - 6, radius: b.radius };
    for (const a of gs.actors) {
      if (a === f.source || a.dead || !shapeHitsRect(shape, a.hurtRect())) continue;
      gs.combat.applyHit(
        {
          owner: f.source,
          kind: 'projectile',
          damage: b.damage,
          poise: b.poise,
          knockback: b.knockback,
          hitstop: 5,
          shake: 0.35,
          angle: Math.atan2(a.y - f.y, a.x - f.x),
          unblockable: true, // a shield doesn't stop a blast; rolling through it does
          unparryable: true,
        },
        a,
        gs.bus,
      );
    }
  }

  clear() {
    this.list = [];
  }
}

/** How close to a point the nearest unbroken keg is. */
export function nearestKeg(gs: GameScene, x: number, y: number, r: number): { x: number; y: number } | null {
  let best: { x: number; y: number } | null = null;
  let bd = r;
  for (const p of gs.props.list) {
    if (p.dead || !DATA.props[p.kind]?.explode) continue;
    const d = Math.hypot(p.x - x, p.y - y);
    if (d <= bd) {
      bd = d;
      best = { x: p.x, y: p.y };
    }
  }
  return best;
}
