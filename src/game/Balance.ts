// The difficulty curve, as numbers. For each tier of the route (data/config/balance.json) it builds the player
// we expect there (level, stats, HP, weapon upgrade, flasks) and holds every enemy, miniboss and boss of that
// tier to the rules: hits to kill, hardest hit against the expected HP, Tallow for the level, upgrade materials,
// and the walk back from the nearest shrine. `npm run balance` prints it; tests/balance.test.ts keeps it true.
// Pure: it reads only what it is given, so the game (Player.ts), the report and the tests share the maths.
import type { BalanceCfg, EnemyDef, ItemDef, LevelsCfg, RoomData, SmithCfg, StatName, WeaponDef } from '../data/schemas';

export interface BalanceData {
  areas: { areas: Record<string, { name: string; tier: number; tallowMult: number; hpMult: number }> };
  rooms: Record<string, RoomData>;
  enemies: Record<string, EnemyDef>;
  items: Record<string, ItemDef>;
  weapons: Record<string, WeaponDef>;
  levels: LevelsCfg;
  smith: SmithCfg;
  balance: BalanceCfg;
  player: { maxHp: number };
  phial: { startCharges: number };
}

const STATS: readonly StatName[] = ['vitality', 'endurance', 'strength', 'dexterity'];

// ------------------------------------------------------------------ the formulas the game uses
/** Tallow to go from `level` to the next. */
export function levelCostOf(levels: LevelsCfg, level: number): number {
  const c = levels.cost;
  const n = level - 1;
  return Math.round(c.base + c.linear * n + c.quad * n * n);
}

/** HP that Vitality adds over the start. */
export function vitalityHpOf(levels: LevelsCfg, vitality: number): number {
  const v = levels.vitality;
  const pts = vitality - levels.start;
  const first = Math.min(pts, v.softCap - levels.start);
  return first * v.hpPerPoint + Math.max(0, pts - first) * v.hpAfterCap;
}

/** How much a stat adds to a weapon with this grade: the grade's weight times progress to `full`. */
export function scalingBonusOf(levels: LevelsCfg, grade: string | undefined, stat: number): number {
  if (!grade) return 0;
  const sc = levels.scaling;
  const k = Math.max(0, Math.min(1, (stat - levels.start) / (sc.full - levels.start)));
  return (sc.grades[grade as keyof typeof sc.grades] ?? 0) * k;
}

/** A weapon's damage multiplier from stats and its upgrade level. */
export function weaponMultOf(levels: LevelsCfg, smith: SmithCfg, w: WeaponDef, stats: Record<StatName, number>, upgrade: number): number {
  const fromStats = scalingBonusOf(levels, w.scaling.str, stats.strength) + scalingBonusOf(levels, w.scaling.dex, stats.dexterity);
  return (1 + fromStats) * (1 + upgrade * smith.damagePerLevel);
}

// ------------------------------------------------------------------ the expected player
export interface ExpectedPlayer {
  tier: number;
  name: string;
  level: number;
  upgrade: number;
  flasks: number;
  stats: Record<StatName, number>;
  hp: number;
  /** The expected weapon's first light attack. */
  hit: number;
}

export function expectedPlayer(d: BalanceData, tier: number): ExpectedPlayer {
  const t = d.balance.tiers.find(x => x.tier === tier)!;
  const points = t.level - 1;
  const total = STATS.reduce((a, s) => a + (d.balance.build[s] ?? 0), 0) || 1;
  const stats = Object.fromEntries(STATS.map(s => [s, d.levels.start + (points * (d.balance.build[s] ?? 0)) / total])) as Record<StatName, number>;
  const w = d.weapons[d.balance.weapon];
  const base = w.light[0]?.damage ?? w.heavy?.strike.damage ?? 0;
  return {
    tier,
    name: t.name,
    level: t.level,
    upgrade: t.upgrade,
    flasks: t.flasks,
    stats,
    hp: Math.round(d.player.maxHp + vitalityHpOf(d.levels, Math.floor(stats.vitality))),
    hit: base * weaponMultOf(d.levels, d.smith, w, stats, t.upgrade),
  };
}

