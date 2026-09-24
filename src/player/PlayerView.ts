// Renders the player: shadow, legs (movement-facing), torso (aim-facing) and the held weapon.
// Positions are interpolated between ticks and snapped to whole pixels.
import Phaser from 'phaser';
import { DATA } from '../data/config';
import { hexToInt } from '../ui/colors';
import { DEG, lerp } from '../core/math';
import { DEPTH } from '../render/depth';
import { HeldWeapon, lerpAngle } from '../render/HeldWeapon';
import type { SpriteLib } from '../anim/SpriteLib';
import type { Player } from './Player';

export class PlayerView {
  private shadow: Phaser.GameObjects.Sprite;
  private legs: Phaser.GameObjects.Sprite;
  private body: Phaser.GameObjects.Sprite;
  readonly weapon: HeldWeapon;
  private shield: Phaser.GameObjects.Sprite | null = null;

  constructor(scene: Phaser.Scene, private p: Player, private lib: SpriteLib) {
    this.shadow = lib.sprite('shadow').setDepth(DEPTH.shadow);
    this.legs = lib.sprite('player_legs');
    this.body = lib.sprite('player_body');
    this.weapon = new HeldWeapon(scene, lib);
  }

  /** Returns the snapped draw position of the feet (camera follows this). */
  render(alpha: number): { x: number; y: number } {
    const p = this.p;
    const feetX = Math.round(lerp(p.prevX, p.x, alpha));
    const feetY = Math.round(lerp(p.prevY, p.y, alpha));
    // The sprite recoils from hits; the shadow and camera stay on the real position.
    const x = feetX + Math.round(p.flinchX);
    const y = feetY + Math.round(p.flinchY);
    const depth = DEPTH.actor(feetY);
    const { sx, sy } = p.squash;
    const flash = p.flash > 0;

    this.shadow.setPosition(feetX, feetY);

    let torsoDy = 0;
    this.legs.setVisible(p.legsVisible);
    if (p.legsVisible) {
      const f = this.lib.frame('player_legs', p.legs.name, p.legsDir, p.legs.index);
      this.legs.setFrame(f.frame).setScale(f.flip ? -sx : sx, sy).setPosition(x, y).setDepth(depth);
      torsoDy = Math.round((p.legs.frame.torsoDy ?? 0) * sy);
      tint(this.legs, flash);
    }

    const bf = this.lib.frame('player_body', p.body.name, p.bodyDir, p.body.index);
    this.body
      .setFrame(bf.frame)
      .setScale(bf.flip ? -sx : sx, sy)
      .setPosition(x, y + torsoDy)
      .setDepth(depth + 0.1);
    // armour repaints the cloak: its own sheet, built once per outfit
    const outfit = outfitTexture(this.body.scene, p.worn.head, p.worn.body);
    if (this.body.texture.key !== outfit) this.body.setTexture(outfit, bf.frame);
    tint(this.body, flash);

    const anchor = p.body.frame.hand ?? this.lib.manifest('player_body').handAnchors?.[bf.authoredDir] ?? [0, -10];
    const showWeapon = p.weaponVisible && !p.weapon.view.hidden;
    this.weapon.setVisible(showWeapon);
    if (showWeapon) {
      const def = p.weapon;
      this.weapon.setSprite(def.view.sprite);
      const hx = x + (bf.flip ? -anchor[0] : anchor[0]);
      const hy = y + torsoDy + anchor[1];
      let angle: number;
      let reach = p.weaponReach;
      if (p.weaponAngle !== null) {
        angle = p.prevWeaponAngle !== null ? lerpAngle(p.prevWeaponAngle, p.weaponAngle, alpha) : p.weaponAngle;
      } else {
        // Point from the hand at the aim point so the barrel lines up with the cursor.
        const dx = p.aimX - hx;
        const dy = p.aimY - hy;
        const a = dx * dx + dy * dy > 100 ? Math.atan2(dy, dx) : p.aimAngle;
        const mirror = Math.cos(a) < 0 ? -1 : 1;
        angle = a + def.view.restAngleOffsetDeg * DEG * mirror;
        if (p.weaponLowered) angle = a + 65 * DEG * mirror; // reloading / swapping
        const f = def.ranged?.fire;
        if (f && p.recoil > 0) {
          angle -= f.recoilDeg * DEG * mirror * p.recoil; // kick up
          reach -= f.kick * p.recoil;
        }
      }
      this.weapon.place(hx, hy, angle, reach, depth);
      tint(this.weapon.sprite, flash);
    }
    this.renderShield(x, y + torsoDy, depth, bf.flip, anchor, flash);
    // Quick travel: the whole figure fades (legs, body, weapon, shield, shadow together).
    for (const s of [this.shadow, this.legs, this.body, this.weapon.sprite, this.shield]) s?.setAlpha(p.fade);
    return { x: feetX, y: feetY };
  }

