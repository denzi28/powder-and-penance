// Renders the player: shadow, legs (movement-facing), torso (aim-facing) and the held weapon.
// Positions are interpolated between ticks and snapped to whole pixels.
import Phaser from 'phaser';
import { DATA } from '../data/config';
import { DEG, lerp, normDeg } from '../core/math';
import { DEPTH } from '../render/depth';
import type { SpriteLib } from '../anim/SpriteLib';
import type { Player } from './Player';

export class PlayerView {
  private shadow: Phaser.GameObjects.Sprite;
  private legs: Phaser.GameObjects.Sprite;
  private body: Phaser.GameObjects.Sprite;
  private weapon: Phaser.GameObjects.Sprite;
  private weaponSprite = '';

  constructor(scene: Phaser.Scene, private p: Player, private lib: SpriteLib) {
    this.shadow = lib.sprite('shadow').setDepth(DEPTH.shadow);
    this.legs = lib.sprite('player_legs');
    this.body = lib.sprite('player_body');
    this.weapon = scene.add.sprite(0, 0, '__DEFAULT');
  }

  /** Returns the snapped draw position of the feet (camera follows this). */
  render(alpha: number): { x: number; y: number } {
    const p = this.p;
    const x = Math.round(lerp(p.prevX, p.x, alpha));
    const y = Math.round(lerp(p.prevY, p.y, alpha));
    const depth = DEPTH.actor(y);
    const { sx, sy } = p.squash;

    this.shadow.setPosition(x, y);

    let torsoDy = 0;
    this.legs.setVisible(p.legsVisible);
    if (p.legsVisible) {
      const f = this.lib.frame('player_legs', p.legs.name, p.legsDir, p.legs.index);
      this.legs.setFrame(f.frame).setScale(f.flip ? -sx : sx, sy).setPosition(x, y).setDepth(depth);
      torsoDy = Math.round((p.legs.frame.torsoDy ?? 0) * sy);
    }

    const bf = this.lib.frame('player_body', p.body.name, p.bodyDir, p.body.index);
    this.body
      .setFrame(bf.frame)
      .setScale(bf.flip ? -sx : sx, sy)
      .setPosition(x, y + torsoDy)
      .setDepth(depth + 0.1);

    this.weapon.setVisible(p.weaponVisible);
    if (p.weaponVisible) this.renderWeapon(x, y + torsoDy, depth, bf.flip, bf.authoredDir);
    return { x, y };
  }

  private renderWeapon(bx: number, by: number, depth: number, flip: boolean, dir: string) {
    const p = this.p;
    const def = DATA.weapons[p.weaponId];
    if (this.weaponSprite !== def.view.sprite) {
      this.weaponSprite = def.view.sprite;
      this.weapon.setTexture(def.view.sprite, 0);
      this.lib.applyOrigin(this.weapon, def.view.sprite);
    }
    const anchor = p.body.frame.hand ?? this.lib.manifest('player_body').handAnchors?.[dir] ?? [0, -10];
    const hx = bx + (flip ? -anchor[0] : anchor[0]);
    const hy = by + anchor[1];

    // Point the weapon from the hand at the aim point (so the barrel lines up with the cursor).
    const dx = p.aimX - hx;
    const dy = p.aimY - hy;
    const ang = dx * dx + dy * dy > 100 ? Math.atan2(dy, dx) : p.aimAngle;
    const left = Math.cos(ang) < 0;
    const rot = ang + def.view.restAngleOffsetDeg * DEG * (left ? -1 : 1);

    const [a0, a1] = DATA.player.weaponBehindArcDeg;
    const deg = normDeg(ang / DEG);
    const behind = deg >= a0 && deg <= a1;

    this.weapon
      .setPosition(hx, hy)
      .setRotation(rot)
      .setScale(1, left ? -1 : 1)
      .setDepth(depth + (behind ? -0.05 : 0.2));
  }
}
