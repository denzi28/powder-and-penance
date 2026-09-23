// Souls-style stamina: any action may start while stamina > 0 (bar clamps at 0, never negative).
// Hitting 0 "locks" the bar: nothing costing stamina starts until regen has restored `minToAct`.
// Regen begins `regenDelayTicks` after the most recent spend.
export interface StaminaParams {
  max: number;
  regenDelayTicks: number;
  regenPerSec: number;
  minToAct: number;
}

export class Stamina {
  value: number;
  locked = false;
  private delay = 0;

  constructor(private cfg: () => StaminaParams, private tickRate: () => number) {
    this.value = cfg().max;
  }

  get max() {
    return this.cfg().max;
  }
  /** Ticks left before regen resumes. */
  get regenDelay() {
    return this.delay;
  }

  canAct(): boolean {
    return this.locked ? this.value >= this.cfg().minToAct : this.value > 0;
  }

  spend(amount: number) {
    this.value = Math.max(0, this.value - amount);
    this.delay = this.cfg().regenDelayTicks;
    if (this.value <= 0) this.locked = true;
  }

  tick() {
    const c = this.cfg();
    if (this.value > c.max) this.value = c.max;
    if (this.delay > 0) {
      this.delay--;
      return;
    }
    this.value = Math.min(c.max, this.value + c.regenPerSec / this.tickRate());
    if (this.locked && this.value >= c.minToAct) this.locked = false;
  }

  refill() {
    this.value = this.cfg().max;
    this.locked = false;
    this.delay = 0;
  }
}
