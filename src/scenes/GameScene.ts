// Owns the simulation (fixed 60 Hz ticks) and world rendering; orchestrates the game systems.
// Feature logic lives in src/game/* (presentation, interactions, shrines, persistence, aim).
// HUD and menus live in UIScene on top.
import Phaser from 'phaser';
import { DATA, onDataReload } from '../data/config';
import { FixedLoop } from '../core/FixedLoop';
import { EventBus, type GameEvents } from '../core/EventBus';
import { mulberry32, type WorldCtx } from '../core/World';
import { INPUT } from '../input/instance';
import type { Input } from '../input/Input';
import { SpriteLib } from '../anim/SpriteLib';
import { buildGrid, Cell, TILE, type TileGrid } from '../world/TileGrid';
import { WorldView } from '../world/WorldView';
import { Racks } from '../world/Racks';
import { GroundItems } from '../world/GroundItems';
import { SHRINE_RADIUS, Shrines, type Shrine } from '../world/Shrines';
import { Pickups } from '../world/Pickups';
import { DeathMarker } from '../world/DeathMarker';
import { Doors } from '../world/Doors';
import { Props } from '../world/Props';
import { Decor } from '../world/Decor';
import { markObstacles } from '../world/Obstacles';
import { Npcs } from '../story/Npcs';
import { Story } from '../story/Story';
import { BossArena } from '../game/BossArena';
import { Levers } from '../world/Levers';
import { check } from '../story/conditions';
import { tickWarp, type WarpTarget } from '../game/Warp';
import { Exits, findSpawn, type Exit } from '../world/Exits';
import { LootDrops, rollLoot, type LootDrop } from '../world/LootDrops';
import { Pathfinder } from '../world/Pathfinder';
import { Player } from '../player/Player';
import { PlayerView } from '../player/PlayerView';
import { Enemy } from '../enemies/Enemy';
import { EnemyView } from '../enemies/EnemyView';
import { AttackTokens } from '../enemies/AttackTokens';
import { CombatSystem } from '../combat/CombatSystem';
import { Projectiles } from '../combat/Projectiles';
import { CameraRig, type Bounds } from '../render/CameraRig';
import { Fx } from '../render/Fx';
import { Particles } from '../render/Particles';
import { FloatingText } from '../render/FloatingText';
import { ProjectileView } from '../render/ProjectileView';
import { EnemyBars } from '../render/EnemyBars';
import { Sfx } from '../audio/Sfx';
import { SaveSystem, type SaveData } from '../save/SaveSystem';
import { MenuNav, type Menu } from '../ui/Menu';
import { DebugOverlay } from '../debug/DebugOverlay';
import { installDebugKeys } from '../debug/DebugKeys';
import { hexToInt } from '../ui/colors';
import { wirePresentation } from '../game/Presentation';
import { handleInteract, nearestInteractable } from '../game/Interactions';
import { grantItem } from '../game/Items';
import { tickShrineSeq } from '../game/ShrineFlow';
import { applySave, snapshot } from '../game/Persistence';
import { updateAim } from '../game/aim';
import type { Actor } from '../actors/Actor';
import type { Dir8 } from '../core/math';
import type { RoomData } from '../data/schemas';

const DIR_ANGLE: Record<Dir8, number> = { E: 0, SE: 45, S: 90, SW: 135, W: 180, NW: 225, N: 270, NE: 315 };
/** How long an item banner stays up (ticks), fade included: long enough to read the explanation. */
const TOAST_TICKS = 360;

export interface GameStartData {
  /** continue = load the save (falls back to new); new = wipe the save and start fresh. */
  mode?: 'continue' | 'new';
}

export class GameScene extends Phaser.Scene {
  // Core services
  loop!: FixedLoop;
  controls!: Input;
  bus = new EventBus<GameEvents>();
  lib!: SpriteLib;
  grid!: TileGrid;
  combat = new CombatSystem();
  projectiles = new Projectiles();
  tokens = new AttackTokens();
  sfx = new Sfx();
  saves = new SaveSystem();

