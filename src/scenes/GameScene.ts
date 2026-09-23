// Owns the simulation (fixed 60 Hz ticks) and world rendering. HUD lives in UIScene on top.
import Phaser from 'phaser';
import { DATA, onDataReload } from '../data/config';
import { FixedLoop } from '../core/FixedLoop';
import { EventBus, type GameEvents } from '../core/EventBus';
import { mulberry32, type WorldCtx } from '../core/World';
import { Input } from '../input/Input';
import { SpriteLib } from '../anim/SpriteLib';
import { buildGrid, TILE, type TileGrid } from '../world/TileGrid';
import { WorldView } from '../world/WorldView';
import { Player } from '../player/Player';
import { PlayerView } from '../player/PlayerView';
import { Enemy } from '../enemies/Enemy';
import { EnemyView } from '../enemies/EnemyView';
import { AttackTokens } from '../enemies/AttackTokens';
import { CombatSystem } from '../combat/CombatSystem';
import { CameraRig } from '../render/CameraRig';
import { Fx } from '../render/Fx';
import { Particles } from '../render/Particles';
import { FloatingText } from '../render/FloatingText';
import { DEPTH } from '../render/depth';
import { Sfx } from '../audio/Sfx';
import { DebugOverlay } from '../debug/DebugOverlay';
import { installDebugKeys } from '../debug/DebugKeys';
import { hexToInt } from '../ui/colors';
import type { Actor } from '../actors/Actor';
import type { Dir8 } from '../core/math';

const DIR_ANGLE: Record<Dir8, number> = { E: 0, SE: 45, S: 90, SW: 135, W: 180, NW: 225, N: 270, NE: 315 };
/** The arc in slash.png spans this radius; slashes are scaled to the strike's hitbox radius. */
const SLASH_RADIUS = 22;

export class GameScene extends Phaser.Scene {
  loop!: FixedLoop;
  controls!: Input;
  bus = new EventBus<GameEvents>();
  lib!: SpriteLib;
  grid!: TileGrid;
  player!: Player;
  enemies: Enemy[] = [];
  combat = new CombatSystem();
  tokens = new AttackTokens();
  debug!: DebugOverlay;
  sfx = new Sfx();
  /** Sim ticks (frozen during hit-stop). */
  simTick = 0;
  tickCount = 0;
  hitstop = 0;
  /** Ticks since the player died (-1 = alive) and since respawn (-1 = not fading back). */
  deathT = -1;
  respawnT = -1;

  private ctxObj!: WorldCtx;
  private worldView!: WorldView;
  private playerView!: PlayerView;
  private enemyViews = new Map<Enemy, EnemyView>();
  private cam!: CameraRig;
  private fx!: Fx;
  private particles!: Particles;
  private numbers!: FloatingText;
  private bars!: Phaser.GameObjects.Graphics;
  private rng = mulberry32(1234);
  private roomsJson = '';

  constructor() {
    super('game');
  }

  get actors(): Actor[] {
    return [this.player, ...this.enemies];
  }

  create() {
    this.lib = new SpriteLib(this);
    this.controls = new Input(() => DATA.input);
    this.controls.attach(this.game.canvas);
    this.game.canvas.style.cursor = 'none';

    this.ctxObj = {
      input: this.controls,
      bus: this.bus,
      grid: () => this.grid,
      combat: this.combat,
      tokens: this.tokens,
      rng: this.rng,
      player: () => this.player,
      enemies: () => this.enemies,
    };

    this.worldView = new WorldView(this, this.lib);
    this.buildWorld();

    const spawn = this.findSpawn();
    this.player = new Player(this.ctxObj, spawn.x, spawn.y);
    this.playerView = new PlayerView(this, this.player, this.lib);
    this.spawnRoomEnemies();

    this.cam = new CameraRig();
    this.fx = new Fx(this, this.lib);
    this.particles = new Particles(this);
    this.numbers = new FloatingText(this);
    this.bars = this.add.graphics().setDepth(DEPTH.overlay - 3);
    this.debug = new DebugOverlay(this);
    this.wireEvents();

    this.loop = new FixedLoop(() => DATA.game.tickRate, () => DATA.game.maxStepsPerFrame, () => this.tick());

    const unlock = () => this.sfx.unlock();
    window.addEventListener('keydown', unlock);
    window.addEventListener('mousedown', unlock);
    const offReload = onDataReload(() => this.onDataReload());
    const offKeys = installDebugKeys(this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      offReload();
      offKeys();
      window.removeEventListener('keydown', unlock);
      window.removeEventListener('mousedown', unlock);
      this.controls.dispose();
    });

