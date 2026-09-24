// Ambient life (data/ambience.json). Nothing here touches the simulation: it is all for looks.
// - Decor with flames (listed under `decor`) gets a warm flickering light, dancing flame tips, and smoke,
//   sparks, steam or moths.
// - Each area (`areas`) gets things in the air (ash, dust, soot, fireflies, mist, leaves), floors that
//   bubble, drops falling from the ceiling, and small animals: rats scurry off into cracks, crows fly away,
//   frogs hop off, a cat keeps its distance, bats flit across dark rooms.
import Phaser from 'phaser';
import { DATA } from '../data/config';
import { DEPTH } from '../render/depth';
import { hexToInt } from '../ui/colors';
import { Cell, TILE } from './TileGrid';
import type { TileGrid } from './TileGrid';
import type { AmbientArea, AmbientDecor, CRITTERS, RoomData } from '../data/schemas';
import type { SpriteLib } from '../anim/SpriteLib';

type Kind = (typeof CRITTERS)[number];
type Pt = { x: number; y: number };

const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(Math.random() * xs.length)];
const col = (name: string) => hexToInt(DATA.palette[name]);

interface Puff {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  kind: 'smoke' | 'ember' | 'steam';
}

/** One piece of decor with flames: its own Graphics so it sorts with the decor. */
interface Burner {
  def: AmbientDecor;
  x: number;
  y: number;
  flames: Pt[];
  steam: Pt[];
  g: Phaser.GameObjects.Graphics;
  lights: Phaser.GameObjects.Image[];
  puffs: Puff[];
  acc: { smoke: number; embers: number; steam: number };
  tips: { dx: number; dy: number; c: number }[];
  tipT: number;
  moths: { a: number; b: number; ph: number; r: number }[];
}

interface Critter {
  kind: Kind;
  sprite: Phaser.GameObjects.Sprite;
  tiles: Pt[];
  ground: Set<string>;
  room: { x0: number; y0: number; x1: number; y1: number };
  x: number;
  y: number;
  z: number;
  tx: number;
  ty: number;
  state: 'idle' | 'move' | 'flee' | 'fly' | 'land' | 'gone' | 'wait';
  timer: number;
  t: number;
  alt: boolean;
  facing: number;
  vx: number;
  vy: number;
}

interface Mote {
  fx: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  ph: number;
  c: number;
  s: number;
}

interface Drop {
  x: number;
  y: number;
  z: number;
  vz: number;
  splash: number;
}

interface Bubble {
  x: number;
  y: number;
  t: number;
  life: number;
  c: number;
}

/** Scare distance, move speed, flee speed (px, px/s). */
const CRITTER: Record<Kind, { scare: number; speed: number; flee: number }> = {
  rat: { scare: 46, speed: 42, flee: 110 },
  crow: { scare: 62, speed: 22, flee: 90 },
  frog: { scare: 34, speed: 40, flee: 70 },
  cat: { scare: 26, speed: 18, flee: 34 },
  bat: { scare: 0, speed: 70, flee: 70 },
};
/** Frames in the critters sheet: idle, alt (sniff/peck/croak/flick), move a/b. */
const FRAMES: Record<Kind, [number, number, number, number]> = {
  rat: [0, 1, 2, 3],
  crow: [4, 5, 6, 7],
  frog: [8, 9, 10, 11],
  cat: [14, 15, 16, 17],
  bat: [18, 18, 18, 19],
};

export class Ambience {
  private burners: Burner[] = [];
  private critters: Critter[] = [];
  private motes: Mote[] = [];
  private drops: Drop[] = [];
  private bubbles: Bubble[] = [];
  private bubbleTiles: { x: number; y: number; c: number }[] = [];
  private area: AmbientArea | null = null;
  private grid: TileGrid | null = null;
  private air: Phaser.GameObjects.Graphics;
  private mist: Phaser.GameObjects.Graphics;
  private floorFx: Phaser.GameObjects.Graphics;
  private t = 0;
  private dripAcc = 0;

  constructor(
    private scene: Phaser.Scene,
    private lib: SpriteLib,
  ) {
    this.air = scene.add.graphics().setDepth(DEPTH.overlay - 12);
    this.mist = scene.add.graphics().setDepth(DEPTH.shadow + 5);
    this.floorFx = scene.add.graphics().setDepth(DEPTH.floor + 2);
  }

