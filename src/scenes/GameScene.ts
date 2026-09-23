// Owns the simulation (fixed 60 Hz ticks) and world rendering. HUD and menus live in UIScene on top.
import Phaser from 'phaser';
import { DATA, onDataReload } from '../data/config';
import { FixedLoop } from '../core/FixedLoop';
import { EventBus, type GameEvents } from '../core/EventBus';
import { mulberry32, type WorldCtx } from '../core/World';
import { INPUT } from '../input/instance';
import type { Input } from '../input/Input';
import { SpriteLib } from '../anim/SpriteLib';
import { buildGrid, TILE, type TileGrid } from '../world/TileGrid';
import { WorldView } from '../world/WorldView';
import { Racks } from '../world/Racks';
import { GroundItems } from '../world/GroundItems';
import { SHRINE_RADIUS, Shrines, type Shrine } from '../world/Shrines';
import { Pickups } from '../world/Pickups';
import { DeathMarker } from '../world/DeathMarker';
import { FISTS, Player } from '../player/Player';
import { PlayerView } from '../player/PlayerView';
import { Enemy } from '../enemies/Enemy';
import { EnemyView } from '../enemies/EnemyView';
import { AttackTokens } from '../enemies/AttackTokens';
import { CombatSystem } from '../combat/CombatSystem';
import { PROJECTILE_HEIGHT, Projectiles } from '../combat/Projectiles';
import { CameraRig } from '../render/CameraRig';
import { Fx } from '../render/Fx';
import { Particles } from '../render/Particles';
import { FloatingText } from '../render/FloatingText';
import { ProjectileView } from '../render/ProjectileView';
import { DEPTH } from '../render/depth';
import { Sfx } from '../audio/Sfx';
import { SaveSystem, type SaveData } from '../save/SaveSystem';
import { firstEnabled, MenuNav, type Menu } from '../ui/Menu';
import { DebugOverlay } from '../debug/DebugOverlay';
import { installDebugKeys } from '../debug/DebugKeys';
import { hexToInt } from '../ui/colors';
import type { Actor } from '../actors/Actor';
import type { Dir8 } from '../core/math';
import type { RoomData } from '../data/schemas';

const DIR_ANGLE: Record<Dir8, number> = { E: 0, SE: 45, S: 90, SW: 135, W: 180, NW: 225, N: 270, NE: 315 };
/** The arc in slash.png spans this radius; slashes are scaled to the strike's hitbox radius. */
const SLASH_RADIUS = 22;
/** Only these player states may interact with objects. */
const CAN_INTERACT = new Set(['idle', 'move', 'sprint']);

export interface GameStartData {
  /** continue = load the save (falls back to new); new = wipe the save and start fresh. */
  mode?: 'continue' | 'new';
}

export class GameScene extends Phaser.Scene {
  loop!: FixedLoop;
  controls!: Input;
  bus = new EventBus<GameEvents>();
  lib!: SpriteLib;
  grid!: TileGrid;
  player!: Player;
  enemies: Enemy[] = [];
  combat = new CombatSystem();
  projectiles = new Projectiles();
  tokens = new AttackTokens();
  racks!: Racks;
  ground!: GroundItems;
  shrines!: Shrines;
  pickups!: Pickups;
  marker!: DeathMarker;
  debug!: DebugOverlay;
  sfx = new Sfx();
  saves = new SaveSystem();
  /** Persistent world state: "shrine:<id>" lit, "item:<id>" taken (later: doors, shortcuts, bosses). */
  flags = new Set<string>();
  lastShrine: string | null = null;
  /** Open menu (freezes the simulation). */
  menu: Menu | null = null;
  /** Item/event banner for the UI. */
  toast: { title: string; body: string; t: number } | null = null;
  /** Sim ticks (frozen during hit-stop and menus). */
  simTick = 0;
  tickCount = 0;
  hitstop = 0;
  /** Ticks since the player died (-1 = alive) and since respawn (-1 = not fading back). */
  deathT = -1;
  respawnT = -1;

