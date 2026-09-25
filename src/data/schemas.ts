// Zod schemas for everything under /data and /assets. Timings are in ticks (1/60 s) unless named otherwise.
import { z } from 'zod';

const num = z.number();
const pos = z.number().positive();
const int = z.number().int();
export const Vec2 = z.tuple([num, num]);
export const Dir = z.enum(['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE']);
/** [scaleX, scaleY, ticks] — scale snaps to this then eases back to 1. */
const SquashKey = z.tuple([pos, pos, int.nonnegative()]);

export const GameCfg = z.object({
  width: int.positive(),
  height: int.positive(),
  tickRate: int.positive(),
  maxStepsPerFrame: int.positive(),
  startRoom: z.string(),
});

const PoiseCfg = z.object({ max: pos, resetTicks: int.nonnegative() });
const HurtBox = z.object({ w: pos, h: pos, offsetY: num });

export const PlayerCfg = z.object({
  maxHp: pos,
  poise: PoiseCfg,
  staggerTicks: int.positive(),
  deathTicks: int.positive(),
  bodyRadius: pos,
  walkSpeed: pos,
  accelTicks: pos,
  decelTicks: pos,
  sprintMult: pos,
  aimOriginY: num,
  collider: z.object({ w: pos, h: pos }),
  hurtbox: HurtBox,
  legs: z.object({
    backpedal: z.enum(['turn', 'reverse']),
    backpedalDot: num.min(-1).max(1),
    walkAnimSpeedAt: pos,
  }),
  weaponBehindArcDeg: Vec2,
  /** Two weapon slots (any mix of melee/ranged) and an optional off-hand shield. */
  loadout: z.object({ slots: z.tuple([z.string(), z.string()]), shield: z.string().nullable() }),
  swapTicks: int.positive(),
  guardBreakTicks: int.positive(),
});

export const RollCfg = z
  .object({
    stamina: num.nonnegative(),
    distance: num.nonnegative(),
    travelTicks: int.positive(),
    totalTicks: int.positive(),
    iframeStart: int.nonnegative(),
    iframeEnd: int.nonnegative(),
    curvePower: pos,
    cancelFrom: int.nonnegative(),
    moveCancelFrom: int.nonnegative(),
  })
  .refine(r => r.travelTicks <= r.totalTicks, { message: 'travelTicks must be <= totalTicks' })
  .refine(r => r.iframeStart <= r.iframeEnd, { message: 'iframeStart must be <= iframeEnd' });

export const StaminaCfg = z.object({
  max: pos,
  regenDelayTicks: int.nonnegative(),
  regenPerSec: num.nonnegative(),
  minToAct: num.nonnegative(),
  sprintPerSec: num.nonnegative(),
});

export const CameraCfg = z.object({
  aimLeadFactor: num.min(0),
  aimLeadMax: num.min(0),
  leadLerp: num.min(0).max(1),
  padLeadDistance: num.min(0),
  centerOffsetY: num,
  /** Keep the view inside the current room (no void). Rooms smaller than the screen are centred. */
  clampToRoom: z.boolean(),
  /** Blend time when the clamp switches rooms (walking through a door). */
  roomBlendMs: num.min(0),
});

export const JuiceCfg = z.object({
  shake: z.object({ maxOffset: num.min(0), decayPerTick: num.min(0), debugTrauma: num.min(0).max(1) }),
  squash: z.object({ rollStart: SquashKey, rollLand: SquashKey, hit: SquashKey, attack: SquashKey }),
  dust: z.object({ footstep: z.enum(['always', 'sprint', 'never']) }),
  flashTicks: int.nonnegative(),
  particles: z.object({ sparks: int.nonnegative(), blood: int.nonnegative(), bloodOnKill: int.nonnegative(), maxStains: int.nonnegative() }),
  damageNumbers: z.enum(['all', 'dummy', 'none']),
  enemyBarTicks: int.nonnegative(),
  hitFeedback: z.object({
    /** Visual recoil (px) on hit / heavy hit / blocked hit. */
    flinch: num.min(0),
    flinchHeavy: num.min(0),
    flinchBlocked: num.min(0),
    /** Health bars: how long the lost chunk lingers, then how fast it drains (fraction of max per second). */
    trailHoldMs: num.min(0),
    trailDrainPerSec: pos,
    /** Red screen-edge flash when the player is hit (strongest on the side the hit came from). */
    vignetteMs: pos,
    vignetteAlpha: num.min(0).max(1),
    /** Below this HP fraction the screen edge pulses. */
    lowHpThreshold: num.min(0).max(1),
  }),
});

const CritCfg = z.object({
  /** Total paired-animation length for the attacker (invulnerable throughout). */
  ticks: int.positive(),
  /** Tick at which the damage lands. */
  hitTick: int.nonnegative(),
  range: pos,
  /** Extra ticks the victim stays down after the attacker recovers. */
  victimExtraTicks: int.nonnegative(),
  hitstop: int.nonnegative(),
  shake: num.min(0).max(1),
});
export const CombatCfg = z.object({
  knockbackDecay: num.min(0).max(0.99),
  bodyPush: num.min(0).max(1),
  heavyHitstop: int.nonnegative(),
  /** Stamina lost per blocked hit = damage x (1 - shield stability) x this. */
  blockStaminaMult: num.min(0),
  /** The attacker must face the victim within this many degrees to start a critical. */
  critFacingDeg: num.min(0).max(180),
  riposte: CritCfg,
  backstab: CritCfg.extend({ arcDeg: num.min(0).max(360) }),
  parryHitstop: int.nonnegative(),
});

export const AiCfg = z.object({ maxAttackers: int.positive() });

export const AudioCfg = z.object({ master: num.min(0).max(1), sfx: num.min(0).max(1), hearingDistance: pos });
export const SfxPreset = z.object({
  wave: z.enum(['sine', 'square', 'sawtooth', 'triangle', 'noise']),
  freq: pos,
  freqEnd: pos.optional(),
  duration: pos,
  attack: num.min(0).default(0.005),
  volume: num.min(0).max(1),
  filter: pos.optional(),
  filterEnd: pos.optional(),
});
export const SfxBank = z.object({ presets: z.record(z.string(), SfxPreset) });

export const PhialCfg = z
  .object({
    startCharges: int.nonnegative(),
    maxCharges: int.positive(),
    healAmount: num.min(0),
    healPerLevel: num.min(0),
    maxLevel: int.nonnegative(),
    /** Timeline (ticks): raise the phial, drink, heal lands at healApplyTick, lower until totalTicks. */
    raiseTicks: int.positive(),
    healApplyTick: int.positive(),
    totalTicks: int.positive(),
    moveMult: num.min(0).max(1),
  })
  .refine(p => p.raiseTicks < p.healApplyTick && p.healApplyTick < p.totalTicks, {
    message: 'need raiseTicks < healApplyTick < totalTicks',
  });

export const ShrineCfg = z.object({
  reach: pos,
  kneelTicks: int.positive(),
  kindleTicks: int.positive(),
  spawnOffset: Vec2,
  markerPickupRadius: pos,
  autosaveTicks: int.positive(),
});

/** Breakable scenery (data/props/*.json). Props respawn on rest; their loot drops only the first time. */
/** A powder blast: after `fuseTicks` of hissing it bursts, hurting everyone (and every prop) within `radius`. */
export const BlastDef = z.object({
  fuseTicks: int.nonnegative(),
  radius: pos,
  damage: num.min(0),
  poise: num.min(0),
  knockback: num.min(0).default(160),
  sfx: z.string().default('b_keg_blast'),
});
export type BlastDef = z.infer<typeof BlastDef>;

/**
 * A swarm of bees (data/swarms.json): a cloud that hunts one creature and stings everything in it (you, or the
 * enemies you lead it through). It chases for `angerTicks`, or until its quarry is `giveUp` px away, then goes
 * home and settles. Weapons pass through it; smoke calms it at once. A settled swarm hovering at home (a Drone
 * Swarm, room entity "swarm") rises at whoever comes within `sense` px.
 */
export const SwarmDef = z.object({
  /** Bees drawn in the cloud. */
  bees: int.min(3).max(80),
  /** Cloud radius (px): everything inside is stung. */
  radius: pos,
  /** Chase speed (px/s); the player walks at about 80. */
  speed: pos,
  /** Each sting: damage and poise, every `everyTicks` to each creature in the cloud. */
  damage: num.min(0),
  poise: num.min(0).default(0),
  everyTicks: int.positive(),
  angerTicks: int.positive(),
  giveUp: pos.default(260),
  /** Settled at home: rises at whoever comes this close (0 = never; a hive's swarm only comes out when struck). */
  sense: num.min(0).default(0),
  /** Settled again this long after being calmed by smoke. */
  calmTicks: int.nonnegative().default(600),
});
export type SwarmDef = z.infer<typeof SwarmDef>;
export const SwarmCfg = z.object({ swarms: z.record(z.string(), SwarmDef) });

