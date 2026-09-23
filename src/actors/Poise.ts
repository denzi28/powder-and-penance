// Poise: poise damage accumulates; reaching `max` (+ any hyper-armor buffer) staggers and resets.
// The accumulated damage clears after `resetTicks` without taking poise damage.
export interface PoiseParams {
  max: number;
  resetTicks: number;
}

export class Poise {
  damage = 0;
  private timer = 0;

  constructor(private cfg: () => PoiseParams) {}

  get max() {
    return this.cfg().max;
  }

  /** Apply poise damage; returns true if this breaks poise (stagger). */
  hit(amount: number, buffer = 0): boolean {
    this.damage += amount;
    this.timer = this.cfg().resetTicks;
    if (this.damage >= this.cfg().max + buffer) {
      this.damage = 0;
      this.timer = 0;
      return true;
    }
    return false;
  }

  tick() {
    if (this.timer > 0 && --this.timer === 0) this.damage = 0;
  }

  reset() {
    this.damage = 0;
    this.timer = 0;
  }
}