    this.scene.launch('ui');
  }

  // ------------------------------------------------------------------ simulation
  private tick() {
    this.tickCount++;
    this.controls.beginTick(this.simTick);
    this.cam.tickShake();
    this.tickDeath();
    if (this.hitstop > 0) {
      this.hitstop--;
      return;
    }
    this.simTick++;

    const lead = this.updateAim();
    this.player.tick();
    for (const e of this.enemies) e.tick();
    this.resolveBodies();
    this.combat.resolve(this.actors, this.bus);

    for (const e of this.enemies.filter(en => en.remove)) this.removeEnemy(e);
    this.cam.tick(lead.x, lead.y);
  }

  /** Soft circle separation so actors don't overlap. Immovable actors (resist 1) push others fully. */
  private resolveBodies() {
    const list = this.actors.filter(a => !a.dead);
    const k = DATA.combat.bodyPush;
    for (let i = 0; i < list.length; i++)
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const min = a.bodyRadius + b.bodyRadius;
        const d = Math.hypot(dx, dy);
        if (d >= min) continue;
        const wa = 1 - a.knockbackResist;
        const wb = 1 - b.knockbackResist;
        if (wa + wb === 0) continue;
        const nx = d > 0.001 ? dx / d : 1;
        const ny = d > 0.001 ? dy / d : 0;
        const push = (min - d) * k * 2;
        a.moveBy((-nx * push * wa) / (wa + wb), (-ny * push * wa) / (wa + wb));
        b.moveBy((nx * push * wb) / (wa + wb), (ny * push * wb) / (wa + wb));
      }
  }

  private tickDeath() {
    const d = DATA.death;
    if (this.player.dead) {
      this.deathT++;
      if (this.deathT >= d.overlayDelayTicks + d.fadeInTicks + d.holdTicks + d.fadeOutTicks) this.respawn();
    } else if (this.respawnT >= 0 && ++this.respawnT > d.fadeBackTicks) {
      this.respawnT = -1;
    }
  }

  /** M2: respawn at the room's spawn point; shrines replace this in M4. */
  respawn() {
    const s = this.findSpawn();
    this.deathT = -1;
    this.respawnT = 0;
    this.player.respawn(s.x, s.y);
    this.resetEnemies();
    this.particles.clear();
    this.numbers.clear();
    this.hitstop = 0;
  }

  // ------------------------------------------------------------------ enemies
  spawnEnemy(kind: string, x: number, y: number, facing = Math.PI / 2): Enemy | null {
    if (!DATA.enemies[kind]) return null;
    const e = new Enemy(this.ctxObj, kind, x, y, facing);
    this.enemies.push(e);
    this.enemyViews.set(e, new EnemyView(this, e, this.lib));
    return e;
  }

  private removeEnemy(e: Enemy) {
    this.enemyViews.get(e)?.destroy();
    this.enemyViews.delete(e);
    this.enemies = this.enemies.filter(x => x !== e);
    this.tokens.release(e);
  }

  resetEnemies() {
    for (const e of [...this.enemies]) this.removeEnemy(e);
    this.tokens.clear();
    this.combat.clear();
    this.spawnRoomEnemies();
  }

  private spawnRoomEnemies() {
    for (const r of this.areaRooms())
      for (const en of r.entities) {
        if (en.type !== 'enemy') continue;
        const facing = (DIR_ANGLE[(en.facing as Dir8) ?? 'S'] ?? 90) * (Math.PI / 180);
        this.spawnEnemy(String(en.kind), (r.origin[0] + en.at[0]) * TILE + TILE / 2, (r.origin[1] + en.at[1]) * TILE + TILE - 2, facing);
      }
  }

  // ------------------------------------------------------------------ presentation events
  private wireEvents() {
    const bus = this.bus;
    bus.on('dust', e => this.fx.spawn('dust', e.kind === 'roll' ? 'puff' : 'step', e.x, e.y));
    bus.on('shake', e => this.cam.addTrauma(e.trauma));
    bus.on('sfx', e => {
      let vol = e.volume ?? 1;
      if (e.x !== undefined && e.y !== undefined) {
        const d = Math.hypot(e.x - this.player.x, e.y - this.player.y);
        vol *= Math.max(0, 1 - d / DATA.audio.hearingDistance);
      }
      this.sfx.play(e.id, vol, (e.pitch ?? 1) * (0.96 + Math.random() * 0.08));
    });

    bus.on('hit', h => {
      const s = h.strike;
      const heavy = s.hitstop >= DATA.combat.heavyHitstop || h.staggered || h.killed;
      this.hitstop = Math.max(this.hitstop, s.hitstop + (h.killed ? 2 : 0));
      const trauma = s.shake * (h.target === this.player ? 1.4 : 1) + (h.staggered ? 0.1 : 0);
      if (trauma > 0) this.cam.addTrauma(trauma);
      const t = h.target;
      const z = -t.hurtbox.offsetY;
      const pc = DATA.juice.particles;
      this.particles.burst(t.x, t.y, z, h.angle, 1.4, pc.sparks, 110, 'flame2', false);
      this.particles.burst(t.x, t.y, z, h.angle, 1.0, h.killed ? pc.bloodOnKill : pc.blood, 90, t.bloodColor, true);
      this.bus.emit('sfx', { id: heavy ? 'hit_heavy' : 'hit', x: t.x, y: t.y });

      const isDummy = t instanceof Enemy && t.def.ai === 'dummy';
      const mode = DATA.juice.damageNumbers;
      if (mode === 'all' || (mode === 'dummy' && isDummy)) {
        const pal = DATA.palette;
        this.numbers.add(String(h.damage), t.x, t.y - t.hurtbox.h - 12, hexToInt(h.staggered ? pal.flame2 : pal.wax2));
        if (h.staggered) this.numbers.add('BREAK', t.x, t.y - t.hurtbox.h - 20, hexToInt(pal.ember));
      }
    });

    bus.on('swing', e => {
      const s = e.strike;
      const thrust = s.sweep.fromDeg === s.sweep.toDeg;
      const dir = Math.sign(s.sweep.toDeg - s.sweep.fromDeg) || 1;
      const scale = (s.hitbox.radius + (s.hitbox.shape === 'circle' ? s.hitbox.offset : 0)) / SLASH_RADIUS;
      this.fx.spawn('slash', thrust ? 'thrust' : 'swing', e.actor.x, e.actor.y + s.originY, {
        rotation: e.angle,
        scaleX: scale,
        scaleY: scale * e.mirror * dir,
        depth: DEPTH.actor(e.actor.y) + 0.3,
      });
      this.bus.emit('sfx', { id: s.sfx, x: e.actor.x, y: e.actor.y });
    });

    bus.on('telegraph', e => {
      const tip = this.weaponTip(e.actor);
      this.fx.spawn('glint', e.kind, tip.x, tip.y, { depth: DEPTH.overlay - 5 });
      this.bus.emit('sfx', { id: e.kind === 'danger' ? 'telegraph_danger' : 'telegraph', x: e.actor.x, y: e.actor.y });
    });

    bus.on('chargeFull', e => {
      const tip = this.weaponTip(e.actor);
      this.fx.spawn('glint', 'normal', tip.x, tip.y, { depth: DEPTH.overlay - 5 });
      this.bus.emit('sfx', { id: 'charge_full' });
    });

    bus.on('died', e => {
      if (e.actor !== this.player) return;
      this.deathT = 0;
      this.cam.addTrauma(0.4);
    });
  }

  private weaponTip(a: Actor): { x: number; y: number } {
    const w = a === this.player ? this.playerView.weapon : this.enemyViews.get(a as Enemy)?.weapon;
    return w ? { x: w.tipX, y: w.tipY } : { x: a.x, y: a.chestY };
  }

  // ------------------------------------------------------------------ rendering
  update(_time: number, delta: number) {
    let alpha = this.loop.frame(delta);
    if (this.hitstop > 0) alpha = 1; // hold still during hit-stop instead of interpolating
    const fxDelta = delta * (this.loop.frozen ? 0 : this.loop.timeScale);
    this.fx.update(fxDelta);
    this.particles.update(fxDelta);
    this.numbers.update(fxDelta);

    const feet = this.playerView.render(alpha);
    for (const v of this.enemyViews.values()) v.render(alpha);
    this.cam.apply(this.cameras.main, feet.x, feet.y, alpha);
    this.drawEnemyBars();
    this.debug.draw(this, feet.x, feet.y);
  }

  private drawEnemyBars() {
    const g = this.bars;
    const pal = DATA.palette;
    g.clear();
    for (const v of this.enemyViews.values()) {
      const e = v.e;
      if (e.dead || e.barTicks <= 0 || e.def.ai === 'dummy') continue;
      const w = 16;
      const x = v.x - w / 2;
      const y = v.y - e.def.hurtbox.h - 9;
      g.fillStyle(hexToInt(pal.ink), 1).fillRect(x - 1, y - 1, w + 2, 4);
      g.fillStyle(hexToInt(pal.dark2), 1).fillRect(x, y, w, 2);
      g.fillStyle(hexToInt(pal.blood2), 1).fillRect(x, y, Math.max(1, Math.round((w * e.hp) / e.maxHp)), 2);
    }
  }

  /** Feed aim into the player; returns the camera lead target offset. */
  private updateAim(): { x: number; y: number } {
    const p = this.player;
    const inp = this.controls;
    const cam = this.cameras.main;
    const cc = DATA.camera;
    if (inp.device === 'kbm') {
      const ptr = this.input.activePointer;
      p.setAim(ptr.x + cam.scrollX, ptr.y + cam.scrollY);
      let lx = (ptr.x - DATA.game.width / 2) * cc.aimLeadFactor;
      let ly = (ptr.y - DATA.game.height / 2) * cc.aimLeadFactor;
      const len = Math.hypot(lx, ly);
      if (len > cc.aimLeadMax) {
        lx *= cc.aimLeadMax / len;
        ly *= cc.aimLeadMax / len;
      }
      return { x: lx, y: ly };
    }
    let dx: number;
    let dy: number;
    if (inp.aimStickActive) [dx, dy] = [inp.aimStickX, inp.aimStickY];
    else if (DATA.input.padAimFollowsMove && (inp.moveX !== 0 || inp.moveY !== 0)) [dx, dy] = [inp.moveX, inp.moveY];
    else [dx, dy] = [Math.cos(p.aimAngle), Math.sin(p.aimAngle)];
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;
    const d = DATA.input.padAimDistance;
    p.setAim(p.x + dx * d, p.y + DATA.player.aimOriginY + dy * d);
    return { x: dx * cc.padLeadDistance, y: dy * cc.padLeadDistance };
  }

  // ------------------------------------------------------------------ world
  private areaRooms() {
    const start = DATA.rooms[DATA.game.startRoom];
    return Object.values(DATA.rooms).filter(r => r.area === start.area);
  }

  private buildWorld() {
    const rooms = this.areaRooms();
    this.roomsJson = JSON.stringify(rooms);
    this.grid = buildGrid(rooms);
    this.worldView.build(this.grid);
  }

  private findSpawn() {
    const room = DATA.rooms[DATA.game.startRoom];
    const e = room.entities.find(en => en.type === 'spawn') ?? { at: [1, 1] as [number, number] };
    return { x: (room.origin[0] + e.at[0]) * TILE + TILE / 2, y: (room.origin[1] + e.at[1]) * TILE + TILE - 2 };
  }

  private onDataReload() {
    if (JSON.stringify(this.areaRooms()) !== this.roomsJson) {
      this.buildWorld();
      this.resetEnemies();
    }
  }
}
