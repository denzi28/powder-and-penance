// Screen-wide cinematic effects shared by cutscene scripts and boss moments: letterbox bars that slide in and
// out, full-screen flashes (white for an explosion, black for a snuffing, red for a scream), and a "cinema"
// hold: the camera looks at something while the controls are taken away, and the world keeps moving.
import { DATA } from '../data/config';
import { hexToInt } from '../ui/colors';

const BAR_TICKS = 18;

export class ScreenFx {
  /** 0..1: how far the bars have slid in. */
  bars = 0;
  private barOwners = new Set<string>();
  flash: { color: number; t: number; ticks: number; peak: number } | null = null;
  /** A cinema hold: where the camera looks (world px), and for how many more ticks the player can't act. */
  private hold: { at: () => { x: number; y: number } | null; ticks: number; lock: boolean } | null = null;

  /** Bars in (while any owner wants them) or out. */
  setBars(owner: string, on: boolean) {
    if (on) this.barOwners.add(owner);
    else this.barOwners.delete(owner);
  }

  /** A flash of a palette colour (or #hex), fading over `ticks`. */
  flashOn(color: string, ticks = 12, peak = 1) {
    this.flash = { color: hexToInt(DATA.palette[color] ?? color), t: 0, ticks, peak };
  }
  get flashAlpha() {
    const f = this.flash;
    if (!f) return 0;
    const k = f.t / f.ticks;
    return f.peak * (1 - k) ** 1.5;
  }

  /** Look at `at` for `ticks` (bars in); `lock` takes the controls away meanwhile. */
  cinema(at: () => { x: number; y: number } | null, ticks: number, lock = true) {
    this.hold = { at, ticks, lock };
    this.setBars('cinema', true);
  }
  endCinema() {
    this.hold = null;
    this.setBars('cinema', false);
  }
  get cameraPoint() {
    return this.hold ? this.hold.at() : null;
  }
  get locked() {
    return !!this.hold?.lock;
  }

  tick() {
    const want = this.barOwners.size ? 1 : 0;
    this.bars = want > this.bars ? Math.min(1, this.bars + 1 / BAR_TICKS) : Math.max(0, this.bars - 1 / BAR_TICKS);
    if (this.flash && ++this.flash.t >= this.flash.ticks) this.flash = null;
    if (this.hold && --this.hold.ticks <= 0) this.endCinema();
  }

  reset() {
    this.barOwners.clear();
    this.bars = 0;
    this.flash = null;
    this.hold = null;
  }
}