export const PropDef = z.object({
  id: z.string(),
  name: z.string(),
  sprite: z.string(),
  hp: pos,
  /** Blocking circle radius (px). */
  radius: pos,
  hurtbox: HurtBox,
  /** Palette key for the break burst. */
  debris: z.string(),
  loot: z.string().default('none'),
  sfx: z.string().default('break'),
  /**
   * A cracked section of wall: placed in a wall tile, it is part of the wall (solid, drawn as wall) until
   * broken, then the tile opens for good (world flag "wall:<room>#<index>") and never respawns.
   */
  secretWall: z.boolean().default(false),
  /** A powder keg: broken, it lights and bursts (setting off other kegs in reach). */
  explode: BlastDef.optional(),
  /** A hive (data/swarms.json id): struck, a swarm pours out after whoever struck it; broken, a bigger one. */
  hive: z.string().optional(),
  /**
   * A way sealed with tallow (with `secretWall`): no blow breaks it, but a beeswax light (the `light` modifier)
   * carried within `near` px melts it away for good.
   */
  melts: z.object({ near: pos }).optional(),
});

/** One weighted outcome of a loot roll. */
export const LootEntry = z.object({
  weight: pos,
  tallow: Vec2.optional(),
  /** Restores this fraction of every carried ranged weapon's reserve. */
  ammo: num.positive().max(1).optional(),
  /** A consumable (data/consumables id), `count` of them. */
  item: z.string().optional(),
  count: int.positive().default(1),
});
export const LootTables = z.object({ tables: z.record(z.string(), z.array(LootEntry).min(1)) });

export const ItemDef = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  effect: z.discriminatedUnion('type', [
    z.object({ type: z.literal('phialMax'), amount: int.positive() }),
    z.object({ type: z.literal('phialLevel'), amount: int.positive() }),
    /** Restores this fraction of every carried ranged weapon's reserve. */
    z.object({ type: z.literal('ammo'), amount: num.positive().max(1) }),
    z.object({ type: z.literal('tallow'), amount: int.positive() }),
    /** A key: kept for good (world flag "key:<item id>"). Doors with `requires: <item id>` open with it. */
    z.object({ type: z.literal('key'), opens: z.string() }),
    /** A quest item, kept for good (world flag "key:<item id>", so scripts can check it); `note` says what it's for. */
    z.object({ type: z.literal('quest'), note: z.string() }),
    /** Gear: a weapon, shield or piece of armour, put in your inventory. */
    z.object({ type: z.literal('gear'), kind: z.enum(['weapon', 'shield', 'armour']), id: z.string() }),
    /** Consumables (data/consumables id) for the quick-use belt. */
    z.object({ type: z.literal('consumable'), id: z.string(), count: int.positive().default(1) }),
    /** A ring (data/rings id). */
    z.object({ type: z.literal('ring'), id: z.string() }),
  ]),
  /** Frame in the `icons` sheet. */
  icon: int.nonnegative().default(0),
});

/** A scaling grade (data/config/levels.json gives each its weight). */
export const Grade = z.enum(['S', 'A', 'B', 'C', 'D', 'E']);
export type Grade = z.infer<typeof Grade>;

/**
 * Modifiers from worn rings and from consumables' timed effects. Additions add up, multipliers multiply,
 * `keepTallow` and `sureFooted` take the largest.
 */
export const Mods = z
  .object({
    /** Added to max HP. */
    maxHp: num.optional(),
    /** Added to max stamina. */
    stamina: num.optional(),
    /** Stamina regeneration multiplier. */
    staminaRegen: pos.optional(),
    /** Roll stamina cost multiplier. */
    rollCost: pos.optional(),
    /** Added to poise. */
    poise: num.optional(),
    /** Multiplier on all the damage you deal. */
    damage: pos.optional(),
    /** Multiplier on the damage of your shots and thrown things. */
    rangedDamage: pos.optional(),
    /** Multiplier on the damage you deal while at or below 30% HP. */
    desperate: pos.optional(),
    /** Multiplier on the damage you take (after armour). */
    damageTaken: pos.optional(),
    /** Multiplier on what a phial drink heals. */
    heal: pos.optional(),
    /** Multiplier on how fast enemies notice you. */
    notice: pos.optional(),
    /** Multiplier on Tallow from kills and drops. */
    tallowGain: pos.optional(),
    /** Multiplier on equip load capacity. */
    capacity: pos.optional(),
    /** Fraction of carried Tallow kept when you die (the rest is left behind as usual). */
    keepTallow: num.min(0).max(1).optional(),
    /** Fraction of the slowdown of wax, mud and spilled pools that you ignore. */
    sureFooted: num.min(0).max(1).optional(),
    /** Multiplier on how long a reload takes. */
    reload: pos.optional(),
    /** Multiplier on the spread of your guns' shots. */
    spread: pos.optional(),
    /** Multiplier on shop prices. */
    prices: pos.optional(),
    /** A beeswax light: sealed ways melt as you pass, and the dark is warmer. */
    light: num.min(0).optional(),
    /** HP back when your backstab or riposte lands. */
    critHeal: num.min(0).optional(),
    /** Multiplier on the damage bee stings do to you. */
    stings: num.min(0).optional(),
  })
  .strict();
export type Mods = z.infer<typeof Mods>;

/** A consumable (data/consumables): carried in a stack, used from the quick-use belt. */
export const ConsumableDef = z.object({
  id: z.string(),
  name: z.string(),
  icon: int.nonnegative(),
  /** Its quick lore. */
  description: z.string(),
  /** How many you can carry. */
  max: int.positive(),
  /** Sound on use (the throw, the bite, the strike of the match). */
  sfx: z.string().default('p_use'),
  use: z.discriminatedUnion('type', [
    /** Thrown where you aim: a straight projectile, or a lobbed one (def.lob) that bursts where the cursor is. */
    z.object({ type: z.literal('throw'), projectile: z.lazy(() => ProjectileDef) }),
    /** Heals `amount` HP spread over `ticks`. */
    z.object({ type: z.literal('regen'), amount: int.positive(), ticks: int.positive() }),
    /** A timed effect: `mods` for `ticks`. `label` shows under the HUD. `lose` makes enemies lose track of you. */
    z.object({ type: z.literal('buff'), ticks: int.positive(), label: z.string(), mods: Mods, lose: z.boolean().default(false), colour: z.string().default('wax2') }),
    /** Loads every carried gun and gives this fraction of its spare shots. */
    z.object({ type: z.literal('reload'), reserve: num.min(0).max(1) }),
    /** Turned into Tallow. */
    z.object({ type: z.literal('tallow'), amount: int.positive() }),
    /** Not used from the belt: a smith's material (Bede takes it for upgrades). */
    z.object({ type: z.literal('material') }),
  ]),
});
export type ConsumableDef = z.infer<typeof ConsumableDef>;

/** A ring (data/rings): two can be worn; each changes you while worn. */
export const RingDef = z.object({
  id: z.string(),
  name: z.string(),
  icon: int.nonnegative(),
  description: z.string(),
  /** One plain line saying what it does (the equipment screen shows it). */
  effect: z.string(),
  mods: Mods,
});
export type RingDef = z.infer<typeof RingDef>;

/** A lore note (data/notes): lying on the floor (room entity "note"); read, it is kept in NOTES. */
export const NoteDef = z.object({
  id: z.string(),
  title: z.string(),
  /** Paragraphs separated by blank lines. */
  text: z.string(),
});
export type NoteDef = z.infer<typeof NoteDef>;

/**
 * An enemy placement made a miniboss (`"miniboss": {...}` on a room's enemy entity): a name bar at the bottom
 * of the screen while it fights you, `hpMult` times its health, it stays dead for good once killed (world flag
 * "miniboss:<id>"), and it drops `drop` (data/items) where it falls.
 */
export const MinibossPlacement = z.object({
  id: z.string(),
  title: z.string(),
  drop: z.string(),
  hpMult: pos.default(1),
});
export type MinibossPlacement = z.infer<typeof MinibossPlacement>;

const StatName = z.enum(['vitality', 'endurance', 'strength', 'dexterity']);
export type StatName = z.infer<typeof StatName>;
/**
 * Levelling at Maudlin (data/config/levels.json). Each stat starts at `start`; your level is 1 plus the points
 * spent. The next level costs base + linear*(L-1) + quad*(L-1)^2 Tallow at level L.
 */
export const LevelsCfg = z.object({
  start: int.positive(),
  max: int.positive(),
  cost: z.object({ base: pos, linear: num.min(0), quad: num.min(0) }),
  /** HP per Vitality point up to `softCap`, then `hpAfterCap` per point. */
  vitality: z.object({ hpPerPoint: pos, softCap: int.positive(), hpAfterCap: num.min(0) }),
  endurance: z.object({ staminaPerPoint: pos, capacityPerPoint: pos }),
  /** Damage bonus: grade weight x (stat - start) / (full - start), capped at 1. */
  scaling: z.object({ grades: z.record(Grade, num.min(0)), full: int.positive() }),
  /** One line per stat for the level-up screen. */
  notes: z.record(StatName, z.string()),
});
export type LevelsCfg = z.infer<typeof LevelsCfg>;

/** Bede's upgrades (data/config/smith.json): what each level costs, and the damage it adds per level. */
export const SmithCfg = z.object({
  damagePerLevel: pos,
  levels: z.array(z.object({ tallow: int.positive(), materials: z.record(z.string(), int.positive()) })).min(1),
});
export type SmithCfg = z.infer<typeof SmithCfg>;



// ---- Story: characters, dialogue and cutscene scripts (see STORY.md) ----
/**
 * A condition on world flags: "name" (set) or "!name" (not set); a list means all of them. Bare names are
 * story flags ("story:<name>"); names with a colon are any world flag ("key:toll_key", "shrine:shrine_rest").
 */
