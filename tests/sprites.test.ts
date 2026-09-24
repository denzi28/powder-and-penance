// Enemy art is wired to enemy data: every animation a move asks for, and every projectile sprite, exists.
// (An unknown animation silently falls back to "attack", which would hide the tell of a move.)
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DATA } from '../src/data/config';

const SPRITES = path.resolve(import.meta.dirname, '../assets/sprites');
const manifest = (name: string) => JSON.parse(fs.readFileSync(path.join(SPRITES, `${name}.anim.json`), 'utf8'));

describe('enemy sprites', () => {
  const enemies = Object.values(DATA.enemies);

  it('have every animation their moves play', () => {
    for (const e of enemies) {
      const anims = Object.keys(manifest(e.sprite).animations ?? {});
      for (const m of e.moves) for (const s of m.strikes) if (s.anim) expect(anims, `${e.id} / ${m.id}`).toContain(s.anim);
      if (e.boss?.introAnim) expect(anims, `${e.id} intro`).toContain(e.boss.introAnim);
    }
  });

  it('have their projectile and weapon sprites', () => {
    for (const e of enemies) {
      if (e.weaponSprite) expect(fs.existsSync(path.join(SPRITES, `${e.weaponSprite}.png`)), `${e.id} weapon`).toBe(true);
      for (const m of e.moves)
        for (const s of m.strikes)
          if (s.projectile) expect(fs.existsSync(path.join(SPRITES, `${s.projectile.sprite}.png`)), `${e.id} / ${m.id}`).toBe(true);
    }
  });

  it('give per-direction weapon hands for every direction an animation has', () => {
    for (const e of enemies) {
      for (const [name, a] of Object.entries(manifest(e.sprite).animations ?? {}) as [string, { dirs: string[]; frames: { hands?: Record<string, number[]> }[] }][])
        for (const f of a.frames) if (f.hands) expect(Object.keys(f.hands).sort(), `${e.sprite} / ${name}`).toEqual([...a.dirs].sort());
    }
  });
});