  build(rooms: RoomData[], grid: TileGrid, areaId: string) {
    this.clear();
    this.grid = grid;
    this.area = DATA.ambience.areas[areaId] ?? null;
    // decor flames
    for (const r of rooms)
      for (const en of r.entities) {
        if (en.type !== 'decor') continue;
        const def = DATA.ambience.decor[String(en.kind)];
        if (!def) continue;
        const x = (r.origin[0] + en.at[0]) * TILE + TILE / 2;
        const y = (r.origin[1] + en.at[1]) * TILE + TILE;
        const flip = en.flip === true ? -1 : 1;
        const place = (p: readonly number[]) => ({ x: x + p[0] * flip, y: y + p[1] });
        const flames = def.at.map(place);
        const lights: Phaser.GameObjects.Image[] = [];
        if (def.glow && this.scene.textures.exists('light_glow'))
          for (const f of flames) {
            const img = this.scene.add
              .image(f.x, f.y, 'light_glow')
              .setBlendMode(Phaser.BlendModes.ADD)
              .setScale(def.glow)
              .setAlpha(0.8)
              .setDepth(DEPTH.actor(y) + 0.5);
            this.scene.tweens.add({ targets: img, alpha: 0.55, scale: def.glow * 0.94, duration: rnd(90, 170), yoyo: true, repeat: -1, delay: rnd(0, 200) });
            lights.push(img);
          }
        this.burners.push({
          def,
          x,
          y,
          flames,
          steam: (def.steamAt ?? def.at).map(place),
          g: this.scene.add.graphics().setDepth(DEPTH.actor(y) + 0.6),
          lights,
          puffs: [],
          acc: { smoke: Math.random(), embers: Math.random(), steam: Math.random() },
          tips: [],
          tipT: 0,
          moths: Array.from({ length: def.moths ?? 0 }, () => ({ a: rnd(1.3, 2.6), b: rnd(1.7, 3.1), ph: rnd(0, 6.28), r: rnd(5, 10) })),
        });
      }
    if (!this.area) return;
    // critters, room by room
    for (const r of rooms)
      for (const spec of this.area.critters) {
        if (spec.rooms && !spec.rooms.includes(r.id)) continue;
        const tiles: Pt[] = [];
        for (let ty = 0; ty < r.tiles.length; ty++)
          for (let tx = 0; tx < r.tiles[0].length; tx++) {
            const wx = r.origin[0] + tx;
            const wy = r.origin[1] + ty;
            if (grid.get(wx, wy) !== Cell.Floor || grid.isSolid(wx, wy)) continue;
            if (spec.on && !spec.on.includes(grid.variant(wx, wy))) continue;
            tiles.push({ x: wx, y: wy });
          }
        if (!tiles.length && spec.kind !== 'bat') continue;
        const n = Math.round(rnd(spec.perRoom[0], spec.perRoom[1] + 0.999) - 0.5);
        const room = { x0: r.origin[0] * TILE, y0: r.origin[1] * TILE, x1: (r.origin[0] + r.tiles[0].length) * TILE, y1: (r.origin[1] + r.tiles.length) * TILE };
        for (let i = 0; i < n; i++) this.critters.push(this.spawnCritter(spec.kind, tiles, room));
      }
    // floors that bubble
    const bubbles = new Set(this.area.bubbles);
    if (bubbles.size)
      for (let y = 0; y < grid.h; y++)
        for (let x = 0; x < grid.w; x++) {
          const wx = grid.ox + x;
          const wy = grid.oy + y;
          const v = grid.variant(wx, wy);
          if (grid.get(wx, wy) === Cell.Floor && bubbles.has(v)) this.bubbleTiles.push({ x: wx, y: wy, c: v === 'floor_wax' ? col('wax1') : col('stone3') });
        }
  }

