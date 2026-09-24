// Boss arenas. Room entity:
//   { "type": "arena", "id": "<arena id>", "boss": "<enemy kind>", "seals": [[x, y], ...], "at": [0, 0] }
// When the player walks into the arena's room (2+ tiles past its doorways), smoke rises in every seal tile (they
// become walls), the boss performs its entrance, and its name and health bar appear.
//
// A boss with `boss.next` has a second phase. When the first falls, a half-buried chest rises in the arena
// holding the item that wakes the next phase (the Igniter); using it on the remains burns them, and the
// next phase rises there with its own entrance. The smoke stays up throughout.
//
// A boss with `boss.turn` doesn't fall when its health runs out: it walks to its altar and gives itself to
// the fire, and the next phase rises there (see tickTurn).
//
// When the last phase falls: the boss stays dead for good (world flag "boss:<first kind>"), the smoke
// lifts, shrines waiting on that flag appear, and its `deathScript` plays. A `dust` boss crumbles away.
// If the player dies at any point, the smoke lifts and the whole fight resets with the world. Dying inside
// puts your Tallow just outside the doorway you came through.
import Phaser from 'phaser';
import { DATA } from '../data/config';
import { DEPTH } from '../render/depth';
import { Cell, TILE } from '../world/TileGrid';
import { arenaWakesAt } from './arenaWake';
import type { Enemy } from '../enemies/Enemy';
import type { RoomData } from '../data/schemas';
import type { GameScene } from '../scenes/GameScene';

interface Arena {
  id: string;
  kind: string;
  room: RoomData;
  seals: { tx: number; ty: number; prev: Cell; sprite: Phaser.GameObjects.Sprite }[];
}

type Stage =
  | { name: 'fight'; boss: Enemy; deathT: number; turning?: boolean }
  | { name: 'remains'; body: Enemy }
  | { name: 'burning'; body: Enemy; t: number }
  | { name: 'done' };

/** Ticks between a boss's death and what happens next (let the death animation land). */
const AFTER_DEATH = 30;
/** How close you must stand to the remains to use them. */
const REMAINS_REACH = 30;

export class BossArena {
  /** The boss being fought (drives the boss bar), or null. */
  active: { enemy: Enemy; title: string } | null = null;
  private arenas: Arena[] = [];
  private current: Arena | null = null;
  private stage: Stage | null = null;
  /** Where the player came in, for the Tallow rule. */
  private entry: { x: number; y: number } | null = null;
  private smokeT = 0;
  /** Created on first build: the scene's display list doesn't exist yet when the arena is constructed. */
  private bubbles: Phaser.GameObjects.Graphics | null = null;

  constructor(private gs: GameScene) {}

