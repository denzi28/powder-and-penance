// Renders the player: shadow, legs (movement-facing), torso (aim-facing) and the held weapon.
// Positions are interpolated between ticks and snapped to whole pixels.
import Phaser from 'phaser';
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
    const x = Math.round(lerp(p.prevX, p.x, alpha));
    const y = Math.round(lerp(p.prevY, p.y, alpha));
    const depth = DEPTH.actor(y);
    const { sx, sy } = p.squash;
    const flash = p.flash > 0;

    this.shadow.setPosition(x, y);

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
    return { x, y };
  }

  /** Off-hand shield: at the off hand normally, pushed out toward the aim while blocking. */
  private renderShield(x: number, y: number, depth: number, flip: boolean, anchor: readonly number[], flash: boolean) {
    const p = this.p;
    const sh = p.shield;
    const show = !!sh && p.weaponVisible && !p.dead;
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
