// Player simulation state. No Phaser here: PlayerView renders it, interpolating prev -> current position.
import { DATA } from '../data/config';
import { AnimPlayer } from '../anim/AnimPlayer';
import { SPRITES } from '../data/assets';
import { Stamina } from '../actors/Stamina';
import { StateMachine } from '../actors/StateMachine';
import { Squash } from '../actors/Squash';
import { dir4FromAngle, dir8FromAngle, type Dir8 } from '../core/math';
import type { EventBus, GameEvents } from '../core/EventBus';
import type { Input } from '../input/Input';
import type { TileGrid } from '../world/TileGrid';
import { moveBox } from '../world/collision';
import { PLAYER_STATES } from './PlayerStates';

export interface PlayerCtx {
  input: Input;
  bus: EventBus<GameEvents>;
  grid: () => TileGrid;
}

export class Player {
  x: number;
  y: number;
  prevX: number;
  prevY: number;
  vx = 0;
  vy = 0;
  aimX = 0;
  aimY = 0;
  aimAngle = Math.PI / 2;
  moveX = 0;
  moveY = 0;
  moveMag = 0;
  hp: number;

  bodyDir: Dir8 = 'S';
  legsDir: Dir8 = 'S';
  legsVisible = true;
  weaponVisible = true;
  invulnerable = false;
  rollDirX = 0;
  rollDirY = 1;
  sprintNeedsRepress = false;
  slot = 0;

  readonly stamina = new Stamina(() => DATA.stamina, () => DATA.game.tickRate);
  readonly body = new AnimPlayer(SPRITES.player_body.animations);
  readonly legs = new AnimPlayer(SPRITES.player_legs.animations);
  readonly squash = new Squash();
  readonly sm: StateMachine<Player>;

  constructor(readonly ctx: PlayerCtx, x: number, y: number) {
    this.x = this.prevX = x;
    this.y = this.prevY = y;
    this.aimX = x;
    this.aimY = y + 32;
    this.hp = DATA.player.maxHp;
    this.body.play('idle');
    this.legs.play('idle');
    this.sm = new StateMachine<Player>(this, PLAYER_STATES, 'idle');
    this.sm.start();
  }

  get input() {
    return this.ctx.input;
  }
  get weaponId() {
    const list = DATA.player.startWeapons;
    return list[this.slot % list.length];
  }

  setAim(ax: number, ay: number) {
    this.aimX = ax;
    this.aimY = ay;
    this.aimAngle = Math.atan2(ay - (this.y + DATA.player.aimOriginY), ax - this.x);
  }

  tick() {
    this.prevX = this.x;
    this.prevY = this.y;
    this.moveX = this.input.moveX;
    this.moveY = this.input.moveY;
    this.moveMag = Math.min(1, Math.hypot(this.moveX, this.moveY));

    this.stamina.tick();
    this.sm.tick();
    this.updateAnims();
    this.squash.tick();
  }

  /** Approach a target velocity: fast acceleration, faster braking/reversal (no ice-skating). */
  accelerate(tx: number, ty: number) {
    const cfg = DATA.player;
    const braking = (tx === 0 && ty === 0) || tx * this.vx + ty * this.vy < 0;
    const rate = cfg.walkSpeed / (braking ? cfg.decelTicks : cfg.accelTicks);
    const dx = tx - this.vx;
    const dy = ty - this.vy;
    const len = Math.hypot(dx, dy);
    if (len <= rate) {
      this.vx = tx;
      this.vy = ty;
    } else {
      this.vx += (dx / len) * rate;
      this.vy += (dy / len) * rate;
    }
  }

  /** Move by the current velocity for one tick. */
  integrate() {
    const r = this.moveBy(this.vx / DATA.game.tickRate, this.vy / DATA.game.tickRate);
    if (r.hitX) this.vx = 0;
    if (r.hitY) this.vy = 0;
  }

  moveBy(dx: number, dy: number) {
    const c = DATA.player.collider;
    const r = moveBox(this.ctx.grid(), this.x, this.y, c.w / 2, c.h, dx, dy);
    this.x = r.x;
    this.y = r.y;
    return r;
  }

  swapWeapon() {
    this.slot = (this.slot + 1) % DATA.player.startWeapons.length;
  }

  refill() {
    this.hp = DATA.player.maxHp;
    this.stamina.refill();
  }

  private updateAnims() {
    const rolling = this.sm.name === 'roll';
    if (!rolling) this.bodyDir = dir8FromAngle(this.aimAngle);
    this.body.tick();

    const speed = Math.hypot(this.vx, this.vy);
    const cfg = DATA.player.legs;
    let events: string[];
    if (!rolling && speed > 4) {
      const moveAngle = Math.atan2(this.vy, this.vx);
      let legsAngle = moveAngle;
      let animSpeed = speed / cfg.walkAnimSpeedAt;
      if (cfg.backpedal === 'reverse' && Math.cos(moveAngle - this.aimAngle) < cfg.backpedalDot) {
        legsAngle = this.aimAngle; // face the aim and walk the cycle backwards
        animSpeed = -animSpeed;
      }
      this.legsDir = dir4FromAngle(legsAngle);
      this.legs.play('walk');
      events = this.legs.tick(animSpeed);
    } else {
      if (!rolling) this.legsDir = dir4FromAngle(this.aimAngle);
      this.legs.play('idle');
      events = this.legs.tick();
    }

    const dustMode = DATA.juice.dust.footstep;
    if (events.includes('footstep') && (dustMode === 'always' || (dustMode === 'sprint' && this.sm.name === 'sprint')))
      this.ctx.bus.emit('dust', { x: this.x, y: this.y, kind: 'step' });
  }
}
