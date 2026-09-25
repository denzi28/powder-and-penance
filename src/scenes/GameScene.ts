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
import { Chatter } from '../story/Chatter';
import { Story } from '../story/Story';
import { BossArena } from '../game/BossArena';
import { Levers } from '../world/Levers';
import { WaxPools } from '../world/WaxPools';
import { check } from '../story/conditions';
import { tickWarp, type WarpTarget } from '../game/Warp';
import { Exits, findSpawn, type Exit } from '../world/Exits';
import { LootDrops, rollLoot, type LootDrop } from '../world/LootDrops';
import { Notes } from '../world/Notes';
import { ScreenFx } from '../game/ScreenFx';
import { Eruptions } from '../game/Eruptions';
import { Explosions, nearestKeg } from '../game/Explosions';
import { Swarms, type Swarm } from '../game/Swarms';
import { Prop } from '../world/Props';
import { Pathfinder } from '../world/Pathfinder';
import { Player } from '../player/Player';
import { PlayerView } from '../player/PlayerView';
import { COMBAT_STATES, Enemy } from '../enemies/Enemy';
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
import { LightCones } from '../render/LightCones';
import { Ambience } from '../world/Ambience';
import { Sfx } from '../audio/Sfx';
import { AmbientAudio } from '../audio/Ambient';
import { BossSfx } from '../audio/BossSfx';
import { GearScreen } from '../ui/GearScreen';
import { LevelUpScreen, ShopScreen, SmithScreen, type AnyServiceScreen } from '../ui/ServiceScreens';
import { ControlsScreen, SettingsScreen, type AnyOptionsScreen } from '../ui/OptionsScreens';
import { BossMusic, ExploreMusic, musicLoad } from '../audio/Music';
import { SaveSystem, type SaveData } from '../save/SaveSystem';
import { MenuNav, type Menu } from '../ui/Menu';
import { DebugOverlay } from '../debug/DebugOverlay';
import { installDebugKeys } from '../debug/DebugKeys';
import { hexToInt } from '../ui/colors';
import { DEPTH } from '../render/depth';
import { wirePresentation } from '../game/Presentation';
import { handleInteract, nearestInteractable } from '../game/Interactions';
import { beltKeys, grantItem, useLine } from '../game/Items';
import { tickShrineSeq } from '../game/ShrineFlow';
import { applySave, snapshot } from '../game/Persistence';
import { updateAim } from '../game/aim';
import type { Actor } from '../actors/Actor';
import type { Dir8 } from '../core/math';
import { MinibossPlacement, type RoomData } from '../data/schemas';

const DEPTH_LIGHT = (y: number) => DEPTH.actor(y) + 1;
const DIR_ANGLE: Record<Dir8, number> = { E: 0, SE: 45, S: 90, SW: 135, W: 180, NW: 225, N: 270, NE: 315 };
/** How long an item banner stays up (ticks), fade included: long enough to read the explanation. */
const TOAST_TICKS = 360;

export interface GameStartData {
  /** continue = load the save (falls back to new); new = wipe the save and start fresh. */
  mode?: 'continue' | 'new';
}

