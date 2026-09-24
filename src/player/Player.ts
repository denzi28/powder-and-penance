// Player simulation state. No Phaser here: PlayerView renders it, interpolating prev -> current position.
import { DATA } from '../data/config';
import type { LoadCfg } from '../data/schemas';
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
  readonly poise = new Poise(() => ({ ...DATA.player.poise, max: DATA.player.poise.max + this.armourPoise }));
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
  /** The current roll's shape (set as it starts, from the equip load). */
  rollCfg: ReturnType<typeof rollFor> | null = null;
  /** Freeze the body animation (heavy charge hold). */
  animHold = false;

  // Loadout
  slots: [string, string];
  slot = 0;
  shieldId: string | null;
  /** Armour worn (data/armour ids). */
  readonly worn: { head: string | null; body: string | null } = { head: null, body: null };
  /** Everything owned (equipped or not). Fists aren't listed: they're always there. */
  readonly inv: { weapons: string[]; shields: string[]; armour: string[] } = { weapons: [], shields: [], armour: [] };
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
    for (const id of this.slots) if (id !== FISTS && !this.inv.weapons.includes(id)) this.inv.weapons.push(id);
    if (this.shieldId) this.inv.shields.push(this.shieldId);
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

  // ------------------------------------------------------------------ gear and equip load
  get armourPieces() {
    return [this.worn.head, this.worn.body].filter((id): id is string => !!id && !!DATA.armour[id]).map(id => DATA.armour[id]);
  }
  get armourAbsorb() {
    return Math.min(0.5, this.armourPieces.reduce((a, p) => a + p.absorb, 0));
  }
  get armourPoise() {
    return this.armourPieces.reduce((a, p) => a + p.poise, 0);
  }
  override get damageTakenMult() {
    return 1 - this.armourAbsorb;
  }

  /** Weight of everything equipped: both hands, the shield and armour. */
  get equipLoad() {
    return loadOf({ slots: this.slots, shield: this.shieldId, head: this.worn.head, body: this.worn.body });
  }
  get loadTier() {
    return loadTier(this.equipLoad);
  }

  /** The roll as your equip load makes it (see data/config/load.json). */
  rollParams() {
    return rollFor(this.loadTier);
  }

  /** Put gear in the inventory. Returns false if it was already there. */
  give(kind: 'weapon' | 'shield' | 'armour', id: string): boolean {
    const list = kind === 'weapon' ? this.inv.weapons : kind === 'shield' ? this.inv.shields : this.inv.armour;
    if (list.includes(id) || id === FISTS) return false;
    list.push(id);
    if (kind === 'weapon') this.ammoFor(id);
    return true;
  }

  /** Take gear out of the inventory (unequipping it). */
  lose(kind: 'weapon' | 'shield' | 'armour', id: string) {
    if (kind === 'weapon') {
      this.inv.weapons = this.inv.weapons.filter(w => w !== id);
      this.slots = this.slots.map(w => (w === id ? FISTS : w)) as [string, string];
      this.enforceTwoHanded();
    } else if (kind === 'shield') {
      this.inv.shields = this.inv.shields.filter(w => w !== id);
      if (this.shieldId === id) this.shieldId = null;
    } else {
      this.inv.armour = this.inv.armour.filter(w => w !== id);
      if (this.worn.head === id) this.worn.head = null;
      if (this.worn.body === id) this.worn.body = null;
    }
  }

  /** Put an owned weapon (or fists) in hand slot i; if it's in the other hand it moves over. */
  setSlot(i: 0 | 1, id: string) {
    if (id !== FISTS && !this.inv.weapons.includes(id)) return;
    if (id !== FISTS && this.slots[1 - i] === id) this.slots[1 - i] = FISTS;
    this.slots[i] = id;
    this.ammoFor(id);
    const l = this.lockedSlot;
    this.slot = l ?? (this.slots[this.slot] === FISTS && this.slots[1 - this.slot] !== FISTS ? 1 - this.slot : this.slot);
  }

  setShield(id: string | null) {
    if (id && !this.inv.shields.includes(id)) return;
    this.shieldId = id;
  }

  setArmour(slot: 'head' | 'body', id: string | null) {
    if (id && (!this.inv.armour.includes(id) || DATA.armour[id]?.slot !== slot)) return;
    this.worn[slot] = id;
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
    this.ctx.bus.emit('sfx', { id: 'p_hurt' });
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
    this.inv.weapons = this.inv.weapons.filter(w => w !== id);
    this.slots[this.slot] = FISTS;
    const other = 1 - this.slot;
    if (this.slots[other] !== FISTS) this.slot = other;
    this.enforceTwoHanded();
    return id;
  }

  /**
   * A weapon picked up: it goes into the inventory, and into an empty hand if there is one (the active one
   * first). With both hands full it just goes in the pack. Returns true if it came to hand.
   */
  pickUpWeapon(id: string): boolean {
    this.give('weapon', id);
    if (this.slots.includes(id)) return true;
    if (this.slots[this.slot] === FISTS) this.slots[this.slot] = id;
    else if (this.slots[1 - this.slot] === FISTS) {
      this.slot = 1 - this.slot;
      this.slots[this.slot] = id;
    } else return false;
    this.enforceTwoHanded();
    return true;
  }

  /** Take a weapon from a rack straight into the active hand (the one it replaces stays in the pack). */
  equip(id: string) {
    this.give('weapon', id);
    this.setSlot(this.slot as 0 | 1, id);
    this.enforceTwoHanded();
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
      this.ctx.bus.emit('footstep', { x: this.x, y: this.y, sprint: st === 'sprint' });
      const dustMode = DATA.juice.dust.footstep;
      if (dustMode === 'always' || (dustMode === 'sprint' && st === 'sprint'))
        this.ctx.bus.emit('dust', { x: this.x, y: this.y, kind: 'step' });
    }
  }
}

