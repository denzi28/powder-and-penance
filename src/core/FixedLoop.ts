/**
 * Fixed-timestep driver. Gameplay advances in whole ticks; rendering interpolates with the returned alpha.
 * timeScale/frozen/stepOnce exist for the debug slow-mo and frame-step keys.
 */
export class FixedLoop {
  timeScale = 1;
  frozen = false;
  private acc = 0;
  private pendingSteps = 0;

  constructor(
    private tickRate: () => number,
    private maxSteps: () => number,
    private tick: () => void,
  ) {}

  get stepMs() {
    return 1000 / this.tickRate();
  }

  /** Advance by a frame's real delta; returns interpolation alpha in [0, 1]. */
  frame(deltaMs: number): number {
    const step = this.stepMs;
    if (!this.frozen) this.acc += Math.min(deltaMs, 250) * this.timeScale;
    let steps = 0;
    while (this.acc >= step && steps < this.maxSteps()) {
      this.tick();
      this.acc -= step;
      steps++;
    }
    if (this.acc >= step) this.acc = 0; // spiral-of-death guard: drop the backlog
    for (; this.pendingSteps > 0; this.pendingSteps--) this.tick();
    return this.frozen ? 1 : this.acc / step;
  }

  stepOnce() {
    this.pendingSteps++;
  }
}
