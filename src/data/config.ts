// Loads and validates every JSON file under /data. Edits hot-apply in place (Vite HMR) so a running
// game picks up new tuning values without restarting; code should read DATA.x.y at use time.
import { z } from 'zod';
import * as S from './schemas';

const PREFIX = '../../data/';
const files = import.meta.glob('../../data/**/*.json', { eager: true, import: 'default' }) as Record<string, unknown>;

function loadAll(src: Record<string, unknown>) {
  const errors: string[] = [];
  const one = <T extends z.ZodTypeAny>(schema: T, p: string): z.infer<T> => {
    const key = `${PREFIX}${p}.json`;
    if (!(key in src)) {
      errors.push(`data/${p}.json: file missing`);
      return undefined as z.infer<T>;
    }
    const r = schema.safeParse(src[key]);
    if (!r.success) errors.push(`data/${p}.json:\n${S.formatZod(r.error)}`);
    return (r.success ? r.data : undefined) as z.infer<T>;
  };
  const dir = <T extends z.ZodTypeAny>(schema: T, folder: string): Record<string, z.infer<T>> => {
    const out: Record<string, z.infer<T>> = {};
    for (const key of Object.keys(src).filter(k => k.startsWith(`${PREFIX}${folder}/`))) {
      const rel = key.slice(PREFIX.length);
      const r = schema.safeParse(src[key]);
      if (!r.success) {
        errors.push(`data/${rel}:\n${S.formatZod(r.error)}`);
        continue;
      }
      const id = (r.data as { id: string }).id;
      if (out[id]) errors.push(`data/${rel}: duplicate id "${id}"`);
      out[id] = r.data;
    }
    return out;
  };

  const data = {
    game: one(S.GameCfg, 'config/game'),
    player: one(S.PlayerCfg, 'config/player'),
    roll: one(S.RollCfg, 'config/roll'),
    stamina: one(S.StaminaCfg, 'config/stamina'),
    camera: one(S.CameraCfg, 'config/camera'),
    juice: one(S.JuiceCfg, 'config/juice'),
    input: one(S.InputCfg, 'config/input'),
    debug: one(S.DebugCfg, 'config/debug'),
    hud: one(S.HudCfg, 'config/hud'),
    combat: one(S.CombatCfg, 'config/combat'),
    ai: one(S.AiCfg, 'config/ai'),
    audio: one(S.AudioCfg, 'config/audio'),
    death: one(S.DeathCfg, 'config/death'),
    phial: one(S.PhialCfg, 'config/phial'),
    shrine: one(S.ShrineCfg, 'config/shrine'),
    sfx: one(S.SfxBank, 'audio/sfx'),
    palette: one(S.Palette, 'palette'),
    weapons: dir(S.WeaponDef, 'weapons'),
    shields: dir(S.ShieldDef, 'shields'),
    items: dir(S.ItemDef, 'items'),
    props: dir(S.PropDef, 'props'),
    loot: one(S.LootTables, 'loot'),
    enemies: dir(S.EnemyDef, 'enemies'),
    rooms: dir(S.RoomData, 'rooms'),
  };

  if (!errors.length) {
    for (const e of Object.values(data.enemies))
      if (!data.palette[e.blood]) errors.push(`data/enemies/${e.id}.json: blood "${e.blood}" is not a palette colour`);
    for (const r of Object.values(data.rooms))
      for (const en of r.entities)
        if (en.type === 'enemy' && !data.enemies[String(en.kind)])
          errors.push(`data/rooms/${r.id}.json: unknown enemy kind "${String(en.kind)}"`);
    for (const pr of Object.values(data.props)) {
      if (pr.loot !== 'none' && !data.loot.tables[pr.loot]) errors.push(`data/props/${pr.id}.json: unknown loot table "${pr.loot}"`);
      if (!data.palette[pr.debris]) errors.push(`data/props/${pr.id}.json: debris "${pr.debris}" is not a palette colour`);
    }
    if (!data.weapons.fists) errors.push('data/weapons/fists.json: required (an empty weapon slot holds bare fists)');
    for (const w of data.player.loadout.slots)
      if (!data.weapons[w]) errors.push(`data/config/player.json: loadout.slots references unknown weapon "${w}"`);
    const sh = data.player.loadout.shield;
    if (sh && !data.shields[sh]) errors.push(`data/config/player.json: loadout.shield references unknown shield "${sh}"`);
    // Persistent entities (shrines, items) need world-unique ids: they key the save's world flags.
    const ids = new Set<string>();
    for (const r of Object.values(data.rooms))
      for (const en of r.entities) {
        if (en.type === 'prop' && !data.props[String(en.kind)])
          errors.push(`data/rooms/${r.id}.json: unknown prop kind "${String(en.kind)}"`);
        if (en.type === 'shrine' || en.type === 'item' || en.type === 'door') {
          if (!en.id) errors.push(`data/rooms/${r.id}.json: ${en.type} needs an "id"`);
          else if (ids.has(en.id)) errors.push(`data/rooms/${r.id}.json: duplicate entity id "${en.id}"`);
          else ids.add(en.id);
        }
        if (en.type === 'item' && !data.items[String(en.item)])
          errors.push(`data/rooms/${r.id}.json: item "${en.id}" has unknown item "${String(en.item)}"`);
        if (en.type === 'weapon_rack' && !data.weapons[String(en.weapon)])
          errors.push(`data/rooms/${r.id}.json: weapon_rack has unknown weapon "${String(en.weapon)}"`);
        if (en.type === 'shield_rack' && en.shield !== null && !data.shields[String(en.shield)])
          errors.push(`data/rooms/${r.id}.json: shield_rack has unknown shield "${String(en.shield)}"`);
      }
    if (!data.rooms[data.game.startRoom])
      errors.push(`data/config/game.json: startRoom "${data.game.startRoom}" has no file in data/rooms`);
  }
  return errors.length ? { ok: false as const, error: errors.join('\n\n') } : { ok: true as const, data };
}