  private spawnCritter(kind: Kind, tiles: Pt[], room: Critter['room']): Critter {
    const home = tiles.length ? pick(tiles) : { x: room.x0 / TILE, y: room.y0 / TILE };
    const sprite = this.lib.sprite('critters').setFrame(FRAMES[kind][0]);
    const c: Critter = {
      kind,
      sprite,
      tiles,
      ground: new Set(tiles.map(t => `${t.x},${t.y}`)),
      room,
      x: home.x * TILE + rnd(4, 12),
      y: home.y * TILE + rnd(10, 15),
      z: 0,
      tx: 0,
      ty: 0,
      state: kind === 'bat' ? 'wait' : 'idle',
      timer: rnd(500, 4000),
      t: Math.random() * 1000,
      alt: false,
      facing: Math.random() < 0.5 ? -1 : 1,
      vx: 0,
      vy: 0,
    };
    if (kind === 'bat') sprite.setVisible(false);
    return c;
  }

  /** Clear straight path for a small animal (no walls, no solid scenery). */
  private clearPath(x0: number, y0: number, x1: number, y1: number) {
    const g = this.grid!;
    const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 4);
    for (let i = 1; i <= n; i++) {
      const tx = Math.floor((x0 + ((x1 - x0) * i) / n) / TILE);
      const ty = Math.floor((y0 + ((y1 - y0) * i) / n - 2) / TILE);
      if (g.get(tx, ty) !== Cell.Floor || g.isSolid(tx, ty)) return false;
    }
    return true;
  }

  /** A spot to go: somewhere on its own ground within `reach` tiles, running away from `away` if given. */
  private target(c: Critter, reach: number, away?: Pt): Pt | null {
    const base = away ? Math.atan2(c.y - away.y, c.x - away.x) : 0;
    for (let k = 0; k < 16; k++) {
      const a = away ? base + rnd(-1.1, 1.1) : rnd(0, Math.PI * 2);
      const d = rnd(Math.min(1.2, reach * 0.5), reach) * TILE;
      const x = c.x + Math.cos(a) * d;
      const y = c.y + Math.sin(a) * d;
      if (!c.ground.has(`${Math.floor(x / TILE)},${Math.floor((y - 2) / TILE)}`)) continue;
      if (this.clearPath(c.x, c.y, x, y)) return { x, y };
    }
    return null;
  }

  update(deltaMs: number, player: Pt, view: Phaser.Geom.Rectangle, paused: boolean) {
    const dt = Math.min(deltaMs, 50) / 1000;
    this.t += deltaMs;
    const near = (x: number, y: number, m: number) => x > view.x - m && x < view.right + m && y > view.y - m && y < view.bottom + m;
    for (const b of this.burners) this.tickBurner(b, dt, near(b.x, b.y, 80));
    if (!this.area) return;
    if (!paused) for (const c of this.critters) if (near(c.x, c.y, 160) || c.kind === 'bat') this.tickCritter(c, dt, player);
    this.tickAir(dt, view);
    this.tickFloor(dt, view);
  }

  // ---------------------------------------------------------------- flames, smoke, sparks, steam, moths
  private tickBurner(b: Burner, dt: number, visible: boolean) {
    const g = b.g.clear();
    if (!visible) return;
    const d = b.def;
    const emit = (key: 'smoke' | 'embers' | 'steam', rate: number | undefined, make: () => Puff) => {
      if (!rate) return;
      b.acc[key] += rate * dt;
      while (b.acc[key] >= 1) {
        b.acc[key]--;
        b.puffs.push(make());
      }
    };
    emit('smoke', d.smoke, () => {
      const f = pick(b.flames);
      return { x: f.x + rnd(-1, 1), y: f.y - 2, vx: rnd(1, 5), vy: rnd(-16, -10), age: 0, life: rnd(2.2, 3.4), kind: 'smoke' };
    });
    emit('embers', d.embers, () => {
      const f = pick(b.flames);
      return { x: f.x + rnd(-3, 3), y: f.y, vx: rnd(-6, 6), vy: rnd(-38, -20), age: 0, life: rnd(0.6, 1.4), kind: 'ember' };
    });
    emit('steam', d.steam, () => {
      const f = pick(b.steam);
      return { x: f.x + rnd(-5, 5), y: f.y, vx: rnd(-2, 3), vy: rnd(-14, -8), age: 0, life: rnd(1.2, 2), kind: 'steam' };
    });
    b.puffs = b.puffs.filter(p => (p.age += dt) < p.life);
    for (const p of b.puffs) {
      const k = p.age / p.life;
      p.x += (p.vx + Math.sin(p.age * 3 + p.y) * (p.kind === 'ember' ? 10 : 3)) * dt;
      p.y += p.vy * dt;
      if (p.kind === 'smoke') {
        const s = k < 0.3 ? 1 : k < 0.7 ? 2 : 3;
        g.fillStyle(k < 0.4 ? col('stone3') : col('stone2'), 0.55 * (1 - k)).fillRect(Math.round(p.x), Math.round(p.y), s, s);
      } else if (p.kind === 'steam') {
        const s = k < 0.3 ? 2 : k < 0.7 ? 4 : 5;
        g.fillStyle(col('wax2'), 0.4 * (1 - k)).fillRect(Math.round(p.x - s / 2), Math.round(p.y - s / 2), s, s);
      } else {
        g.fillStyle(k < 0.5 ? col('flame2') : col('ember'), 1 - k * 0.6).fillRect(Math.round(p.x), Math.round(p.y), 1, 1);
      }
    }
    // dancing tips: a pixel or two above each flame, changing every ~0.1 s
    if (d.flicker) {
      b.tipT -= dt;
      if (b.tipT <= 0) {
        b.tipT = rnd(0.07, 0.15);
        b.tips = b.flames.map(() => {
          const r = Math.random();
          return { dx: r < 0.2 ? -1 : r > 0.8 ? 1 : 0, dy: r < 0.5 ? -1 : -2, c: Math.random() < 0.5 ? col('flame2') : col('flame1') };
        });
      }
      b.flames.forEach((f, i) => {
        const tip = b.tips[i];
        if (!tip) return;
        g.fillStyle(tip.c, 1).fillRect(Math.round(f.x + tip.dx), Math.round(f.y + tip.dy), 1, 1);
        if (tip.dy === -2) g.fillStyle(col('flame1'), 1).fillRect(Math.round(f.x + tip.dx), Math.round(f.y - 1), 1, 1);
      });
    }
    // moths round the first flame
    const f0 = b.flames[0];
    for (const m of b.moths) {
      const s = this.t / 1000;
      const x = f0.x + Math.sin(s * m.a + m.ph) * m.r + Math.sin(s * 7.1 + m.ph) * 1.5;
      const y = f0.y + Math.cos(s * m.b + m.ph) * m.r * 0.6 + Math.sin(s * 5.3) * 1.2;
      const flap = Math.floor(s * 18 + m.ph) % 2;
      g.fillStyle(col('wax1'), 0.9).fillRect(Math.round(x) - flap, Math.round(y), 1 + flap * 2, 1);
    }
  }

  // ---------------------------------------------------------------- critters
  private tickCritter(c: Critter, dt: number, player: Pt) {
    const cfg = CRITTER[c.kind];
    const fr = FRAMES[c.kind];
    c.t += dt * 1000;
    const dp = Math.hypot(player.x - c.x, player.y - c.y);
    const moveTo = (speed: number) => {
      const dx = c.tx - c.x;
      const dy = c.ty - c.y;
      const d = Math.hypot(dx, dy);
      if (Math.abs(dx) > 0.5) c.facing = dx < 0 ? -1 : 1;
      if (d <= speed * dt) {
        c.x = c.tx;
        c.y = c.ty;
        return true;
      }
      c.x += (dx / d) * speed * dt;
      c.y += (dy / d) * speed * dt;
      return false;
    };
    const scared = cfg.scare > 0 && dp < cfg.scare && (c.state === 'idle' || c.state === 'move');
    if (scared) {
      if (c.kind === 'crow') {
        c.state = 'fly';
        const a = Math.atan2(c.y - player.y, c.x - player.x) + rnd(-0.5, 0.5);
        c.vx = Math.cos(a) * cfg.flee;
        c.vy = Math.sin(a) * cfg.flee * 0.5;
        c.facing = c.vx < 0 ? -1 : 1;
        c.timer = 1.6;
      } else {
        const t = this.target(c, c.kind === 'cat' ? 3 : 6, player);
        if (t) {
          c.tx = t.x;
          c.ty = t.y;
          c.state = 'flee';
        } else if (c.kind !== 'cat') this.vanish(c);
      }
    }
    switch (c.state) {
      case 'idle': {
        c.timer -= dt * 1000;
        if (Math.floor(c.t / (c.kind === 'crow' ? 260 : 420)) % 5 === 0 !== c.alt) c.alt = !c.alt;
        c.sprite.setFrame(c.alt && Math.random() < 0.9 ? fr[1] : fr[0]);
        if (c.timer <= 0) {
          const t = this.target(c, c.kind === 'crow' ? 1.5 : 4);
          if (t) {
            c.tx = t.x;
            c.ty = t.y;
            c.state = 'move';
          }
          c.timer = rnd(1200, 4200);
        }
        break;
      }
      case 'move':
      case 'flee': {
        const speed = c.state === 'flee' ? cfg.flee : cfg.speed;
        c.sprite.setFrame(Math.floor(c.t / (c.state === 'flee' ? 70 : 120)) % 2 ? fr[3] : fr[2]);
        if (c.kind === 'frog' || c.kind === 'crow') c.z = Math.abs(Math.sin(c.t / 90)) * (c.kind === 'frog' ? 4 : 2); // hops
        if (moveTo(speed)) {
          c.z = 0;
          // a rat that has run off slips into a crack; a frog, sometimes, into the reeds
          if (c.state === 'flee' && (c.kind === 'rat' || (c.kind === 'frog' && Math.random() < 0.5))) this.vanish(c);
          else {
            c.state = 'idle';
            c.timer = rnd(800, 3000);
          }
        }
        break;
      }
      case 'fly': {
        c.x += c.vx * dt;
        c.y += c.vy * dt;
        c.z += 55 * dt;
        c.timer -= dt;
        c.sprite.setFrame(Math.floor(c.t / 80) % 2 ? fr[3] : fr[2]);
        c.sprite.setAlpha(Math.min(1, c.timer / 0.6));
        if (c.timer <= 0) this.vanish(c);
        break;
      }
      case 'land': {
        c.z = Math.max(0, c.z - 45 * dt);
        c.sprite.setFrame(Math.floor(c.t / 90) % 2 ? fr[3] : fr[2]);
        c.sprite.setAlpha(Math.min(1, c.sprite.alpha + dt * 2));
        if (c.z <= 0) {
          c.state = 'idle';
          c.timer = rnd(1000, 3000);
        }
        break;
      }
      case 'gone': {
        c.timer -= dt * 1000;
        if (c.timer > 0) break;
        // come back somewhere out of the player's way
        const t = c.tiles.length ? pick(c.tiles) : null;
        if (!t) break;
        const x = t.x * TILE + rnd(4, 12);
        const y = t.y * TILE + rnd(10, 15);
        if (Math.hypot(x - player.x, y - player.y) < 130) {
          c.timer = 600;
          break;
        }
        c.x = x;
        c.y = y;
        c.sprite.setVisible(true);
        if (c.kind === 'crow') {
          c.state = 'land';
          c.z = 50;
          c.sprite.setAlpha(0);
        } else {
          c.state = 'idle';
          c.z = 0;
          c.sprite.setAlpha(1);
          c.timer = rnd(800, 2000);
        }
        break;
      }
      case 'wait': {
        // bats: wait, then flit across the room from one side to the other
        c.timer -= dt * 1000;
        if (c.timer > 0) break;
        const fromLeft = Math.random() < 0.5;
        c.x = fromLeft ? c.room.x0 - 10 : c.room.x1 + 10;
        c.y = rnd(c.room.y0 + 20, c.room.y1 - 20);
        c.vx = (fromLeft ? 1 : -1) * rnd(60, 90);
        c.vy = rnd(-15, 15);
        c.facing = fromLeft ? 1 : -1;
        c.state = 'fly';
        c.timer = (c.room.x1 - c.room.x0 + 20) / Math.abs(c.vx);
        c.z = 30;
        c.sprite.setVisible(true).setAlpha(1);
        break;
      }
    }
    if (c.kind === 'bat' && c.state === 'fly') {
      c.y += Math.sin(c.t / 110) * 30 * dt;
      c.z = 30;
      if (c.timer <= 0.05) {
        c.state = 'wait';
        c.timer = rnd(5000, 14000);
        c.sprite.setVisible(false);
      }
    }
    c.sprite
      .setPosition(Math.round(c.x), Math.round(c.y - c.z))
      .setFlipX(c.facing < 0)
      .setDepth(c.kind === 'bat' || c.state === 'fly' ? DEPTH.overlay - 14 : DEPTH.actor(c.y));
  }

  private vanish(c: Critter) {
    c.state = 'gone';
    c.timer = rnd(6000, 15000);
    c.z = 0;
    c.sprite.setVisible(false).setAlpha(1);
    if (c.kind === 'frog') this.bubbles.push({ x: c.x, y: c.y - 2, t: 0.45, life: 0.6, c: col('stone4') }); // a ripple where it went in
  }

  // ---------------------------------------------------------------- air
  private seedMote(fx: string, view: Phaser.Geom.Rectangle, anywhere: boolean): Mote {
    const m: Mote = { fx, x: rnd(view.x, view.right), y: rnd(view.y, view.bottom), vx: 0, vy: 0, ph: rnd(0, 6.28), c: 0, s: 1 };
    switch (fx) {
      case 'ash':
        m.vx = rnd(4, 9);
        m.vy = rnd(7, 13);
        m.c = col(pick(['stone3', 'stone4', 'stone2']));
        break;
      case 'soot':
        m.vx = rnd(-2, 3);
        m.vy = rnd(5, 10);
        m.c = col(pick(['stone1', 'dark2', 'stone2']));
        break;
      case 'dust':
        m.vx = rnd(-3, 3);
        m.vy = rnd(-2, 2);
        m.c = col(pick(['wax1', 'wax2', 'stone4']));
        break;
      case 'fireflies':
        m.vx = rnd(-8, 8);
        m.vy = rnd(-6, 6);
        m.c = 0xc8e070;
        break;
      case 'mist':
        m.vx = rnd(3, 7);
        m.vy = rnd(-0.5, 0.5);
        m.s = rnd(34, 70);
        m.c = col('stone4');
        break;
      case 'leaves':
        m.vx = rnd(10, 18);
        m.vy = rnd(8, 14);
        m.c = col(pick(['wood2', 'ember', 'flame1']));
        break;
    }
    if (!anywhere) {
      // enter from the side the wind blows from
      if (Math.abs(m.vx) > Math.abs(m.vy)) m.x = m.vx > 0 ? view.x - m.s : view.right + m.s;
      else m.y = m.vy > 0 ? view.y - 4 : view.bottom + 4;
    }
    return m;
  }

  private tickAir(dt: number, view: Phaser.Geom.Rectangle) {
    const a = this.air.clear();
    const mist = this.mist.clear();
    const want = this.area!.air;
    for (const spec of want) {
      const have = this.motes.filter(m => m.fx === spec.fx).length;
      for (let i = have; i < spec.count; i++) this.motes.push(this.seedMote(spec.fx, view, true));
    }
    const s = this.t / 1000;
    this.motes = this.motes.map(m => {
      m.x += (m.vx + (m.fx === 'leaves' ? Math.sin(s * 3 + m.ph) * 14 : m.fx === 'ash' ? Math.sin(s * 1.5 + m.ph) * 4 : 0)) * dt;
      m.y += m.vy * dt;
      if (m.fx === 'fireflies' || m.fx === 'dust') {
        m.vx += rnd(-10, 10) * dt;
        m.vy += rnd(-10, 10) * dt;
        const lim = m.fx === 'dust' ? 4 : 10;
        m.vx = Phaser.Math.Clamp(m.vx, -lim, lim);
        m.vy = Phaser.Math.Clamp(m.vy, -lim, lim);
      }
      const out = m.x < view.x - m.s - 8 || m.x > view.right + m.s + 8 || m.y < view.y - 12 || m.y > view.bottom + 12;
      return out ? this.seedMote(m.fx, view, Math.abs(m.x - view.centerX) > view.width * 2 || Math.abs(m.y - view.centerY) > view.height * 2) : m;
    });
    for (const m of this.motes) {
      const x = Math.round(m.x);
      const y = Math.round(m.y);
      switch (m.fx) {
        case 'fireflies': {
          const on = Math.max(0, Math.sin(s * 1.7 + m.ph));
          if (on < 0.05) break;
          a.fillStyle(m.c, 0.12 * on).fillRect(x - 2, y - 1, 5, 3).fillRect(x - 1, y - 2, 3, 5);
          a.fillStyle(m.c, 0.3 * on).fillRect(x - 1, y - 1, 3, 3);
          a.fillStyle(0xf0ff9a, on).fillRect(x, y, 1, 1);
          break;
        }
        case 'mist':
          mist.fillStyle(m.c, 0.05 + 0.02 * Math.sin(s * 0.5 + m.ph)).fillEllipse(x, y, m.s, m.s * 0.28);
          mist.fillStyle(m.c, 0.035).fillEllipse(x + m.s * 0.2, y - 2, m.s * 0.6, m.s * 0.18);
          break;
        case 'dust':
          a.fillStyle(m.c, 0.25 + 0.3 * Math.max(0, Math.sin(s * 0.9 + m.ph))).fillRect(x, y, 1, 1);
          break;
        case 'leaves':
          a.fillStyle(m.c, 0.9).fillRect(x, y, Math.sin(s * 6 + m.ph) > 0 ? 2 : 1, 1);
          break;
        default:
          a.fillStyle(m.c, m.fx === 'ash' ? 0.6 : 0.7).fillRect(x, y, 1, 1);
      }
    }
  }

  // ---------------------------------------------------------------- bubbles and drips
  private tickFloor(dt: number, view: Phaser.Geom.Rectangle) {
    const g = this.floorFx.clear();
    const area = this.area!;
    // bubbles rise in the wax and grease
    const visible = this.bubbleTiles.filter(b => b.x * TILE > view.x - 16 && b.x * TILE < view.right && b.y * TILE > view.y - 16 && b.y * TILE < view.bottom);
    for (const b of visible)
      if (Math.random() < dt * 0.09) this.bubbles.push({ x: b.x * TILE + rnd(2, 14), y: b.y * TILE + rnd(3, 14), t: 0, life: rnd(0.8, 1.6), c: b.c });
    // drops from the dark above
    if (area.drips && this.grid) {
      this.dripAcc += area.drips * dt;
      while (this.dripAcc >= 1) {
        this.dripAcc--;
        const tx = Math.floor(rnd(view.x, view.right) / TILE);
        const ty = Math.floor(rnd(view.y, view.bottom) / TILE);
        if (this.grid.get(tx, ty) === Cell.Floor) this.drops.push({ x: tx * TILE + rnd(2, 14), y: ty * TILE + rnd(4, 14), z: rnd(60, 90), vz: 0, splash: 0 });
      }
    }
    this.bubbles = this.bubbles.filter(b => (b.t += dt) < b.life);
    for (const b of this.bubbles) {
      const k = b.t / b.life;
      const x = Math.round(b.x);
      const y = Math.round(b.y);
      if (k < 0.75) {
        const r = k < 0.35 ? 1 : 2;
        g.fillStyle(b.c, 0.7).fillRect(x - r + 1, y - r + 1, r, r);
        g.fillStyle(col('white'), 0.5).fillRect(x - r + 1, y - r + 1, 1, 1);
      } else {
        g.lineStyle(1, b.c, 0.6 * (1 - k) * 4).strokeEllipse(x, y, 7, 3); // pop
      }
    }
    this.drops = this.drops.filter(d => {
      if (d.z > 0) {
        d.vz -= 260 * dt;
        d.z = Math.max(0, d.z + d.vz * dt);
        this.air.fillStyle(col('wax2'), 0.85).fillRect(Math.round(d.x), Math.round(d.y - d.z), 1, 2);
        return true;
      }
      d.splash += dt;
      const k = d.splash / 0.35;
      g.fillStyle(col('wax1'), 0.8 * (1 - k))
        .fillRect(Math.round(d.x - 2 - k * 2), Math.round(d.y - 1 - k * 2), 1, 1)
        .fillRect(Math.round(d.x + 2 + k * 2), Math.round(d.y - 1 - k * 2), 1, 1);
      g.lineStyle(1, col('wax1'), 0.5 * (1 - k)).strokeEllipse(Math.round(d.x), Math.round(d.y), 4 + k * 4, 2 + k * 1.5);
      return k < 1;
    });
  }

  clear() {
    for (const b of this.burners) {
      b.g.destroy();
      b.lights.forEach(l => {
        this.scene.tweens.killTweensOf(l);
        l.destroy();
      });
    }
    this.burners = [];
    this.critters.forEach(c => c.sprite.destroy());
    this.critters = [];
    this.motes = [];
    this.drops = [];
    this.bubbles = [];
    this.bubbleTiles = [];
    this.air.clear();
    this.mist.clear();
    this.floorFx.clear();
  }
}
