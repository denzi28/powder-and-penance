// The difficulty curve (data/config/balance.json, src/game/Balance.ts): every tier's enemies and bosses against
// the player expected there. `npm run balance` prints the full report.
import { writeSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DATA } from '../src/data/config';
import { balanceReport, bossForms, formatReport, type BalanceData } from '../src/game/Balance';
import { levelCost, scalingBonus, vitalityHp } from '../src/player/Player';

const data: BalanceData = DATA;
const report = balanceReport(data);

describe('balance', () => {
  // `npm run balance` shows the whole table
  if (process.env.npm_lifecycle_event === 'balance') it('prints the report', () => void writeSync(1, `\n${formatReport(report)}\n\n`));

  it('holds every rule: hits to kill, hardest hits, Tallow, materials, flasks, shrines', () => {
    expect(report.problems).toEqual([]);
  });

  it('puts every area on the route, and every boss in a tier', () => {
    for (const [id, a] of Object.entries(DATA.areas.areas)) if (id !== 'test') expect(a.tier, id).toBeGreaterThan(0);
    const tiers = new Set(report.foes.filter(f => f.role === 'boss').map(f => f.tier));
    for (const t of DATA.balance.tiers) expect(tiers.has(t.tier), `tier ${t.tier} has a boss`).toBe(true);
  });

  it('makes the Chandler the toughest fight and the richest, with the biggest hit', () => {
    const bosses = report.foes.filter(f => f.role === 'boss');
    const chandler = bosses.find(b => b.kind === 'chandler')!;
    for (const b of bosses) if (b !== chandler) expect(chandler.hp, b.kind).toBeGreaterThan(b.hp);
    for (const b of bosses) if (b !== chandler) expect(chandler.maxHit, b.kind).toBeGreaterThan(b.maxHit);
    expect(bossForms(data, 'chandler')).toEqual(['chandler', 'chandler_wick']);
  });

  it('shares its formulas with the game', () => {
    expect(levelCost(1)).toBe(DATA.levels.cost.base);
    expect(vitalityHp(DATA.levels.start + 2)).toBe(2 * DATA.levels.vitality.hpPerPoint);
    expect(scalingBonus('S', DATA.levels.scaling.full)).toBe(DATA.levels.scaling.grades.S);
  });
});
