// Player simulation state. No Phaser here: PlayerView renders it, interpolating prev -> current position.
import { DATA } from '../data/config';
import type { LoadCfg, Mods, StatName } from '../data/schemas';
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
  // Consumables, rings and timed effects (declared first: stamina and poise read them)
  /** Consumables carried: id -> how many. */
  readonly pack = new Map<string, number>();
  /** The consumable on the quick-use belt (cycled through what you carry). */
  belt: string | null = null;
  /** Worn rings (data/rings ids). */
  readonly rings: [string | null, string | null] = [null, null];
  /** Timed effects from consumables: ticks left of each. */
  buffs: { id: string; ticks: number; total: number }[] = [];
  /** Healing spread over time (honeycomb): HP still to come and HP per tick. */
  regen: { id: string; left: number; total: number; perTick: number; acc: number } | null = null;
  /** The consumable being used (useItem state). */
  using: string | null = null;
  /** Stats raised at Maudlin (each starts at DATA.levels.start). */
  stats: Record<StatName, number> = startStats();
  /** Bede's upgrades: weapon id -> +level. */
  upgrades: Record<string, number> = {};
  /** Oskar's shop: entry id -> how many bought. */
  bought: Record<string, number> = {};

  readonly poise = new Poise(() => ({ ...DATA.player.poise, max: DATA.player.poise.max + this.armourPoise + this.mods.poise }));
  readonly stamina = new Stamina(
    () => {
      const m = this.mods;
      const fromEnd = (this.stats.endurance - DATA.levels.start) * DATA.levels.endurance.staminaPerPoint;
      return { ...DATA.stamina, max: DATA.stamina.max + fromEnd + m.stamina, regenPerSec: DATA.stamina.regenPerSec * m.staminaRegen };
    },
    () => DATA.game.tickRate,
  );
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
  /** Ticks the drop key has been held. */
  dropHold = 0;
  /** Freeze the body animation (heavy charge hold). */
  animHold = false;

  // Loadout: two hands. slots[0] is the right hand's weapon, slots[1] the left hand's (fists when it's empty
  // or holds the shield). A two-handed weapon is always in the right hand and leaves the left empty.
  slots: [string, string];
  /** The hand in use (0 right, 1 left): the one last swung or fired with, and drawn. */
  slot = 0;
  shieldId: string | null;
  /** Armour worn (data/armour ids). */
  readonly worn: { head: string | null; body: string | null } = { head: null, body: null };
  /** Everything owned (equipped or not). Fists aren't listed: they're always there. */
  readonly inv: { weapons: string[]; shields: string[]; armour: string[]; rings: string[] } = { weapons: [], shields: [], armour: [], rings: [] };
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
    this.normalizeHands();
    this.body.play('idle');
    this.legs.play('idle');
    this.sm = new StateMachine<Player>(this, PLAYER_STATES, 'idle');
    this.sm.start();
  }

  get input() {
    return this.ctx.input;
  }
  get maxHp() {
    return Math.round(DATA.player.maxHp + vitalityHp(this.stats.vitality) + this.mods.maxHp);
  }
  /** Level: 1 plus every point spent at Maudlin. */
  get level() {
    return levelOf(this.stats);
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
  /** The shield on the left arm (never there with a two-handed weapon). */
  get shield() {
    if (!this.shieldId || DATA.weapons[this.slots[0]]?.twoHanded) return null;
    return DATA.shields[this.shieldId] ?? null;
  }
  /** A two-handed weapon is in hand (it takes both hands). */
  get twoHanding() {
    return !!DATA.weapons[this.slots[0]]?.twoHanded;
  }
  /** The left hand's weapon, if it holds one (not a shield, not empty). */
  get leftWeapon(): string | null {
    return this.slots[1] !== FISTS ? this.slots[1] : null;
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
    return (1 - this.armourAbsorb) * this.mods.damageTaken;
  }

  /** Rings and timed effects together. */
  get mods(): FullMods {
    const list: Mods[] = [];
    for (const r of this.rings) if (r && DATA.rings[r]) list.push(DATA.rings[r].mods);
    for (const b of this.buffs) {
      const u = DATA.consumables[b.id]?.use;
      if (u?.type === 'buff') list.push(u.mods);
    }
    return combineMods(list);
  }

  /** Rings and effects, and for a weapon's own hits its upgrade and your Strength/Dexterity (a thrown
   *  consumable is a projectile without a weapon). */
  override damageDealtMult(kind: 'melee' | 'projectile' | 'critical', weapon?: string) {
    const m = this.mods;
    const w = weapon ?? (kind === 'projectile' ? null : this.weaponId);
    const own = w ? weaponMult(w, this.stats, this.upgrades[w] ?? 0) : 1;
    return own * m.damage * (kind === 'projectile' ? m.rangedDamage : 1) * (this.hp <= this.maxHp * 0.3 ? m.desperate : 1);
  }

  /** Wax, mud and spilled pools slow you less when sure-footed. */
  override terrainMult() {
    const k = super.terrainMult();
    return k + (1 - k) * this.mods.sureFooted;
  }

  /** Weight of everything equipped: both hands, the shield and armour. */
  get equipLoad() {
    return loadOf({ slots: this.slots, shield: this.shieldId, head: this.worn.head, body: this.worn.body });
  }
  /** Equip load capacity (rings can raise it). */
  get capacity() {
    const fromEnd = (this.stats.endurance - DATA.levels.start) * DATA.levels.endurance.capacityPerPoint;
    return Math.round((DATA.load.capacity + fromEnd) * this.mods.capacity * 10) / 10;
  }
  get loadTier() {
    return loadTier(this.equipLoad, this.capacity);
  }

  /** The roll as your equip load makes it (see data/config/load.json). */
  rollParams() {
    const r = rollFor(this.loadTier);
    return { ...r, stamina: r.stamina * this.mods.rollCost };
  }

  // ------------------------------------------------------------------ consumables and rings
  count(id: string) {
    return this.pack.get(id) ?? 0;
  }

  /** Add consumables (up to what can be carried). Returns how many were actually taken. */
  addItem(id: string, n: number): number {
    const c = DATA.consumables[id];
    if (!c) return 0;
    const took = Math.max(0, Math.min(n, c.max - this.count(id)));
    if (took) this.pack.set(id, this.count(id) + took);
    if (c.use.type !== 'material' && (!this.belt || !this.count(this.belt))) this.belt = id;
    return took;
  }

  /** Spend consumables or materials (e.g. at the smith). Returns false (and spends nothing) if short. */
  spendItem(id: string, n: number): boolean {
    if (this.count(id) < n) return false;
    if (this.count(id) === n) this.pack.delete(id);
    else this.pack.set(id, this.count(id) - n);
    if (this.belt && !this.count(this.belt)) this.cycleBelt();
    return true;
  }

  /** Everything in the pack, in data order (the inventory lists these). */
  get carried(): string[] {
    return Object.keys(DATA.consumables).filter(id => this.count(id) > 0);
  }
  /** What can go on the belt: carried, and usable (not a smith's material). */
  get beltable(): string[] {
    return this.carried.filter(id => DATA.consumables[id].use.type !== 'material');
  }

  /** Next (or previous) usable consumable onto the belt. */
  cycleBelt(dir = 1) {
    const list = this.beltable;
    if (!list.length) {
      this.belt = null;
      return;
    }
    const i = this.belt ? list.indexOf(this.belt) : -1;
    this.belt = list[(i + dir + list.length) % list.length];
  }

  /** Put an owned ring on finger i (moving it off the other finger), or take the ring there off. */
  setRing(i: 0 | 1, id: string | null) {
    if (id && !this.inv.rings.includes(id)) return;
    if (id && this.rings[1 - i] === id) this.rings[1 - i] = null;
    this.rings[i] = id;
  }

  /**
   * Use one of the belt's consumable now (the useItem state calls this at the moment it lands). Returns what
   * happened for the presentation, or null if there was nothing to use.
   */
  applyConsumable(id: string): boolean {
    const c = DATA.consumables[id];
    if (!c || this.count(id) <= 0 || c.use.type === 'material') return false;
    const n = this.count(id) - 1;
    if (n) this.pack.set(id, n);
    else {
      this.pack.delete(id);
      this.cycleBelt();
      if (this.belt === id) this.belt = null;
    }
    const u = c.use;
    const ctx = this.ctx;
    switch (u.type) {
      case 'throw': {
        const hand = 8;
        const x = this.x + Math.cos(this.aimAngle) * hand;
        const y = this.y + Math.sin(this.aimAngle) * hand;
        let target: { x: number; y: number } | undefined;
        if (u.projectile.lob) {
          // lands where you aim (on the ground), up to a stone's throw away
          const dx = this.aimX - this.x;
          const dy = this.aimY - this.y;
          const k = Math.min(1, THROW_REACH / Math.max(1, Math.hypot(dx, dy)));
          target = { x: this.x + dx * k, y: this.y + dy * k };
        }
        ctx.projectiles.spawn(this, x, y, this.aimAngle, u.projectile, target);
        break;
      }
      case 'regen':
        this.regen = { id, left: u.amount, total: u.amount, perTick: u.amount / u.ticks, acc: 0 };
        break;
      case 'buff': {
        this.buffs = this.buffs.filter(b => b.id !== id);
        this.buffs.push({ id, ticks: u.ticks, total: u.ticks });
        if (u.lose) for (const e of ctx.enemies()) e.loseTrack();
        break;
      }
      case 'reload':
        for (const wid of new Set(this.slots)) {
          const r = DATA.weapons[wid]?.ranged;
          if (!r) continue;
          const a = this.ammoFor(wid);
          a.clip = r.clip;
          a.reserve = Math.min(r.reserveMax, a.reserve + Math.ceil(r.reserveMax * u.reserve));
        }
        break;
      case 'tallow':
        this.tallow += u.amount;
        break;
    }
    ctx.bus.emit('itemUsed', { id, x: this.x, y: this.y });
    return true;
  }

  private tickEffects() {
    for (const b of this.buffs) b.ticks--;
    const ended = this.buffs.filter(b => b.ticks <= 0);
    if (ended.length) {
      this.buffs = this.buffs.filter(b => b.ticks > 0);
      for (const b of ended) this.ctx.bus.emit('buffEnded', { id: b.id });
    }
    const r = this.regen;
    if (r && !this.dead) {
      r.acc += r.perTick;
      const whole = Math.min(r.left, Math.floor(r.acc));
      if (whole > 0) {
        r.acc -= whole;
        r.left -= whole;
        this.hp = Math.min(this.maxHp, this.hp + whole);
      }
      if (r.left <= 0) this.regen = null;
    }
    if (this.hp > this.maxHp) this.hp = this.maxHp;
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
      this.normalizeHands();
    } else if (kind === 'shield') {
      this.inv.shields = this.inv.shields.filter(w => w !== id);
      if (this.shieldId === id) this.shieldId = null;
    } else {
      this.inv.armour = this.inv.armour.filter(w => w !== id);
      if (this.worn.head === id) this.worn.head = null;
      if (this.worn.body === id) this.worn.body = null;
    }
  }

  get hands(): Hands {
    return { right: this.slots[0], left: this.slots[1], shield: this.shieldId };
  }
  private setHands(h: Hands) {
    this.slots = [h.right, h.left];
    this.shieldId = h.shield;
    for (const id of this.slots) this.ammoFor(id);
    // stay on the hand in use if it still holds something; otherwise whichever hand does
    if (this.slots[this.slot] === FISTS && this.slots[1 - this.slot] !== FISTS) this.slot = 1 - this.slot;
    if (this.twoHanding || (this.slot === 1 && this.slots[1] === FISTS)) this.slot = 0;
  }

  /** Put an owned weapon (or fists) in a hand: 0 right, 1 left (see equipHand for the rules). */
  setSlot(i: 0 | 1, id: string) {
    if (id !== FISTS && !this.inv.weapons.includes(id)) return;
    this.setHands(equipHand(this.hands, i === 0 ? 'right' : 'left', id));
  }

  /** Strap a shield on the left arm (it replaces a left-hand weapon, and a two-handed weapon), or take it off. */
  setShield(id: string | null) {
    if (id && !this.inv.shields.includes(id)) return;
    this.setHands(id ? equipHand(this.hands, 'left', id) : { ...this.hands, shield: null });
  }

  /** Make the hands obey the rules (after loading a save, or losing a weapon). */
  normalizeHands() {
    this.setHands(normalizeHands(this.hands));
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
    this.tickEffects();
    if (this.input.consume('cycleItem') && this.beltable.length) {
      this.cycleBelt();
      this.ctx.bus.emit('sfx', { id: 'p_belt' });
    }
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
    return Math.round((DATA.phial.healAmount + this.phials.level * DATA.phial.healPerLevel) * this.mods.heal);
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


  onGrabbed(by: Actor, grab: { holdTicks: number; damage: number; throwKnockback: number }) {
    if (this.dead || this.sm.name === 'grabbed') return;
    this.grabbedBy = { by, ...grab };
    this.sm.change('grabbed');
  }

  /** Drop the weapon in the hand in use on the ground (it leaves the inventory). Returns its id. */
  dropActive(): string | null {
    const id = this.weaponId;
    if (id === FISTS) return null;
    this.inv.weapons = this.inv.weapons.filter(w => w !== id);
    const h = this.hands;
    this.setHands(this.slot === 0 ? { ...h, right: FISTS } : { ...h, left: FISTS });
    return id;
  }

  /**
   * A weapon picked up: it goes into the inventory, and into a free hand if there is one: the right hand first,
   * then (one-handed weapons) an empty left hand. A two-handed weapon only comes to hand if both are free.
   * Otherwise it goes in the pack. Returns true if it came to hand.
   */
  pickUpWeapon(id: string): boolean {
    this.give('weapon', id);
    if (this.slots.includes(id)) return true;
    const h = this.hands;
    const leftFree = h.left === FISTS && !h.shield;
    const twoH = !!DATA.weapons[id]?.twoHanded;
    if (h.right === FISTS && (!twoH || leftFree)) this.setSlot(0, id);
    else if (!twoH && leftFree && !this.twoHanding) this.setSlot(1, id);
    else return false;
    return true;
  }

  /** Take a weapon from a rack straight into the right hand (the one it replaces stays in the pack). */
  equip(id: string) {
    this.give('weapon', id);
    this.setSlot(0, id);
    this.slot = 0;
  }

  /** Shrine rest / respawn: full HP, stamina, phials and ammo. */
  refill() {
    this.buffs = [];
    this.regen = null;
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

// ------------------------------------------------------------------ hands (pure, shared with the menus)
/** What the two hands hold: the right hand's weapon, the left hand's weapon (fists if none), the left arm's shield. */
export interface Hands {
  right: string;
  left: string;
  shield: string | null;
}

const isTwoHanded = (id: string) => !!DATA.weapons[id]?.twoHanded;

/**
 * Put something in a hand. The right hand holds a weapon (fists when empty). The left hand holds a shield, a
 * one-handed weapon, or nothing (null). A two-handed weapon takes both hands: it goes in the right hand and
 * empties the left, and putting a shield or weapon in the left hand takes it off. The same weapon can't be in
 * both hands: it moves over.
 */
export function equipHand(h: Hands, hand: 'right' | 'left', id: string | null): Hands {
  const out = { ...h };
  if (hand === 'right' || (id && isTwoHanded(id))) {
    const w = id ?? FISTS;
    if (w !== FISTS && out.left === w) out.left = FISTS;
    out.right = w;
    if (isTwoHanded(w)) {
      out.left = FISTS;
      out.shield = null;
    }
    return out;
  }
  if (id === null || id === FISTS) return { ...out, left: FISTS, shield: null };
  if (DATA.shields[id]) {
    out.shield = id;
    out.left = FISTS;
  } else {
    if (out.right === id) out.right = FISTS;
    out.left = id;
    out.shield = null;
  }
  if (isTwoHanded(out.right)) out.right = FISTS;
  return out;
}

/** Fix hands that break the rules (an old save): a two-hander goes to the right hand alone; a shield beats a
 *  left-hand weapon. */
export function normalizeHands(h: Hands): Hands {
  const out = { ...h };
  if (isTwoHanded(out.left)) {
    if (out.right === FISTS) out.right = out.left;
    out.left = FISTS;
  }
  if (isTwoHanded(out.right)) {
    out.left = FISTS;
    out.shield = null;
  }
  if (out.shield && out.left !== FISTS) out.left = FISTS;
  if (out.left === out.right) out.left = FISTS;
  return out;
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
export function loadTier(load: number, capacity = DATA.load.capacity) {
  const tiers = DATA.load.tiers;
  const f = load / capacity;
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

// ------------------------------------------------------------------ modifiers (rings, timed effects)
/** How far a lobbed throw can land. */
export const THROW_REACH = 120;

export type FullMods = Required<Mods>;

/** Several sets of modifiers as one: additions add, multipliers multiply, fractions take the largest. */
export function combineMods(list: readonly Mods[]): FullMods {
  const m: FullMods = {
    maxHp: 0, stamina: 0, poise: 0,
    staminaRegen: 1, rollCost: 1, damage: 1, rangedDamage: 1, desperate: 1, damageTaken: 1, heal: 1, notice: 1, tallowGain: 1, capacity: 1,
    reload: 1, prices: 1, spread: 1,
    keepTallow: 0, sureFooted: 0,
  };
  for (const x of list) {
    m.maxHp += x.maxHp ?? 0;
    m.stamina += x.stamina ?? 0;
    m.poise += x.poise ?? 0;
    for (const k of ['staminaRegen', 'rollCost', 'damage', 'rangedDamage', 'desperate', 'damageTaken', 'heal', 'notice', 'tallowGain', 'capacity', 'reload', 'prices', 'spread'] as const)
      m[k] *= x[k] ?? 1;
    m.keepTallow = Math.max(m.keepTallow, x.keepTallow ?? 0);
    m.sureFooted = Math.max(m.sureFooted, x.sureFooted ?? 0);
  }
  return m;
}

// ------------------------------------------------------------------ levels, scaling, upgrades (pure)
export const STATS: readonly StatName[] = ['vitality', 'endurance', 'strength', 'dexterity'];

export function startStats(): Record<StatName, number> {
  const v = DATA.levels.start;
  return { vitality: v, endurance: v, strength: v, dexterity: v };
}

/** 1 plus every point spent. */
export function levelOf(stats: Record<StatName, number>): number {
  return 1 + STATS.reduce((a, k) => a + stats[k] - DATA.levels.start, 0);
}

/** Tallow to go from `level` to the next. */
export function levelCost(level: number): number {
  const c = DATA.levels.cost;
  const n = level - 1;
  return Math.round(c.base + c.linear * n + c.quad * n * n);
}

/** HP that Vitality adds over the start. */
export function vitalityHp(vitality: number): number {
  const v = DATA.levels.vitality;
  const pts = vitality - DATA.levels.start;
  const first = Math.min(pts, v.softCap - DATA.levels.start);
  return first * v.hpPerPoint + Math.max(0, pts - first) * v.hpAfterCap;
}

/** How much a stat adds to a weapon with this grade: the grade's weight times progress to `full`. */
export function scalingBonus(grade: string | undefined, stat: number): number {
  if (!grade) return 0;
  const sc = DATA.levels.scaling;
  const k = Math.max(0, Math.min(1, (stat - DATA.levels.start) / (sc.full - DATA.levels.start)));
  return (sc.grades[grade as keyof typeof sc.grades] ?? 0) * k;
}

/** A weapon's damage multiplier from your stats and its upgrade level. */
export function weaponMult(weaponId: string, stats: Record<StatName, number>, upgrade: number): number {
  const w = DATA.weapons[weaponId];
  if (!w) return 1;
  const fromStats = scalingBonus(w.scaling.str, stats.strength) + scalingBonus(w.scaling.dex, stats.dexterity);
  return (1 + fromStats) * (1 + upgrade * DATA.smith.damagePerLevel);
}
