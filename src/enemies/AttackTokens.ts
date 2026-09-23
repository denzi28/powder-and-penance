// Limits how many enemies may be mid-attack at once, so groups circle and take turns (readable, fair).
import { DATA } from '../data/config';
import type { Actor } from '../actors/Actor';

export class AttackTokens {
  private holders = new Set<Actor>();

  acquire(a: Actor): boolean {
    for (const h of this.holders) if (h.dead) this.holders.delete(h);
    if (this.holders.has(a)) return true;
    if (this.holders.size >= DATA.ai.maxAttackers) return false;
    this.holders.add(a);
    return true;
  }

  /** Could `a` get a token right now? */
  available(a: Actor): boolean {
    for (const h of this.holders) if (h.dead) this.holders.delete(h);
    return this.holders.has(a) || this.holders.size < DATA.ai.maxAttackers;
  }

  release(a: Actor) {
    this.holders.delete(a);
  }

  clear() {
    this.holders.clear();
  }

  get count() {
    return this.holders.size;
  }
}
