// Tick-driven state machine. `t` is ticks since the state was entered (0 on its first tick).
// A state's tick() returns the next state's name to transition, or nothing to stay.
export interface State<C> {
  enter?(ctx: C, from: string): void;
  tick(ctx: C, t: number): string | void;
  exit?(ctx: C, to: string): void;
}

export class StateMachine<C> {
  name: string;
  t = 0;
  private cur: State<C>;
  private changed = false;

  constructor(private ctx: C, private states: Record<string, State<C>>, initial: string) {
    this.name = initial;
    this.cur = this.get(initial);
  }

  start() {
    this.cur.enter?.(this.ctx, '');
  }

  /** Switch state. `force` re-enters the current state (e.g. roll chained into roll). */
  change(to: string, force = false) {
    if (!force && to === this.name) return;
    const next = this.get(to);
    this.cur.exit?.(this.ctx, to);
    const from = this.name;
    this.name = to;
    this.cur = next;
    this.t = 0;
    this.changed = true;
    next.enter?.(this.ctx, from);
  }

  tick() {
    this.changed = false;
    const next = this.cur.tick(this.ctx, this.t);
    if (next && next !== this.name) this.change(next);
    if (!this.changed) this.t++;
  }

  private get(name: string): State<C> {
    const s = this.states[name];
    if (!s) throw new Error(`Unknown state "${name}"`);
    return s;
  }
}
