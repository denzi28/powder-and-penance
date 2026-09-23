/** Squash & stretch: snap to a scale, then ease back to 1 over N ticks. */
export class Squash {
  sx = 1;
  sy = 1;
  private fromX = 1;
  private fromY = 1;
  private t = 0;
  private dur = 0;

  set([sx, sy, ticks]: readonly [number, number, number]) {
    this.fromX = this.sx = sx;
    this.fromY = this.sy = sy;
    this.dur = ticks;
    this.t = 0;
  }

  tick() {
    if (this.t >= this.dur) {
      this.sx = this.sy = 1;
      return;
    }
    this.t++;
    const k = 1 - (1 - this.t / this.dur) ** 2;
    this.sx = this.fromX + (1 - this.fromX) * k;
    this.sy = this.fromY + (1 - this.fromY) * k;
  }
}
