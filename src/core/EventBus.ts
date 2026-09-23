import type { HitInfo } from '../combat/CombatSystem';
import type { Actor } from '../actors/Actor';
import type { StrikeDef, WeaponDef } from '../data/schemas';

type Handler<T> = (payload: T) => void;

export class EventBus<E extends object> {
  private handlers = new Map<keyof E, Set<Handler<never>>>();

  on<K extends keyof E>(key: K, fn: Handler<E[K]>): () => void {
    let set = this.handlers.get(key);
    if (!set) this.handlers.set(key, (set = new Set()));
    set.add(fn as Handler<never>);
    return () => set!.delete(fn as Handler<never>);
  }

  emit<K extends keyof E>(key: K, payload: E[K]) {
    this.handlers.get(key)?.forEach(fn => (fn as Handler<E[K]>)(payload));
  }
}

/** Gameplay → presentation events (juice, audio, UI subscribe; sim never calls them directly). */
export interface GameEvents {
  dust: { x: number; y: number; kind: 'roll' | 'step' };
  shake: { trauma: number };
  sfx: { id: string; x?: number; y?: number; volume?: number; pitch?: number };
  hit: HitInfo;
  /** Active frames of a strike begin (slash FX + swing sound). */
  swing: { actor: Actor; strike: StrikeDef; angle: number; mirror: number };
  /** Enemy windup cue: glint on the weapon + sound. */
  telegraph: { actor: Actor; kind: 'normal' | 'danger' };
  /** Player heavy reached full charge. */
  chargeFull: { actor: Actor };
  notice: { actor: Actor };
  suspicious: { actor: Actor };
  died: { actor: Actor };
  parry: { parrier: Actor; attacker: Actor };
  /** A critical (riposte/backstab) lands. */
  critical: { attacker: Actor; victim: Actor; kind: 'riposte' | 'backstab' };
  /** A gun/crossbow fires; x/y = muzzle on the ground plane. */
  shot: { actor: Actor; weapon: WeaponDef; x: number; y: number; angle: number };
  projectileEnd: { x: number; y: number; angle: number; wall: boolean };
  weaponDropped: { id: string; x: number; y: number };
  healed: { actor: Actor };
  /** Drink interrupted before the heal landed: the charge is wasted. */
  healFailed: { actor: Actor };
}
