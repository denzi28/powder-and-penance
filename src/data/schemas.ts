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
});

/** One weighted outcome of a loot roll. */
export const LootEntry = z.object({
  weight: pos,
  tallow: Vec2.optional(),
  /** Restores this fraction of every carried ranged weapon's reserve. */
  ammo: num.positive().max(1).optional(),
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
  ]),
});

// ---- Story: characters, dialogue and cutscene scripts (see STORY.md) ----
/**
 * A condition on world flags: "name" (set) or "!name" (not set); a list means all of them. Bare names are
 * story flags ("story:<name>"); names with a colon are any world flag ("key:toll_key", "shrine:shrine_rest").
 */
export const Cond = z.union([z.string(), z.array(z.string())]);
export type Cond = z.infer<typeof Cond>;
/** A camera target: "player", "npc:<placement id>", "point:<point id>" or "enemy:<enemy kind>" (e.g. a boss). */
const Target = z
  .string()
  .regex(/^(player|npc:.+|point:.+|enemy:.+)$/, 'expected "player", "npc:<id>", "point:<id>" or "enemy:<kind>"');

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
  | { card: string; sub?: string; ticks?: number };
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
  /**
   * Lobbed: arcs over obstacles to the target point (speed/range ignored), a warning marker shows where it
   * will land, and it bursts there for area damage. Can't be blocked by walls; can be rolled through.
   */
  lob: z
    .object({ flightTicks: int.positive(), arcHeight: num.min(0), blastRadius: pos, sfx: z.string().default('explosion') })
    .optional(),
});

export const StrikeDef = z.object({
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
  pools: z
    .object({
      count: int.positive(),
      radius: pos,
      spread: num.min(0).default(0),
      at: z.enum(['self', 'target']).default('self'),
      ticks: int.positive(),
      speedMult: num.min(0.05).max(1).default(0.5),
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
        })
        .optional(),
      /**
       * A turn instead of a death: when this phase's health runs out it does not fall. It walks, untouchable,
       * to `altar` (room tiles; it faces north there), performs `anim` for `ticks` while its arena flares,
       * then `kind` takes its place with its own entrance. `line` is shown as a banner as the turn begins.
       */
      turn: z
        .object({ kind: z.string(), altar: Vec2, anim: z.string().default('pour'), ticks: int.positive(), line: z.string().optional() })
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
  /** Not slowed by terrain (creatures of the mire move freely through its wax). */
  wader: z.boolean().default(false),
  /**
   * Ambusher: waits unseen under the surface (invulnerable, not perceiving) until the player comes within
   * `radius` px, then rises (anim "rise", `riseTicks`) and fights.
   */
  ambush: z.object({ radius: pos, riseTicks: int.positive() }).optional(),
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
  toast: z.object({ y: int.nonnegative(), cols: int.positive(), titleScale: int.positive() }).default({ y: 14, cols: 60, titleScale: 1 }),
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
});

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