export const Cond = z.union([z.string(), z.array(z.string())]);
export type Cond = z.infer<typeof Cond>;

/**
 * Oskar's stock (data/shop.json). Each entry sells a consumable, an item (data/items: a ring, a powder pouch)
 * or a note, for `price` Tallow, up to `limit` times in all (none = as many as you like). It is on sale once
 * `when` holds, so the stock grows as you explore.
 */
export const ShopCfg = z.object({
  stock: z
    .array(
      z
        .object({
          id: z.string(),
          /** Who sells it: Oskar at Wick's Rest, or Hild at her apiary in Bloomhollow. */
          seller: z.enum(['oskar', 'hild']).default('oskar'),
          consumable: z.string().optional(),
          item: z.string().optional(),
          note: z.string().optional(),
          price: int.positive(),
          limit: int.positive().optional(),
          when: Cond.optional(),
        })
        .refine(e => [e.consumable, e.item, e.note].filter(Boolean).length === 1, 'sell exactly one of consumable, item, note'),
    )
    .min(1),
});
export type ShopEntry = z.infer<typeof ShopCfg>['stock'][number];
/** A camera target: "player", "npc:<placement id>", "point:<point id>" or "enemy:<enemy kind>" (e.g. a boss). */
const Target = z
  .string()
  .regex(/^(player|npc:.+|point:.+|enemy:.+|actor:.+)$/, 'expected "player", "npc:<id>", "point:<id>", "enemy:<kind>" or "actor:<id>"');
