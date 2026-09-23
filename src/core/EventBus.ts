import type { HitInfo } from '../combat/CombatSystem';
import type { Actor } from '../actors/Actor';
import type { StrikeDef } from '../data/schemas';

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
  died: { actor: Actor };
}
