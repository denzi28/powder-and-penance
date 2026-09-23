// Kneeling at a Wick Shrine: kindle (first visit) or rest -> restore, respawn enemies, save, shrine menu.
import { DATA } from '../data/config';
import { firstEnabled } from '../ui/Menu';
import type { GameScene } from '../scenes/GameScene';
import type { Shrine } from '../world/Shrines';

export function beginShrine(gs: GameScene, s: Shrine) {
  const p = gs.player;
  const sp = gs.shrines.spawnPoint(s);
  p.moveBy(sp.x - p.x, sp.y - p.y);
  p.aimAngle = -Math.PI / 2;
  p.sm.change('rest');
  gs.shrineSeq = { shrine: s, t: 0, kindle: !s.lit };
  gs.bus.emit('sfx', { id: s.lit ? 'rest' : 'shrine_kindle' });
}

export function tickShrineSeq(gs: GameScene) {
  const q = gs.shrineSeq;
  if (!q) return;
  q.t++;
  const c = DATA.shrine;
  if (q.kindle && q.t === Math.floor(c.kindleTicks / 2)) {
    gs.shrines.light(q.shrine);
    gs.flags.add(`shrine:${q.shrine.id}`);
    gs.particles.burst(q.shrine.x, q.shrine.y, 30, -Math.PI / 2, 3, 16, 60, 'flame2', false);
    gs.showToast('WICK KINDLED', `${q.shrine.name}. Rest here to mend and to be returned here when you fall.`);
  }
  if (q.t >= (q.kindle ? c.kindleTicks : c.kneelTicks)) {
    gs.shrineSeq = null;
    rest(gs, q.shrine);
  }
}

function rest(gs: GameScene, s: Shrine) {
  gs.lastShrine = s.id;
  gs.restoreWorld();
  gs.save();
  gs.particles.burst(gs.player.x, gs.player.y, 12, -Math.PI / 2, 2.5, 12, 40, 'wax2', false);
  const leave = () => {
    gs.closeMenu();
    gs.player.sm.change('idle');
  };
  const items = [
    { label: 'LEVEL UP', enabled: false, note: 'M7', action: () => {} },
    { label: 'TRAVEL', enabled: false, note: 'later', action: () => {} },
    { label: 'LEAVE', enabled: true, action: leave },
  ];
  gs.menu = { title: s.name.toUpperCase(), subtitle: 'Rested. Progress saved.', items, index: firstEnabled(items), onBack: leave };
}
