// Applying placed items (data/items) and telling the player, in plain words and real numbers, what changed.
// The item's own `description` is flavour text, shown under the explanation.
import { DATA } from '../data/config';
import type { GameScene } from '../scenes/GameScene';

export function grantItem(gs: GameScene, id: string, itemId: string, x: number, y: number) {
  const p = gs.player;
  const item = DATA.items[itemId];
  const e = item.effect;
  gs.flags.add(`item:${id}`);
  let what: string;
  switch (e.type) {
    case 'phialMax': {
      const before = p.phials.max;
      p.phials.max = Math.min(DATA.phial.maxCharges, p.phials.max + e.amount);
      p.phials.charges = Math.min(p.phials.max, p.phials.charges + e.amount);
      what =
        p.phials.max > before
          ? `Your Mending Phial holds one more drink: ${before} -> ${p.phials.max}. All drinks refill when you rest at a shrine.`
          : `Your phial already holds the most it can (${before} drinks).`;
      break;
    }
    case 'phialLevel': {
      const before = p.healAmount;
      p.phials.level = Math.min(DATA.phial.maxLevel, p.phials.level + e.amount);
      what =
        p.healAmount > before
          ? `Each phial drink now heals more: ${before} -> ${p.healAmount} HP.`
          : `Your phial is already as strong as it gets (${before} HP per drink).`;
      break;
    }
    case 'ammo': {
      const parts: string[] = [];
      for (const wid of new Set(p.slots)) {
        const r = DATA.weapons[wid]?.ranged;
        if (!r) continue;
        const a = p.ammoFor(wid);
        const before = a.reserve;
        a.reserve = Math.min(r.reserveMax, a.reserve + Math.ceil(r.reserveMax * e.amount));
        const name = DATA.weapons[wid].name;
        parts.push(
          a.reserve > before
            ? `${name}: +${a.reserve - before} spare shots (${before} -> ${a.reserve} of ${r.reserveMax})`
            : `${name}: spare shots already full (${r.reserveMax})`,
        );
      }
      what = parts.length
        ? `${parts.join('. ')}. Spare shots are what you reload from; shrines refill them.`
        : 'Ammo for firearms, but you carry none. Equip a gun or crossbow to use pouches like this.';
      break;
    }
    case 'tallow':
      p.tallow += e.amount;
      what = `+${e.amount} Tallow (you carry ${p.tallow}). Tallow is money. You drop all you carry when you die; reach the spot again to take it back.`;
      break;
  }
  gs.showToast(item.name.toUpperCase(), what, item.description);
  gs.particles.burst(x, y, 10, -Math.PI / 2, 1.6, 12, 60, 'flame2', false); // sparks from the open chest
  gs.bus.emit('sfx', { id: 'item' });
  gs.save();
}
