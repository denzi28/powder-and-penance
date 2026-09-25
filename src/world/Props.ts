// Breakable scenery (crates, pots, candle clusters). Props are Actors on the 'prop' team, so any attack or
// projectile can break them; they are immovable bodies. They respawn on rest; loot drops only the first time
// (world flag "loot:<uid>").
import Phaser from 'phaser';
import { DATA } from '../data/config';
import { Actor } from '../actors/Actor';
import { Poise } from '../actors/Poise';
import { DEPTH } from '../render/depth';
import { lerp } from '../core/math';
import { TILE } from './TileGrid';
import { tint } from '../player/PlayerView';
import type { WorldCtx } from '../core/World';
import type { HitInfo } from '../combat/CombatSystem';
import type { SpriteLib } from '../anim/SpriteLib';
import type { RoomData } from '../data/schemas';

export class Prop extends Actor {
  readonly team = 'prop' as const;
  readonly poise = new Poise(() => ({ max: 1e9, resetTicks: 0 }));

  /** @param uid stable id ("<room>#<entity index>") used for the one-time loot flag */
  constructor(ctx: WorldCtx, readonly kind: string, readonly uid: string, x: number, y: number) {
    super(ctx, x, y);
    this.hp = this.def.hp;
    this.invulnerable = !!this.def.melts || !!this.def.blastOnly; // a tallow seal or fallen masonry: no blow breaks it
  }

  get def() {
    return DATA.props[this.kind];
  }
  get maxHp() {
    return this.def.hp;
  }
  get collider() {
    return { w: this.def.radius * 2, h: 4 };
  }
  get hurtbox() {
    return this.def.hurtbox;
  }
  get bodyRadius() {
    return this.def.radius;
  }
  get bloodColor() {
    return this.def.debris;
  }
  get knockbackResist() {
    return 1;
  }
  get stateName() {
    return this.dead ? 'broken' : 'prop';
  }
  get stateTick() {
    return 0;
  }

  tick() {
    this.beginTick();
    this.squash.tick();
  }

  onHit(h: HitInfo) {
    if (h.killed) {
      this.dead = true;
      this.ctx.bus.emit('propBroken', { prop: this });
    } else this.squash.set([1.15, 0.85, 5]);
  }
}

export class Props {
  list: Prop[] = [];
  private sprites = new Map<Prop, Phaser.GameObjects.Sprite>();

  constructor(private lib: SpriteLib) {}

  /** @param brokenWall secret walls already broken ("wall:<uid>" flags) stay open and aren't rebuilt */
  build(ctx: WorldCtx, rooms: RoomData[], brokenWall: (uid: string) => boolean = () => false) {
    this.clear();
    for (const r of rooms)
      r.entities.forEach((en, i) => {
        if (en.type !== 'prop') return;
        const uid = `${r.id}#${i}`;
        if (DATA.props[String(en.kind)].secretWall && brokenWall(uid)) return;
        const x = (r.origin[0] + en.at[0]) * TILE + TILE / 2;
        const y = (r.origin[1] + en.at[1]) * TILE + TILE - 3;
        const p = new Prop(ctx, String(en.kind), uid, x, y);
        this.list.push(p);
        // A secret wall's cracks are drawn over the wall face, in front of the tile.
        const depth = p.def.secretWall ? DEPTH.actor(y + 4) : DEPTH.actor(y);
        this.sprites.set(p, this.lib.sprite(p.def.sprite).setPosition(x, y + (p.def.secretWall ? 3 : 0)).setDepth(depth));
      });
  }

  clear() {
    this.sprites.forEach(s => s.destroy());
    this.sprites.clear();
    this.list = [];
  }

  render(alpha: number) {
    for (const [p, s] of this.sprites) {
      // Frame 0 = intact, frame 1 = rubble (stays until the props respawn).
      s.setFrame(p.dead ? 1 : 0)
        .setPosition(Math.round(lerp(p.prevX, p.x, alpha) + p.flinchX), Math.round(p.y + p.flinchY + (p.def.secretWall ? 3 : 0)))
        .setScale(p.squash.sx, p.squash.sy)
        .setDepth(p.dead ? DEPTH.shadow + 1 : DEPTH.actor(p.y + (p.def.secretWall ? 4 : 0)));
      tint(s, p.flash > 0);
    }
  }
}