// ------------------------------------------------------------------ what the world holds, tier by tier
export function roomTier(d: BalanceData, room: RoomData): number {
  return d.balance.roomTiers[room.id] ?? d.areas.areas[room.area]?.tier ?? 0;
}

/** Every numeric `damage` anywhere in an enemy (moves, strikes, projectiles, blasts). */
function damages(o: unknown, out: number[] = []): number[] {
  if (Array.isArray(o)) for (const v of o) damages(v, out);
  else if (o && typeof o === 'object')
    for (const [k, v] of Object.entries(o)) {
      if (k === 'damage' && typeof v === 'number') out.push(v);
      else damages(v, out);
    }
  return out;
}

/** A boss and every form it turns into (`boss.turn`, `boss.next`), first to last. */
export function bossForms(d: BalanceData, kind: string): string[] {
  const out: string[] = [];
  for (let k: string | undefined = kind; k && !out.includes(k); ) {
    out.push(k);
    const b: EnemyDef['boss'] = d.enemies[k]?.boss;
    k = b?.turn?.kind ?? b?.next?.kind;
  }
  return out;
}

export interface FoeRow {
  kind: string;
  room: string;
  tier: number;
  role: 'regular' | 'miniboss' | 'boss';
  hp: number;
  tallow: number;
  maxHit: number;
  hitsToKill: number;
  /** Hardest hit as a share of the expected HP. */
  hitShare: number;
  shrineHops: number;
}

export interface TierRow {
  player: ExpectedPlayer;
  /** Tallow in the world up to this tier's bosses (every earlier tier, and this tier short of its bosses). */
  tallowBefore: number;
  /** ...and after them. */
  tallowAfter: number;
  /** The level that Tallow buys, after the target upgrades and the shops. */
  affordLevel: number;
  /** Phial charges the world has given by this tier. */
  flasksFound: number;
  /** The highest upgrade the world's materials allow by this tier. */
  upgradeReachable: number;
  /** Average Tallow for one ordinary enemy of the tier. */
  regularTallow: number;
  /** Average light hits to kill one ordinary enemy of the tier. */
  regularHits: number;
}

export interface BalanceReport {
  tiers: TierRow[];
  foes: FoeRow[];
  problems: string[];
}

/** Rooms joined by an exit or by touching within an area, and shrine rooms. */
function roomGraph(d: BalanceData) {
  const rooms = Object.values(d.rooms);
  const spawnRoom = new Map<string, string>();
  for (const r of rooms) for (const e of r.entities) if (e.type === 'spawn') spawnRoom.set(`${r.area}/${String(e.id)}`, r.id);
  const adj = new Map<string, Set<string>>(rooms.map(r => [r.id, new Set<string>()]));
  const link = (a: string, b: string) => {
    adj.get(a)!.add(b);
    adj.get(b)!.add(a);
  };
  for (const r of rooms)
    for (const e of r.entities)
      if (e.type === 'exit') {
        const to = e.to as { area: string; spawn: string };
        const t = spawnRoom.get(`${to.area}/${to.spawn}`);
        if (t) link(r.id, t);
      }
  const box = (r: RoomData) => [r.origin[0], r.origin[1], r.origin[0] + r.tiles[0].length, r.origin[1] + r.tiles.length];
  for (let i = 0; i < rooms.length; i++)
    for (let j = i + 1; j < rooms.length; j++) {
      const [a, b] = [rooms[i], rooms[j]];
      if (a.area !== b.area) continue;
      const [ax0, ay0, ax1, ay1] = box(a);
      const [bx0, by0, bx1, by1] = box(b);
      if (ax0 <= bx1 && bx0 <= ax1 && ay0 <= by1 && by0 <= ay1) link(a.id, b.id);
    }
  const shrines = new Set(rooms.filter(r => r.entities.some(e => e.type === 'shrine')).map(r => r.id));
  const hops = (from: string) => {
    const seen = new Map([[from, 0]]);
    const q = [from];
    while (q.length) {
      const c = q.shift()!;
      if (shrines.has(c)) return seen.get(c)!;
      for (const n of adj.get(c) ?? []) if (!seen.has(n)) (seen.set(n, seen.get(c)! + 1), q.push(n));
    }
    return Infinity;
  };
  return { hops };
}

