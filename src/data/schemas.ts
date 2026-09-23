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
  ]),
});

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
  ai: z.enum(['melee', 'ranged', 'dummy', 'rhythm']),
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
export const RoomEntity = z.object({ type: z.string(), id: z.string().optional(), at: Vec2 }).passthrough();
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
export type FrameDef = z.infer<typeof FrameDef>;
export type AnimDef = z.infer<typeof AnimDef>;
export type SpriteManifest = z.infer<typeof SpriteManifest>;

export function formatZod(e: z.ZodError): string {
  return e.issues.map(i => `  ${i.path.join('.') || '(root)'}: ${i.message}`).join('\n');
}