/** A place in a cutscene: a target, or [x, y] tiles in the player's room. */
const At = z.union([Target, z.tuple([num, num])]);
type At = string | [number, number];
/** How a cutscene actor looks: an animation (with a direction), a strip of frames, or one frame. */
const Pose = {
  anim: z.string().optional(),
  dir: z.enum(['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE']).optional(),
  frames: z.array(int.nonnegative()).min(1).optional(),
  every: int.positive().optional(),
  frame: int.nonnegative().optional(),
  flip: z.boolean().optional(),
};
type Pose = { anim?: string; dir?: 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW' | 'N' | 'NE'; frames?: number[]; every?: number; frame?: number; flip?: boolean };

export type Step =
  | { say: string; who?: string }
  | { menu: { text: string; when?: Cond; do?: Step[]; end?: boolean }[] }
  | { if: Cond; then: Step[]; else?: Step[] }
  | { set: string | string[] }
  | { clear: string | string[] }
  | { wait: number }
  | { camera: string; ticks?: number }
  | { fade: 'out' | 'in'; ticks?: number }
  | { sfx: string }
  | { shake: number }
  | { give: string }
  | { toast: [string, string] }
  | { card: string; sub?: string; ticks?: number }
  | { open: 'levelup' | 'shop' | 'smith' | 'apiary' }
  | { respec: true }
  | ({ actor: string; sprite: string; at: At; lift?: number; z?: number; shadow?: boolean; bob?: number } & Pose)
  | ({ move: string; to: At; ticks: number; arc?: number; face?: boolean; wait?: boolean } & Pose)
  | ({ play: string; shake?: number } & Pose)
  | { remove: string | string[] }
  | { bubble: string; over: string; ticks?: number }
  | { flash: string; ticks?: number; peak?: number }
  | { burst: string; at: At; count?: number }
  | { hide: string[] }
  | { show: string[] }
  | { bars: boolean }
  | { follow: string | null };
export const Step: z.ZodType<Step> = z.lazy(() =>
  z.union([
    /** A line of dialogue. `who`: a character id (data/npcs.json); omitted = narration. */
    z.object({ say: z.string(), who: z.string().optional() }).strict(),
    /** Choices. Picking an option runs its `do`; the menu comes back until an option with `end` is picked. */
    z
      .object({
        menu: z
          .array(z.object({ text: z.string(), when: Cond.optional(), do: z.array(Step).optional(), end: z.boolean().optional() }).strict())
          .min(1),
      })
      .strict(),
    z.object({ if: Cond, then: z.array(Step), else: z.array(Step).optional() }).strict(),
    z.object({ set: z.union([z.string(), z.array(z.string())]) }).strict(),
    z.object({ clear: z.union([z.string(), z.array(z.string())]) }).strict(),
    z.object({ wait: int.nonnegative() }).strict(),
    /** Point the camera at a target over `ticks` (default 40); "player" gives it back. */
    z.object({ camera: Target, ticks: int.nonnegative().optional() }).strict(),
    z.object({ fade: z.enum(['out', 'in']), ticks: int.positive().optional() }).strict(),
    z.object({ sfx: z.string() }).strict(),
    z.object({ shake: num.min(0).max(1) }).strict(),
    /** Give an item (data/items), explained like a chest's. */
    z.object({ give: z.string() }).strict(),
    z.object({ toast: z.tuple([z.string(), z.string()]) }).strict(),
    /** A title card in the middle of the screen (over a fade, it reads like a chapter's end), for `ticks`. */
    z.object({ card: z.string(), sub: z.string().optional(), ticks: int.positive().optional() }).strict(),
    /** Open a townsperson's screen (level up, shop, smith) once the conversation ends. */
    z.object({ open: z.enum(['levelup', 'shop', 'smith', 'apiary']) }).strict(),
    /** Put every stat back where it started and give back all the Tallow spent levelling. */
    z.object({ respec: z.literal(true) }).strict(),
    // ---- the cutscene stage (story/Stage.ts): actors, bubbles, bursts, flashes, letterbox bars
    /** Put an actor on stage: any sprite sheet, in a pose. `lift`: drawn higher (sat on a cart); `z`: depth bias. */
    z.object({ actor: z.string(), sprite: z.string(), at: At, lift: num.optional(), z: num.optional(), shadow: z.boolean().optional(), bob: int.nonnegative().optional(), ...Pose }).strict(),
    /** Move an actor over `ticks` (hopping `arc` px); `wait` holds the script until it arrives. */
    z.object({ move: z.string(), to: At, ticks: int.positive(), arc: num.optional(), face: z.boolean().optional(), wait: z.boolean().optional(), ...Pose }).strict(),
    /** Change an actor's pose; `shake` px jitter (0 stops it). */
    z.object({ play: z.string(), shake: num.min(0).optional(), ...Pose }).strict(),
    z.object({ remove: z.union([z.string(), z.array(z.string())]) }).strict(),
    /** A speech bubble over an actor ("actor:<id>"), an NPC or the player, for `ticks`. Doesn't wait. */
    z.object({ bubble: z.string(), over: Target, ticks: int.positive().optional() }).strict(),
    /** The whole screen flashes a colour (palette name or #hex). */
    z.object({ flash: z.string(), ticks: int.positive().optional(), peak: num.min(0).max(1).optional() }).strict(),
    /** A burst of particles: dust, debris, sparks, flame, wax, blood, smoke, water, feathers, petals, honey. */
    z.object({ burst: z.string(), at: At, count: int.positive().optional() }).strict(),
    /** Hide / show "player", "npc:<placement>" or "decor:<kind>" while the scene plays (shown again at its end). */
    z.object({ hide: z.array(z.string()) }).strict(),
    z.object({ show: z.array(z.string()) }).strict(),
    /** Letterbox bars in or out. */
    z.object({ bars: z.boolean() }).strict(),
    /** The camera rides with an actor ("actor:<id>"), or stops (null). */
    z.object({ follow: z.union([Target, z.null()]) }).strict(),
  ]),
);
/** data/scripts/*.json: a dialogue or cutscene. `skippable`: Esc jumps to the end (flags are still set). */
export const ScriptDef = z.object({ id: z.string(), skippable: z.boolean().default(false), steps: z.array(Step) });
/**
 * A speaking voice: a short blip (`sfx`, a preset in data/audio/sfx.json) played as the text types out,
 * once every `every` letters, at `pitch` (high = small/young, low = big/old), at `volume`.
 */
export const Voice = z.object({
  sfx: z.string().default('voice'),
  pitch: num.min(0.2).max(4).default(1),
  every: int.positive().default(2),
  volume: num.min(0).max(2).default(1),
});
export type Voice = z.infer<typeof Voice>;
/** data/npcs.json: characters. `portrait` is a frame of the `portraits` sheet. */
export const NpcDef = z.object({
  name: z.string(),
  sprite: z.string(),
  portrait: int.nonnegative(),
  voice: Voice.default({ sfx: 'voice', pitch: 1, every: 2, volume: 1 }),
  /** Sound on each stroke of its work pose (chopping, drawing water...), heard when you're near. */
  workSfx: z.string().optional(),
  /** Plays music (data/audio/ambient.json `harp`) while doing its work pose. */
  music: z.literal('harp').optional(),
});
/** `narration`: the voice of lines with no speaker. */
export const Npcs = z.object({ npcs: z.record(z.string(), NpcDef), narration: Voice.default({ sfx: 'voice_soft', pitch: 0.75, every: 3, volume: 0.55 }) });

export const DeathCfg = z.object({
  text: z.string(),
  overlayDelayTicks: int.nonnegative(),
  fadeInTicks: int.positive(),
  holdTicks: int.nonnegative(),
  fadeOutTicks: int.positive(),
  fadeBackTicks: int.positive(),
  textScale: int.positive(),
});

// ---- Strikes: one swing/stab/shove. Shared by player weapons and enemy moves. ----
const HitShape = z.discriminatedUnion('shape', [
  z.object({ shape: z.literal('arc'), radius: pos, halfAngle: num.min(0).max(180), offset: num.default(0), inner: num.min(0).default(0) }),
  z.object({ shape: z.literal('circle'), radius: pos, offset: num.default(0) }),
]);
/** What a lobbed projectile scatters when it bursts: a ring of `count` straight shots from the landing point. */
const ShardsDef = z.object({
  sprite: z.string(),
  count: int.positive(),
  speed: pos,
  range: pos,
  damage: num.min(0),
  poise: num.min(0).default(0),
  knockback: num.min(0).default(0),
  radius: pos.default(3),
});
export type ShardsDef = z.infer<typeof ShardsDef>;
export const ProjectileDef = z.object({
  sprite: z.string(),
  speed: pos,
  range: pos,
  damage: num.min(0),
  poise: num.min(0),
  pierce: int.nonnegative().default(0),
  knockback: num.min(0).default(0),
  hitstop: int.nonnegative().default(0),
  shake: num.min(0).max(1).default(0.05),
  radius: pos,
  spreadDeg: num.min(0).default(0),
  count: int.positive().default(1),
  /** `count` shots spaced evenly all the way round (spreadDeg is ignored). */
  ring: z.boolean().default(false),
  /**
   * Thrown again `count` times in all, every `everyTicks` during the active frames (make `active` long
   * enough). Each volley turns `turnDeg` further (a spiral), or aims afresh at the target with `reaim`.
   */
  volleys: z.object({ count: int.min(2), everyTicks: int.positive(), turnDeg: num.default(0), reaim: z.boolean().default(false) }).optional(),
  /** Straight shots that bend toward the nearest foe, up to `degPerTick`, for their first `ticks`. */
  homing: z.object({ degPerTick: pos, ticks: int.positive().default(9999) }).optional(),
  /** Straight shots that glance off walls this many times before breaking. */
  bounces: int.nonnegative().default(0),
  /** A boomerang: at the end of its range (or at a wall) it turns and flies back to the thrower, able to hit again. */
  returns: z.boolean().default(false),
  /** Drawn spinning (a thrown weapon, a tumbling coin) instead of pointing along its flight. */
  spin: num.default(0),
  /** A lobbed shot scatters these when it bursts. */
  shards: ShardsDef.optional(),
  /**
   * Lobbed: arcs over obstacles to the target point (speed/range ignored), a warning marker shows where it
   * will land, and it bursts there for area damage. Can't be blocked by walls; can be rolled through.
   */
  lob: z
    .object({ flightTicks: int.positive(), arcHeight: num.min(0), blastRadius: pos, sfx: z.string().default('explosion') })
    .optional(),
});

export const StrikeDef = z.object({
  /** A thrown strike aims at a powder keg within this many px of its target, if there is one, instead. */
  aimAtKeg: pos.optional(),
  damage: num.min(0),
  poise: num.min(0),
  stamina: num.min(0).default(0),
  windup: int.nonnegative(),
  active: int.positive(),
  recovery: int.nonnegative(),
  hitbox: HitShape,
  /** Hitbox centre height relative to the feet (negative = up). */
  originY: num.default(-8),
  /** Weapon sprite motion relative to the attack direction; reach = forward thrust in px. */
  sweep: z.object({ fromDeg: num, toDeg: num, reach: num.default(0) }).default({ fromDeg: -90, toDeg: 90, reach: 0 }),
  /** Max turn toward the target during windup; direction locks when active frames start. */
  trackDegPerTick: num.min(0).default(0),
  lunge: z.object({ distance: num, startTick: int.nonnegative(), ticks: int.positive() }).optional(),
  knockback: num.min(0).default(0),
  hitstop: int.nonnegative().default(0),
  shake: num.min(0).max(1).default(0),
  telegraph: z.object({ tick: int.nonnegative(), kind: z.enum(['normal', 'danger']) }).optional(),
  /** Extra poise buffer while winding up / active (resists stagger). */
  hyperArmor: num.min(0).default(0),
  unblockable: z.boolean().default(false),
  unparryable: z.boolean().default(false),
  /** Player only: tick (from strike start) from which the next light attack may chain. */
  comboFrom: int.nonnegative().optional(),
  /** Player only: tick from which a roll may cancel the recovery. */
  rollCancelFrom: int.nonnegative().optional(),
  sfx: z.string().default('swing'),
  /** Sound as the strike starts winding up (a grunt, a chain, a breath): the tell you hear. */
  windupSfx: z.string().optional(),
  /** Body animation to play (phased windup/active/recovery). Default: "attack" ("thrust" for player thrusts). */
  anim: z.string().optional(),
  /** Thrown instead of swung: launched at the target when the active frames start (no melee hitbox). */
  projectile: ProjectileDef.optional(),
  /**
   * Grab: on a clean hit the target is held for holdTicks (helpless), then takes `damage` and is thrown.
   * The strike's own damage is applied on contact. Pair with unblockable + a "danger" telegraph.
   */
  grab: z.object({ holdTicks: int.positive(), damage: num.min(0), throwKnockback: num.min(0) }).optional(),
  /** Hook: the knockback drags the target toward the attacker instead of pushing it away. */
  pull: z.boolean().default(false),
  /**
   * A spell instead of a swing: when the active frames start, `count` enemies of `kind` appear in a ring of
   * `radius` px around the caster. With `shield`, the caster sits in an invulnerable bubble until they all
   * die. (The caster won't cast again while any of them live.)
   */
  summon: z.object({ kind: z.string(), count: int.positive(), radius: pos.default(40), shield: z.boolean().default(false) }).optional(),
  /**
   * Smoke instead of a swing: when the active frames start the attacker vanishes in a cloud and comes out
   * `distance` px from its target (behind or beside it), barely visible for `ticks`, ready to strike.
   */
  vanish: z.object({ distance: pos, ticks: int.positive() }).optional(),
  /**
   * Spilled wax: when the active frames start, `count` slowing pools of `radius` px land within `spread` px
   * of `at` (the attacker, or the target). Anyone wading one moves at `speedMult`. They set after `ticks`.
   * Works on its own (damage 0: no hitbox) or alongside a swing.
   */
  /**
   * The ground erupts (spikes, geysers, flame, water): each point shows a warning for `warnTicks`, then bursts
   * for area damage. The pattern, from the attacker toward its target when the active frames start:
   * - line: `count` points marching from the attacker toward the target, `spacing` px apart;
   * - star: `lines` lines of `count` radiating from the attacker;
   * - follow: `count` points, each placed where the target stands when its turn comes;
   * - ring: `count` points in a ring of `spacing` px round the target (and one on it, with `centre`);
   * - scatter: `count` points at random within `spacing` px of the target.
   * One point appears every `stepTicks`. `fx` picks the look: spikes, wax, flame, water or ember.
   */
  eruptions: z
    .object({
      pattern: z.enum(['line', 'star', 'follow', 'ring', 'scatter']),
      count: int.positive(),
      lines: int.positive().default(4),
      spacing: num.min(0).default(24),
      stepTicks: int.nonnegative().default(4),
      warnTicks: int.positive().default(24),
      radius: pos,
      damage: num.min(0),
      poise: num.min(0).default(0),
      knockback: num.min(0).default(0),
      centre: z.boolean().default(false),
      fx: z.enum(['spikes', 'wax', 'flame', 'water', 'ember', 'honey']),
      sfx: z.string().default('b_ground_slam'),
    })
    .optional(),
  /**
   * The hitbox rides the weapon: an arc `hitbox.halfAngle` wide centred on the weapon's angle as it sweeps
   * (with `sweep` running past 360 degrees, a spin). `rehitTicks`: anyone hit may be hit again this often.
   */
  followSweep: z.boolean().default(false),
  rehitTicks: int.positive().optional(),
  /**
   * A puff of smoke when the active frames start, `offset` px ahead: everyone caught in its `radius` (not the
   * one puffing) is blinded for `blind` ticks (they can't see to fight), and bee swarms in it settle.
   */
  smoke: z.object({ radius: pos, offset: num.default(16), blind: int.nonnegative().default(0), calm: z.boolean().default(true) }).optional(),
  /** Swarms of bees (data/swarms.json id) pour out of the attacker after its target when the active frames start. */
  swarm: z.object({ id: z.string(), count: int.positive().default(1) }).optional(),
  pools: z
    .object({
      count: int.positive(),
      radius: pos,
      spread: num.min(0).default(0),
      at: z.enum(['self', 'target']).default('self'),
      ticks: int.positive(),
      speedMult: num.min(0.05).max(1).default(0.5),
      /** Molten wax, or honey. */
      kind: z.enum(['wax', 'honey']).default('wax'),
    })
    .optional(),
});

export const MoveDef = z.object({
  id: z.string(),
  range: Vec2,
  weight: pos,
  cooldown: int.nonnegative(),
  strikes: z.array(StrikeDef).min(1),
});

export const EnemyDef = z.object({
  id: z.string(),
  name: z.string(),
  /**
   * melee = full AI; ranged = full AI that keeps its distance (spacing.retreatBelow) and needs line of sight
   * to throw; dummy = never acts or dies; rhythm = stands still and repeats its first move every interval.
   */
  ai: z.enum(['melee', 'ranged', 'dummy', 'rhythm', 'boss']),
  /**
   * Boss (ai "boss"): waits dormant until the player enters its arena (room entity "arena"), then performs
   * its entrance (the player keeps control): `introAnim` for `introTicks`, with `slams` (ticks) that shake
   * the screen, and `introLine` shown as a banner. Its name and health bar sit at the bottom of the screen.
   * Once dead it stays dead (world flag "boss:<id>"); after `deathTicks` its `deathScript` plays.
   */
  boss: z
    .object({
      title: z.string(),
      introAnim: z.string().default('intro'),
      introTicks: int.positive(),
      slams: z.array(int.nonnegative()).default([]),
      slamShake: num.min(0).max(1).default(0.4),
      slamSfx: z.string().default('bell_slam'),
      introLine: z.string().optional(),
      roarSfx: z.string().optional(),
      deathScript: z.string().optional(),
      /**
       * A second phase. When this one falls, a half-buried chest rises in the arena (`chest.at`, room
       * tiles) holding `chest.item`; with that item (world flag "key:<item>") the player can use the
       * remains (`prompt`) and `kind` rises in its place. Without it, `hint` says what's needed.
       */
      next: z
        .object({
          kind: z.string(),
          chest: z.object({ id: z.string(), item: z.string(), at: Vec2 }),
          prompt: z.string(),
          hint: z.string(),
          fallenLine: z.string(),
          igniteTicks: int.positive().default(70),
          /** Screamed (a sound id) as the remains go up, with a flash of this palette colour. */
          scream: z.string().optional(),
          flash: z.string().default('ember'),
        })
        .optional(),
      /**
       * A turn instead of a death: when this phase's health runs out it does not fall. It walks, untouchable,
       * to `altar` (room tiles; it faces north there), performs `anim` for `ticks` while its arena flares,
       * then `kind` takes its place with its own entrance. `line` is shown as a banner as the turn begins.
       */
      turn: z
        .object({
          kind: z.string(),
          altar: Vec2,
          anim: z.string().default('pour'),
          ticks: int.positive(),
          line: z.string().optional(),
          /** The sound at the height of the turn, and the colour the screen flashes. */
          scream: z.string().optional(),
          flash: z.string().default('white'),
        })
        .optional(),
      /** On its final death the body crumbles away to dust instead of leaving a corpse. */
      dust: z.boolean().default(false),
    })
    .optional(),
  /**
   * Shield guard (frontal arc) that blocks hits and projectiles while not attacking or staggered. Blocked hits
   * drain `max` guard points (damage x (1 - stability) x blockStaminaMult); at zero the guard breaks and the
   * enemy reels for breakTicks, open to a riposte. Guard points regenerate after regenDelayTicks.
   */
  guard: z
    .object({
      max: pos,
      regenPerSec: num.min(0),
      regenDelayTicks: int.nonnegative(),
      arcDeg: num.min(0).max(360),
      stability: num.min(0).max(1),
      absorption: num.min(0).max(1),
      breakTicks: int.positive(),
    })
    .optional(),
  rhythmIntervalTicks: int.positive().default(120),
  /** Long stagger after being parried (riposte window). */
  parriedTicks: int.positive().default(80),
  /** Never dies: HP refills on every hit (training targets). */
  immortal: z.boolean().default(false),
  sprite: z.string(),
  weaponSprite: z.string().optional(),
  weaponRestDeg: num.default(50),
  hp: pos,
  poise: PoiseCfg,
  tallow: int.nonnegative().default(0),
  /** A loot table (data/loot.json) rolled where it dies. */
  loot: z.string().optional(),
  /** It carries powder: when it dies, it bursts after a short fuse. */
  deathBlast: BlastDef.optional(),
  speed: num.min(0).default(0),
  strafeSpeed: num.min(0).default(0),
  accelTicks: pos.default(6),
  turnDegPerTick: pos.default(6),
  collider: z.object({ w: pos, h: pos }),
  hurtbox: HurtBox,
  bodyRadius: pos,
  knockbackResist: num.min(0).max(1).default(0),
  /**
   * Stealth / awareness. Sight has no distance limit — only walls (line of sight) and the facing cone hide you.
   * While seen, awareness (0..1) fills in `detectTicksNear` ticks at <= nearDistance, slowing linearly to
   * `detectTicksFar` at >= farDistance. At `suspicionAt` the enemy turns suspicious ("?") and investigates;
   * at 1 it is sure ("!"), reacts after reactionTicks, and alerts its whole room.
   */
  perception: z
    .object({
      halfAngleDeg: num.min(0).max(180),
      nearDistance: num.min(0),
      farDistance: pos,
      detectTicksNear: pos,
      detectTicksFar: pos,
      suspicionAt: num.min(0).max(1),
      /** Awareness lost per tick while you are unseen. */
      forgetPerTick: num.min(0),
      /** How long a suspicious enemy searches the last seen spot before giving up. */
      investigateTicks: int.nonnegative(),
      reactionTicks: Vec2,
      /** In combat: ticks without seeing you (and you outside its room) before it goes back to searching. */
      loseTicks: int.nonnegative(),
    })
    .default({
      halfAngleDeg: 70,
      nearDistance: 48,
      farDistance: 320,
      detectTicksNear: 20,
      detectTicksFar: 150,
      suspicionAt: 0.3,
      forgetPerTick: 0.004,
      investigateTicks: 200,
      reactionTicks: [12, 20],
      loseTicks: 240,
    }),
  leash: z.object({ distance: pos, healOnReturn: z.boolean() }).default({ distance: 200, healOnReturn: true }),
  /** preferred: circling distance; retreatBelow: back off when the player is closer than this (0 = never). */
  spacing: z
    .object({ preferred: pos, strafeTicks: Vec2, retreatBelow: num.min(0).default(0) })
    .default({ preferred: 30, strafeTicks: [40, 90], retreatBelow: 0 }),
  /** Random pause [min, max] ticks after finishing an attack before trying another. */
  attackGapTicks: Vec2.default([20, 50]),
  staggerTicks: int.positive().default(30),
  deathTicks: int.positive().default(40),
  corpseTicks: int.nonnegative().default(120),
  blood: z.string().default('blood2'),
  /** Footfalls while walking (on the walk cycle's contact frames): a sound id and its volume. */
  steps: z.object({ sfx: z.string(), volume: num.min(0).max(2).default(1) }).optional(),
  /** Its voice: a cry when it spots you (`alert`), when it's hurt (`hurt`), as it dies (`die`, else the generic
   *  death), and as an ambusher comes up out of hiding (`rise`). */
  voice: z.object({ alert: z.string().optional(), hurt: z.string().optional(), die: z.string().optional(), rise: z.string().optional() }).optional(),
  /** Not slowed by terrain (creatures of the mire move freely through its wax). */
  wader: z.boolean().default(false),
  /** Bees leave it be (beekeepers, the hive's own). */
  beeproof: z.boolean().default(false),
  /** Smoke staggers it (a swarm given a body): a puff deals this much poise damage. */
  smokePoise: num.min(0).default(0),
  /** Leaves slowing puddles behind as it walks (honey): one every `everyTicks`. */
  trail: z.object({ everyTicks: int.positive(), radius: pos, ticks: int.positive(), speedMult: num.min(0.05).max(1).default(0.6) }).optional(),
  /**
   * Ambusher: waits unseen under the surface (invulnerable, not perceiving) until the player comes within
   * `radius` px, then rises (anim "rise", `riseTicks`) and fights. Not `hidden`: it waits in plain sight,
   * still as scenery (a scarecrow), and a blow wakes it too.
   */
  ambush: z.object({ radius: pos, riseTicks: int.positive(), hidden: z.boolean().default(true) }).optional(),
  /** Sweeps its gaze back and forth by this many degrees each side of its facing while idle (lanterns). */
  scan: z.object({ arcDeg: pos, degPerTick: pos }).optional(),
  /** Draw its sight cone in the world as a pale light (lanterns: so the player can read the sweep). */
  lightCone: z.object({ length: pos, color: z.string().default('flame2') }).optional(),
  /** On death, burst into `count` of another enemy kind (e.g. a wax blob into smaller blobs). */
  splitInto: z.object({ kind: z.string(), count: int.positive() }).optional(),
  moves: z.array(MoveDef).default([]),
});

export const InputCfg = z.object({
  bufferTicks: int.nonnegative(),
  stickDeadzone: num.min(0).max(0.95),
  aimStickDeadzone: num.min(0).max(0.95),
  triggerThreshold: num.min(0).max(1),
  padAimDistance: pos,
  padAimFollowsMove: z.boolean(),
  keyboard: z.record(z.string(), z.array(z.string())),
  gamepad: z.record(z.string(), z.array(int.nonnegative())),
});

export const DebugCfg = z.object({ overlayOnStart: z.boolean(), slowmoScale: pos });

export const HudCfg = z.object({
  x: int, y: int, hpPxPerPoint: pos, hpHeight: int.positive(),
  staminaPxPerPoint: pos, staminaHeight: int.positive(), gap: int.nonnegative(),
  /** Item/event banner: top edge (px), wrap width (characters), title scale (1 = same size as the body). */
  /** Item and event messages, top-centre between the bars and the minimap: `y` is their top; `cols` the widest. */
  toast: z.object({ y: int.nonnegative(), cols: int.positive(), titleScale: int.positive() }).default({ y: 8, cols: 60, titleScale: 1 }),
  /** Area name shown on arrival: vertical position (px), text scale, how long it stays (ticks, fades included). */
  areaBanner: z.object({ y: int.nonnegative(), scale: int.positive(), ticks: int.positive() }).default({ y: 72, scale: 1, ticks: 180 }),
  /** Corner minimap: on/off, box size (px), pixels per tile. The large map (M) scales itself to fit. */
  minimap: z
    .object({ enabled: z.boolean(), w: int.positive(), h: int.positive(), scale: int.positive() })
    .default({ enabled: true, w: 72, h: 48, scale: 2 }),
});

export const Palette = z.record(z.string(), z.string().regex(/^#[0-9a-fA-F]{6}$/));

export const WeaponDef = z
  .object({
    id: z.string(),
    name: z.string(),
    kind: z.enum(['melee', 'ranged']),
    twoHanded: z.boolean(),
    /** How much Strength and Dexterity add to its damage, graded S (most) to E (least); missing = none. */
    scaling: z.object({ str: Grade.optional(), dex: Grade.optional() }).default({}),
    /** Can Bede upgrade it (+1 to +5)? */
    upgradable: z.boolean().default(true),
    /** hidden: no weapon sprite is drawn (bare hands). */
    view: z.object({ sprite: z.string(), restAngleOffsetDeg: num, hidden: z.boolean().default(false) }),
    light: z.array(StrikeDef).default([]),
    /** Melee: charged heavy. Ranged: the weapon bash (chargeTicks 0). */
    heavy: z
      .object({ chargeTicks: int.nonnegative(), chargeDamageMult: pos, chargePoiseMult: pos, strike: StrikeDef })
      .optional(),
    ranged: z
      .object({
        clip: int.positive(),
        reserveMax: int.nonnegative(),
        fire: z.object({
          windup: int.nonnegative(),
          recovery: int.nonnegative(),
          stamina: num.min(0),
          moveMult: num.min(0).max(1),
          /** Visual kick: weapon rotates up by recoilDeg and slides back by kick px, then settles. */
          recoilDeg: num,
          kick: num.min(0),
          shake: num.min(0).max(1).default(0.08),
          sfx: z.string(),
        }),
        reload: z.object({ ticks: int.positive(), stamina: num.min(0), moveMult: num.min(0).max(1) }),
        projectile: ProjectileDef,
        casing: z.boolean().default(false),
        muzzle: z.enum(['small', 'large', 'none']).default('small'),
      })
      .optional(),
    /** Critical damage multipliers applied to the weapon's base damage (first light strike or bash). */
    crit: z.object({ backstab: pos, riposte: pos }).default({ backstab: 2.5, riposte: 3 }),
    /** Equip weight (counts toward equip load while in a hand slot). */
    weight: num.min(0).default(0),
    /** Frame in the `icons` sheet (inventory screens). */
    icon: int.nonnegative().default(0),
    description: z.string().default(''),
    /** Sounds: `draw` when it comes to hand, `hit` when one of its strikes lands, `shotHit` when its shot lands, `charge` as a heavy starts charging, `reload` steps as [fraction of the reload, sound]. */
    sounds: z
      .object({
        draw: z.string().optional(),
        hit: z.string().optional(),
        /** A shot or bolt landing. */
        shotHit: z.string().optional(),
        charge: z.string().optional(),
        reload: z.array(z.tuple([num.min(0).max(1), z.string()])).optional(),
      })
      .default({}),
  })
  .passthrough()
  .superRefine((w, ctx) => {
    if (w.kind === 'melee' && !w.light.length) ctx.addIssue({ code: 'custom', path: ['light'], message: 'melee weapons need at least one light strike' });
    if (w.kind === 'ranged' && !w.ranged) ctx.addIssue({ code: 'custom', path: ['ranged'], message: 'ranged weapons need a "ranged" block' });
  });

export const ShieldDef = z.object({
  id: z.string(),
  name: z.string(),
  sprite: z.string(),
  /** Fraction of blocked damage NOT converted into stamina loss (higher = cheaper blocks). */
  stability: num.min(0).max(1),
  /** Fraction of damage blocked (the rest goes through as chip damage). */
  absorption: num.min(0).max(1),
  arcDeg: num.min(0).max(360),
  parryWindowTicks: int.nonnegative(),
  /** Block must be released this long before a new press can parry again (no mashing). */
  parryRearmTicks: int.nonnegative(),
  raiseTicks: int.nonnegative(),
  blockMoveMult: num.min(0).max(1),
  blockRegenMult: num.min(0).max(1),
  weight: num.min(0).default(0),
  icon: int.nonnegative().default(0),
  description: z.string().default(''),
  /** Sounds when it takes a blow and when it parries. */
  blockSfx: z.string().default('block'),
  parrySfx: z.string().default('parry'),
});

/** Armour (data/armour): worn on the head or body. Reduces damage taken, adds poise, weighs you down. */
export const ArmourDef = z.object({
  id: z.string(),
  name: z.string(),
  slot: z.enum(['head', 'body']),
  weight: num.min(0),
  /** Fraction of incoming damage it takes off (pieces add up). */
  absorb: num.min(0).max(0.5),
  /** Added to the player's poise (how much it takes to stagger you). */
  poise: num.min(0),
  icon: int.nonnegative(),
  description: z.string(),
  /** The colours it dresses the player in, dark to light: the cloak's teal is repainted with them (the hood by
   *  head armour, the rest by body armour). */
  ramp: z.tuple([z.string(), z.string(), z.string(), z.string()]),
  /** Worn, it changes you like a ring (a beekeeper's veil against stings). */
  mods: Mods.optional(),
  /** One plain line saying what `mods` do (the equipment screen shows it). */
  effect: z.string().optional(),
});
export type ArmourDef = z.infer<typeof ArmourDef>;

/** Equip load: tiers by the fraction of `capacity` your equipped gear weighs; each changes the roll and your pace. */
export const LoadCfg = z.object({
  capacity: pos,
  tiers: z
    .array(
      z.object({
        id: z.enum(['light', 'medium', 'heavy', 'over']),
        label: z.string(),
        /** Applies up to (and including) this fraction of capacity. */
        upTo: pos,
        /** Roll: distance and stamina multipliers, travel and recovery time multipliers, iframes added (ticks). */
        roll: z.object({ distance: pos, travel: pos, recover: pos, stamina: pos, iframes: int }),
        /** Walking speed multiplier; whether you can sprint. */
        move: pos,
        sprint: z.boolean().default(true),
        /** One line for the equipment screen. */
        note: z.string(),
      }),
    )
    .min(1),
});
export type LoadCfg = z.infer<typeof LoadCfg>;

/** wall, void, floor, or a named floor variant ("floor_moss", "floor_dirt"...) looked up in the area's tileset. */
export const TileKind = z.string().regex(/^(wall|void|floor|floor_[a-z0-9_]+)$/, 'expected wall, void, floor or floor_<variant>');
/** data/areas.json: per-area presentation. */
export const AreaDef = z.object({ name: z.string(), tileset: z.string() });
export const Areas = z.object({ areas: z.record(z.string(), AreaDef) });
/**
 * data/decor.json: static scenery. `blocks` are tile offsets from the entity's tile that become solid
 * (movement and bullets stop). Sight passes over them (low cover) unless `tall` (hiding spots).
 * `flat` decor lies on the floor.
 */
export const DecorDef = z.object({
  sprite: z.string(),
  frame: int.nonnegative().default(0),
  blocks: z.array(Vec2).default([]),
  tall: z.boolean().default(false),
  flat: z.boolean().default(false),
});
export const DecorTable = z.object({ decor: z.record(z.string(), DecorDef) });
/** data/terrain.json: floor variants that change how things move (e.g. wax pools slow you down). */
export const Terrain = z.object({ floors: z.record(z.string(), z.object({ speedMult: num.min(0.05).max(2) })) });
export const RoomEntity = z.object({ type: z.string(), id: z.string().optional(), at: Vec2 }).passthrough();
/** One stop of an NPC's routine (room tiles): walk there (through `via`), then `do` something for `ticks`. */
export const NpcStop = z.object({
  at: Vec2,
  via: z.array(Vec2).optional(),
  do: z.enum(['idle', 'work', 'sit', 'kneel']).default('idle'),
  ticks: int.positive().default(120),
  face: z.union([z.literal(-1), z.literal(1)]).optional(),
});
export type NpcStop = z.infer<typeof NpcStop>;
/** Ambient chatter: short exchanges in speech bubbles between NPC placements standing near each other. */
export const ChatDef = z.object({
  id: z.string(),
  /** Placement ids that must all be present and within `range` px of the first. */
  who: z.array(z.string()).min(1),
  when: Cond.optional(),
  range: pos.default(80),
  /** [placement id, line] in order. Lines are short: they sit in a bubble over the speaker's head. */
  lines: z.array(z.tuple([z.string(), z.string().max(90)])).min(1),
});
export const Chatter = z.object({ chats: z.array(ChatDef) });

// ---- Ambient life (data/ambience.json): flames, smoke, critters and air, per decor kind and per area ----
const Px = z.tuple([int, int]);
export const AmbientDecor = z.object({
  /** Flame points, in px from the decor's anchor (bottom centre of its tile). */
  at: z.array(Px).min(1),
  /** Warm light over each flame (scale of the glow). */
  glow: z.number().min(0).max(3).optional(),
  /** Dancing flame tips. */
  flicker: z.boolean().default(true),
  /** Puffs / sparks per second from the flames. */
  smoke: z.number().min(0).optional(),
  embers: z.number().min(0).optional(),
  steam: z.number().min(0).optional(),
  /** Where steam rises from (else the flame points). */
  steamAt: z.array(Px).optional(),
  /** Moths fluttering round the first flame. */
  moths: int.min(0).max(6).optional(),
});
export const CRITTERS = ['rat', 'crow', 'frog', 'cat', 'bat'] as const;
export const AIR_FX = ['ash', 'dust', 'fireflies', 'soot', 'mist', 'leaves', 'petals', 'pollen'] as const;
export const AmbientArea = z.object({
  /** Things drifting in the air over the view. */
  air: z.array(z.object({ fx: z.enum(AIR_FX), count: int.min(1).max(80) })).default([]),
  /** Small animals per room: [min, max]. `on`: only on these floor kinds; `rooms`: only in these rooms. */
  critters: z
    .array(z.object({ kind: z.enum(CRITTERS), perRoom: z.tuple([int.min(0), int.min(0)]), on: z.array(z.string()).optional(), rooms: z.array(z.string()).optional() }))
    .default([]),
  /** Floor kinds that bubble now and then. */
  bubbles: z.array(z.string()).default([]),
  /** Drops falling from the dark ceiling, per second, in view. */
  drips: z.number().min(0).default(0),
});
export const Ambience = z.object({ decor: z.record(AmbientDecor), areas: z.record(AmbientArea) });
export type AmbientDecor = z.infer<typeof AmbientDecor>;
// ---- Ambient sound (data/audio/ambient.json) ----
export const AMBIENT_SOUNDS = ['crow', 'creak', 'owl', 'bell', 'crickets', 'frog', 'bubble', 'drip', 'clank', 'steam', 'chain', 'choir', 'humming', 'crackle', 'roar', 'wings', 'squeak', 'plop', 'bees', 'songbird'] as const;
export type AmbientSound = (typeof AMBIENT_SOUNDS)[number];
/** Layered sound effects (bosses "b_", regular enemies "e_"): recipes in src/audio/BossSfx.ts, usable anywhere an effect id is. */
export const LAYERED_SOUNDS = [
  'b_toll_heft', 'b_hammer_whoosh', 'b_hammer_thrust', 'b_bell_rise', 'b_bell_slam', 'b_toss', 'b_toll_roar',
  'b_matron_breath', 'b_wet_swipe', 'b_matron_hush', 'b_embrace', 'b_matron_sing', 'b_matron_wail', 'b_matron_lullaby',
  'b_mother_grunt', 'b_ladle_whoosh', 'b_spit', 'b_wax_splat', 'b_mother_heave', 'b_ladle_crush', 'b_mother_hum', 'b_wax_pour', 'b_mother_roar',
  'b_bone_rattle', 'b_bone_whoosh', 'b_bone_jab', 'b_bone_hiss', 'b_bone_leap', 'b_ground_slam', 'b_bone_summon', 'b_bone_screech',
  'b_chandler_chant', 'b_staff_whoosh', 'b_staff_thrust', 'b_flame_flick', 'b_censer', 'b_chandler_roar',
  'b_blackflame_whoosh', 'b_blackflame_jab', 'b_blackflame_slam', 'b_blackflame_leap', 'b_volley', 'b_fire_burst', 'b_flood', 'b_blackflame_roar',
  'b_step_armor', 'b_step_wet', 'b_step_heavy', 'b_step_bone', 'b_step_robe', 'b_step_flame',
  // wickling
  'e_wick_chitter', 'e_cleaver', 'e_wick_swipe', 'e_wick_shove', 'e_wick_alert', 'e_wick_hurt', 'e_wick_die', 'e_step_patter',
  // taper hound
  'e_growl', 'e_bite', 'e_lunge', 'e_bark', 'e_yelp', 'e_whine', 'e_step_paws',
  // powder acolyte
  'e_acolyte_chant', 'e_fuse', 'e_lob', 'e_firepot_blast', 'e_shove', 'e_acolyte_alert', 'e_acolyte_hurt', 'e_acolyte_die', 'e_step_sandal',
  // belfry brute
  'e_brute_heave', 'e_brute_slam', 'e_brute_whoosh', 'e_brute_grab', 'e_brute_roar', 'e_brute_hurt', 'e_brute_die', 'e_step_brute',
  // bulwark warden
  'e_armor_shift', 'e_shield_bash', 'e_spear_thrust', 'e_spear_overhead', 'e_warden_alert', 'e_warden_hurt', 'e_warden_die', 'e_step_warden',
  // drowned pilgrim
  'e_gurgle', 'e_wet_claw', 'e_drag', 'e_drowned_moan', 'e_drowned_hurt', 'e_drowned_die', 'e_drowned_rise', 'e_step_drowned',
  // renderer
  'e_hook_whirl', 'e_hook_throw', 'e_butcher_grunt', 'e_flense', 'e_butcher_alert', 'e_butcher_hurt', 'e_butcher_die', 'e_step_boot',
  // vat crawler, vat spawn, wax slime
  'e_blob_rise', 'e_engulf', 'e_blob_nip', 'e_sizzle_rise', 'e_scald', 'e_blob_gurgle', 'e_blob_chirp', 'e_blob_hurt', 'e_blob_die', 'e_blob_pop', 'e_slime_die', 'e_step_slime',
  // mire lantern
  'e_lantern_alarm', 'e_lantern_hurt', 'e_lantern_die',
  // the player ("p_"): weapons
  'p_punch', 'p_punch_heavy', 'p_hit_blunt', 'p_draw_fists',
  'p_dagger', 'p_dagger_heavy', 'p_hit_stab', 'p_draw_blade_small',
  'p_sword', 'p_sword_heavy', 'p_hit_blade', 'p_draw_blade',
  'p_axe', 'p_axe_heavy', 'p_hit_axe', 'p_draw_heavy',
  'p_revolver', 'p_flintlock', 'p_crossbow', 'p_bash', 'p_hit_shot', 'p_hit_bolt', 'p_draw_gun',
  'p_cyl_open', 'p_shell_out', 'p_round_in', 'p_cyl_close', 'p_powder_pour', 'p_ramrod', 'p_cock', 'p_crank', 'p_bolt_seat', 'p_latch',
  'p_charge', 'p_block_buckler', 'p_parry',
  // the player: body and gear
  'p_hurt', 'p_die', 'p_drink', 'p_roll_light', 'p_roll', 'p_roll_heavy', 'p_roll_flop',
  'p_unequip', 'p_draw', 'p_strap', 'p_armour_light', 'p_armour_heavy', 'p_mail_jingle',
  // the player: consumables, rings, notes
  'p_use', 'p_belt', 'p_swap', 'p_levelup', 'p_buy', 'p_anvil',
  // the Powder Vault
  'b_keg_blast', 'e_spark_pop', 'e_step_mule', 'e_mule_alert', 'e_mule_hurt', 'e_mule_die', 'e_mule_heave', 'e_mule_shove',
  'e_runner_alert', 'e_runner_hurt', 'e_runner_die', 'e_linstock_jab', 'b_cannon_roll', 'b_cannon_crank', 'b_cannon_fire',
  'b_grapeshot', 'b_cannon_ram', 'b_gunner_roar', 'b_gunner_grunt', 'b_stock_swing', 'b_blunderbuss',
  'b_spikes', 'b_geyser', 'b_spout', 'b_ember_pop', 'b_whirl', 'b_spin', 'b_notes', 'b_wave', 'b_chain_shot',
  'b_tallow_scream', 'b_chandler_scream', 'b_cannon_burst', 'b_boss_fall',
  // Bloomhollow
  'e_buzz', 'e_sting', 'e_swarm_rise', 'e_swarm_calm', 'p_smoker', 'e_husk_puff',
  'e_husk_alert', 'e_husk_hurt', 'e_husk_die', 'e_husk_pump', 'e_step_husk', 'e_straw', 'e_guard_rise', 'e_guard_alert', 'e_guard_hurt', 'e_guard_die', 'e_scythe', 'e_scythe_windup', 'b_warden_roar', 'b_warden_scythe', 'b_warden_spin', 'b_crows_fly', 'b_step_straw', 'b_queen_hum', 'b_queen_song', 'b_jelly_spit', 'b_sceptre', 'b_swarm_roar', 'b_swarm_dive', 'b_queen_scream', 'b_step_glide', 'b_honey_rain',
  'c_shriek', 'c_neigh', 'c_crash', 'c_cart', 'c_crows', 'c_bell_toll', 'c_steam', 'c_bubble', 'p_blunderbuss', 'p_throw', 'p_throw_knife', 'p_eat', 'p_incense', 'p_cartridge', 'p_oil', 'p_smoke', 'p_drink_grog', 'p_candle', 'p_ring', 'p_paper',
] as const;
export type LayeredSound = (typeof LAYERED_SOUNDS)[number];
export const SURFACES = ['dirt', 'grass', 'stone', 'wood', 'metal', 'mud', 'grease', 'wax', 'moss'] as const;
export type Surface = (typeof SURFACES)[number];
const Sound = z.enum(AMBIENT_SOUNDS);
const Every = z.tuple([pos, pos]);
export const AmbientBed = z.object({
  /** wind: gusting noise; rumble: low noise; drone: soft chord; hum: machine buzz. */
  type: z.enum(['wind', 'rumble', 'drone', 'hum']),
  volume: num.min(0).max(1),
  /** Band centre (wind), cut-off (rumble) or root pitch (drone, hum), Hz. */
  freq: pos,
  /** How much it swells and fades (wind, rumble), 0-1. */
  gust: num.min(0).max(1).default(0.5),
  /** Drone / hum partials as multiples of freq. */
  chord: z.array(pos).optional(),
});
export type AmbientBed = z.infer<typeof AmbientBed>;
// ---- Boss music (data/audio/music.json) ----
export const MUSIC_INSTRUMENTS = ['drum', 'timpani', 'snare', 'hat', 'cymbal', 'anvil', 'bell', 'bass', 'pad', 'strings', 'spiccato', 'choir', 'organ', 'lead', 'brass', 'horn', 'hum', 'musicbox', 'celesta', 'pluck', 'harp', 'hit', 'riser', 'roll'] as const;
export const MusicLayer = z
  .object({
    inst: z.enum(MUSIC_INSTRUMENTS),
    /** Plays from this intensity up: 0 entrance, 1 fight, 2 below half health. */
    level: int.min(0).max(2).default(0),
    /** Keeps playing between phases. */
    hold: z.boolean().default(false),
    vol: num.min(0).max(3).optional(),
    /** Octaves up (+) or down (-) from the chord root / key. */
    oct: int.min(-3).max(3).optional(),
    /** One character per step: "x" plays, "X" plays louder, "." rests. */
    pattern: z.string().regex(/^[xX.]+$/).optional(),
    /** Chord tones to play ("1", "3", "5", "7", "8"; ' raises one an octave, , lowers it; space-separated when
     *  marked, e.g. "1 5 8 3'"), cycled one per hit (or all at once with `chord`). */
    notes: z.string().regex(/^([13578]+|[13578][',]*( [13578][',]*)*)$/).optional(),
    /** Only on every n-th bar (a cymbal every 4 bars). */
    every: int.min(1).default(1),
    /** Stereo position, -1 left .. 1 right. */
    pan: num.min(-1).max(1).optional(),
    /** Reverb send (else the instrument's own). */
    rev: num.min(0).max(1.5).optional(),
    /** The part it plays in the theme's `form` (a section plays only the tags it lists). */
    tag: z.string().optional(),
    /** Only in the first bar of a section (the hits of a drop) or its last (a build's riser). */
    at: z.enum(['first', 'last']).optional(),
    chord: z.boolean().default(false),
    /** Note length in steps. */
    len: pos.optional(),
    /** A melody line per bar: "degree:steps" words ("r" rests; "5+" raised, "7-" lowered). */
    melody: z.array(z.string()).min(1).optional(),
  })
  .refine(l => !!l.pattern !== !!l.melody, { message: 'a layer has either a pattern or a melody' });
export type MusicLayer = z.infer<typeof MusicLayer>;
export const MusicTheme = z.object({
  bpm: pos,
  /** Sixteenth-note steps per bar (16 for 4/4, 12 for 3/4 or 6/8). */
  steps: int.min(4).max(32),
  /** The key's root, MIDI (48 = C3). */
  root: int,
  scale: z.enum(['minor', 'dorian', 'phrygian', 'major']),
  /** One chord per bar: a scale degree from 0 (its triad in the scale), or "4M" / "3m" to force major / minor. */
  chords: z.array(z.union([int.min(0), z.string().regex(/^\d+[Mm]$/)])).min(1),
  layers: z.array(MusicLayer).min(1),
  /** The song's structure, looped: sections of bars, each playing the layers with the listed tags (untagged
   *  layers always play). `gap` silences everything for the last steps of a section: the breath before a drop. */
  form: z.array(z.object({ bars: int.min(1), play: z.array(z.string()), gap: int.min(0).optional() })).optional(),
});
export type MusicTheme = z.infer<typeof MusicTheme>;
export const MusicCfg = z.object({
  volume: num.min(0).max(1),
  /** Boss (enemy kind) -> theme. */
  bosses: z.record(z.string()),
  /** Area -> exploration theme. */
  areas: z.record(z.string()).default({}),
  /** Exploration music: its volume, and how long after a boss fight it comes back (seconds). */
  explore: z.object({ volume: num.min(0).max(1), resumeAfter: num.min(0) }).default({ volume: 0.06, resumeAfter: 8 }),
  themes: z.record(MusicTheme),
});
export const AmbientAudioCfg = z.object({
  volume: num.min(0).max(1),
  areas: z.record(
    z.object({
      beds: z.array(AmbientBed).default([]),
      /** One-off sounds every [min, max] seconds while `when` holds; `echo` sends it into the room's echo. */
      events: z.array(z.object({ sound: Sound, every: Every, volume: num.min(0).max(1), when: Cond.optional(), echo: num.min(0).max(1).default(0.5) })).default([]),
      /** Echo feedback for this area (0 = none). */
      echo: num.min(0).max(0.8).default(0),
    }),
  ),
  /** Sounds from scenery, heard within `range` px. */
  decor: z.record(z.object({ sound: Sound, every: Every, range: pos, volume: num.min(0).max(1) })),
  /** Echo for enclosed rooms (overrides their area's). */
  roomEcho: z.record(num.min(0).max(0.8)).default({}),
  /** The player's footsteps: floor kind -> surface; plain `floor` per area (or `default`); `echo` send in echoing rooms. */
  footsteps: z.object({
    volume: num.min(0).max(2),
    echo: num.min(0).max(1),
    surfaces: z.record(z.enum(SURFACES)),
    floor: z.record(z.enum(SURFACES)),
  }),
  /** The hub harper's music: full volume within `near` px, silent past `range`. */
  harp: z.object({ volume: num.min(0).max(1), bpm: pos, near: pos, range: pos }),
});
export type AmbientArea = z.infer<typeof AmbientArea>;
export type ChatDef = z.infer<typeof ChatDef>;
export const RoomData = z
  .object({
    id: z.string(),
    area: z.string().default('default'),
    origin: Vec2,
    legend: z.record(z.string().length(1), TileKind),
    tiles: z.array(z.string()).min(1),
    entities: z.array(RoomEntity).default([]),
  })
  .superRefine((r, ctx) => {
    const w = r.tiles[0].length;
    r.tiles.forEach((row, y) => {
      if (row.length !== w) ctx.addIssue({ code: 'custom', path: ['tiles', y], message: `row is ${row.length} wide, expected ${w}` });
      for (const ch of row) if (!(ch in r.legend)) ctx.addIssue({ code: 'custom', path: ['tiles', y], message: `char "${ch}" not in legend` });
    });
  });

// ---- Asset manifests (assets/sprites/*.anim.json) — see ASSETS.md ----
export const Box = z.object({ x: num, y: num, w: pos, h: pos });
export const FrameDef = z.object({
  ticks: pos,
  col: int.nonnegative().optional(),
  phase: z.string().optional(),
  events: z.array(z.string()).optional(),
  hand: Vec2.optional(),
  /** Per-direction weapon hand for this frame (relative to the pivot); wins over `hand` for the listed directions. */
  hands: z.record(z.string(), Vec2).optional(),
  torsoDy: num.optional(),
  hurtbox: Box.optional(),
});
export const AnimDef = z.object({
  row: int.nonnegative(),
  dirs: z.array(Dir).min(1),
  loop: z.boolean(),
  frames: z.array(FrameDef).min(1),
});
export const SpriteManifest = z.object({
  image: z.string(),
  cell: z.tuple([int.positive(), int.positive()]),
  pivot: Vec2,
  layer: z.enum(['legs', 'torso', 'single', 'weapon', 'fx', 'ui', 'tiles']),
  handAnchors: z.record(z.string(), Vec2).optional(),
  points: z.record(z.string(), Vec2).optional(),
  tiles: z.record(z.string(), z.array(int.nonnegative()).min(1)).optional(),
  animations: z.record(z.string(), AnimDef).default({}),
});

export type GameCfg = z.infer<typeof GameCfg>;
export type PlayerCfg = z.infer<typeof PlayerCfg>;
export type RollCfg = z.infer<typeof RollCfg>;
export type StaminaCfg = z.infer<typeof StaminaCfg>;
export type InputCfg = z.infer<typeof InputCfg>;
export type WeaponDef = z.infer<typeof WeaponDef>;
export type StrikeDef = z.infer<typeof StrikeDef>;
export type ShieldDef = z.infer<typeof ShieldDef>;
export type ProjectileDef = z.infer<typeof ProjectileDef>;
export type PropDef = z.infer<typeof PropDef>;
export type LootEntry = z.infer<typeof LootEntry>;
export type ItemDef = z.infer<typeof ItemDef>;
export type MoveDef = z.infer<typeof MoveDef>;
export type EnemyDef = z.infer<typeof EnemyDef>;
export type SfxPreset = z.infer<typeof SfxPreset>;
export type RoomData = z.infer<typeof RoomData>;
export type TileKind = z.infer<typeof TileKind>;
export type DecorDef = z.infer<typeof DecorDef>;
export type ScriptDef = z.infer<typeof ScriptDef>;
export type NpcDef = z.infer<typeof NpcDef>;
export type FrameDef = z.infer<typeof FrameDef>;
export type AnimDef = z.infer<typeof AnimDef>;
export type SpriteManifest = z.infer<typeof SpriteManifest>;

export function formatZod(e: z.ZodError): string {
  return e.issues.map(i => `  ${i.path.join('.') || '(root)'}: ${i.message}`).join('\n');
}