export function balanceReport(d: BalanceData): BalanceReport {
  const rules = d.balance.rules;
  const tiers = d.balance.tiers.map(t => t.tier).sort((a, b) => a - b);
  const player = new Map(tiers.map(t => [t, expectedPlayer(d, t)]));
  const graph = roomGraph(d);
  const foes: FoeRow[] = [];
  // Tallow by tier: ordinary enemies and minibosses and tallow in chests ("before"), bosses ("boss")
  const before = new Map<number, number>();
  const boss = new Map<number, number>();
  const add = (m: Map<number, number>, t: number, v: number) => m.set(t, (m.get(t) ?? 0) + v);
  const shards = new Map<number, number>();
  const mats = new Map<number, Record<string, number>>();

  for (const room of Object.values(d.rooms)) {
    const tier = roomTier(d, room);
    if (!tier) continue; // test rooms
    const p = player.get(tier);
    for (const e of room.entities) {
      // what a chest holds, or what an enemy carries (dropped the first time it falls): counted in its room's tier
      const placed = e.type === 'item' ? String(e.item) : e.type === 'enemy' ? (e.carries as { item?: string } | undefined)?.item : undefined;
      if (placed) {
        const item = d.items[placed];
        const eff = item?.effect;
        if (eff?.type === 'tallow') add(before, tier, eff.amount);
        if (eff?.type === 'phialMax') add(shards, tier, eff.amount);
        if (eff?.type === 'consumable') {
          const m = mats.get(tier) ?? {};
          m[eff.id] = (m[eff.id] ?? 0) + eff.count;
          mats.set(tier, m);
        }
      }
      if (e.type === 'item') continue;
      if (e.type !== 'enemy' || !p) continue;
      const kind = String(e.kind);
      const def = d.enemies[kind];
      if (!def || def.immortal) continue;
      const mb = e.miniboss as { hpMult?: number; tallow?: number } | undefined;
      const forms = def.boss ? bossForms(d, kind) : [kind];
      const hp = forms.reduce((a, k) => a + d.enemies[k].hp, 0) * (mb ? (mb.hpMult ?? 1) : def.boss ? 1 : (d.areas.areas[room.area]?.hpMult ?? 1));
      const tallow = def.boss
        ? forms.reduce((a, k) => a + d.enemies[k].tallow, 0)
        : mb
          ? (mb.tallow ?? def.tallow)
          : def.tallow * (d.areas.areas[room.area]?.tallowMult ?? 1);
      const maxHit = Math.max(0, ...forms.flatMap(k => damages(d.enemies[k])));
      const role = def.boss ? 'boss' : mb ? 'miniboss' : 'regular';
      add(role === 'boss' ? boss : before, tier, tallow);
      foes.push({
        kind,
        room: room.id,
        tier,
        role,
        hp: Math.round(hp),
        tallow: Math.round(tallow),
        maxHit,
        hitsToKill: hp / p.hit,
        hitShare: maxHit / p.hp,
        shrineHops: role === 'regular' ? 0 : graph.hops(room.id),
      });
    }
  }

  const upgradeCost = (u: number) => d.smith.levels.slice(0, u).reduce((a, l) => a + l.tallow, 0);
  const affordLevel = (tallow: number, upgrade: number) => {
    let left = tallow * (1 - d.balance.shopShare) - upgradeCost(upgrade);
    let level = 1;
    while (left >= levelCostOf(d.levels, level)) left -= levelCostOf(d.levels, level++);
    return level;
  };
  const reachable = (have: Record<string, number>) => {
    const left = { ...have };
    let u = 0;
    for (const lv of d.smith.levels) {
      if (!Object.entries(lv.materials).every(([m, n]) => (left[m] ?? 0) >= n)) break;
      for (const [m, n] of Object.entries(lv.materials)) left[m] -= n;
      u++;
    }
    return u;
  };

  let carried = 0;
  let flasks = d.phial.startCharges;
  const held: Record<string, number> = {};
  const rows: TierRow[] = tiers.map(t => {
    const p = player.get(t)!;
    const tallowBefore = carried + (before.get(t) ?? 0);
    carried = tallowBefore + (boss.get(t) ?? 0);
    flasks += shards.get(t) ?? 0;
    for (const [m, n] of Object.entries(mats.get(t) ?? {})) held[m] = (held[m] ?? 0) + n;
    const regs = foes.filter(f => f.tier === t && f.role === 'regular');
    return {
      player: p,
      tallowBefore,
      tallowAfter: carried,
      affordLevel: affordLevel(tallowBefore, p.upgrade),
      flasksFound: flasks,
      upgradeReachable: reachable(held),
      regularTallow: regs.length ? regs.reduce((a, f) => a + f.tallow, 0) / regs.length : 0,
      regularHits: regs.length ? regs.reduce((a, f) => a + f.hitsToKill, 0) / regs.length : 0,
    };
  });

  // ---- the rules
  const problems: string[] = [];
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const seen = new Set<string>();
  for (const f of foes) {
    const key = `${f.role}:${f.kind}:${f.tier}`;
    if (f.role === 'regular' && seen.has(key)) continue;
    seen.add(key);
    // bosses sit in their band; an ordinary enemy only has a ceiling (scouts and swarmers may be fragile: the tier's
    // average is held below); a miniboss sits between the two
    const [lo, hi] =
      f.role === 'boss' ? rules.bossHitsToKill : f.role === 'regular' ? [0, rules.regularHitsMax] : [rules.regularHitsMax, rules.bossHitsToKill[0]];
    if (f.hitsToKill < lo || f.hitsToKill > hi) problems.push(`${f.kind} (${f.role}, tier ${f.tier}): ${f.hitsToKill.toFixed(1)} hits to kill, wants ${lo}-${hi}`);
    const cap = f.role === 'regular' ? rules.regularHitMax : rules.bossHitMax;
    if (f.hitShare > cap) problems.push(`${f.kind} (tier ${f.tier}): hardest hit ${f.maxHit} is ${pct(f.hitShare)} of ${player.get(f.tier)!.hp} HP, cap ${pct(cap)}`);
    if (f.role !== 'regular') {
      const cap2 = f.role === 'boss' ? rules.shrineHops.boss : rules.shrineHops.miniboss;
      if (f.shrineHops > cap2) problems.push(`${f.kind} (${f.room}): ${f.shrineHops} rooms from a shrine, wants at most ${cap2}`);
    }
    if (f.role === 'miniboss') {
      const want = rules.minibossTallow * rows.find(r => r.player.tier === f.tier)!.regularTallow;
      if (Math.abs(f.tallow - want) > want * 0.3) problems.push(`${f.kind} (miniboss, tier ${f.tier}): ${f.tallow} Tallow, wants about ${Math.round(want)}`);
    }
  }
  // tiers rise: bosses get tougher and pay more, and the last boss is the toughest of all
  const bosses = foes.filter(f => f.role === 'boss');
  for (const a of bosses)
    for (const b of bosses) {
      if (a.tier >= b.tier) continue;
      if (a.hp >= b.hp) problems.push(`${a.kind} (tier ${a.tier}) has ${a.hp} HP, not less than ${b.kind} (tier ${b.tier}, ${b.hp})`);
      if (a.tallow >= b.tallow && b.tier < 4) problems.push(`${a.kind} (tier ${a.tier}) pays ${a.tallow}, not less than ${b.kind} (tier ${b.tier}, ${b.tallow})`);
    }
  const last = Math.max(...tiers);
  const lastMax = Math.max(...bosses.filter(b => b.tier === last).map(b => b.maxHit));
  for (const b of bosses) if (b.tier < last && b.maxHit >= lastMax) problems.push(`${b.kind} hits for ${b.maxHit}, not less than the final boss (${lastMax})`);
  // bosses of one tier (fought in either order) stay close
  for (const t of tiers) {
    const hp = bosses.filter(b => b.tier === t).map(b => b.hp);
    if (hp.length > 1 && Math.max(...hp) > Math.min(...hp) * 1.15) problems.push(`tier ${t} bosses range ${Math.min(...hp)}-${Math.max(...hp)} HP; keep them within 15%`);
  }
  for (const r of rows) {
    const t = r.player;
    const [lo, hi] = rules.regularAverageHits;
    if (r.regularHits < lo || r.regularHits > hi) problems.push(`tier ${t.tier}: ordinary enemies take ${r.regularHits.toFixed(1)} hits on average, wants ${lo}-${hi}`);
    if (Math.abs(r.affordLevel - t.level) > rules.levelSlack) problems.push(`tier ${t.tier}: the Tallow buys level ${r.affordLevel} by its bosses, target ${t.level}`);
    if (r.flasksFound < t.flasks) problems.push(`tier ${t.tier}: ${r.flasksFound} flasks found, target ${t.flasks}`);
    if (r.upgradeReachable < t.upgrade) problems.push(`tier ${t.tier}: materials allow +${r.upgradeReachable}, target +${t.upgrade}`);
    if (r.upgradeReachable > t.upgrade + 1) problems.push(`tier ${t.tier}: materials allow +${r.upgradeReachable}, well past the target +${t.upgrade}`);
  }
  return { tiers: rows, foes, problems };
}

