// Boss arenas. Room entity:
//   { "type": "arena", "id": "<arena id>", "boss": "<enemy kind>", "seals": [[x, y], ...], "at": [0, 0] }
// When the player walks into the arena's room (past its doorways), smoke rises in every seal tile (they
// become walls), the boss performs its entrance, and its name and health bar appear. The seals lift when the
// boss dies (for good: world flag "boss:<enemy kind>") or when the player dies (the fight resets with the world).
// Dying inside puts your Tallow just outside the doorway you came through.
import Phaser from 'phaser';
import { DEPTH } from '../render/depth';
import { Cell, TILE } from '../world/TileGrid';
import type { Enemy } from '../enemies/Enemy';
import type { RoomData } from '../data/schemas';
import type { GameScene } from '../scenes/GameScene';

interface Arena {
  id: string;
  kind: string;
  room: RoomData;
  seals: { tx: number; ty: number; prev: Cell; sprite: Phaser.GameObjects.Sprite }[];
}

/** Ticks between the boss's death and its last words (let the death animation land). */
const LAST_WORDS_DELAY = 30;

export class BossArena {
  /** The boss being fought (drives the boss bar), or null. */
  active: { enemy: Enemy; title: string } | null = null;
  private arenas: Arena[] = [];
  private current: Arena | null = null;
  /** Where the player came in, for the Tallow rule. */
  private entry: { x: number; y: number } | null = null;
  private deathT = -1;
  private smokeT = 0;

  constructor(private gs: GameScene) {}

  build(rooms: RoomData[]) {
    this.clear();
    for (const r of rooms)
      for (const en of r.entities) {
        if (en.type !== 'arena' || !en.id) continue;
        const seals = ((en.seals as [number, number][]) ?? []).map(([x, y]) => {
          const tx = r.origin[0] + x;
          const ty = r.origin[1] + y;
          const sprite = this.gs.lib.sprite('smoke_veil').setPosition(tx * TILE + TILE / 2, ty * TILE + TILE).setVisible(false);
          sprite.setDepth(DEPTH.actor(ty * TILE + TILE));
          return { tx, ty, prev: Cell.Floor as Cell, sprite };
        });
        this.arenas.push({ id: en.id, kind: String(en.boss), room: r, seals });
      }
  }

  /** Is this tile currently sealed by smoke? (Doors in a sealed doorway can't be used.) */
  sealed(tx: number, ty: number) {
    return !!this.current?.seals.some(s => s.tx === tx && s.ty === ty);
  }

  /** Where the player's Tallow should fall if they die now (null = where they stand). */
  get markerPoint() {
    return this.current ? this.entry : null;
  }

  tick() {
    const gs = this.gs;
    if (this.current) {
      const boss = this.active?.enemy;
      if (gs.player.dead) {
        // The fight resets with the world on respawn; lift the smoke now.
        this.release();
        return;
      }
      if (boss?.dead) {
        if (this.deathT < 0) {
          this.deathT = 0;
          gs.flags.add(`boss:${this.current.kind}`);
          gs.markDirty();
        }
        if (++this.deathT === boss.def.deathTicks + LAST_WORDS_DELAY) {
          this.release();
          this.active = null;
          const script = boss.def.boss?.deathScript;
          if (script) gs.story.start(script);
        }
      }
      return;
    }
    // Waiting: wake the boss when the player is inside the arena room, past its doorways.
    const p = gs.player;
    if (p.dead) return;
    const tx = Math.floor(p.x / TILE);
    const ty = Math.floor(p.y / TILE);
    for (const a of this.arenas) {
      if (gs.flags.has(`boss:${a.kind}`)) continue;
      const [ox, oy] = a.room.origin;
      const inside = tx > ox && ty > oy && tx < ox + a.room.tiles[0].length - 1 && ty < oy + a.room.tiles.length - 1;
      if (!inside) continue;
      const boss = gs.enemies.find(e => e.kind === a.kind && !e.dead);
      if (!boss) continue;
      this.begin(a, boss);
      return;
    }
  }

  private begin(a: Arena, boss: Enemy) {
    const gs = this.gs;
    this.current = a;
    this.deathT = -1;
    // The Tallow rule: just outside the doorway nearest to where the player came in.
    const p = gs.player;
    const near = [...a.seals].sort((s1, s2) => Math.hypot(s1.tx * TILE - p.x, s1.ty * TILE - p.y) - Math.hypot(s2.tx * TILE - p.x, s2.ty * TILE - p.y))[0];
    if (near) {
      const [ox, oy] = a.room.origin;
      const dx = near.tx === ox ? -1 : near.tx === ox + a.room.tiles[0].length - 1 ? 1 : 0;
      const dy = near.ty === oy ? -1 : near.ty === oy + a.room.tiles.length - 1 ? 1 : 0;
      this.entry = { x: (near.tx + dx) * TILE + TILE / 2, y: (near.ty + dy) * TILE + TILE - 2 };
    } else this.entry = null;
    for (const s of a.seals) {
      s.prev = gs.grid.get(s.tx, s.ty);
      gs.grid.set(s.tx, s.ty, Cell.Wall);
      s.sprite.setVisible(true).setAlpha(0);
    }
    this.active = { enemy: boss, title: boss.def.boss!.title };
    boss.startIntro();
    gs.bus.emit('sfx', { id: 'veil' });
    const line = boss.def.boss!.introLine;
    if (line) gs.showToast(boss.def.boss!.title.toUpperCase(), line);
  }

  /** Lift the smoke (boss dead, or the player died). */
  private release() {
    const a = this.current;
    if (!a) return;
    for (const s of a.seals) {
      if (this.gs.grid.get(s.tx, s.ty) === Cell.Wall) this.gs.grid.set(s.tx, s.ty, s.prev);
      s.sprite.setVisible(false);
    }
    this.current = null;
    if (this.gs.player.dead) this.active = null;
  }

  /** World reset (rest, respawn, area change): no fight in progress. */
  reset() {
    this.release();
    this.active = null;
    this.deathT = -1;
  }

  update(deltaMs: number) {
    this.smokeT += deltaMs;
    const frame = Math.floor(this.smokeT / 120) % 4;
    for (const a of this.arenas)
      for (const s of a.seals)
        if (s.sprite.visible) s.sprite.setFrame(frame).setAlpha(Math.min(1, s.sprite.alpha + deltaMs / 400));
  }

  /** Before building a new area: the old seals belong to the old map, so only forget them. */
  private clear() {
    this.current = null;
    for (const a of this.arenas) for (const s of a.seals) s.sprite.destroy();
    this.arenas = [];
    this.active = null;
  }
}
