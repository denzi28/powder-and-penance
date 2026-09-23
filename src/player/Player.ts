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
import type { Guard, HitInfo } from '../combat/CombatSystem';
import type { Enemy } from '../enemies/Enemy';
import { PLAYER_STATES } from './PlayerStates';

/** Weapon id that fills an empty slot. */
export const FISTS = 'fists';

export interface Ammo {
  clip: number;
  reserve: number;
}

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
  /** Ticks alive (for timing rules such as parry re-arm). */
  age = 0;

  bodyDir: Dir8 = 'S';
  legsDir: Dir8 = 'S';
  legsVisible = true;
  weaponVisible = true;
  rollDirX = 0;
  rollDirY = 1;
  sprintNeedsRepress = false;
  comboIndex = 0;
  /** Heavy attack charge ticks accumulated. */
  charge = 0;
  /** Freeze the body animation (heavy charge hold). */
  animHold = false;

  // Loadout
  slots: [string, string];
  slot = 0;
  shieldId: string | null;
  readonly ammo = new Map<string, Ammo>();

  // Resources
  /** Carried currency: dropped where you die. */
  tallow = 0;
  /** How solid the player is drawn (0..1): quick travel dissolves and re-forms them. */
  fade = 1;
  phials = { charges: DATA.phial.startCharges, max: DATA.phial.startCharges, level: 0 };
  /** Set once the current drink's heal has landed (a hit before that wastes the charge). */
  healApplied = false;
  /** Gun recoil 0..1 (decays), reload/swap progress 0..1 for the view and HUD. */
  recoil = 0;
  reloadProgress = -1;
  weaponLowered = false;

  // Shield
  blockReleasedAt = -Infinity;
  parryActive = false;

  // Critical (riposte / backstab) in progress
  crit: { victim: Enemy; kind: 'riposte' | 'backstab' } | null = null;
  /** Held by a grab strike. */
  grabbedBy: { by: Actor; holdTicks: number; damage: number; throwKnockback: number } | null = null;

  constructor(ctx: WorldCtx, x: number, y: number) {
    super(ctx, x, y);
    this.hp = this.maxHp;
    this.aimX = x;
    this.aimY = y + 32;
    this.slots = [...DATA.player.loadout.slots];
    this.shieldId = DATA.player.loadout.shield;
    this.enforceTwoHanded();
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
    return this.slots[this.slot];
  }
  get weapon() {
    return DATA.weapons[this.weaponId];
  }
  /** The usable shield: none while a two-handed weapon is held. */
  get shield() {
    if (!this.shieldId || this.weapon.twoHanded) return null;
    return DATA.shields[this.shieldId] ?? null;
  }

  ammoFor(weaponId: string): Ammo {
    let a = this.ammo.get(weaponId);
    if (!a) {
      const r = DATA.weapons[weaponId]?.ranged;
      a = { clip: r?.clip ?? 0, reserve: r?.reserveMax ?? 0 };
      this.ammo.set(weaponId, a);
    }
    return a;
  }

  setAim(ax: number, ay: number) {
    this.aimX = ax;
    this.aimY = ay;
    this.aimAngle = Math.atan2(ay - (this.y + DATA.player.aimOriginY), ax - this.x);
  }

  tick() {
    this.beginTick();
    this.age++;
    this.moveX = this.input.moveX;
    this.moveY = this.input.moveY;
    this.moveMag = Math.min(1, Math.hypot(this.moveX, this.moveY));
    this.recoil = Math.max(0, this.recoil - 0.12);

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

  guard(): Guard | null {
    const sh = this.shield;
    if (!sh || this.sm.name !== 'block') return null;
    return { facing: this.aimAngle, arcDeg: sh.arcDeg, parry: this.parryActive, stability: sh.stability, absorption: sh.absorption };
  }

  spendGuardStamina(cost: number): boolean {
    this.stamina.spend(cost);
    return this.stamina.value <= 0;
  }

  get healAmount() {
    return DATA.phial.healAmount + this.phials.level * DATA.phial.healPerLevel;
  }

  onHit(h: HitInfo) {
    if (h.killed) {
      this.sm.change('dead');
      return;
    }
    // Any damage before the heal lands interrupts the drink and wastes the charge.
    if (this.sm.name === 'heal' && !this.healApplied && h.damage > 0 && !h.staggered) this.sm.change('idle');
    if (h.blocked) {
      if (h.guardBroken) this.sm.change('guardBroken');
      else this.squash.set(DATA.juice.squash.hit);
      return;
    }
    this.ctx.bus.emit('sfx', { id: 'player_hurt' });
    if (h.staggered) this.sm.change('stagger', true);
    else this.squash.set(DATA.juice.squash.hit);
  }

  /** A two-handed weapon takes both hands: its slot is forced active and the other slot is disabled. */
  get lockedSlot(): number | null {
    const i = this.slots.findIndex(id => DATA.weapons[id]?.twoHanded);
    return i >= 0 ? i : null;
  }

  isSlotDisabled(i: number) {
    const l = this.lockedSlot;
    return l !== null && l !== i;
  }

  enforceTwoHanded() {
    const l = this.lockedSlot;
    if (l !== null) this.slot = l;
  }

  onGrabbed(by: Actor, grab: { holdTicks: number; damage: number; throwKnockback: number }) {
    if (this.dead || this.sm.name === 'grabbed') return;
    this.grabbedBy = { by, ...grab };
    this.sm.change('grabbed');
  }

  swapWeapon() {
    if (this.lockedSlot !== null) return;
    this.slot = (this.slot + 1) % this.slots.length;
  }

  /** Empty the active slot; the other weapon (if any) comes to hand. Returns the dropped weapon id. */
  dropActive(): string | null {
    const id = this.weaponId;
    if (id === FISTS) return null;
    this.slots[this.slot] = FISTS;
    const other = 1 - this.slot;
    if (this.slots[other] !== FISTS) this.slot = other;
    this.enforceTwoHanded();
    return id;
  }

  /**
   * Take a weapon into hand: fills the active slot if empty, else the other empty slot; with both full it
   * replaces the active weapon. Returns the weapon that had to be let go (to drop on the floor), if any.
   */
  equip(id: string): string | null {
    let released: string | null = null;
    if (this.slots[this.slot] === FISTS) this.slots[this.slot] = id;
    else if (this.slots[1 - this.slot] === FISTS) {
      this.slot = 1 - this.slot;
      this.slots[this.slot] = id;
    } else {
      released = this.slots[this.slot];
      this.slots[this.slot] = id;
    }
    this.ammoFor(id);
    this.enforceTwoHanded();
    return released;
  }

  /** Shrine rest / respawn: full HP, stamina, phials and ammo. */
  refill() {
    this.hp = this.maxHp;
    this.stamina.refill();
    this.phials.charges = this.phials.max;
    this.ammo.clear(); // refilled lazily to full
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
    else if (st !== 'roll' && st !== 'dead' && st !== 'stagger' && st !== 'guardBroken' && st !== 'rest' && st !== 'grabbed')
      this.bodyDir = dir8FromAngle(this.aimAngle);
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
