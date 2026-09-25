import type { HitInfo } from '../combat/CombatSystem';
import type { Actor } from '../actors/Actor';
import type { StrikeDef, WeaponDef } from '../data/schemas';
import type { Prop } from '../world/Props';

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
  /** The player's foot came down (the sound depends on the ground). */
  footstep: { x: number; y: number; sprint: boolean };
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
  projectileEnd: { x: number; y: number; angle: number; wall: boolean; bounce?: boolean };
  weaponDropped: { id: string; x: number; y: number };
  /** A lobbed projectile bursts (area damage already applied). */
  blast: { x: number; y: number; radius: number; sfx: string };
  /** The player used a consumable (its effect has already applied). */
  itemUsed: { id: string; x: number; y: number };
  /** Explain a control once (a tap of the drop key, the old swap key). */
  hint: { id: 'drop' };
  /** A consumable's timed effect wore off. */
  buffEnded: { id: string };
  /** A thrown strike releases its projectile (throw sound). */
  thrown: { actor: Actor; strike: StrikeDef };
  /** A summoning strike goes off: the scene spawns the summoned enemies around the caster. */
  summon: { actor: Actor; strike: StrikeDef };
  /** A smoke strike goes off: the scene hides the attacker and moves it near its target. */
  vanish: { actor: Actor; strike: StrikeDef };
  /** A strike spills wax: the scene lays slowing pools (`target` = where the strike was aimed). */
  pools: { actor: Actor; strike: StrikeDef; target: { x: number; y: number } | null };
  eruptions: { actor: Actor; strike: StrikeDef; target: { x: number; y: number } | null; angle: number };
  /** A strike puffs smoke (strike.smoke): the scene blinds whoever is in it and settles bees. */
  smoke: { actor: Actor; strike: StrikeDef; angle: number };
  /** A strike sends out bees (strike.swarm). */
  swarm: { actor: Actor; strike: StrikeDef };
  /** Something walking leaves a slowing puddle behind it (enemy `trail`). */
  trail: { actor: Actor; x: number; y: number };
  erupted: { x: number; y: number; radius: number; fx: 'spikes' | 'wax' | 'flame' | 'water' | 'ember' | 'honey'; sfx: string };
  /** Player caught by a grab / released from it. */
  grabbed: { by: Actor };
  propBroken: { prop: Prop };
  healed: { actor: Actor };
  /** Drink interrupted before the heal landed: the charge is wasted. */
  healFailed: { actor: Actor };
}