  /** Off-hand shield: at the off hand normally, pushed out toward the aim while blocking. */
  private renderShield(x: number, y: number, depth: number, flip: boolean, anchor: readonly number[], flash: boolean) {
    const p = this.p;
    const sh = p.shield;
    const show = !!sh && p.weaponVisible && !p.dead && p.stateName !== 'heal'; // off hand holds the phial
    this.shield?.setVisible(show);
    if (!show) return;
    if (!this.shield) this.shield = this.lib.sprite(sh.sprite);
    if (this.shield.texture.key !== sh.sprite) {
      this.shield.setTexture(sh.sprite, 0);
      this.lib.applyOrigin(this.shield, sh.sprite);
    }
    const left = Math.cos(p.aimAngle) < 0;
    let sx: number;
    let sy: number;
    let front: boolean;
    if (p.stateName === 'block') {
      sx = x + Math.cos(p.aimAngle) * 7;
      sy = y - 11 + Math.sin(p.aimAngle) * 5;
      front = Math.sin(p.aimAngle) > -0.35;
    } else {
      sx = x + (flip ? anchor[0] : -anchor[0]);
      sy = y + anchor[1] + 1;
      front = !p.bodyDir.includes('N');
    }
    this.shield
      .setPosition(Math.round(sx), Math.round(sy))
      .setScale(left ? -1 : 1, 1)
      .setDepth(depth + (front ? 0.25 : -0.06));
    tint(this.shield, flash);
  }
}

export function tint(s: Phaser.GameObjects.Sprite, white: boolean) {
  if (white) s.setTintFill(0xffffff);
  else if (s.isTinted) s.clearTint();
}

/**
 * The player's body sheet dressed in armour: the cloak's teal pixels are repainted with each piece's colour
 * ramp, matched by brightness. Head armour takes the hood (the top rows of each frame's figure), body armour
 * the rest. Built once per outfit as a canvas sheet; returns its texture key ("player_body" when unarmoured).
 */
export function outfitTexture(scene: Phaser.Scene, head: string | null, body: string | null): string {
  const h = head ? DATA.armour[head] : null;
  const b = body ? DATA.armour[body] : null;
  if (!h && !b) return 'player_body';
  const key = `player_body~${head ?? '-'}~${body ?? '-'}`;
  if (scene.textures.exists(key)) return key;
  const src = scene.textures.get('player_body').getSourceImage() as HTMLImageElement;
  const canvas = document.createElement('canvas');
  canvas.width = src.width;
  canvas.height = src.height;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(src, 0, 0);
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  const ramp = (a: { ramp: readonly string[] } | null) => a?.ramp.map(c => [(hexToInt(c) >> 16) & 255, (hexToInt(c) >> 8) & 255, hexToInt(c) & 255]);
  const hr = ramp(h);
  const br = ramp(b);
  const CELL = 32;
  const HOOD_ROWS = 7;
  const lum = (r: number, g: number, bl: number) => 0.3 * r + 0.59 * g + 0.11 * bl;
  const L0 = lum(16, 38, 42);
  const L1 = lum(125, 191, 166);
  for (let cy = 0; cy < canvas.height; cy += CELL)
    for (let cx = 0; cx < canvas.width; cx += CELL) {
      // where the figure starts in this frame (the hood is its top rows)
      let top = -1;
      for (let y = 0; y < CELL && top < 0; y++)
        for (let x = 0; x < CELL; x++)
          if (d[((cy + y) * canvas.width + cx + x) * 4 + 3] > 0) {
            top = y;
            break;
          }
      if (top < 0) continue;
      for (let y = 0; y < CELL; y++)
        for (let x = 0; x < CELL; x++) {
          const i = ((cy + y) * canvas.width + cx + x) * 4;
          if (d[i + 3] === 0) continue;
          const r = d[i];
          const g = d[i + 1];
          const bl = d[i + 2];
          // the cloak: teal (green and blue well above red)
          if (!(g > r + 12 && bl > r + 12)) continue;
          const ramp4 = y < top + HOOD_ROWS ? (hr ?? br) : br;
          if (!ramp4) continue;
          const k = Math.max(0, Math.min(0.999, (lum(r, g, bl) - L0) / (L1 - L0)));
          const c = ramp4[Math.floor(k * 4)];
          d[i] = c[0];
          d[i + 1] = c[1];
          d[i + 2] = c[2];
        }
    }
  ctx.putImageData(img, 0, 0);
  scene.textures.addSpriteSheet(key, canvas as unknown as HTMLImageElement, { frameWidth: CELL, frameHeight: CELL });
  return key;
}
