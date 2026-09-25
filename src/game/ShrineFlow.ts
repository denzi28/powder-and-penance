// Kneeling at a Wick Shrine: kindle (first visit) or rest -> restore, respawn enemies, save, shrine menu
// (travel to any other lit shrine; level up there once Maudlin has left Wick's Rest).
import { DATA } from '../data/config';
import { firstEnabled } from '../ui/Menu';
import { beginWarp, travelTargets } from './Warp';
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
  shrineMenu(gs, s, 'Rested. Progress saved.');
}

function shrineMenu(gs: GameScene, s: Shrine, subtitle: string) {
  const leave = () => {
    gs.closeMenu();
    gs.player.sm.change('idle');
  };
  const targets = travelTargets(gs, s.id);
  const items = [
    // With Maudlin gone from Wick's Rest, you hold the Tallow to the flame yourself, at any Wick
    ...(gs.flags.has('story:maudlin_condemned')
      ? [
          {
            label: 'LEVEL UP',
            enabled: true,
            action: () => {
              gs.player.sm.change('idle');
              gs.openService('levelup');
            },
          },
        ]
      : []),
    {
      label: 'TRAVEL',
      enabled: targets.length > 0,
      note: targets.length ? undefined : 'no other lit shrine',
      action: () => travelMenu(gs, s),
    },
    { label: 'LEAVE', enabled: true, action: leave },
  ];
  gs.menu = { title: s.name.toUpperCase(), subtitle, items, index: firstEnabled(items), onBack: leave };
}

/** Pick a lit shrine to travel to, grouped by area. */
function travelMenu(gs: GameScene, s: Shrine) {
  const back = () => shrineMenu(gs, s, 'Travel to another lit Wick.');
  const targets = travelTargets(gs, s.id).sort((a, b) => a.area.localeCompare(b.area) || a.name.localeCompare(b.name));
  const items = [
    ...targets.map(t => ({
      label: `${DATA.areas.areas[t.area].name.toUpperCase()}: ${t.name.toUpperCase()}`,
      enabled: true,
      action: () => {
        gs.closeMenu();
        gs.player.sm.change('idle');
        beginWarp(gs, t);
      },
    })),
    { label: 'BACK', enabled: true, action: back },
  ];
  gs.menu = { title: 'TRAVEL', subtitle: 'The flame knows the way to every Wick you have lit.', items, index: 0, onBack: back };
}