  build(rooms: RoomData[]) {
    this.clear();
    this.bubbles ??= this.gs.add.graphics();
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

  /** What the boss music should play (see audio/Music.ts), or null when there's no fight. */
  musicState(): { arena: string; boss: string; level: number } | null {
    const st = this.stage;
    const a = this.current;
    if (!st || !a || st.name === 'done') return null;
    if (st.name === 'fight') {
      const b = st.boss;
      const level = b.stateName === 'intro' ? 0 : st.turning || b.dead ? -1 : b.hp <= b.maxHp * 0.5 ? 2 : 1;
      return { arena: a.kind, boss: b.kind, level };
    }
    return { arena: a.kind, boss: st.body.kind, level: -1 }; // between phases
  }

  /** Is this tile currently sealed by smoke? (Doors in a sealed doorway can't be used.) */
  sealed(tx: number, ty: number) {
    return !!this.current?.seals.some(s => s.tx === tx && s.ty === ty);
  }

  /** Where the player's Tallow should fall if they die now (null = where they stand). */
  get markerPoint() {
    return this.current ? this.entry : null;
  }

  /** "Press E" on a fallen first phase: burn it (with the item) or be told what's needed. */
  remainsInteraction(): { label: string; use: () => void } | null {
    const st = this.stage;
    if (st?.name !== 'remains') return null;
    const p = this.gs.player;
    if (Math.hypot(st.body.x - p.x, st.body.y - p.y) > REMAINS_REACH) return null;
    const next = st.body.def.boss!.next!;
    if (!this.gs.flags.has(`key:${next.chest.item}`))
      return { label: 'HER REMAINS', use: () => this.gs.showToast('HER REMAINS', next.hint) };
    return {
      label: next.prompt,
      use: () => {
        this.stage = { name: 'burning', body: st.body, t: 0 };
        this.gs.bus.emit('sfx', { id: 'ignite', x: st.body.x, y: st.body.y });
      },
    };
  }

  tick() {
    const gs = this.gs;
    if (this.current && this.stage) {
      if (gs.player.dead) {
        this.release(); // the fight resets with the world on respawn; lift the smoke now
        return;
      }
      this.tickStage(this.stage);
      return;
    }
    // Waiting: wake the boss when the player is inside the arena room, past its doorways.
    const p = gs.player;
    if (p.dead) return;
    const tx = Math.floor(p.x / TILE);
    const ty = Math.floor(p.y / TILE);
    for (const a of this.arenas) {
      if (gs.flags.has(`boss:${a.kind}`)) continue;
      if (!arenaWakesAt(a.room, a.seals, tx, ty)) continue;
      const boss = gs.enemies.find(e => e.kind === a.kind && !e.dead);
      if (!boss) continue;
      this.begin(a, boss);
      return;
    }
  }

  private tickStage(st: Stage) {
    const gs = this.gs;
    if (st.name === 'fight') {
      const b = st.boss;
      if (b.stateName === 'turn') {
        this.tickTurn(st, b);
        return;
      }
      if (!b.dead) return;
      if (st.deathT === 0 && b.def.boss?.dust) this.crumble(b, 0);
      st.deathT++;
      if (b.def.boss?.dust && st.deathT % 12 === 0) this.crumble(b, st.deathT); // dust keeps drifting off
      if (st.deathT < b.def.deathTicks + AFTER_DEATH) return;
      const next = b.def.boss?.next;
      if (next) {
        // The first phase is down. A chest rises out of the floor with what wakes the next one.
        this.active = null;
        this.stage = { name: 'remains', body: b };
        const [ox, oy] = this.current!.room.origin;
        const tx = ox + next.chest.at[0];
        const ty = oy + next.chest.at[1];
        gs.pickups.addDynamic(next.chest.id, next.chest.item, tx, ty, gs.flags.has(`item:${next.chest.id}`), gs.grid);
        gs.particles.burst(tx * TILE + 8, ty * TILE + 14, 2, -Math.PI / 2, 2.4, 20, 60, 'stone4', false);
        gs.bus.emit('shake', { trauma: 0.3 });
        gs.bus.emit('sfx', { id: 'door_open', x: tx * TILE, y: ty * TILE });
        gs.showToast(b.def.boss!.title.toUpperCase(), next.fallenLine);
        return;
      }
      this.finish(b);
      return;
    }
    if (st.name === 'burning') {
      // Fire climbs the remains, then the next phase gets up out of it.
      st.t++;
      const b = st.body;
      if (st.t % 3 === 0) gs.particles.burst(b.x + (Math.random() - 0.5) * 20, b.y - 4, 6, -Math.PI / 2, 1.2, 3, 50, st.t % 2 ? 'flame2' : 'flame1', false);
      if (st.t % 20 === 0) gs.bus.emit('shake', { trauma: 0.12 });
      const next = b.def.boss!.next!;
      if (st.t < next.igniteTicks) return;
      const x = b.x;
      const y = b.y;
      gs.despawn(b);
      const risen = gs.spawnEnemy(next.kind, x, y, -Math.PI / 2);
      if (!risen) return;
      gs.particles.burst(x, y, 6, -Math.PI / 2, Math.PI * 2, 30, 110, 'flame1', false);
      gs.bus.emit('sfx', { id: 'explosion', x, y });
      this.active = { enemy: risen, title: risen.def.boss?.title ?? risen.def.name };
      this.stage = { name: 'fight', boss: risen, deathT: 0 };
      risen.startIntro();
      if (risen.def.boss?.introLine) gs.showToast(this.active.title.toUpperCase(), risen.def.boss.introLine);
    }
  }

  /**
   * A boss making its turn (boss.turn): it says its line, walks to the altar and gives itself to the fire,
   * which climbs higher the longer it pours. When it's done, the next phase rises out of the flames.
   */
  private tickTurn(st: Extract<Stage, { name: 'fight' }>, b: Enemy) {
    const gs = this.gs;
    const tr = b.def.boss!.turn!;
    if (!st.turning) {
      st.turning = true;
      if (tr.line) gs.showToast(b.def.boss!.title.toUpperCase(), tr.line);
      gs.bus.emit('sfx', { id: 'stagger', x: b.x, y: b.y, pitch: 0.6 });
    }
    if (b.turnT >= 0) {
      const k = Math.min(1, b.turnT / tr.ticks);
      const ay = b.y - TILE; // the altar, just north of where it stands
      if (b.turnT === 0) gs.bus.emit('sfx', { id: 'ignite', x: b.x, y: ay });
      if (b.turnT % 3 === 0)
        gs.particles.burst(b.x + (Math.random() - 0.5) * 20, ay, 6 + k * 14, -Math.PI / 2, 0.7, 2 + Math.round(k * 5), 40 + k * 70, b.turnT % 2 ? 'flame2' : 'flame1', false);
      if (b.turnT % 5 === 0 && k > 0.4) gs.particles.burst(b.x, ay - 6, 10 + k * 20, -Math.PI / 2, 0.5, 2, 60, 'dark2', false); // the flame starts to blacken
      if (b.turnT % 7 === 0) gs.particles.burst(b.x, b.y - 22, 14, -Math.PI / 2, 1.6, 3, 30, 'wax1', true); // wax running off him
      if (b.turnT % 30 === 0) gs.bus.emit('shake', { trauma: 0.08 + k * 0.25 });
    }
    if (!b.turned) return;
    const x = b.x;
    const y = b.y;
    gs.despawn(b);
    const risen = gs.spawnEnemy(tr.kind, x, y, Math.atan2(gs.player.y - y, gs.player.x - x));
    if (!risen) return;
    gs.particles.burst(x, y - 10, 8, -Math.PI / 2, Math.PI * 2, 40, 120, 'flame1', false);
    gs.particles.burst(x, y - 20, 12, -Math.PI / 2, 1.2, 30, 90, 'dark1', false);
    gs.bus.emit('shake', { trauma: 0.6 });
    gs.bus.emit('sfx', { id: 'explosion', x, y });
    this.active = { enemy: risen, title: risen.def.boss?.title ?? risen.def.name };
    this.stage = { name: 'fight', boss: risen, deathT: 0 };
    risen.startIntro();
    if (risen.def.boss?.introLine) gs.showToast(this.active.title.toUpperCase(), risen.def.boss.introLine);
  }

  private begin(a: Arena, boss: Enemy) {
    const gs = this.gs;
    this.current = a;
    this.stage = { name: 'fight', boss, deathT: 0 };
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

  /** The last phase fell: the boss is gone for good. */
  private finish(b: Enemy) {
    const gs = this.gs;
    const a = this.current!;
    gs.flags.add(`boss:${a.kind}`);
    this.release();
    this.active = null;
    this.stage = null;
    if (b.def.boss?.dust) gs.despawn(b); // nothing left but dust
    // A shrine that waited for this victory kindles into being where the fight was.
    const before = new Set(gs.shrines.list.map(s => s.id));
    gs.rebuildShrines();
    for (const s of gs.shrines.list.filter(s => !before.has(s.id))) {
      gs.particles.burst(s.x, s.y, 4, -Math.PI / 2, Math.PI * 2, 24, 80, 'flame2', false);
      gs.particles.burst(s.x, s.y, 20, -Math.PI / 2, 1.5, 14, 50, 'wax2', false);
    }
    gs.markDirty();
    gs.save();
    const script = b.def.boss?.deathScript;
    if (script) gs.story.start(script);
  }

  /** A puff of bone dust off a crumbling body. */
  private crumble(b: Enemy, t: number) {
    const k = Math.min(1, t / (b.def.deathTicks + AFTER_DEATH));
    const count = t === 0 ? 30 : 8;
    this.gs.particles.burst(b.x, b.y - 20 * (1 - k), 14 * (1 - k) + 2, -Math.PI / 2, Math.PI * 1.2, count, 45, t % 24 ? 'stone4' : 'wax2', false);
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
    if (this.gs.player.dead) {
      this.active = null;
      this.stage = null;
    }
  }

  /** World reset (rest, respawn, area change): no fight in progress, and no chest left mid-floor. */
  reset() {
    this.release();
    this.active = null;
    this.stage = null;
    this.gs.pickups.removeDynamic(this.gs.grid);
  }

  update(deltaMs: number) {
    this.smokeT += deltaMs;
    const frame = Math.floor(this.smokeT / 120) % 4;
    for (const a of this.arenas)
      for (const s of a.seals)
        if (s.sprite.visible) s.sprite.setFrame(frame).setAlpha(Math.min(1, s.sprite.alpha + deltaMs / 400));
    // Summoning bubbles: a pale, pulsing shell around any enemy sheltering in one.
    if (!this.bubbles) return;
    const g = this.bubbles.clear().setDepth(DEPTH.actor(99999));
    const pal = DATA.palette;
    for (const e of this.gs.enemies) {
      if (!e.bubble || e.dead) continue;
      const r = e.bodyRadius + 12 + Math.sin(this.smokeT / 160) * 1.5;
      const cy = e.y - e.def.hurtbox.h / 2;
      g.fillStyle(Phaser.Display.Color.HexStringToColor(pal.wax2).color, 0.12).fillEllipse(e.x, cy, r * 2, r * 2.4);
      g.lineStyle(1, Phaser.Display.Color.HexStringToColor(pal.flame2).color, 0.7).strokeEllipse(e.x, cy, r * 2, r * 2.4);
    }
  }

  /** Before building a new area: the old seals belong to the old map, so only forget them. */
  private clear() {
    this.current = null;
    this.stage = null;
    for (const a of this.arenas) for (const s of a.seals) s.sprite.destroy();
    this.arenas = [];
    this.active = null;
  }
}