  private ctxObj!: WorldCtx;
  private rooms: RoomData[] = [];
  private worldView!: WorldView;
  private playerView!: PlayerView;
  private enemyViews = new Map<Enemy, EnemyView>();
  private projectileView!: ProjectileView;
  private cam!: CameraRig;
  private fx!: Fx;
  private particles!: Particles;
  private numbers!: FloatingText;
  private bars!: Phaser.GameObjects.Graphics;
  private rng = mulberry32(1234);
  private roomsJson = '';
  private menuNav = new MenuNav();
  /** Kneeling at a shrine: kindle (first visit) or rest, then the shrine menu opens. */
  private shrineSeq: { shrine: Shrine; t: number; kindle: boolean } | null = null;
  private dirty = false;

  constructor() {
    super('game');
  }

  get actors(): Actor[] {
    return [this.player, ...this.enemies];
  }

  create(data: GameStartData = {}) {
    this.lib = new SpriteLib(this);
    this.controls = INPUT;
    this.controls.attach(this.game.canvas);
    this.game.canvas.style.cursor = 'none';

    this.ctxObj = {
      input: this.controls,
      bus: this.bus,
      grid: () => this.grid,
      combat: this.combat,
      projectiles: this.projectiles,
      tokens: this.tokens,
      rng: this.rng,
      player: () => this.player,
      enemies: () => this.enemies,
      roomAt: (x, y) => this.roomAt(x, y),
    };

    // Load or start fresh.
    let save: SaveData | null = null;
    if (data.mode === 'new') this.saves.clear();
    else {
      const r = this.saves.load();
      if (r.ok) save = r.save;
      else if (r.reason === 'corrupt') this.showToast('SAVE UNREADABLE', 'A backup was kept; starting a new game.');
    }
    this.flags = new Set(save?.world.flags ?? []);
    this.lastShrine = save?.lastShrine ?? null;

    this.worldView = new WorldView(this, this.lib);
    this.racks = new Racks(this.lib);
    this.ground = new GroundItems(this.lib);
    this.shrines = new Shrines(this.lib);
    this.pickups = new Pickups(this.lib);
    this.marker = new DeathMarker(this.lib);
    this.buildWorld();

    const spawn = this.respawnPoint();
    this.player = new Player(this.ctxObj, spawn.x, spawn.y);
    if (save) this.applySave(save);
    this.playerView = new PlayerView(this, this.player, this.lib);
    this.spawnRoomEnemies();

    this.cam = new CameraRig();
    this.fx = new Fx(this, this.lib);
    this.particles = new Particles(this);
    this.numbers = new FloatingText(this);
    this.projectileView = new ProjectileView(this, this.lib);
    this.bars = this.add.graphics().setDepth(DEPTH.overlay - 3);
    this.debug = new DebugOverlay(this);
    this.wireEvents();

    this.loop = new FixedLoop(() => DATA.game.tickRate, () => DATA.game.maxStepsPerFrame, () => this.tick());
    this.respawnT = 0; // fade in

    const unlock = () => this.sfx.unlock();
    const saveOnExit = () => this.save();
    window.addEventListener('keydown', unlock);
    window.addEventListener('mousedown', unlock);
    window.addEventListener('beforeunload', saveOnExit);
    const offReload = onDataReload(() => this.onDataReload());
    const offKeys = installDebugKeys(this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      offReload();
      offKeys();
      window.removeEventListener('keydown', unlock);
      window.removeEventListener('mousedown', unlock);
      window.removeEventListener('beforeunload', saveOnExit);
    });

