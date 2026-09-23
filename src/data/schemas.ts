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
  startWeapons: z.array(z.string()).min(1),
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
});

export const JuiceCfg = z.object({
  shake: z.object({ maxOffset: num.min(0), decayPerTick: num.min(0), debugTrauma: num.min(0).max(1) }),
  squash: z.object({ rollStart: SquashKey, rollLand: SquashKey, hit: SquashKey, attack: SquashKey }),
  dust: z.object({ footstep: z.enum(['always', 'sprint', 'never']) }),
  flashTicks: int.nonnegative(),
  particles: z.object({ sparks: int.nonnegative(), blood: int.nonnegative(), bloodOnKill: int.nonnegative(), maxStains: int.nonnegative() }),
  damageNumbers: z.enum(['all', 'dummy', 'none']),
  enemyBarTicks: int.nonnegative(),
});

export const CombatCfg = z.object({
  knockbackDecay: num.min(0).max(0.99),
  bodyPush: num.min(0).max(1),
  heavyHitstop: int.nonnegative(),
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
  /** Player only: tick (from strike start) from which the next light attack may chain. */
  comboFrom: int.nonnegative().optional(),
  /** Player only: tick from which a roll may cancel the recovery. */
  rollCancelFrom: int.nonnegative().optional(),
  sfx: z.string().default('swing'),
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
  ai: z.enum(['melee', 'dummy']),
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
  perception: z
    .object({ range: pos, halfAngleDeg: num.min(0).max(180), reactionTicks: Vec2, loseTicks: int.nonnegative(), alertShareRadius: num.min(0) })
    .default({ range: 100, halfAngleDeg: 60, reactionTicks: [15, 25], loseTicks: 240, alertShareRadius: 80 }),
  leash: z.object({ distance: pos, healOnReturn: z.boolean() }).default({ distance: 200, healOnReturn: true }),
  spacing: z.object({ preferred: pos, strafeTicks: Vec2 }).default({ preferred: 30, strafeTicks: [40, 90] }),
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
});

export const Palette = z.record(z.string(), z.string().regex(/^#[0-9a-fA-F]{6}$/));

export const WeaponDef = z
  .object({
    id: z.string(),
    name: z.string(),
    kind: z.enum(['melee', 'ranged']),
    twoHanded: z.boolean(),
    view: z.object({ sprite: z.string(), restAngleOffsetDeg: num }),
    light: z.array(StrikeDef).default([]),
    heavy: z
      .object({ chargeTicks: int.nonnegative(), chargeDamageMult: pos, chargePoiseMult: pos, strike: StrikeDef })
      .optional(),
  })
  .passthrough();

export const TileKind = z.enum(['wall', 'floor', 'floor_moss', 'void']);
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
export type MoveDef = z.infer<typeof MoveDef>;
export type EnemyDef = z.infer<typeof EnemyDef>;
export type SfxPreset = z.infer<typeof SfxPreset>;
export type RoomData = z.infer<typeof RoomData>;
export type TileKind = z.infer<typeof TileKind>;
export type FrameDef = z.infer<typeof FrameDef>;
export type AnimDef = z.infer<typeof AnimDef>;
export type SpriteManifest = z.infer<typeof SpriteManifest>;

export function formatZod(e: z.ZodError): string {
  return e.issues.map(i => `  ${i.path.join('.') || '(root)'}: ${i.message}`).join('\n');
}