export class GameScene extends Phaser.Scene {
  /** Music notes played / dropped over the voice budget (debugging the audio load). */
  readonly musicLoad = musicLoad;
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
  ambientAudio = new AmbientAudio(this.sfx);
  bossMusic = new BossMusic(this.sfx);
  bossSfx = new BossSfx(this.sfx);
  exploreMusic = new ExploreMusic(this.sfx);
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
  ambience!: Ambience;
  npcs!: Npcs;
  chatter!: Chatter;
  /** Dialogue and cutscenes (data/scripts): pauses the world while a script runs. */
  story = new Story(this);
  /** Boss arenas of the current area; `arena.active` drives the boss bar. */
  arena = new BossArena(this);
  exits = new Exits();
  /** Wax spilled by bosses (strike.pools): slows whoever wades it. */
  pools = new WaxPools();
  levers!: Levers;
  notes!: Notes;
  /** Lit powder: kegs and mules on a fuse. */
  explosions = new Explosions();
  /** Letterbox bars, flashes and cinema holds (cutscenes and boss moments). */
  screenFx = new ScreenFx();
  eruptions = new Eruptions();
  /** Bees: swarms out of struck hives, drone swarms over the flowers. */
  swarms = new Swarms();
  /** The swarm each hive has out (struck again, it turns on the new culprit instead of sending more). */
  private hiveOut = new Map<Prop, Swarm>();
  /** A warm glow round the player while a beeswax light burns. */
  private playerLight: Phaser.GameObjects.Image | null = null;
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
  toast: { title: string; body: string; t: number; life: number } | null = null;
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
  /** Equipment / inventory screen (from the pause menu): the world is paused. */
  gear: GearScreen | AnyServiceScreen | AnyOptionsScreen | null = null;
  /** A townsperson's screen to open when the conversation ends (script step "open"). */
  pendingScreen: 'levelup' | 'shop' | 'smith' | 'apiary' | null = null;
  /** Quick travel between shrines in progress (game/Warp): the world is paused. */
  warp: { to: WarpTarget; t: number } | null = null;

  private ctxObj!: WorldCtx;
  private rooms: RoomData[] = [];
  private worldView!: WorldView;
  playerView!: PlayerView;
  private enemyViews = new Map<Enemy, EnemyView>();
  private projectileView!: ProjectileView;
  private enemyBars!: EnemyBars;
  private lightCones!: LightCones;
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
      slowAt: (x, y) => this.pools.mult(x, y),
      kegNear: (x, y, r) => nearestKeg(this, x, y, r),
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
    this.ambience = new Ambience(this, this.lib);
    this.ambience.onSound = (id, x, y) => this.ambientAudio.play(id, x, y, this.player);
    this.npcs = new Npcs(this.lib);
    this.chatter = new Chatter(this, this.npcs, this.bus);
    this.npcs.onWorkStroke = n => {
      const sfx = DATA.npcs.npcs[n.npc].workSfx;
      if (sfx) this.bus.emit('sfx', { id: sfx, volume: 0.35, pitch: 0.9 + Math.random() * 0.2 });
    };
    this.story = new Story(this);
    this.arena = new BossArena(this);
    this.levers = new Levers(this.lib);
    this.notes = new Notes(this.lib);
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
    this.lightCones = new LightCones(this);
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
      this.ambientAudio.stop();
      this.bossMusic.stop();
      this.exploreMusic.stop();
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
    this.screenFx.tick();
    if (this.screenFx.locked && !this.story.active) this.controls.mute(); // a boss moment has the camera and the controls
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
    if (this.pendingScreen) {
      this.openService(this.pendingScreen);
      this.pendingScreen = null;
    }
    if (this.gear) {
      this.gear.update(this.controls);
      return;
    }
    if (this.controls.pressed('pause') && !this.menu && !this.player.dead && !this.shrineSeq && !this.travel) {
      this.openPause();
      return;
    }
    // Tab / I: straight into EQUIPMENT / INVENTORY; the same key (or Esc) closes it again, back to the game
    for (const [key, kind] of [['equipment', 'equip'], ['inventory', 'inventory']] as const)
      if (this.controls.pressed(key) && !this.menu && !this.player.dead && !this.shrineSeq && !this.travel) {
        this.openGear(kind, undefined, key);
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
    this.explosions.tick(this);
    this.eruptions.tick(this);
    this.pools.tick();
    this.swarms.tick(this);
    this.meltSeals();
    for (const e of this.enemies)
      if (e.blind > 0 && e.blind % 9 === 0 && !e.dead) this.particles.burst(e.x, e.y - e.hurtbox.h - 4, 4, -Math.PI / 2, 1.8, 2, 20, 'stone4', false); // smoke still in its eyes
    for (const e of this.enemies)
      if (e.veiled > 0 && e.veiled % 4 === 0) this.particles.burst(e.x + (this.rng() - 0.5) * 16, e.y - 6, 4, -Math.PI / 2, 1.4, 3, 18, e.veiled % 8 ? 'stone3' : 'stone2', false); // its smoke clings to it
    tickShrineSeq(this);
    for (const c of this.pickups.tick()) grantItem(this, c.id, c.item, c.x, c.y);
    this.tryRecoverMarker();
    this.markSeen();
    this.arena.tick();
    this.tickTravel();
    if (!this.travel && !this.player.dead && !this.shrineSeq) this.story.checkTriggers();
    if (!this.player.dead) for (const d of this.loot.tick(this.player.x, this.player.y, d => this.canCollect(d))) this.collectLoot(d);

    this.announceMinibosses();
    for (const e of this.enemies.filter(en => en.remove)) this.removeEnemy(e);
    this.cam.tick(lead.x, lead.y);
    if (this.dirty && this.simTick % DATA.shrine.autosaveTicks === 0) this.save();
  }

