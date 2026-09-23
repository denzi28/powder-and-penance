// Renders a single-layer enemy: shadow, body, held weapon, notice "!" pip.
import Phaser from 'phaser';
import { lerp } from '../core/math';
import { DEPTH } from '../render/depth';
import { HeldWeapon, lerpAngle } from '../render/HeldWeapon';
import { tint } from '../player/PlayerView';
import type { SpriteLib } from '../anim/SpriteLib';
import type { Enemy } from './Enemy';

/** Animations that need both hands free: the held weapon is laid on the floor meanwhile. */
const SET_DOWN_ANIMS: ReadonlySet<string> = new Set(['summon', 'channel']);

export class EnemyView {
  private shadow: Phaser.GameObjects.Sprite;
  private body: Phaser.GameObjects.Sprite;
  private pip: Phaser.GameObjects.Sprite;
  readonly weapon: HeldWeapon | null;
  /** Where the weapon lies while it's been set down (see SET_DOWN_ANIMS), or null while held. */
  private setDownAt: { x: number; y: number; side: number } | null = null;
  /** Snapped draw position from the last render (for bars, numbers). */
  x = 0;
  y = 0;

  constructor(scene: Phaser.Scene, readonly e: Enemy, private lib: SpriteLib) {
    this.shadow = lib.sprite('shadow').setDepth(DEPTH.shadow);
    this.body = lib.sprite(e.def.sprite);
    this.pip = lib.sprite('exclaim').setVisible(false);
    this.weapon = e.def.weaponSprite ? new HeldWeapon(scene, lib) : null;
    this.weapon?.setSprite(e.def.weaponSprite!);
  }

  render(alpha: number) {
    const e = this.e;
    const feetX = (this.x = Math.round(lerp(e.prevX, e.x, alpha)));
    const feetY = (this.y = Math.round(lerp(e.prevY, e.y, alpha)));
    const x = feetX + Math.round(e.flinchX); // recoil from hits (visual only)
    const y = feetY + Math.round(e.flinchY);
    const depth = DEPTH.actor(feetY);
    const sheet = e.def.sprite;
    const f = this.lib.frame(sheet, e.anim.name, e.dir, e.anim.index);
    const { sx, sy } = e.squash;

    this.shadow.setPosition(feetX, feetY).setAlpha(e.alpha);
    this.body
      .setFrame(f.frame)
      .setScale(f.flip ? -sx : sx, sy)
      .setPosition(x, y)
      .setDepth(depth + 0.1)
      .setAlpha(e.alpha);
    tint(this.body, e.flash > 0);

    const pip = e.stateName === 'notice' ? 'exclaim' : e.stateName === 'suspicious' ? 'question' : null;
    this.pip.setVisible(pip !== null && e.alpha > 0);
    if (pip) {
      if (this.pip.texture.key !== pip) this.pip.setTexture(pip, 0);
      this.pip.setPosition(x, y - e.def.hurtbox.h - 14).setDepth(DEPTH.overlay - 1);
    }

    if (this.weapon) {
      this.weapon.setVisible(!e.dead && e.alpha > 0); // hidden with its owner (e.g. submerged ambushers)
      // Casting and channelling need both hands: the weapon is set down flat on the floor beside the
      // caster, where it stays until they move or fight again.
      const setDown = !e.dead && SET_DOWN_ANIMS.has(e.anim.name);
      if (!setDown) this.setDownAt = null;
      else if (!this.setDownAt) {
        const side = f.flip ? -1 : 1;
        this.setDownAt = { x: feetX + side * 8, y: feetY + 3, side };
      }
      if (this.setDownAt) {
        const g = this.setDownAt;
        this.weapon.place(g.x, g.y, g.side > 0 ? 0.06 : Math.PI - 0.06, 0, depth);
        this.weapon.sprite.setDepth(DEPTH.shadow + 1); // lying on the floor, under everyone
        tint(this.weapon.sprite, false);
      } else if (!e.dead && e.weaponAngle !== null) {
        const anchor = e.anim.frame.hand ?? this.lib.manifest(sheet).handAnchors?.[f.authoredDir] ?? [0, -10];
        const angle = e.prevWeaponAngle !== null ? lerpAngle(e.prevWeaponAngle, e.weaponAngle, alpha) : e.weaponAngle;
        this.weapon.place(x + (f.flip ? -anchor[0] : anchor[0]), y + anchor[1], angle, e.weaponReach, depth);
        tint(this.weapon.sprite, e.flash > 0);
      }
    }
  }

  destroy() {
    this.shadow.destroy();
    this.body.destroy();
    this.pip.destroy();
    this.weapon?.destroy();
  }
}
