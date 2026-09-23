// Feeds the aim point into the player from mouse or right stick; returns the camera's aim-lead target.
import { DATA } from '../data/config';
import type { GameScene } from '../scenes/GameScene';

export function updateAim(gs: GameScene): { x: number; y: number } {
  const p = gs.player;
  const inp = gs.controls;
  const cam = gs.cameras.main;
  const cc = DATA.camera;
  if (inp.device === 'kbm') {
    const ptr = gs.input.activePointer;
    p.setAim(ptr.x + cam.scrollX, ptr.y + cam.scrollY);
    let lx = (ptr.x - DATA.game.width / 2) * cc.aimLeadFactor;
    let ly = (ptr.y - DATA.game.height / 2) * cc.aimLeadFactor;
    const len = Math.hypot(lx, ly);
    if (len > cc.aimLeadMax) {
      lx *= cc.aimLeadMax / len;
      ly *= cc.aimLeadMax / len;
    }
    return { x: lx, y: ly };
  }
  let dx: number;
  let dy: number;
  if (inp.aimStickActive) [dx, dy] = [inp.aimStickX, inp.aimStickY];
  else if (DATA.input.padAimFollowsMove && (inp.moveX !== 0 || inp.moveY !== 0)) [dx, dy] = [inp.moveX, inp.moveY];
  else [dx, dy] = [Math.cos(p.aimAngle), Math.sin(p.aimAngle)];
  const len = Math.hypot(dx, dy) || 1;
  dx /= len;
  dy /= len;
  const d = DATA.input.padAimDistance;
  p.setAim(p.x + dx * d, p.y + DATA.player.aimOriginY + dy * d);
  return { x: dx * cc.padLeadDistance, y: dy * cc.padLeadDistance };
}