  /** A miniboss that spots you makes an entrance: its name across the screen, its cry, the ground shaking. */
  private announceMinibosses() {
    for (const e of this.enemies) {
      if (!e.miniboss || e.announced || e.dead || e.awareness < 1) continue;
      e.announced = true;
      this.areaBanner = { name: e.miniboss.title, t: 0 };
      this.cam.addTrauma(0.3);
      this.bus.emit('sfx', { id: e.def.voice?.alert ?? 'boss_roar', x: e.x, y: e.y, volume: 1.4 });
    }
  }

  /** A drop the player can't take yet (a full stack) stays on the floor. */
  private canCollect(d: LootDrop) {
    if (d.kind !== 'item' || !d.item) return true;
    return this.player.count(d.item) < DATA.consumables[d.item].max;
  }

  /** Put consumables straight into the pack, with a toast (a boss's drop). */
  private giveDirect(id: string, n: number, x: number, y: number) {
    const c = DATA.consumables[id];
    const took = this.player.addItem(id, n);
    this.flags.add(`found:${id}`);
    this.numbers.add(`${c.name.toUpperCase()}${took > 1 ? ` x${took}` : ''}`, x, y - 30, hexToInt(DATA.palette.wax2));
    this.showToast(c.name.toUpperCase(), `${took > 1 ? `${took} x ` : ''}${c.name}, into your pack. ${useLine(id)}`);
    this.dirty = true;
  }

  private collectLoot(d: LootDrop) {
    const p = this.player;
    if (d.kind === 'tallow') {
      const got = Math.round(d.amount * p.mods.tallowGain);
      p.tallow += got;
      this.numbers.add(`+${got}`, p.x, p.y - 30, hexToInt(DATA.palette.flame2));
    } else if (d.kind === 'item' && d.item) {
      const c = DATA.consumables[d.item];
      const took = p.addItem(d.item, d.amount);
      this.numbers.add(took ? `${c.name.toUpperCase()}${took > 1 ? ` x${took}` : ''}` : `${c.name.toUpperCase()} (FULL)`, p.x, p.y - 30, hexToInt(DATA.palette.wax2));
      if (took) this.firstFind(d.item);
    } else {
      for (const wid of p.inv.weapons) {
        const r = DATA.weapons[wid]?.ranged;
        if (r) p.ammoFor(wid).reserve = Math.min(r.reserveMax, p.ammoFor(wid).reserve + Math.ceil(r.reserveMax * d.amount));
      }
      this.numbers.add('POWDER', p.x, p.y - 30, hexToInt(DATA.palette.wax2));
    }
    this.bus.emit('sfx', { id: 'tallow' });
    this.dirty = true;
  }

