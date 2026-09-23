// "Recent damage" trail for health bars: after a hit the lost chunk stays visible briefly, then drains.
export class TrailBar {
  /** Displayed trail value (>= current). */
  value: number;
  private hold = 0;
  private last: number;

  constructor(initial: number) {
    this.value = this.last = initial;
  }

  /** @param holdMs how long the lost chunk stays before draining; drainPerSec as a fraction of max */
  update(current: number, max: number, dtMs: number, holdMs: number, drainPerSec: number) {
    if (current < this.last) this.hold = holdMs; // fresh damage restarts the hold
    this.last = current;
    if (current >= this.value) {
      this.value = current; // healing: no trail
      return;
    }
    if (this.hold > 0) this.hold -= dtMs;
    else this.value = Math.max(current, this.value - (max * drainPerSec * dtMs) / 1000);
  }
}