  // Actors and world objects
  player!: Player;
  enemies: Enemy[] = [];
  racks!: Racks;
  ground!: GroundItems;
  shrines!: Shrines;
  pickups!: Pickups;
  doors!: Doors;
  props!: Props;
  decor!: Decor;
  npcs!: Npcs;
  /** Dialogue and cutscenes (data/scripts): pauses the world while a script runs. */
  story = new Story(this);
  /** Boss arenas of the current area; `arena.active` drives the boss bar. */
  arena = new BossArena(this);
  exits = new Exits();
  levers!: Levers;
  loot!: LootDrops;
  marker!: DeathMarker;
  /** Current area (rooms with this `area` are built into one world). */
  area = '';

  // Presentation
  cam!: CameraRig;
  fx!: Fx;
  particles!: Particles;
  numbers!: FloatingText;
  debug!: DebugOverlay;

  // Game state
  /** Persistent world state: "shrine:<id>" lit, "item:<id>" taken, "door:<id>" open, "loot:<prop>" dropped, "weapon:<id>" placed. */
  flags = new Set<string>();
  lastShrine: string | null = null;
  /** Open menu (freezes the simulation). */
  menu: Menu | null = null;
  /** Item/event banner for the UI. */
  toast: { title: string; body: string; note?: string; t: number; life: number } | null = null;
  /** Last hit taken by the player, for the UI damage vignette (t in ms since the hit). */
  hurt: { angle: number; strength: number; t: number } | null = null;
  /** Kneeling at a shrine: kindle (first visit) or rest, then the shrine menu opens. */
  shrineSeq: { shrine: Shrine; t: number; kindle: boolean } | null = null;
  /** Sim ticks (frozen during hit-stop and menus). */
  simTick = 0;
  tickCount = 0;
  hitstop = 0;
  /** Ticks since the player died (-1 = alive) and since respawn (-1 = not fading back). */
  deathT = -1;
  respawnT = -1;
  /** Walking through an area exit: fading out (t counts up to `fade`), then the new area fades in. */
  travel: { exit: Exit; t: number; fade: number } | null = null;
  /** Area name shown on arrival (t in ticks). */
  areaBanner: { name: string; t: number } | null = null;
  /** Large map open (M): the world is paused. */
  mapOpen = false;
  /** Quick travel between shrines in progress (game/Warp): the world is paused. */
  warp: { to: WarpTarget; t: number } | null = null;

  private ctxObj!: WorldCtx;
  private rooms: RoomData[] = [];
  private worldView!: WorldView;
  private playerView!: PlayerView;
  private enemyViews = new Map<Enemy, EnemyView>();
  private projectileView!: ProjectileView;
  private enemyBars!: EnemyBars;
  private rng = mulberry32(1234);
  private roomsJson = '';
  private menuNav = new MenuNav();
  private dirty = false;
  /** Secret walls already smashed stay open ("wall:<room>#<index>"). */
  private brokenWall = (uid: string) => this.flags.has(`wall:${uid}`);
  /** Levers stay pulled for good ("lever:<id>"). */
  leverPulled = (id: string) => this.flags.has(`lever:${id}`);

  constructor() {
    super('game');
  }

  /** Everything combat can touch: player, enemies and intact props. */
  get actors(): Actor[] {
    return [this.player, ...this.enemies, ...this.props.list.filter(p => !p.dead)];
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
      nav: new Pathfinder(() => this.grid),
      rng: this.rng,
      player: () => this.player,
      enemies: () => this.enemies,
      roomAt: (x, y) => this.roomAt(x, y),
    };

    // Load or start fresh. Flags and the last shrine must be known before the world is built.
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
    this.doors = new Doors(this.lib);
    this.props = new Props(this.lib);
    this.decor = new Decor(this.lib);
    this.npcs = new Npcs(this.lib);
    this.story = new Story(this);
    this.arena = new BossArena(this);
    this.levers = new Levers(this.lib);
    this.loot = new LootDrops(this.lib);
    this.marker = new DeathMarker(this.lib);
    const spawn = this.respawnPoint();
    this.area = spawn.area;
    this.buildWorld();

