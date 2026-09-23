// Player simulation state. No Phaser here: PlayerView renders it, interpolating prev -> current position.
import { DATA } from '../data/config';
import { AnimPlayer } from '../anim/AnimPlayer';
import { SPRITES } from '../data/assets';
import { Actor } from '../actors/Actor';
import { Stamina } from '../actors/Stamina';
import { StateMachine } from '../actors/StateMachine';
import { Poise } from '../actors/Poise';
import { dir4FromAngle, dir8FromAngle, type Dir8 } from '../core/math';
import type { WorldCtx } from '../core/World';
import type { HitInfo } from '../combat/CombatSystem';
import { PLAYER_STATES } from './PlayerStates';

export class Player extends Actor {
  readonly team = 'player' as const;
  readonly poise = new Poise(() => DATA.player.poise);
  readonly stamina = new Stamina(() => DATA.stamina, () => DATA.game.tickRate);
  readonly body = new AnimPlayer(SPRITES.player_body.animations);
  readonly legs = new AnimPlayer(SPRITES.player_legs.animations);
  readonly sm: StateMachine<Player>;

  aimX: number;
  aimY: number;
  aimAngle = Math.PI / 2;
  moveX = 0;
  moveY = 0;
  moveMag = 0;

  bodyDir: Dir8 = 'S';
  legsDir: Dir8 = 'S';
  legsVisible = true;
  weaponVisible = true;
  rollDirX = 0;
  rollDirY = 1;
  sprintNeedsRepress = false;
  slot = 0;
  comboIndex = 0;
  /** Heavy attack charge ticks accumulated. */
  charge = 0;
  /** Freeze the body animation (heavy charge hold). */
  animHold = false;

  constructor(ctx: WorldCtx, x: number, y: number) {
    super(ctx, x, y);
    this.hp = this.maxHp;
    this.aimX = x;
    this.aimY = y + 32;
    this.body.play('idle');
    this.legs.play('idle');
    this.sm = new StateMachine<Player>(this, PLAYER_STATES, 'idle');
    this.sm.start();
  }

  get input() {
    return this.ctx.input;
  }
  get maxHp() {
    return DATA.player.maxHp;
  }
  get collider() {
    return DATA.player.collider;
  }
  get hurtbox() {
    return DATA.player.hurtbox;
  }
  get bodyRadius() {
    return DATA.player.bodyRadius;
  }
  get bloodColor() {
    return 'blood2';
  }
  get stateName() {
    return this.sm.name;
  }
  get stateTick() {
    return this.sm.t;
  }
  get weaponId() {
    const list = DATA.player.startWeapons;
    return list[this.slot % list.length];
  }
  get weapon() {
    return DATA.weapons[this.weaponId];
  }

  setAim(ax: number, ay: number) {
    this.aimX = ax;
    this.aimY = ay;
    this.aimAngle = Math.atan2(ay - (this.y + DATA.player.aimOriginY), ax - this.x);
  }

  tick() {
    this.beginTick();
    this.moveX = this.input.moveX;
    this.moveY = this.input.moveY;
    this.moveMag = Math.min(1, Math.hypot(this.moveX, this.moveY));

    this.stamina.tick();
    this.sm.tick();
    this.applyKnockback();
    this.hyperArmor = this.runner?.hyperArmor ?? 0;
    if (this.runner) {
      const pose = this.runner.pose();
      this.weaponAngle = pose.angle;
      this.weaponReach = pose.reach;
    } else {
      this.weaponAngle = null;
      this.weaponReach = 0;
    }
    this.updateAnims();
    this.squash.tick();
  }

  onHit(h: HitInfo) {
    this.ctx.bus.emit('sfx', { id: 'player_hurt' });
    if (h.killed) this.sm.change('dead');
    else if (h.staggered) this.sm.change('stagger', true);
    else this.squash.set(DATA.juice.squash.hit);
  }

  swapWeapon() {
    this.slot = (this.slot + 1) % DATA.player.startWeapons.length;
  }

  refill() {
    this.hp = this.maxHp;
    this.stamina.refill();
  }

  respawn(x: number, y: number) {
    this.x = this.prevX = x;
    this.y = this.prevY = y;
    this.vx = this.vy = this.kbx = this.kby = 0;
    this.dead = false;
    this.flash = 0;
    this.refill();
    this.poise.reset();
    this.sm.change('idle', true);
  }

  private updateAnims() {
    const st = this.sm.name;
    if (this.runner) this.bodyDir = dir8FromAngle(this.runner.angle);
    else if (st !== 'roll' && st !== 'dead' && st !== 'stagger') this.bodyDir = dir8FromAngle(this.aimAngle);
    this.body.tick(this.animHold ? 0 : 1);

    if (!this.legsVisible) return;
    const speed = Math.hypot(this.vx, this.vy);
    const cfg = DATA.player.legs;
    let events: string[];
    if (speed > 4 && !this.runner) {
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
      this.legsDir = dir4FromAngle(this.runner ? this.runner.angle : this.aimAngle);
      this.legs.play('idle');
      events = this.legs.tick();
    }

    if (events.includes('footstep')) {
      this.ctx.bus.emit('sfx', { id: 'footstep', volume: st === 'sprint' ? 1.3 : 1 });
      const dustMode = DATA.juice.dust.footstep;
      if (dustMode === 'always' || (dustMode === 'sprint' && st === 'sprint'))
        this.ctx.bus.emit('dust', { x: this.x, y: this.y, kind: 'step' });
    }
  }
}
