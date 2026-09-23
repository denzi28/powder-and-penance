// Owns the simulation (fixed 60 Hz ticks) and world rendering. HUD lives in UIScene on top.
import Phaser from 'phaser';
import { DATA, onDataReload } from '../data/config';
import { FixedLoop } from '../core/FixedLoop';
import { EventBus, type GameEvents } from '../core/EventBus';
import { Input } from '../input/Input';
import { SpriteLib } from '../anim/SpriteLib';
import { buildGrid, TILE, type TileGrid } from '../world/TileGrid';
import { WorldView } from '../world/WorldView';
import { Player } from '../player/Player';
import { PlayerView } from '../player/PlayerView';
import { CameraRig } from '../render/CameraRig';
import { Fx } from '../render/Fx';
import { DebugOverlay } from '../debug/DebugOverlay';
import { installDebugKeys } from '../debug/DebugKeys';

export class GameScene extends Phaser.Scene {
  loop!: FixedLoop;
  controls!: Input;
  bus = new EventBus<GameEvents>();
  lib!: SpriteLib;
  grid!: TileGrid;
  player!: Player;
  debug!: DebugOverlay;
  tickCount = 0;
  hitstop = 0;

  private worldView!: WorldView;
  private playerView!: PlayerView;
  private cam!: CameraRig;
  private fx!: Fx;
  private roomsJson = '';

  constructor() {
    super('game');
  }

  create() {
    this.lib = new SpriteLib(this);
    this.controls = new Input(() => DATA.input);
    this.controls.attach(this.game.canvas);
    this.game.canvas.style.cursor = 'none';

    this.worldView = new WorldView(this, this.lib);
    this.buildWorld();

    const spawn = this.findSpawn();
    this.player = new Player({ input: this.controls, bus: this.bus, grid: () => this.grid }, spawn.x, spawn.y);
    this.playerView = new PlayerView(this, this.player, this.lib);

    this.cam = new CameraRig();
    this.fx = new Fx(this, this.lib);
    this.debug = new DebugOverlay(this);
    this.bus.on('dust', e => this.fx.spawn('dust', e.kind === 'roll' ? 'puff' : 'step', e.x, e.y));
    this.bus.on('shake', e => this.cam.addTrauma(e.trauma));

    this.loop = new FixedLoop(() => DATA.game.tickRate, () => DATA.game.maxStepsPerFrame, () => this.tick());

    const offReload = onDataReload(() => this.onDataReload());
    const offKeys = installDebugKeys(this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      offReload();
      offKeys();
      this.controls.dispose();
    });

    this.scene.launch('ui');
  }

  private tick() {
    this.tickCount++;
    this.controls.beginTick(this.tickCount);
    this.cam.tickShake();
    if (this.hitstop > 0) {
      this.hitstop--;
      return;
    }
    const lead = this.updateAim();
    this.player.tick();
    this.cam.tick(lead.x, lead.y);
  }

  update(_time: number, delta: number) {
    const alpha = this.loop.frame(delta);
    this.fx.update(delta * (this.loop.frozen ? 0 : this.loop.timeScale));
    const feet = this.playerView.render(alpha);
    this.cam.apply(this.cameras.main, feet.x, feet.y, alpha);
    this.debug.draw(this.player, feet.x, feet.y);
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
    if (JSON.stringify(this.areaRooms()) !== this.roomsJson) this.buildWorld();
  }
}