    this.player = new Player(this.ctxObj, spawn.x, spawn.y);
    if (save) applySave(this, save);
    this.ground.setArea(this.area);
    this.marker.setArea(this.area);
    this.playerView = new PlayerView(this, this.player, this.lib);
    this.spawnRoomEnemies();

    this.cam = new CameraRig();
    this.fx = new Fx(this, this.lib);
    this.particles = new Particles(this);
    this.numbers = new FloatingText(this);
    this.projectileView = new ProjectileView(this, this.lib);
    this.enemyBars = new EnemyBars(this);
    this.debug = new DebugOverlay(this);
    wirePresentation(this);
    this.wireGameplayEvents();

    this.loop = new FixedLoop(() => DATA.game.tickRate, () => DATA.game.maxStepsPerFrame, () => this.tick());
    this.respawnT = 0; // fade in
    this.showAreaBanner();

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
    if (this.warp) {
      tickWarp(this);
      return;
    }
    if (this.mapOpen) {
      // The large map pauses the world, like a menu.
      if (this.controls.pressed('map') || this.controls.pressed('back')) {
        this.mapOpen = false;
        this.controls.clearBuffer();
      }
      return;
    }
    if (this.story.active) {
      // A conversation or cutscene: the script drives the dialogue box, camera and fades; the world waits.
      this.story.tick();
      if (this.toast && ++this.toast.t > this.toast.life) this.toast = null;
      if (this.areaBanner && ++this.areaBanner.t > DATA.hud.areaBanner.ticks) this.areaBanner = null;
      return;
    }
    if (this.controls.pressed('map') && !this.menu && !this.player.dead && !this.shrineSeq && !this.travel) {
      this.mapOpen = true;
      return;
    }
    if (this.menu) {
      const r = this.menuNav.update(this.menu, this.controls);
      if (r === 'moved') this.bus.emit('sfx', { id: 'menu_move' });
      if (r === 'confirmed') this.bus.emit('sfx', { id: 'menu_confirm' });
      return;
    }
    this.cam.tickShake();
    if (this.toast && ++this.toast.t > this.toast.life) this.toast = null;
    if (this.areaBanner && ++this.areaBanner.t > DATA.hud.areaBanner.ticks) this.areaBanner = null;
    if (this.hitstop > 0) {
      this.hitstop--;
      return;
    }
    this.simTick++;

    const lead = updateAim(this);
    handleInteract(this);
    this.player.tick();
    for (const e of this.enemies) e.tick();
    for (const p of this.props.list) p.tick();
    this.resolveBodies();
    this.combat.resolve(this.actors, this.bus);
    this.projectiles.tick(this.actors, this.grid, this.combat, this.bus);
    tickShrineSeq(this);
    for (const c of this.pickups.tick()) grantItem(this, c.id, c.item, c.x, c.y);
    this.tryRecoverMarker();
    this.markSeen();
    this.arena.tick();
    this.tickTravel();
    if (!this.travel && !this.player.dead && !this.shrineSeq) this.story.checkTriggers();
    if (!this.player.dead) for (const d of this.loot.tick(this.player.x, this.player.y)) this.collectLoot(d);

