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
    armour: dir(S.ArmourDef, 'armour'),
    load: one(S.LoadCfg, 'config/load'),
    levels: one(S.LevelsCfg, 'config/levels'),
    smith: one(S.SmithCfg, 'config/smith'),
    shop: one(S.ShopCfg, 'shop'),
    items: dir(S.ItemDef, 'items'),
    consumables: dir(S.ConsumableDef, 'consumables'),
    rings: dir(S.RingDef, 'rings'),
    notes: dir(S.NoteDef, 'notes'),
    props: dir(S.PropDef, 'props'),
    loot: one(S.LootTables, 'loot'),
    enemies: dir(S.EnemyDef, 'enemies'),
    rooms: dir(S.RoomData, 'rooms'),
    areas: one(S.Areas, 'areas'),
    decor: one(S.DecorTable, 'decor'),
    npcs: one(S.Npcs, 'npcs'),
    chatter: one(S.Chatter, 'chatter'),
    ambience: one(S.Ambience, 'ambience'),
    ambient: one(S.AmbientAudioCfg, 'audio/ambient'),
    music: one(S.MusicCfg, 'audio/music'),
    terrain: one(S.Terrain, 'terrain'),
    scripts: dir(S.ScriptDef, 'scripts'),
  };

  if (!errors.length) {
    for (const e of Object.values(data.enemies)) {
      if (!data.palette[e.blood]) errors.push(`data/enemies/${e.id}.json: blood "${e.blood}" is not a palette colour`);
      if ((e.ai === 'boss') !== !!e.boss) errors.push(`data/enemies/${e.id}.json: ai "boss" and a "boss" block go together`);
      if (e.boss?.deathScript && !data.scripts[e.boss.deathScript])
        errors.push(`data/enemies/${e.id}.json: unknown deathScript "${e.boss.deathScript}"`);
      if (e.splitInto && !data.enemies[e.splitInto.kind]) errors.push(`data/enemies/${e.id}.json: splitInto unknown kind "${e.splitInto.kind}"`);
      const next = e.boss?.next;
      if (next && !data.enemies[next.kind]?.boss) errors.push(`data/enemies/${e.id}.json: next phase "${next.kind}" is not a boss`);
      if (next && !data.items[next.chest.item]) errors.push(`data/enemies/${e.id}.json: next.chest has unknown item "${next.chest.item}"`);
      const turn = e.boss?.turn;
      if (turn && !data.enemies[turn.kind]?.boss) errors.push(`data/enemies/${e.id}.json: turn into "${turn.kind}", which is not a boss`);
      if (turn && next) errors.push(`data/enemies/${e.id}.json: a boss has either "turn" or "next", not both`);
      for (const m of e.moves)
        for (const s of m.strikes)
          if (s.summon && !data.enemies[s.summon.kind]) errors.push(`data/enemies/${e.id}.json: move "${m.id}" summons unknown kind "${s.summon.kind}"`);
    }
    for (const r of Object.values(data.rooms))
      for (const en of r.entities)
        if (en.type === 'arena' && !data.enemies[String(en.boss)]?.boss)
          errors.push(`data/rooms/${r.id}.json: arena "${en.id}" names "${String(en.boss)}", which is not a boss`);
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
    for (const r of Object.values(data.rooms)) {
      if (!data.areas.areas[r.area]) errors.push(`data/rooms/${r.id}.json: area "${r.area}" is not in data/areas.json`);
      for (const en of r.entities) {
        if (en.type === 'prop' && !data.props[String(en.kind)])
          errors.push(`data/rooms/${r.id}.json: unknown prop kind "${String(en.kind)}"`);
        if (en.type === 'decor' && !data.decor.decor[String(en.kind)])
          errors.push(`data/rooms/${r.id}.json: unknown decor kind "${String(en.kind)}"`);
        if (en.type === 'weapon' && !data.weapons[String(en.weapon)])
          errors.push(`data/rooms/${r.id}.json: weapon "${en.id}" has unknown weapon "${String(en.weapon)}"`);
        if (en.type === 'note' && !data.notes[String(en.note)]) errors.push(`data/rooms/${r.id}.json: note has unknown note "${String(en.note)}"`);
        if (en.type === 'enemy' && en.miniboss !== undefined) {
          const mb = S.MinibossPlacement.safeParse(en.miniboss);
          if (!mb.success) errors.push(`data/rooms/${r.id}.json: miniboss:\n${S.formatZod(mb.error)}`);
          else if (!data.items[mb.data.drop]) errors.push(`data/rooms/${r.id}.json: miniboss "${mb.data.id}" drops unknown item "${mb.data.drop}"`);
          else if (ids.has(mb.data.id)) errors.push(`data/rooms/${r.id}.json: duplicate entity id "${mb.data.id}"`);
          else ids.add(mb.data.id);
        }
        if (en.type === 'shrine' || en.type === 'item' || en.type === 'door' || en.type === 'weapon') {
          if (!en.id) errors.push(`data/rooms/${r.id}.json: ${en.type} needs an "id"`);
          else if (ids.has(en.id)) errors.push(`data/rooms/${r.id}.json: duplicate entity id "${en.id}"`);
          else ids.add(en.id);
        }
        if (en.type === 'item' && !data.items[String(en.item)])
          errors.push(`data/rooms/${r.id}.json: item "${en.id}" has unknown item "${String(en.item)}"`);
        if (en.type === 'door' && en.requires !== undefined)
          for (const k of [en.requires].flat().map(String))
            if (data.items[k]?.effect.type !== 'key') errors.push(`data/rooms/${r.id}.json: door "${en.id}" requires "${k}", which is not a key item`);
        if (en.type === 'exit') {
          const to = en.to as { area?: string; spawn?: string } | undefined;
          if (!en.id || !to?.area || !to.spawn) errors.push(`data/rooms/${r.id}.json: exit needs "id" and "to": { "area", "spawn" }`);
          else if (!data.areas.areas[to.area]) errors.push(`data/rooms/${r.id}.json: exit "${en.id}" leads to unknown area "${to.area}"`);
          else {
            // Exits into areas that have rooms must land on a spawn point there. (An area with no rooms yet is
            // allowed: the exit just says the way isn't open.)
            const target = Object.values(data.rooms).filter(t => t.area === to.area);
            if (target.length && !target.some(t => t.entities.some(e => e.type === 'spawn' && e.id === to.spawn)))
              errors.push(`data/rooms/${r.id}.json: exit "${en.id}": no spawn "${to.spawn}" in area "${to.area}"`);
          }
        }
        if (en.type === 'weapon_rack' && !data.weapons[String(en.weapon)])
          errors.push(`data/rooms/${r.id}.json: weapon_rack has unknown weapon "${String(en.weapon)}"`);
        if (en.type === 'shield_rack' && en.shield !== null && !data.shields[String(en.shield)])
          errors.push(`data/rooms/${r.id}.json: shield_rack has unknown shield "${String(en.shield)}"`);
      }
    }
    for (const [boss, theme] of Object.entries(data.music.bosses)) {
      if (!data.enemies[boss]) errors.push(`data/audio/music.json: unknown boss "${boss}"`);
      if (!data.music.themes[theme]) errors.push(`data/audio/music.json: boss "${boss}" has unknown theme "${theme}"`);
    }
    for (const [area, theme] of Object.entries(data.music.areas)) {
      if (!data.areas.areas[area]) errors.push(`data/audio/music.json: unknown area "${area}"`);
      if (!data.music.themes[theme]) errors.push(`data/audio/music.json: area "${area}" has unknown theme "${theme}"`);
    }
    for (const [id, th] of Object.entries(data.music.themes))
      th.layers.forEach((l, i) =>
        (l.melody ?? []).forEach((line, b) => {
          const sum = line.split(' ').reduce((a, w) => a + Number(w.split(':')[1]), 0);
          if (!/^((r|\d+[+-]?):\d+ ?)+$/.test(line) || sum !== th.steps)
            errors.push(`data/audio/music.json: theme "${id}" layer ${i} bar ${b + 1}: "${line}" should be "degree:steps" words adding up to ${th.steps} steps`);
        }),
      );
    // every sound an enemy makes must exist: a preset, or a layered boss sound
    const sound = (id: string) => !!data.sfx.presets[id] || (S.LAYERED_SOUNDS as readonly string[]).includes(id);
    for (const e of Object.values(data.enemies) as S.EnemyDef[]) {
      const ids: string[] = [];
      for (const m of e.moves ?? [])
        for (const st of m.strikes) {
          ids.push(st.sfx);
          if (st.windupSfx) ids.push(st.windupSfx);
          if (st.projectile?.lob?.sfx) ids.push(st.projectile.lob.sfx);
        }
      if (e.boss) ids.push(e.boss.slamSfx, ...(e.boss.roarSfx ? [e.boss.roarSfx] : []));
      if (e.steps) ids.push(e.steps.sfx);
      for (const v of Object.values(e.voice ?? {})) if (v) ids.push(v);
      for (const id of ids) if (!sound(id)) errors.push(`data/enemies/${e.id}.json: unknown sound "${id}"`);
    }
    for (const it of Object.values(data.items)) {
      const e = it.effect;
      if (e.type === 'consumable' && !data.consumables[e.id]) errors.push(`data/items/${it.id}.json: unknown consumable "${e.id}"`);
      if (e.type === 'ring' && !data.rings[e.id]) errors.push(`data/items/${it.id}.json: unknown ring "${e.id}"`);
      if (e.type !== 'gear') continue;
      const table = e.kind === 'weapon' ? data.weapons : e.kind === 'shield' ? data.shields : data.armour;
      if (!table[e.id]) errors.push(`data/items/${it.id}.json: gear "${e.id}" is not a ${e.kind}`);
    }
    for (const e of data.shop.stock) {
      const where = `data/shop.json: "${e.id}"`;
      if (e.consumable && !data.consumables[e.consumable]) errors.push(`${where} sells unknown consumable "${e.consumable}"`);
      if (e.note && !data.notes[e.note]) errors.push(`${where} sells unknown note "${e.note}"`);
      if (e.item && !data.items[e.item]) errors.push(`${where} sells unknown item "${e.item}"`);
      if (e.item && data.items[e.item]?.effect.type === 'ring' && e.limit !== 1) errors.push(`${where}: a ring is sold once ("limit": 1)`);
    }
    if (new Set(data.shop.stock.map(e => e.id)).size !== data.shop.stock.length) errors.push('data/shop.json: duplicate entry ids');
    for (const lv of data.smith.levels)
      for (const m of Object.keys(lv.materials))
        if (data.consumables[m]?.use.type !== 'material') errors.push(`data/config/smith.json: "${m}" is not a material (data/consumables, use "material")`);
    for (const [t, table] of Object.entries(data.loot.tables))
      for (const l of table) if (l.item && !data.consumables[l.item]) errors.push(`data/loot.json: table "${t}" drops unknown consumable "${l.item}"`);
    for (const e of Object.values(data.enemies) as S.EnemyDef[])
      if (e.loot && !data.loot.tables[e.loot]) errors.push(`data/enemies/${e.id}.json: unknown loot table "${e.loot}"`);
    for (const c of Object.values(data.consumables)) {
      if (!sound(c.sfx)) errors.push(`data/consumables/${c.id}.json: unknown sound "${c.sfx}"`);
      if (c.use.type === 'throw' && c.use.projectile.lob && !sound(c.use.projectile.lob.sfx))
        errors.push(`data/consumables/${c.id}.json: unknown sound "${c.use.projectile.lob.sfx}"`);
      if (c.use.type === 'buff' && !data.palette[c.use.colour]) errors.push(`data/consumables/${c.id}.json: colour "${c.use.colour}" is not a palette colour`);
    }
    for (const w of Object.values(data.weapons))
      for (const id of [w.sounds.draw, w.sounds.hit, w.sounds.shotHit, w.sounds.charge, ...(w.sounds.reload ?? []).map(r => r[1]), w.ranged?.fire.sfx, ...w.light.map(l => l.sfx), w.heavy?.strike.sfx])
        if (id && !sound(id)) errors.push(`data/weapons/${w.id}.json: unknown sound "${id}"`);
    for (const sh of Object.values(data.shields))
      for (const id of [sh.blockSfx, sh.parrySfx]) if (!sound(id)) errors.push(`data/shields/${sh.id}.json: unknown sound "${id}"`);
    for (const k of Object.keys(data.ambient.decor)) if (!data.decor.decor[k]) errors.push(`data/audio/ambient.json: unknown decor kind "${k}"`);
    for (const r of Object.keys(data.ambient.roomEcho)) if (!data.rooms[r]) errors.push(`data/audio/ambient.json: roomEcho: unknown room "${r}"`);
    for (const a of Object.keys(data.ambient.areas)) if (!data.areas.areas[a]) errors.push(`data/audio/ambient.json: unknown area "${a}"`);
    for (const k of Object.keys(data.ambience.decor)) if (!data.decor.decor[k]) errors.push(`data/ambience.json: unknown decor kind "${k}"`);
    for (const [a, amb] of Object.entries(data.ambience.areas)) {
      if (!data.areas.areas[a]) errors.push(`data/ambience.json: unknown area "${a}"`);
      for (const c of amb.critters)
        for (const r of c.rooms ?? []) if (data.rooms[r]?.area !== a) errors.push(`data/ambience.json: ${a} ${c.kind}: room "${r}" is not in that area`);
    }
    errors.push(...checkStory(data));
    if (!data.rooms[data.game.startRoom])
      errors.push(`data/config/game.json: startRoom "${data.game.startRoom}" has no file in data/rooms`);
  }
  return errors.length ? { ok: false as const, error: errors.join('\n\n') } : { ok: true as const, data };
}