  /** The first time a kind of consumable is found, say what it does. */
  firstFind(id: string) {
    if (this.flags.has(`found:${id}`)) return;
    this.flags.add(`found:${id}`);
    const c = DATA.consumables[id];
    const keys = beltKeys();
    const how = c.use.type === 'material' ? '' : ` It goes on your belt: ${keys.cycle} cycles, ${keys.use} uses.`;
    this.showToast(c.name.toUpperCase(), `${useLine(id)}${how}`);
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
  /** The pause menu (Esc): the world waits. */
  openPause(index = 0) {
    const close = () => this.closeMenu();
    const items = [
      { label: 'RESUME', enabled: true, action: close },
      { label: 'EQUIPMENT', enabled: true, action: () => this.openGear('equip') },
      { label: 'INVENTORY', enabled: true, action: () => this.openGear('inventory') },
      { label: 'CONTROLS', enabled: true, action: () => this.openOptions('controls') },
      { label: 'SETTINGS', enabled: true, action: () => this.openOptions('settings') },
      {
        label: 'QUIT TO TITLE',
        enabled: true,
        action: () => {
          this.save();
          this.scene.stop('ui');
          this.scene.start('title');
        },
      },
    ];
    const t = this.player.loadTier;
    this.menu = { title: 'PAUSED', subtitle: `${DATA.areas.areas[this.area].name}. Load ${this.player.equipLoad}/${this.player.capacity} (${t.label.toLowerCase()}).`, items, index, onBack: close };
    this.controls.clearBuffer();
  }

  /** Open EQUIPMENT or INVENTORY from the pause menu (back returns there), or straight onto a note just read
   *  or from its own key (back returns to the game). */
  openGear(kind: 'equip' | 'inventory', note?: string, hotkey?: 'equipment' | 'inventory') {
    this.menu = null;
    this.controls.clearBuffer();
    this.gear = new GearScreen(
      kind,
      this.player,
      this.flags,
      () => {
        this.gear = null;
        this.markDirty();
        if (note || hotkey) this.controls.clearBuffer();
        else this.openPause(kind === 'equip' ? 1 : 2);
      },
      id => this.bus.emit('sfx', { id }),
      hotkey,
    );
    if (note) this.gear.focus('NOTES', note);
  }

  /** CONTROLS or SETTINGS from the pause menu; back returns to it. */
  openOptions(kind: 'controls' | 'settings') {
    this.menu = null;
    this.controls.clearBuffer();
    const close = () => {
      this.gear = null;
      this.openPause(kind === 'controls' ? 3 : 4);
    };
    this.gear = kind === 'controls' ? new ControlsScreen(this, close) : new SettingsScreen(this, close);
  }

  /** Open Maudlin's, Oskar's or Bede's screen; closing it returns to the game. */
  openService(kind: 'levelup' | 'shop' | 'smith' | 'apiary') {
    this.menu = null;
    this.controls.clearBuffer();
    const close = () => {
      this.gear = null;
      this.markDirty();
      this.controls.clearBuffer();
    };
    this.gear =
      kind === 'levelup' ? new LevelUpScreen(this, close) : kind === 'shop' ? new ShopScreen(this, close) : kind === 'apiary' ? new ShopScreen(this, close, 'hild') : new SmithScreen(this, close);
  }

  closeMenu() {
    this.menu = null;
    this.controls.clearBuffer();
  }

  /** Banner: title and what happened. (An item's lore is kept for the INVENTORY, not shown here.) */
  showToast(title: string, body: string) {
    this.toast = { title, body, t: 0, life: body.length > 90 ? TOAST_TICKS : 240 };
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
    this.explosions.clear();
    this.eruptions.clear();
    this.screenFx.reset();
    this.pools.clear();
    this.swarms.reset(this.ctxObj);
    this.hiveOut.clear();
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
    // controls explained once a session: a tap of the drop key
    const hinted = new Set<string>();
    this.bus.on('hint', e => {
      if (hinted.has(e.id)) return;
      hinted.add(e.id);
      if (e.id === 'drop') this.showToast('DROP WEAPON', 'Hold the drop key (G) to drop the weapon in use on the ground. It leaves your inventory until you pick it up again.');
    });
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
        if (e.actor.def.deathBlast) this.explosions.arm(e.actor.x, e.actor.y - 4, e.actor.def.deathBlast, e.actor, this); // its keg goes up
        if (e.actor.summoned) return;
        const loot = e.actor.def.loot;
        if (loot) {
          const roll = rollLoot(DATA.loot.tables[loot], this.rng);
          // A boss's drop goes straight into the pack: loot on the floor is gone after a rest or a death,
          // and a boss never comes back to drop it again.
          if (e.actor.def.boss && roll.item) this.giveDirect(roll.item, roll.count, e.actor.x, e.actor.y);
          else this.loot.spawn(roll, e.actor.x, e.actor.y, this.rng);
        }
        const mb = e.actor.miniboss;
        if (mb) {
          this.flags.add(`miniboss:${mb.id}`);
          if (!this.flags.has(`item:${mb.id}`)) grantItem(this, mb.id, mb.drop, e.actor.x, e.actor.y);
        }
        const gain = Math.round(e.actor.def.tallow * this.player.mods.tallowGain);
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
      // (a Miser's Band keeps some of it on you)
      const kept = Math.floor(p.tallow * p.mods.keepTallow);
      const left = p.tallow - kept;
      this.marker.set(left > 0 ? { x: at.x, y: at.y, tallow: left, area: this.area } : null);
      p.tallow = kept;
      this.save();
    });
    this.bus.on('hit', h => {
      // a struck hive: out come the bees, after whoever struck it (a blast or a stray sting: after you)
      const hive = h.target instanceof Prop ? h.target : null;
      if (!hive?.def.hive) return;
      const culprit = h.attacker === this.player || h.attacker instanceof Enemy ? h.attacker : this.player;
      const out = this.hiveOut.get(hive);
      if (h.killed) {
        const big = DATA.swarms.swarms[`${hive.def.hive}_broken`] ? `${hive.def.hive}_broken` : hive.def.hive;
        this.swarms.release(this.ctxObj, big, hive.x, hive.y - 10, culprit);
        this.particles.burst(hive.x, hive.y, 12, -Math.PI / 2, Math.PI * 2, 18, 80, 'flame1', true); // honey everywhere
        this.pools.add(hive.x, hive.y + 2, 14, 900, 0.6, 'honey');
      } else if (out && this.swarms.list.includes(out) && out.target) {
        out.target = culprit;
        out.anger = out.def.angerTicks;
      } else this.hiveOut.set(hive, this.swarms.release(this.ctxObj, hive.def.hive, hive.x, hive.y - 10, culprit));
    });
    this.bus.on('smoke', e => {
      const sm = e.strike.smoke!;
      const x = e.actor.x + Math.cos(e.angle) * sm.offset;
      const y = e.actor.y + Math.sin(e.angle) * sm.offset * 0.7;
      this.particles.burst(x, y - 6, 8, e.angle, 1.6, Math.round(sm.radius * 0.8), 45, 'stone4', false);
      this.particles.burst(x, y - 10, 14, -Math.PI / 2, Math.PI, Math.round(sm.radius * 0.6), 30, 'stone3', false);
      this.bus.emit('sfx', { id: e.strike.sfx, x, y });
      if (sm.calm) this.swarms.calm(x, y, sm.radius, this);
      // everyone caught in it (bar the one puffing, and anyone rolling through) is blinded
      for (const a of [this.player, ...this.enemies]) {
        if (a === e.actor || a.dead || a.invulnerable || Math.hypot(a.x - x, a.y - y) > sm.radius + 6) continue;
        if (a === this.player) {
          if (sm.blind > 0) this.player.blind = Math.max(this.player.blind, sm.blind);
        } else if (a instanceof Enemy) {
          if (a.team === e.actor.team) continue; // husks don't smoke each other
          if (a.def.smokePoise > 0 && !a.bossWaiting) this.combat.applyHit({ owner: e.actor, kind: 'projectile', damage: 0, poise: a.def.smokePoise, knockback: 20, hitstop: 2, shake: 0.1, angle: e.angle, unblockable: true, unparryable: true }, a, this.bus);
          if (sm.blind > 0) a.setBlind(sm.blind);
        }
      }
    });
    this.bus.on('swarm', e => {
      const sw = e.strike.swarm!;
      for (let i = 0; i < sw.count; i++) {
        const a = (i / sw.count) * Math.PI * 2 + e.actor.facing;
        this.swarms.release(this.ctxObj, sw.id, e.actor.x + Math.cos(a) * 12, e.actor.y + Math.sin(a) * 8 - 6, e.actor === this.player ? null : this.player);
      }
    });
    this.bus.on('trail', e => {
      const tr = (e.actor as Enemy).def.trail!;
      this.pools.add(e.x, e.y + 1, tr.radius, tr.ticks, tr.speedMult, 'honey');
    });
    this.bus.on('critical', e => {
      // the Ring of the Queen: a clean kill from behind feeds you
      const heal = this.player.mods.critHeal;
      if (e.attacker !== this.player || heal <= 0 || this.player.dead) return;
      this.player.hp = Math.min(this.player.maxHp, this.player.hp + heal);
      this.numbers.add(`+${heal}`, this.player.x, this.player.y - 30, hexToInt(DATA.palette.flame2));
      this.bus.emit('healed', { actor: this.player });
    });
    this.bus.on('eruptions', e => this.eruptions.start(e.actor, e.strike.eruptions!, e.target, e.angle, this));
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
        kid.summoned = true; // a boss's summons pay nothing (they'd be endless)
        caster.summons.push(kid);
        this.particles.burst(kid.x, kid.y, 4, -Math.PI / 2, Math.PI * 2, 10, 70, 'flame1', false);
      }
      if (sm.shield) caster.bubble = true;
      this.bus.emit('sfx', { id: 'summon', x: caster.x, y: caster.y });
    });
    this.bus.on('vanish', e => {
      // Gone in a cloud of smoke; out of it again behind (or beside) the one it's hunting, half-seen.
      const o = e.actor as Enemy;
      const v = e.strike.vanish!;
      const p = this.player;
      this.smokeCloud(o.x, o.y, 1);
      const open = (x: number, y: number) =>
        [[-7, 0], [7, 0], [0, -4], [0, 0]].every(([dx, dy]) => !this.grid.isSolid(Math.floor((x + dx) / TILE), Math.floor((y + dy) / TILE))) &&
        this.roomAt(x, y) === o.room;
      const behind = p.facing + Math.PI;
      for (let i = 0; i < 16; i++) {
        const a = behind + (this.rng() - 0.5) * Math.min(Math.PI * 2, 1.2 + i * 0.35);
        const x = p.x + Math.cos(a) * v.distance;
        const y = p.y + Math.sin(a) * v.distance * 0.8;
        if (!open(x, y)) continue;
        o.x = o.prevX = x;
        o.y = o.prevY = y;
        break;
      }
      o.vx = o.vy = 0;
      o.facing = Math.atan2(p.y - o.y, p.x - o.x);
      o.veiled = v.ticks;
      o.alpha = 0.18;
      o.attackGap = 0;
      this.smokeCloud(o.x, o.y, 0.6);
      this.bus.emit('sfx', { id: 'veil', x: o.x, y: o.y });
    });
    this.bus.on('pools', e => {
      const pl = e.strike.pools!;
      const at = pl.at === 'target' && e.target ? e.target : { x: e.actor.x, y: e.actor.y };
      for (let i = 0; i < pl.count; i++) {
        const a = this.rng() * Math.PI * 2;
        const d = pl.count === 1 ? 0 : pl.spread * Math.sqrt(this.rng());
        const x = at.x + Math.cos(a) * d;
        const y = at.y + Math.sin(a) * d * 0.7;
        if (this.grid.isSolid(Math.floor(x / TILE), Math.floor(y / TILE))) continue;
        this.pools.add(x, y, pl.radius, pl.ticks, pl.speedMult, pl.kind);
        this.particles.burst(x, y, 4, -Math.PI / 2, Math.PI * 2, 8, 50, pl.kind === 'honey' ? (i % 2 ? 'honey' : 'flame2') : i % 2 ? 'wax1' : 'wax2', true);
      }
      this.bus.emit('sfx', { id: 'wax_spill', x: at.x, y: at.y });
    });
    this.bus.on('propBroken', e => {
      const p = e.prop;
      if (p.def.explode) this.explosions.arm(p.x, p.y - 4, p.def.explode, p, this); // a keg: it lights
      if (p.def.secretWall) {
        // A hidden way: the wall tile opens for good, and the world is redrawn around it.
        this.flags.add(`wall:${p.uid}`);
        this.grid.set(Math.floor(p.x / TILE), Math.floor(p.y / TILE), Cell.Floor);
        this.worldView.build(this.grid, DATA.areas.areas[this.area].tileset);
        if (p.def.melts) this.showToast('THE SEAL MELTS', 'In the beeswax light the old tallow softens and runs, and a way opens behind it.');
        else this.showToast('A HIDDEN WAY', 'The cracked wall gives way.');
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

  /** A beeswax light carried close melts the tallow seals (prop `melts`) away for good. */
  private meltSeals() {
    const p = this.player;
    if (p.dead || p.mods.light <= 0) return;
    for (const pr of this.props.list) {
      const m = pr.def.melts;
      if (!m || pr.dead || Math.hypot(pr.x - p.x, pr.y - p.y) > m.near) continue;
      pr.dead = true;
      this.particles.burst(pr.x, pr.y, 8, -Math.PI / 2, Math.PI * 2, 24, 60, 'wax1', true);
      this.particles.burst(pr.x, pr.y - 8, 12, -Math.PI / 2, 1.2, 10, 40, 'flame2', false);
      this.bus.emit('sfx', { id: 'wax_spill', x: pr.x, y: pr.y });
      this.bus.emit('propBroken', { prop: pr });
    }
  }

  /** A warm, flickering glow round you while a beeswax light burns. */
  private drawPlayerLight(x: number, y: number) {
    const on = this.player.mods.light > 0 && !this.player.dead;
    if (!on && !this.playerLight) return;
    if (!this.playerLight && this.textures.exists('light_glow'))
      this.playerLight = this.add.image(x, y, 'light_glow').setBlendMode(Phaser.BlendModes.ADD);
    const l = this.playerLight;
    if (!l) return;
    const flick = 0.9 + Math.sin(this.time.now * 0.013) * 0.05 + Math.sin(this.time.now * 0.031) * 0.04;
    l.setVisible(on).setPosition(x, y - 14).setScale(2.4 * flick).setAlpha(0.55 * flick).setDepth(DEPTH_LIGHT(y));
  }

  /** A billow of censer smoke (size 1 = a full cloud). */
  private smokeCloud(x: number, y: number, size: number) {
    this.particles.burst(x, y - 8, 10 * size, -Math.PI / 2, Math.PI * 2, Math.round(40 * size), 70 * size, 'stone3', false);
    this.particles.burst(x, y - 14, 18 * size, -Math.PI / 2, Math.PI, Math.round(24 * size), 40 * size, 'stone4', false);
    this.bus.emit('dust', { x, y, kind: 'roll' });
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
        const mb = en.miniboss === undefined ? null : MinibossPlacement.parse(en.miniboss);
        if (mb && this.flags.has(`miniboss:${mb.id}`)) return; // minibosses stay dead
        if (DATA.enemies[String(en.kind)]?.boss && this.flags.has(`boss:${String(en.kind)}`)) return; // bosses stay dead
        const facing = (DIR_ANGLE[(en.facing as Dir8) ?? 'S'] ?? 90) * (Math.PI / 180);
        const e = this.spawnEnemy(String(en.kind), (r.origin[0] + en.at[0]) * TILE + TILE / 2, (r.origin[1] + en.at[1]) * TILE + TILE - 2, facing);
        if (!e) return;
        e.spawnId = spawnId;
        if (mb) {
          e.miniboss = mb;
          e.hp = e.maxHp;
        }
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
    this.notes.update(delta);
    this.marker.update(delta);
    if (this.hurt) this.hurt.t += delta;

    const feet = this.playerView.render(alpha);
    for (const v of this.enemyViews.values()) v.render(alpha);
    this.props.render(alpha);
    this.loot.render();
    this.projectileView.render(this.projectiles.list, alpha);
    this.eruptions.draw(this);
    this.story.stage.draw();
    this.pools.draw(this);
    this.swarms.draw(this, this.time.now);
    this.drawPlayerLight(feet.x, feet.y);
    const still = !!(this.menu || this.gear || this.mapOpen || this.story.active || this.warp);
    this.npcs.update(delta, this.player, still);
    const fightOn = !!this.arena.musicState() || this.enemies.some(e => !e.dead && COMBAT_STATES.has(e.stateName));
    this.chatter.update(delta, this.player, this.flags, still, fightOn, (x, y) => this.roomAt(x, y));
    this.ambience.update(delta, this.player, this.cameras.main.worldView, still || !!this.hitstop);
    if (!this.mapOpen) {
      // a musician at their instrument (sitting at it, not walking or talking) is heard across the area
      const harper = this.npcs.list.find(n => n.visible && DATA.npcs.npcs[n.npc].music && !n.walking && !n.held && n.pose === 'work' && this.npcs.speaking !== n.npc);
      this.ambientAudio.update(Math.min(delta, 100) / 1000, this.area, this.roomAt(this.player.x, this.player.y), this.player, this.flags, harper ?? null);
    }
    const fight = this.arena.musicState();
    this.bossMusic.update(fight, arena => this.flags.has(`boss:${arena}`));
    this.ambientAudio.duck(fight ? 0.35 : 1); // the world quietens under the music
    this.exploreMusic.update(Math.min(delta, 100) / 1000, this.area, !!fight || this.bossMusic.playing, 1 - 0.9 * this.ambientAudio.harpNear);
    this.arena.update(delta);
    // A script can point the camera elsewhere (cutscenes); otherwise it follows the player.
    const focus = this.story.cameraPoint ?? this.screenFx.cameraPoint;
    const camX = focus ? Math.round(focus.x) : feet.x;
    const camY = focus ? Math.round(focus.y) : feet.y;
    this.cam.apply(this.cameras.main, camX, camY, alpha, this.roomBounds(focus ? focus.x : this.player.x, focus ? focus.y : this.player.y), delta);
    this.enemyBars.draw(this.enemyViews.values(), fxDelta);
    this.lightCones.draw(this.enemies, this.grid);
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
    this.explosions.clear();
    this.eruptions.clear();
    this.screenFx.reset();
    this.pools.clear();
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
    this.ambience.build(this.rooms, this.grid, this.area);
    this.ambientAudio.build(this.rooms);
    this.worldView.build(this.grid, DATA.areas.areas[this.area].tileset);
    this.racks.build(this.rooms);
    this.shrines.build(this.rooms, id => this.flags.has(`shrine:${id}`), this.flags);
    this.pickups.build(this.rooms, id => this.flags.has(`item:${id}`));
    this.doors.build(this.rooms, this.grid, id => this.flags.has(`door:${id}`));
    this.props.build(this.ctxObj, this.rooms, this.brokenWall);
    this.swarms.build(this.ctxObj, this.rooms);
    this.hiveOut.clear();
    this.exits.build(this.rooms);
    this.npcs.build(this.rooms, this.flags);
    this.chatter.reset();
    this.arena.build(this.rooms);
    this.levers.build(this.rooms, this.leverPulled);
    this.notes.build(this.rooms, id => this.flags.has(`note:${id}`));
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