// ------------------------------------------------------------------ equip load (pure, shared with the menus)
export interface Gear {
  slots: readonly string[];
  shield: string | null;
  head: string | null;
  body: string | null;
}

/** Total weight of a set of equipped gear. */
export function loadOf(g: Gear): number {
  let w = 0;
  for (const id of new Set(g.slots)) w += DATA.weapons[id]?.weight ?? 0;
  if (g.shield) w += DATA.shields[g.shield]?.weight ?? 0;
  for (const a of [g.head, g.body]) if (a) w += DATA.armour[a]?.weight ?? 0;
  return Math.round(w * 10) / 10;
}

/** The load tier for a weight: the first whose `upTo` (a fraction of capacity) it fits under. */
export function loadTier(load: number) {
  const tiers = DATA.load.tiers;
  const f = load / DATA.load.capacity;
  return tiers.find(t => f <= t.upTo + 1e-9) ?? tiers[tiers.length - 1];
}

/** The base roll (data/config/roll.json) reshaped by a load tier. */
export function rollFor(tier: LoadCfg['tiers'][number]) {
  const c = DATA.roll;
  const m = tier.roll;
  const travelTicks = Math.max(6, Math.round(c.travelTicks * m.travel));
  const recover = Math.round((c.totalTicks - c.travelTicks) * m.recover);
  const totalTicks = travelTicks + recover;
  const iframeEnd = Math.max(c.iframeStart, Math.min(travelTicks, c.iframeEnd + m.iframes));
  return {
    stamina: c.stamina * m.stamina,
    distance: c.distance * m.distance,
    travelTicks,
    totalTicks,
    iframeStart: c.iframeStart,
    iframeEnd,
    curvePower: c.curvePower,
    cancelFrom: totalTicks - (c.totalTicks - c.cancelFrom),
    moveCancelFrom: totalTicks - (c.totalTicks - c.moveCancelFrom),
    tier: tier.id,
  };
}