    for (const e of this.enemies.filter(en => en.remove)) this.removeEnemy(e);
    this.cam.tick(lead.x, lead.y);
    if (this.dirty && this.simTick % DATA.shrine.autosaveTicks === 0) this.save();
  }

  private collectLoot(d: LootDrop) {
    const p = this.player;
    if (d.kind === 'tallow') {
      p.tallow += d.amount;
      this.numbers.add(`+${d.amount}`, p.x, p.y - 30, hexToInt(DATA.palette.flame2));
    } else {
      for (const wid of new Set(p.slots)) {
        const r = DATA.weapons[wid]?.ranged;
        if (r) p.ammoFor(wid).reserve = Math.min(r.reserveMax, p.ammoFor(wid).reserve + Math.ceil(r.reserveMax * d.amount));
      }
      this.numbers.add('POWDER', p.x, p.y - 30, hexToInt(DATA.palette.wax2));
    }
    this.bus.emit('sfx', { id: 'tallow' });
    this.dirty = true;
  }

  private tryRecoverMarker() {
    if (this.player.dead) return;
    const got = this.marker.tryRecover(this.player.x, this.player.y);
    if (!got) return;
    this.player.tallow += got;
    this.numbers.add(`+${got}`, this.player.x, this.player.y - 34, hexToInt(DATA.palette.flame2));
    this.showToast('TALLOW RECOVERED', `${got} tallow reclaimed from the guttered candle.`);
    this.bus.emit('sfx', { id: 'tallow_recover' });
    this.save();
  }

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
    for (const a of list) this.npcs.pushOut(a);
  }

  // ------------------------------------------------------------------ menus, toasts, saving
  closeMenu() {
    this.menu = null;
    this.controls.clearBuffer();
  }

  /** Banner: title, what happened, and an optional dimmer note (flavour text). */
  showToast(title: string, body: string, note?: string) {
    this.toast = { title, body, note, t: 0, life: note ? TOAST_TICKS : 240 };
  }

  nearestInteractable() {
    return nearestInteractable(this);
  }

  markDirty() {
    this.dirty = true;
  }

  save() {
    this.saves.write(snapshot(this));
    this.dirty = false;
  }

  // ------------------------------------------------------------------ map
  /** Rooms appear on the map once visited (world flag "seen:<room id>", saved). */
  private markSeen() {
    const room = this.roomAt(this.player.x, this.player.y);
    if (room && !this.flags.has(`seen:${room}`)) {
      this.flags.add(`seen:${room}`);
      this.dirty = true;
    }
  }

  /** Rooms of the current area (for the map). */
  get areaRoomList(): readonly RoomData[] {
    return this.rooms;
  }

  // ------------------------------------------------------------------ area exits
  /**
   * Walking into an exit fades to black (the player keeps control, no freeze), swaps the area, puts the
   * player on the target spawn, then fades back in with the area's name.
   */
  private tickTravel() {
    const p = this.player;
    if (this.travel) {
      if (p.dead) {
        this.travel = null;
        return;
      }
      if (++this.travel.t >= this.travel.fade) this.arrive(this.travel.exit);
      return;
    }
    if (p.dead || this.shrineSeq) return;
    const exit = this.exits.check(p.x, p.y);
    if (!exit) return;
    if (!check(this.flags, exit.when)) {
      this.exits.disarm();
      this.showToast('NOT YET', exit.closed ?? 'It will not move.');
      this.bus.emit('sfx', { id: 'locked' });
      return;
    }
    if (!Object.values(DATA.rooms).some(r => r.area === exit.to.area)) {
      // The target area isn't built yet: say so, and don't trigger again until the player steps off.
      this.exits.disarm();
      this.showToast('THE WAY IS NOT OPEN YET', `${DATA.areas.areas[exit.to.area].name} is still being built.`);
      return;
    }
    this.travel = { exit, t: 0, fade: 16 };
  }

  private arrive(exit: Exit) {
    this.travel = null;
    if (exit.to.area !== this.area) this.loadArea(exit.to.area);
    const s = findSpawn(this.rooms, exit.to.spawn);
    if (s) {
      const p = this.player;
      p.x = p.prevX = s.x;
      p.y = p.prevY = s.y;
      p.vx = p.vy = 0;
    }
    this.exits.disarm();
    this.cam.snap();
    this.respawnT = 0; // fade back in
    this.dirty = true;
  }

  private showAreaBanner() {
    this.areaBanner = { name: DATA.areas.areas[this.area].name, t: 0 };
  }

  // ------------------------------------------------------------------ rest, death, respawn
  /** Shared by rest and respawn: full restore and a fresh set of (non-boss) enemies. */
  restoreWorld() {
    this.player.refill();
    this.player.poise.reset();
    for (const f of [...this.flags]) if (f.startsWith('slain:')) this.flags.delete(f); // every enemy returns
    this.arena.reset();
    this.resetEnemies();
    this.props.build(this.ctxObj, this.rooms, this.brokenWall); // props respawn; their loot flags don't
    this.loot.clear();
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
    if (s.area !== this.area) this.loadArea(s.area);
    this.player.respawn(s.x, s.y);
    this.restoreWorld();
    this.particles.clear();
    this.numbers.clear();
    this.hitstop = 0;
    this.cam.snap();
    this.save();
  }

  /** The last shrine rested at (in whichever area it is), else the start room's spawn point. */
  private respawnPoint(): { area: string; x: number; y: number } {
    for (const r of Object.values(DATA.rooms))
      for (const en of r.entities)
        if (en.type === 'shrine' && en.id === this.lastShrine) {
          const [ox, oy] = DATA.shrine.spawnOffset;
          return {
            area: r.area,
            x: (r.origin[0] + en.at[0]) * TILE + TILE / 2 + ox,
            y: (r.origin[1] + en.at[1]) * TILE + TILE - 2 + oy,
          };
        }
    return { area: DATA.rooms[DATA.game.startRoom].area, ...this.findSpawn() };
  }

  /** Gameplay consequences of events (presentation lives in game/Presentation). */
  private wireGameplayEvents() {
    this.bus.on('weaponDropped', e => {
      this.ground.add(e.id, e.x, e.y + 2);
      this.bus.emit('sfx', { id: 'swap' });
      this.dirty = true;
    });
    this.bus.on('died', e => {
      if (e.actor instanceof Enemy) {
        // Slain enemies stay dead (across areas and reloads) until the player rests or dies.
        if (e.actor.spawnId) this.flags.add(`slain:${e.actor.spawnId}`);
        // Some burst into smaller ones (wax blobs); they come out angry, spread around the body.
        const split = e.actor.def.splitInto;
        if (split)
          for (let i = 0; i < split.count; i++) {
            const a = (i / split.count) * Math.PI * 2 + this.rng();
            const kid = this.spawnEnemy(split.kind, e.actor.x + Math.cos(a) * 8, e.actor.y + Math.sin(a) * 5, a);
            if (kid) {
              kid.knock(a, 90);
              kid.aggro();
            }
          }
        const gain = e.actor.def.tallow;
        if (gain > 0) {
          this.player.tallow += gain;
          this.numbers.add(`+${gain}`, e.actor.x, e.actor.y - 20, hexToInt(DATA.palette.flame2));
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
      // In a boss arena the candle falls just outside the doorway you came through, not in the fight.
      const at = this.arena.markerPoint ?? { x: p.x, y: p.y };
      this.marker.set(p.tallow > 0 ? { x: at.x, y: at.y, tallow: p.tallow, area: this.area } : null);
      p.tallow = 0;
      this.save();
    });
    this.bus.on('summon', e => {
      const caster = e.actor as Enemy;
      const sm = e.strike.summon!;
      caster.summons = caster.summons.filter(s => !s.dead);
      for (let i = 0; i < sm.count; i++) {
        const a = (i / sm.count) * Math.PI * 2 + caster.facing;
        const x = caster.x + Math.cos(a) * sm.radius;
        const y = caster.y + Math.sin(a) * sm.radius * 0.7;
        // Keep them inside the walls: fall back to the caster's own spot.
        const ok = !this.grid.isSolid(Math.floor(x / TILE), Math.floor(y / TILE));
        const kid = this.spawnEnemy(sm.kind, ok ? x : caster.x, ok ? y : caster.y, a);
        if (!kid) continue;
        kid.aggro();
        caster.summons.push(kid);
        this.particles.burst(kid.x, kid.y, 4, -Math.PI / 2, Math.PI * 2, 10, 70, 'flame1', false);
      }
      if (sm.shield) caster.bubble = true;
      this.bus.emit('sfx', { id: 'summon', x: caster.x, y: caster.y });
    });
    this.bus.on('propBroken', e => {
      const p = e.prop;
      if (p.def.secretWall) {
        // A hidden way: the wall tile opens for good, and the world is redrawn around it.
        this.flags.add(`wall:${p.uid}`);
        this.grid.set(Math.floor(p.x / TILE), Math.floor(p.y / TILE), Cell.Floor);
        this.worldView.build(this.grid, DATA.areas.areas[this.area].tileset);
        this.showToast('A HIDDEN WAY', 'The cracked wall gives way.');
        this.save();
        return;
      }
      const flag = `loot:${p.uid}`;
      if (p.def.loot === 'none' || this.flags.has(flag)) return;
      this.flags.add(flag); // loot is one-time; the prop itself respawns on rest
      this.loot.spawn(rollLoot(DATA.loot.tables[p.def.loot], this.rng), p.x, p.y, this.rng);
      this.dirty = true;
    });
  }

  // ------------------------------------------------------------------ enemies
  spawnEnemy(kind: string, x: number, y: number, facing = Math.PI / 2): Enemy | null {
    if (!DATA.enemies[kind]) return null;
    const e = new Enemy(this.ctxObj, kind, x, y, facing);
    this.enemies.push(e);
    this.enemyViews.set(e, new EnemyView(this, e, this.lib));
    return e;
  }

  /** Shrines can depend on flags (a boss's shrine appears when it falls): rebuild after such a change. */
  rebuildShrines() {
    this.shrines.build(this.rooms, id => this.flags.has(`shrine:${id}`), this.flags);
  }

  /** Take an enemy out of the world immediately (no death), e.g. a boss replaced by its next phase. */
  despawn(e: Enemy) {
    this.removeEnemy(e);
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

  /** Placed enemies, except those slain since the last rest ("slain:<room>#<index>" flags). */
  private spawnRoomEnemies() {
    for (const r of this.rooms)
      r.entities.forEach((en, i) => {
        if (en.type !== 'enemy') return;
        const spawnId = `${r.id}#${i}`;
        if (this.flags.has(`slain:${spawnId}`)) return;
        if (DATA.enemies[String(en.kind)]?.boss && this.flags.has(`boss:${String(en.kind)}`)) return; // bosses stay dead
        const facing = (DIR_ANGLE[(en.facing as Dir8) ?? 'S'] ?? 90) * (Math.PI / 180);
        const e = this.spawnEnemy(String(en.kind), (r.origin[0] + en.at[0]) * TILE + TILE / 2, (r.origin[1] + en.at[1]) * TILE + TILE - 2, facing);
        if (e) e.spawnId = spawnId;
      });
  }

  weaponTip(a: Actor): { x: number; y: number } {
    const w = a === this.player ? this.playerView.weapon : this.enemyViews.get(a as Enemy)?.weapon;
    return w ? { x: w.tipX, y: w.tipY } : { x: a.x, y: a.chestY };
  }

  // ------------------------------------------------------------------ rendering
  update(_time: number, delta: number) {
    let alpha = this.loop.frame(delta);
    if (this.hitstop > 0 || this.menu || this.mapOpen || this.story.active || this.warp) alpha = 1; // hold still instead of interpolating
    const fxDelta = delta * (this.loop.frozen ? 0 : this.loop.timeScale);
    this.fx.update(fxDelta);
    this.particles.update(fxDelta);
    this.numbers.update(fxDelta);
    this.shrines.update(delta);
    this.pickups.update(delta);
    this.marker.update(delta);
    if (this.hurt) this.hurt.t += delta;

    const feet = this.playerView.render(alpha);
    for (const v of this.enemyViews.values()) v.render(alpha);
    this.props.render(alpha);
    this.loot.render();
    this.projectileView.render(this.projectiles.list, alpha);
    this.npcs.update(delta, this.player.x);
    this.arena.update(delta);
    // A script can point the camera elsewhere (cutscenes); otherwise it follows the player.
    const focus = this.story.cameraPoint;
    const camX = focus ? Math.round(focus.x) : feet.x;
    const camY = focus ? Math.round(focus.y) : feet.y;
    this.cam.apply(this.cameras.main, camX, camY, alpha, this.roomBounds(focus ? focus.x : this.player.x, focus ? focus.y : this.player.y), delta);
    this.enemyBars.draw(this.enemyViews.values(), fxDelta);
    this.debug.draw(this, feet.x, feet.y);
  }

  // ------------------------------------------------------------------ world
  private areaRooms() {
    return Object.values(DATA.rooms).filter(r => r.area === this.area);
  }

  /** Swap the whole world to another area (rooms, doors, props, enemies...). */
  loadArea(area: string) {
    this.area = area;
    this.buildWorld();
    this.resetEnemies();
    this.loot.clear();
    this.projectiles.clear();
    this.ground.setArea(area);
    this.marker.setArea(area);
    this.cam.snap();
    this.showAreaBanner();
  }

  /** Debug: jump to any room (in any area). */
  teleportTo(room: RoomData) {
    if (room.area !== this.area) this.loadArea(room.area);
    // Nearest walkable tile to the room centre.
    const cx = room.origin[0] + Math.floor(room.tiles[0].length / 2);
    const cy = room.origin[1] + Math.floor(room.tiles.length / 2);
    for (let r = 0; r < 12; r++)
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++)
          if (!this.grid.isSolid(cx + dx, cy + dy)) {
            this.player.respawn((cx + dx) * TILE + TILE / 2, (cy + dy) * TILE + TILE - 2);
            this.cam.snap();
            return;
          }
  }

  /** Debug menu (` key): teleport to rooms, inspect/clear world flags. */
  openDebugMenu() {
    const close = () => this.closeMenu();
    const rooms = Object.values(DATA.rooms).sort((a, b) => (a.area + a.id).localeCompare(b.area + b.id));
    const items = [
      { label: 'BOSSES...', enabled: true, action: () => this.openBossMenu() },
      ...rooms.map(r => ({ label: `${r.area} / ${r.id}`, enabled: true, action: () => (close(), this.teleportTo(r)) })),
      { label: `WORLD FLAGS (${this.flags.size})...`, enabled: true, action: () => this.openFlagMenu() },
      { label: 'CLOSE', enabled: true, action: close },
    ];
    this.menu = { title: 'DEBUG', subtitle: `area: ${this.area}`, items, index: 0, onBack: close };
  }

  /** Debug: jump to the doorway of any boss arena (walk in to start the fight); beaten bosses come back. */
  private openBossMenu() {
    const back = () => this.openDebugMenu();
    const arenas = Object.values(DATA.rooms).flatMap(r => r.entities.filter(e => e.type === 'arena').map(e => ({ r, kind: String(e.boss), e })));
    const items = [
      ...arenas.map(({ r, kind, e }) => {
        const beaten = this.flags.has(`boss:${kind}`);
        const title = DATA.enemies[kind].boss?.title ?? kind;
        return {
          label: `${title.toUpperCase()}  (${DATA.areas.areas[r.area].name})${beaten ? '  - BEATEN, REVIVE' : ''}`,
          enabled: true,
          action: () => {
            this.closeMenu();
            this.teleportToBoss(r, kind, e.seals as [number, number][]);
          },
        };
      }),
      { label: 'BACK', enabled: true, action: back },
    ];
    this.menu = {
      title: 'BOSSES',
      subtitle: 'You arrive outside the arena door: walk in to start the fight.',
      items,
      index: 0,
      onBack: back,
    };
  }

  private teleportToBoss(room: RoomData, kind: string, seals: [number, number][]) {
    // A beaten boss comes back (its arena shrine goes away again until it falls).
    if (this.flags.delete(`boss:${kind}`)) {
      const next = DATA.enemies[kind].boss?.next;
      if (next) this.flags.delete(`boss:${next.kind}`);
    }
    if (room.area !== this.area) this.loadArea(room.area);
    this.arena.reset();
    this.resetEnemies();
    this.rebuildShrines();
    // Stand one tile outside the first doorway, beyond the smoke's reach.
    const w = room.tiles[0].length;
    const h = room.tiles.length;
    const [sx, sy] = seals[0];
    const dx = sx === 0 ? -1 : sx === w - 1 ? 1 : 0;
    const dy = sy === 0 ? -1 : sy === h - 1 ? 1 : 0;
    let tx = room.origin[0] + sx + dx;
    let ty = room.origin[1] + sy + dy;
    if (this.grid.isSolid(tx, ty)) {
      tx += dx;
      ty += dy;
    }
    this.player.respawn(tx * TILE + TILE / 2, ty * TILE + TILE - 2);
    this.cam.snap();
    this.showToast('BOSS', `${DATA.enemies[kind].boss?.title ?? kind} is through the doorway.`);
  }

  private openFlagMenu() {
    const flags = [...this.flags].sort();
    const items = [
      ...flags.map(f => ({ label: `clear ${f}`, enabled: true, action: () => (this.flags.delete(f), this.save(), this.openFlagMenu()) })),
      { label: 'CLEAR ALL FLAGS', enabled: flags.length > 0, action: () => (this.flags.clear(), this.save(), this.openFlagMenu()) },
      { label: 'BACK', enabled: true, action: () => this.openDebugMenu() },
    ];
    this.menu = {
      title: 'WORLD FLAGS',
      subtitle: 'reload the area (rest or teleport) to see changes',
      items,
      index: items.length - 1,
      onBack: () => this.openDebugMenu(),
    };
  }

  /** Room containing a world position; shared wall tiles belong to the first room listed. */
  roomAt(x: number, y: number): string | null {
    return this.roomRecordAt(x, y)?.id ?? null;
  }

  private roomRecordAt(x: number, y: number): RoomData | null {
    const tx = Math.floor(x / TILE);
    const ty = Math.floor(y / TILE);
    for (const r of this.rooms) {
      const [ox, oy] = r.origin;
      if (tx >= ox && ty >= oy && tx < ox + r.tiles[0].length && ty < oy + r.tiles.length) return r;
    }
    return null;
  }

  /** Camera bounds for the room at a position: its tiles plus the wall-cap row drawn above its north wall. */
  private roomBounds(x: number, y: number): Bounds | null {
    const r = this.roomRecordAt(x, y);
    if (!r) return null;
    return {
      id: r.id,
      x: r.origin[0] * TILE,
      y: (r.origin[1] - 1) * TILE,
      w: r.tiles[0].length * TILE,
      h: (r.tiles.length + 1) * TILE,
    };
  }

  private buildWorld() {
    this.rooms = this.areaRooms();
    this.roomsJson = JSON.stringify(this.rooms);
    this.grid = buildGrid(this.rooms);
    markObstacles(this.grid, this.rooms, this.brokenWall);
    this.decor.build(this.rooms);
    this.worldView.build(this.grid, DATA.areas.areas[this.area].tileset);
    this.racks.build(this.rooms);
    this.shrines.build(this.rooms, id => this.flags.has(`shrine:${id}`), this.flags);
    this.pickups.build(this.rooms, id => this.flags.has(`item:${id}`));
    this.doors.build(this.rooms, this.grid, id => this.flags.has(`door:${id}`));
    this.props.build(this.ctxObj, this.rooms, this.brokenWall);
    this.exits.build(this.rooms);
    this.npcs.build(this.rooms, this.flags);
    this.arena.build(this.rooms);
    this.levers.build(this.rooms, this.leverPulled);
    this.placeWeapons();
  }

  /**
   * Weapons placed in room data are put on the floor once ("weapon:<id>" flag); from then on they are
   * ordinary ground items, saved and restored with the rest.
   */
  private placeWeapons() {
    for (const r of this.rooms)
      for (const en of r.entities) {
        if (en.type !== 'weapon' || !en.id || this.flags.has(`weapon:${en.id}`)) continue;
        this.flags.add(`weapon:${en.id}`);
        const x = (r.origin[0] + en.at[0]) * TILE + TILE / 2;
        const y = (r.origin[1] + en.at[1]) * TILE + TILE - 4;
        this.ground.add(String(en.weapon), x, y, this.area);
        this.dirty = true;
      }
  }

  private findSpawn(): { x: number; y: number } {
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