/** The report as plain text. */
export function formatReport(r: BalanceReport): string {
  const out: string[] = [];
  const pad = (s: string | number, n: number) => String(s).padEnd(n);
  for (const row of r.tiers) {
    const p = row.player;
    out.push(`TIER ${p.tier}: ${p.name}`);
    out.push(
      `  expected: level ${p.level}, +${p.upgrade}, ${p.flasks} flasks, ${p.hp} HP, light hit ${p.hit.toFixed(1)}` +
        `  |  world: ${Math.round(row.tallowBefore)} Tallow by its bosses (${Math.round(row.tallowAfter)} after) buys level ${row.affordLevel}, ${row.flasksFound} flasks, materials to +${row.upgradeReachable}; ordinary enemies ${row.regularHits.toFixed(1)} hits on average`,
    );
    const foes = r.foes.filter(f => f.tier === p.tier);
    const shown = new Set<string>();
    for (const f of foes) {
      const key = `${f.role}:${f.kind}`;
      if (shown.has(key)) continue;
      shown.add(key);
      const n = foes.filter(x => x.kind === f.kind && x.role === f.role).length;
      out.push(
        `    ${pad(f.role, 9)}${pad(f.kind + (n > 1 ? ` x${n}` : ''), 26)}hp ${pad(f.hp, 6)}tallow ${pad(f.tallow, 6)}hits ${pad(f.hitsToKill.toFixed(1), 6)}max hit ${pad(`${f.maxHit} (${Math.round(f.hitShare * 100)}%)`, 11)}` +
          (f.role === 'regular' ? '' : `shrine ${f.shrineHops} room${f.shrineHops === 1 ? '' : 's'} away`),
      );
    }
  }
  out.push('');
  out.push(r.problems.length ? `${r.problems.length} PROBLEM(S):\n  ${r.problems.join('\n  ')}` : 'No problems: the curve holds.');
  return out.join('\n');
}