    this.scene.launch('ui');
  }

  // ------------------------------------------------------------------ simulation
  private tick() {
    this.tickCount++;
    this.controls.beginTick(this.simTick);
    this.tickDeath(); // fades keep running under menus
    if (this.menu) {
      this.tickMenu();
      return;
    }
    this.cam.tickShake();
    if (this.toast && ++this.toast.t > 240) this.toast = null;
    if (this.hitstop > 0) {
      this.hitstop--;
      return;
    }
    this.simTick++;

    const lead = this.updateAim();
    this.handleInteract();
    this.player.tick();
    for (const e of this.enemies) e.tick();
    this.resolveBodies();
    this.combat.resolve(this.actors, this.bus);
    this.projectiles.tick(this.actors, this.grid, this.combat, this.bus);
    this.tickShrineSeq();

    if (!this.player.dead) {
      const got = this.marker.tryRecover(this.player.x, this.player.y);
      if (got) {
        this.player.tallow += got;
        this.numbers.add(`+${got}`, this.player.x, this.player.y - 34, hexToInt(DATA.palette.flame2));
        this.showToast('TALLOW RECOVERED', `${got} tallow reclaimed from the guttered candle.`);
        this.bus.emit('sfx', { id: 'tallow_recover' });
        this.save();
      }
    }

    for (const e of this.enemies.filter(en => en.remove)) this.removeEnemy(e);
    this.cam.tick(lead.x, lead.y);
    if (this.dirty && this.simTick % DATA.shrine.autosaveTicks === 0) this.save();
  }

  private tickMenu() {
    const r = this.menuNav.update(this.menu!, this.controls);
    if (r === 'moved') this.bus.emit('sfx', { id: 'menu_move' });
    if (r === 'confirmed') this.bus.emit('sfx', { id: 'menu_confirm' });
  }

  closeMenu() {
    this.menu = null;
    this.controls.clearBuffer();
  }

  // ------------------------------------------------------------------ interaction
  /** The closest thing the player can interact with right now. */
  nearestInteractable(): { label: string; use: () => void } | null {
    const p = this.player;
    if (!CAN_INTERACT.has(p.stateName) || this.shrineSeq) return null;
    const item = this.ground.nearest(p.x, p.y);
    if (item)
      return {
        label: `PICK UP ${DATA.weapons[item.weapon].name}`,
        use: () => {
          this.ground.remove(item);
          const released = p.equip(item.weapon);
          if (released) this.ground.add(released, p.x, p.y + 2); // hands full: swap with the one on the floor
          this.announce(DATA.weapons[item.weapon].name);
          this.dirty = true;
        },
      };
    const pick = this.pickups.nearest(p.x, p.y);
    if (pick)
      return {
        label: `PICK UP ${DATA.items[pick.item].name}`,
        use: () => this.takePickup(pick.id, pick.item),
      };
    const shrine = this.shrines.nearest(p.x, p.y);
    if (shrine)
      return {
        label: shrine.lit ? `REST AT ${shrine.name}` : `KINDLE ${shrine.name}`,
        use: () => this.beginShrine(shrine),
      };
    const rack = this.racks.nearest(p.x, p.y);
    if (!rack) return null;
    if (rack.kind === 'weapon' && rack.id) {
      const id = rack.id;
      return {
        label: `TAKE ${DATA.weapons[id].name}`,
        use: () => {
          p.equip(id); // racks never run out; the replaced weapon goes back on the rack
          this.announce(DATA.weapons[id].name);
          this.dirty = true;
        },
      };
    }
    const id = rack.id;
    return {
      label: id ? `TAKE ${DATA.shields[id].name}` : 'REMOVE SHIELD',
      use: () => {
        p.shieldId = id;
        this.announce(id ? DATA.shields[id].name : 'no shield');
        this.dirty = true;
      },
    };
  }

  private handleInteract() {
    const target = this.nearestInteractable();
    if (!target || !this.controls.consume('interact')) return;
    target.use();
    this.bus.emit('sfx', { id: 'pickup' });
  }

  private takePickup(id: string, itemId: string) {
    const p = this.player;
    const item = DATA.items[itemId];
    const pick = this.pickups.list.find(i => i.id === id);
    if (pick) this.pickups.remove(pick);
    this.flags.add(`item:${id}`);
    const e = item.effect;
    switch (e.type) {
      case 'phialMax':
        p.phials.max = Math.min(DATA.phial.maxCharges, p.phials.max + e.amount);
        p.phials.charges = Math.min(p.phials.max, p.phials.charges + e.amount);
        break;
      case 'phialLevel':
        p.phials.level = Math.min(DATA.phial.maxLevel, p.phials.level + e.amount);
        break;
      case 'ammo':
        for (const wid of new Set(p.slots)) {
          const r = DATA.weapons[wid]?.ranged;
          if (!r) continue;
          const a = p.ammoFor(wid);
          a.reserve = Math.min(r.reserveMax, a.reserve + Math.ceil(r.reserveMax * e.amount));
        }
        break;
      case 'tallow':
        p.tallow += e.amount;
        break;
    }
    this.showToast(item.name.toUpperCase(), item.description);
    this.bus.emit('sfx', { id: 'item' });
    this.save();
  }

  showToast(title: string, body: string) {
    this.toast = { title, body, t: 0 };
  }

  private announce(text: string) {
    this.numbers.add(text.toUpperCase(), this.player.x, this.player.y - 34, hexToInt(DATA.palette.wax2));
  }

  // ------------------------------------------------------------------ shrines, rest, death
  private beginShrine(s: Shrine) {
    const p = this.player;
    const sp = this.shrines.spawnPoint(s);
    p.moveBy(sp.x - p.x, sp.y - p.y);
    p.aimAngle = -Math.PI / 2;
    p.sm.change('rest');
    this.shrineSeq = { shrine: s, t: 0, kindle: !s.lit };
    this.bus.emit('sfx', { id: s.lit ? 'rest' : 'shrine_kindle' });
  }

  private tickShrineSeq() {
    const q = this.shrineSeq;
    if (!q) return;
    q.t++;
    const c = DATA.shrine;
    if (q.kindle && q.t === Math.floor(c.kindleTicks / 2)) {
      this.shrines.light(q.shrine);
      this.flags.add(`shrine:${q.shrine.id}`);
      this.particles.burst(q.shrine.x, q.shrine.y, 30, -Math.PI / 2, 3, 16, 60, 'flame2', false);
      this.showToast('WICK KINDLED', `${q.shrine.name}. Rest here to mend and to be returned here when you fall.`);
    }
    if (q.t >= (q.kindle ? c.kindleTicks : c.kneelTicks)) {
      this.shrineSeq = null;
      this.rest(q.shrine);
    }
  }

  /** Rest: restore everything, respawn enemies, save, open the shrine menu. */
  private rest(s: Shrine) {
    this.lastShrine = s.id;
    this.restoreWorld();
    this.save();
    this.particles.burst(this.player.x, this.player.y, 12, -Math.PI / 2, 2.5, 12, 40, 'wax2', false);
    const items = [
      { label: 'LEVEL UP', enabled: false, note: 'M7', action: () => {} },
      { label: 'TRAVEL', enabled: false, note: 'later', action: () => {} },
      { label: 'LEAVE', enabled: true, action: () => this.leaveShrine() },
    ];
    this.menu = { title: s.name.toUpperCase(), subtitle: 'Rested. Progress saved.', items, index: firstEnabled(items), onBack: () => this.leaveShrine() };
  }

  private leaveShrine() {
    this.closeMenu();
    this.player.sm.change('idle');
  }

  /** Shared by rest and respawn: full restore and a fresh set of (non-boss) enemies. */
  private restoreWorld() {
    this.player.refill();
    this.player.poise.reset();
    this.resetEnemies();
    this.projectiles.clear();
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

  /** Back at the last shrine (or the start), world reset. */
  respawn() {
    const s = this.respawnPoint();
    this.deathT = -1;
    this.respawnT = 0;
    this.shrineSeq = null;
    this.player.respawn(s.x, s.y);
    this.restoreWorld();
    this.particles.clear();
    this.numbers.clear();
    this.hitstop = 0;
    this.save();
  }

  private respawnPoint() {
    const shrine = this.shrines.get(this.lastShrine);
    return shrine ? this.shrines.spawnPoint(shrine) : this.findSpawn();
  }

  // ------------------------------------------------------------------ save / load
  snapshot(): SaveData {
    const p = this.player;
    const m = this.marker.data;
    return {
      version: 1,
      savedAt: Date.now(),
      lastShrine: this.lastShrine,
      tallow: p.tallow,
      phials: { ...p.phials },
      stats: { level: 1 },
      loadout: { slots: [...p.slots], slot: p.slot, shield: p.shieldId },
      ammo: Object.fromEntries(p.ammo),
      world: {
        flags: [...this.flags],
        groundItems: this.ground.list.map(i => ({ weapon: i.weapon, x: i.x, y: i.y })),
      },
      deathMarker: m ? { x: m.x, y: m.y, tallow: m.tallow } : null,
    };
  }

  save() {
    this.saves.write(this.snapshot());
    this.dirty = false;
  }

  private applySave(s: SaveData) {
    const p = this.player;
    const known = (id: string) => (DATA.weapons[id] ? id : FISTS); // data may have changed since saving
    p.tallow = s.tallow;
    p.phials = { ...s.phials };
    p.slots = [known(s.loadout.slots[0]), known(s.loadout.slots[1])];
    p.slot = s.loadout.slot;
    p.shieldId = s.loadout.shield && DATA.shields[s.loadout.shield] ? s.loadout.shield : null;
    p.enforceTwoHanded();
    for (const [id, a] of Object.entries(s.ammo)) p.ammo.set(id, { ...a });
    for (const g of s.world.groundItems) if (DATA.weapons[g.weapon]) this.ground.add(g.weapon, g.x, g.y);
    this.marker.set(s.deathMarker);
  }

  // ------------------------------------------------------------------ bodies
  /** Soft circle separation so actors don't overlap; shrines are immovable obstacles. */
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
    for (const s of this.shrines.list)
      for (const a of list) {
        const dx = a.x - s.x;
        const dy = a.y - s.y;
        const min = a.bodyRadius + SHRINE_RADIUS;
        const d = Math.hypot(dx, dy);
        if (d >= min || d < 0.001) continue;
        a.moveBy((dx / d) * (min - d), (dy / d) * (min - d));
      }
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
    for (const r of this.rooms)
      for (const en of r.entities) {
        if (en.type !== 'enemy') continue;
        const facing = (DIR_ANGLE[(en.facing as Dir8) ?? 'S'] ?? 90) * (Math.PI / 180);
        this.spawnEnemy(String(en.kind), (r.origin[0] + en.at[0]) * TILE + TILE / 2, (r.origin[1] + en.at[1]) * TILE + TILE - 2, facing);
      }
  }

  // ------------------------------------------------------------------ presentation events
  private wireEvents() {
    const bus = this.bus;
    const pal = () => DATA.palette;
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
      const s = h.source;
      const t = h.target;
      const z = -t.hurtbox.offsetY;
      const pc = DATA.juice.particles;
      if (h.blocked) {
        this.hitstop = Math.max(this.hitstop, h.guardBroken ? 8 : 3);
        this.cam.addTrauma(h.guardBroken ? 0.35 : 0.12);
        this.particles.burst(t.x, t.y, z, h.angle + Math.PI, 1.6, pc.sparks * 2, 130, 'flame2', false);
        this.bus.emit('sfx', { id: h.guardBroken ? 'guard_break' : 'block', x: t.x, y: t.y });
        return;
      }
      const heavy = s.hitstop >= DATA.combat.heavyHitstop || h.staggered || h.killed || s.kind === 'critical';
      this.hitstop = Math.max(this.hitstop, s.hitstop + (h.killed ? 2 : 0));
      const trauma = s.shake * (t === this.player ? 1.4 : 1) + (h.staggered ? 0.1 : 0);
      if (trauma > 0) this.cam.addTrauma(trauma);
      this.particles.burst(t.x, t.y, z, h.angle, 1.4, pc.sparks, 110, 'flame2', false);
      const blood = h.killed || s.kind === 'critical' ? pc.bloodOnKill : pc.blood;
      this.particles.burst(t.x, t.y, z, h.angle, 1.0, blood, 90, t.bloodColor, true);
      this.bus.emit('sfx', { id: heavy ? 'hit_heavy' : 'hit', x: t.x, y: t.y });

      const training = t instanceof Enemy && t.def.immortal;
      const mode = DATA.juice.damageNumbers;
      if (mode === 'all' || (mode === 'dummy' && training)) {
        this.numbers.add(String(h.damage), t.x, t.y - t.hurtbox.h - 12, hexToInt(h.staggered || s.kind === 'critical' ? pal().flame2 : pal().wax2));
        if (h.staggered) this.numbers.add('BREAK', t.x, t.y - t.hurtbox.h - 20, hexToInt(pal().ember));
      }
    });

    bus.on('parry', e => {
      this.hitstop = Math.max(this.hitstop, DATA.combat.parryHitstop);
      this.cam.addTrauma(0.25);
      const mx = (e.parrier.x + e.attacker.x) / 2;
      const my = (e.parrier.y + e.attacker.y) / 2;
      this.particles.burst(mx, my, 12, Math.atan2(e.attacker.y - e.parrier.y, e.attacker.x - e.parrier.x), 2.4, 14, 150, 'wax2', false);
      this.fx.spawn('glint', 'normal', mx, my - 12, { depth: DEPTH.overlay - 5 });
      this.bus.emit('sfx', { id: 'parry' });
      this.numbers.add('PARRY', e.parrier.x, e.parrier.y - 34, hexToInt(pal().wax2));
    });

    bus.on('critical', e => {
      this.bus.emit('sfx', { id: 'critical' });
      this.numbers.add(e.kind === 'riposte' ? 'RIPOSTE' : 'BACKSTAB', e.victim.x, e.victim.y - e.victim.hurtbox.h - 22, hexToInt(pal().ember));
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

    bus.on('shot', e => {
      const r = e.weapon.ranged!;
      const tip = this.weaponTip(e.actor);
      if (r.muzzle !== 'none') this.fx.spawn('muzzle', r.muzzle, tip.x, tip.y, { rotation: e.angle, depth: DEPTH.overlay - 6 });
      if (r.casing) {
        const side = e.angle + (Math.cos(e.angle) < 0 ? 1 : -1) * (Math.PI / 2 + 0.4);
        this.particles.burst(e.actor.x, e.actor.y, 12, side, 0.5, 1, 60, 'flame1', true);
      }
      this.particles.burst(tip.x, tip.y + PROJECTILE_HEIGHT, PROJECTILE_HEIGHT, e.angle, 0.8, 3, 60, 'stone4', false);
    });

    bus.on('projectileEnd', e => {
      if (!e.wall) return;
      this.particles.burst(e.x, e.y + PROJECTILE_HEIGHT, PROJECTILE_HEIGHT, e.angle + Math.PI, 1.8, 4, 80, 'flame2', false);
      this.bus.emit('sfx', { id: 'bullet_wall', x: e.x, y: e.y });
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

    bus.on('weaponDropped', e => {
      this.ground.add(e.id, e.x, e.y + 2);
      this.bus.emit('sfx', { id: 'swap' });
      this.dirty = true;
    });

    bus.on('healed', e => {
      this.particles.burst(e.actor.x, e.actor.y, 6, -Math.PI / 2, 2.2, 14, 45, 'flame2', false);
      this.particles.burst(e.actor.x, e.actor.y, 14, -Math.PI / 2, 2.2, 8, 35, 'wax2', false);
      this.bus.emit('sfx', { id: 'heal' });
    });

    bus.on('healFailed', e => {
      this.particles.burst(e.actor.x, e.actor.y, 14, -Math.PI / 2, 3, 8, 70, 'steel2', false);
      this.bus.emit('sfx', { id: 'heal_fail' });
      this.numbers.add('WASTED', e.actor.x, e.actor.y - 34, hexToInt(pal().ember));
    });

    bus.on('died', e => {
      if (e.actor instanceof Enemy) {
        const gain = e.actor.def.tallow;
        if (gain > 0) {
          this.player.tallow += gain;
          this.numbers.add(`+${gain}`, e.actor.x, e.actor.y - 20, hexToInt(pal().flame2));
          this.bus.emit('sfx', { id: 'tallow' });
          this.dirty = true;
        }
        return;
      }
      if (e.actor !== this.player) return;
      this.deathT = 0;
      this.cam.addTrauma(0.4);
      // All carried Tallow stays behind as a Guttered Candle; any older candle is lost for good.
      const p = this.player;
      this.marker.set(p.tallow > 0 ? { x: p.x, y: p.y, tallow: p.tallow } : null);
      p.tallow = 0;
      this.save();
    });
  }

  private weaponTip(a: Actor): { x: number; y: number } {
    const w = a === this.player ? this.playerView.weapon : this.enemyViews.get(a as Enemy)?.weapon;
    return w ? { x: w.tipX, y: w.tipY } : { x: a.x, y: a.chestY };
  }

  // ------------------------------------------------------------------ rendering
  update(_time: number, delta: number) {
    let alpha = this.loop.frame(delta);
    if (this.hitstop > 0 || this.menu) alpha = 1; // hold still instead of interpolating
    const fxDelta = delta * (this.loop.frozen ? 0 : this.loop.timeScale);
    this.fx.update(fxDelta);
    this.particles.update(fxDelta);
    this.numbers.update(fxDelta);
    this.shrines.update(delta);
    this.pickups.update(delta);
    this.marker.update(delta);

    const feet = this.playerView.render(alpha);
    for (const v of this.enemyViews.values()) v.render(alpha);
    this.projectileView.render(this.projectiles.list, alpha);
    this.cam.apply(this.cameras.main, feet.x, feet.y, alpha);
    this.drawEnemyBars();
    this.debug.draw(this, feet.x, feet.y);
  }

  /** Health bars (after taking damage) and stealth awareness meters (while not in combat). */
  private drawEnemyBars() {
    const g = this.bars;
    const pal = DATA.palette;
    g.clear();
    for (const v of this.enemyViews.values()) {
      const e = v.e;
      if (e.dead || e.def.ai !== 'melee') continue;
      const w = 16;
      const x = v.x - w / 2;
      let y = v.y - e.def.hurtbox.h - 9;
      if (e.barTicks > 0) {
        g.fillStyle(hexToInt(pal.ink), 1).fillRect(x - 1, y - 1, w + 2, 4);
        g.fillStyle(hexToInt(pal.dark2), 1).fillRect(x, y, w, 2);
        g.fillStyle(hexToInt(pal.blood2), 1).fillRect(x, y, Math.max(1, Math.round((w * e.hp) / e.maxHp)), 2);
        y -= 4;
      }
      const st = e.stateName;
      if (e.awareness > 0 && (st === 'idle' || st === 'suspicious' || st === 'return')) {
        const aw = 10;
        g.fillStyle(hexToInt(pal.ink), 1).fillRect(v.x - aw / 2 - 1, y - 1, aw + 2, 3);
        g.fillStyle(hexToInt(e.awareness >= e.def.perception.suspicionAt ? pal.flame2 : pal.wax1), 1).fillRect(
          v.x - aw / 2,
          y,
          Math.max(1, Math.round(aw * e.awareness)),
          1,
        );
      }
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

  /** Room containing a world position; shared wall tiles belong to the first room listed. */
  roomAt(x: number, y: number): string | null {
    const tx = Math.floor(x / TILE);
    const ty = Math.floor(y / TILE);
    for (const r of this.rooms) {
      const [ox, oy] = r.origin;
      if (tx >= ox && ty >= oy && tx < ox + r.tiles[0].length && ty < oy + r.tiles.length) return r.id;
    }
    return null;
  }

  private buildWorld() {
    this.rooms = this.areaRooms();
    this.roomsJson = JSON.stringify(this.rooms);
    this.grid = buildGrid(this.rooms);
    this.worldView.build(this.grid);
    this.racks.build(this.rooms);
    this.shrines.build(this.rooms, id => this.flags.has(`shrine:${id}`));
    this.pickups.build(this.rooms, id => this.flags.has(`item:${id}`));
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