export type GameData = Extract<ReturnType<typeof loadAll>, { ok: true }>['data'];

interface HotState {
  data: GameData;
  fatal: boolean;
  reload: Set<() => void>;
  error: Set<(msg: string) => void>;
}

const result = loadAll(files);
const prev = import.meta.hot?.data.state as HotState | undefined;
const state: HotState = prev ?? {
  data: result.ok ? result.data : ({} as GameData),
  fatal: !result.ok,
  reload: new Set(),
  error: new Set(),
};

if (prev) {
  // This is a hot re-evaluation: patch the live object the game already holds.
  if (prev.fatal) location.reload();
  else if (result.ok) {
    deepAssign(prev.data, result.data);
    prev.reload.forEach(f => f());
    console.info('[data] reloaded');
  } else {
    console.error(result.error);
    prev.error.forEach(f => f(result.error));
  }
}
if (import.meta.hot) {
  import.meta.hot.data.state = state;
  // Must be written literally: Vite finds HMR boundaries by scanning for `import.meta.hot.accept(`.
  import.meta.hot.accept();
}

export const DATA: GameData = state.data;
export const DATA_ERROR: string | null = prev ? null : result.ok ? null : result.error;

export function onDataReload(fn: () => void): () => void {
  state.reload.add(fn);
  return () => state.reload.delete(fn);
}
export function onDataError(fn: (msg: string) => void): () => void {
  state.error.add(fn);
  return () => state.error.delete(fn);
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function deepAssign(target: Record<string, unknown>, src: Record<string, unknown>) {
  for (const k of Object.keys(target)) if (!(k in src)) delete target[k];
  for (const [k, v] of Object.entries(src)) {
    const t = target[k];
    if (isObj(t) && isObj(v)) deepAssign(t, v);
    else if (Array.isArray(t) && Array.isArray(v)) t.splice(0, t.length, ...v);
    else target[k] = v;
  }
}
