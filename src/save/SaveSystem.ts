// Save game in localStorage: versioned, validated with zod, migrated forward on load.
// Loading always places the player at their last shrine, rested (the Souls "bonfire" contract).
import { z } from 'zod';
import { formatZod } from '../data/schemas';

export const SAVE_KEY = 'powder-and-penance.save';
export const SAVE_VERSION = 1;

const Ammo = z.object({ clip: z.number().int().min(0), reserve: z.number().int().min(0) });

export const SaveV1 = z.object({
  version: z.literal(1),
  savedAt: z.number(),
  lastShrine: z.string().nullable(),
  tallow: z.number().int().min(0),
  phials: z.object({ charges: z.number().int().min(0), max: z.number().int().min(0), level: z.number().int().min(0) }),
  /** Placeholder until levelling (M7). */
  stats: z.object({ level: z.number().int().min(1) }),
  loadout: z.object({
    slots: z.tuple([z.string(), z.string()]),
    slot: z.number().int().min(0).max(1),
    shield: z.string().nullable(),
  }),
  ammo: z.record(z.string(), Ammo),
  world: z.object({
    /** "shrine:<id>" lit shrines, "item:<id>" picked-up items; later shortcuts, doors, bosses. */
    flags: z.array(z.string()),
    groundItems: z.array(z.object({ weapon: z.string(), x: z.number(), y: z.number(), area: z.string().optional() })),
  }),
  deathMarker: z.object({ x: z.number(), y: z.number(), tallow: z.number().int().min(1), area: z.string().optional() }).nullable(),
});
export type SaveData = z.infer<typeof SaveV1>;

/** Upgrade older save shapes: MIGRATIONS[n] turns a version-n save into version n+1. */
const MIGRATIONS: Record<number, (s: Record<string, unknown>) => Record<string, unknown>> = {};

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type LoadResult = { ok: true; save: SaveData } | { ok: false; reason: 'none' } | { ok: false; reason: 'corrupt'; message: string };

export class SaveSystem {
  constructor(private store: KeyValueStore = localStorage) {}

  exists(): boolean {
    return this.store.getItem(SAVE_KEY) !== null;
  }

  load(): LoadResult {
    const raw = this.store.getItem(SAVE_KEY);
    if (raw === null) return { ok: false, reason: 'none' };
    try {
      let data = JSON.parse(raw) as Record<string, unknown>;
      let v = Number(data.version);
      while (v < SAVE_VERSION && MIGRATIONS[v]) data = MIGRATIONS[v++](data);
      const r = SaveV1.safeParse(data);
      if (r.success) return { ok: true, save: r.data };
      return this.corrupt(raw, formatZod(r.error));
    } catch (e) {
      return this.corrupt(raw, String(e));
    }
  }

  write(save: SaveData) {
    this.store.setItem(SAVE_KEY, JSON.stringify(save));
  }

  clear() {
    this.store.removeItem(SAVE_KEY);
  }

  /** Keep the unreadable save under a backup key so nothing is silently destroyed. */
  private corrupt(raw: string, message: string): LoadResult {
    this.store.setItem(`${SAVE_KEY}.corrupt-${Date.now()}`, raw);
    this.store.removeItem(SAVE_KEY);
    console.error(`Save file unreadable, backed up and reset:\n${message}`);
    return { ok: false, reason: 'corrupt', message };
  }
}
