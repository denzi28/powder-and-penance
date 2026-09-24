// Shared context handed to every actor: services and lookups, no Phaser.
import type { Input } from '../input/Input';
import type { EventBus, GameEvents } from './EventBus';
import type { TileGrid } from '../world/TileGrid';
import type { CombatSystem } from '../combat/CombatSystem';
import type { Projectiles } from '../combat/Projectiles';
import type { Pathfinder } from '../world/Pathfinder';
import type { AttackTokens } from '../enemies/AttackTokens';
import type { Player } from '../player/Player';
import type { Enemy } from '../enemies/Enemy';

export interface WorldCtx {
  input: Input;
  bus: EventBus<GameEvents>;
  grid: () => TileGrid;
  combat: CombatSystem;
  projectiles: Projectiles;
  tokens: AttackTokens;
  nav: Pathfinder;
  rng: () => number;
  player: () => Player;
  enemies: () => readonly Enemy[];
  /** Id of the room containing a world position (null outside every room). */
  roomAt: (x: number, y: number) => string | null;
  /** The nearest unbroken powder keg within `r` px of a point (Fuse-Runners throw at them). */
  kegNear?: (x: number, y: number, r: number) => { x: number; y: number } | null;
  /** Extra slowing underfoot from spilled wax pools (1 = none). */
  slowAt?: (x: number, y: number) => number;
}

export function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