export type GameData = Extract<ReturnType<typeof loadAll>, { ok: true }>['data'];

/** Story references: NPC placements, cutscene triggers and everything scripts point at. */
function checkStory(data: {
  rooms: Record<string, S.RoomData>;
  npcs: { npcs: Record<string, S.NpcDef>; narration: S.Voice };
  chatter: { chats: S.ChatDef[] };
  scripts: Record<string, S.ScriptDef>;
  items: Record<string, unknown>;
  enemies: Record<string, unknown>;
  sfx: { presets: Record<string, unknown> };
}): string[] {
  const errors: string[] = [];
  const npcPlacements = new Set<string>();
  const points = new Set<string>();
  for (const r of Object.values(data.rooms))
    for (const en of r.entities) {
      if (en.type === 'npc') {
        if (!en.id) errors.push(`data/rooms/${r.id}.json: npc needs an "id"`);
        else npcPlacements.add(en.id);
        if (!data.npcs.npcs[String(en.npc)]) errors.push(`data/rooms/${r.id}.json: npc "${en.id}" has unknown character "${String(en.npc)}"`);
        if (en.talk !== undefined && !data.scripts[String(en.talk)])
          errors.push(`data/rooms/${r.id}.json: npc "${en.id}" talks with unknown script "${String(en.talk)}"`);
        if (en.routine !== undefined) {
          const rt = z.array(S.NpcStop).min(1).safeParse(en.routine);
          if (!rt.success) errors.push(`data/rooms/${r.id}.json: npc "${en.id}" routine:\n${S.formatZod(rt.error)}`);
          else
            for (const stop of rt.data)
              for (const [tx, ty] of [...(stop.via ?? []), stop.at])
                if (r.legend[r.tiles[ty]?.[tx] ?? ' '] === undefined || ['wall', 'void'].includes(r.legend[r.tiles[ty][tx]]))
                  errors.push(`data/rooms/${r.id}.json: npc "${en.id}" routine goes through [${tx}, ${ty}], which is not floor`);
        }
        if (en.pose !== undefined && !['idle', 'work', 'sit', 'kneel'].includes(String(en.pose)))
          errors.push(`data/rooms/${r.id}.json: npc "${en.id}" has unknown pose "${String(en.pose)}"`);
      }
      if (en.type === 'lever' && en.script !== undefined && !data.scripts[String(en.script)])
        errors.push(`data/rooms/${r.id}.json: lever "${en.id}" runs unknown script "${String(en.script)}"`);
      if (en.type === 'cutscene' && !data.scripts[String(en.script)])
        errors.push(`data/rooms/${r.id}.json: cutscene "${en.id}" has unknown script "${String(en.script)}"`);
      if (en.type === 'point' && en.id) points.add(en.id);
    }
  const walk = (file: string, steps: S.Step[]) => {
    for (const s of steps) {
      if ('say' in s && s.who && !data.npcs.npcs[s.who]) errors.push(`${file}: unknown speaker "${s.who}"`);
      if ('give' in s && !data.items[s.give]) errors.push(`${file}: gives unknown item "${s.give}"`);
      if ('sfx' in s && !data.sfx.presets[s.sfx]) errors.push(`${file}: unknown sound "${s.sfx}"`);
      if ('camera' in s) {
        const [kind, id] = s.camera.split(/:(.*)/);
        if (kind === 'npc' && !npcPlacements.has(id)) errors.push(`${file}: camera target "${s.camera}": no npc placement "${id}"`);
        if (kind === 'point' && !points.has(id)) errors.push(`${file}: camera target "${s.camera}": no point "${id}"`);
        if (kind === 'enemy' && !data.enemies[id]) errors.push(`${file}: camera target "${s.camera}": no enemy kind "${id}"`);
      }
      if ('menu' in s) for (const o of s.menu) walk(file, o.do ?? []);
      if ('if' in s) walk(file, [...s.then, ...(s.else ?? [])]);
    }
  };
  for (const sc of Object.values(data.scripts)) walk(`data/scripts/${sc.id}.json`, sc.steps);
  for (const c of data.chatter.chats) {
    for (const w of c.who) if (!npcPlacements.has(w)) errors.push(`data/chatter.json: chat "${c.id}": no npc placement "${w}"`);
    for (const [w] of c.lines) if (!c.who.includes(w)) errors.push(`data/chatter.json: chat "${c.id}": "${w}" speaks but is not in "who"`);
  }
  for (const [id, n] of Object.entries(data.npcs.npcs))
    if (!data.sfx.presets[n.voice.sfx]) errors.push(`data/npcs.json: "${id}" has unknown voice sound "${n.voice.sfx}"`);
  for (const [id, n] of Object.entries(data.npcs.npcs))
    if (n.workSfx && !data.sfx.presets[n.workSfx]) errors.push(`data/npcs.json: "${id}" has unknown work sound "${n.workSfx}"`);
  if (!data.sfx.presets[data.npcs.narration.sfx]) errors.push(`data/npcs.json: unknown narration voice sound "${data.npcs.narration.sfx}"`);
  return errors;
}

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
