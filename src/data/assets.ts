// Discovers sprite sheets + manifests in /assets/sprites. Replacing a PNG triggers a full page reload.
import { formatZod, SpriteManifest } from './schemas';
import fontUrl from '../../assets/fonts/pixel5x7.png?url';
import smallFontUrl from '../../assets/fonts/pixel3x5.png?url';

const manifests = import.meta.glob('../../assets/sprites/*.anim.json', { eager: true, import: 'default' }) as Record<string, unknown>;
const urls = import.meta.glob('../../assets/sprites/*.png', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;

const base = (p: string) => p.slice(p.lastIndexOf('/') + 1);

export const SPRITES: Record<string, SpriteManifest> = {};
export const SPRITE_URLS: Record<string, string> = {};
export const ASSET_ERRORS: string[] = [];
export const FONT_URL = fontUrl;
export const SMALL_FONT_URL = smallFontUrl;

for (const [p, url] of Object.entries(urls)) SPRITE_URLS[base(p)] = url;
for (const [p, raw] of Object.entries(manifests)) {
  const name = base(p).replace('.anim.json', '');
  const r = SpriteManifest.safeParse(raw);
  if (!r.success) ASSET_ERRORS.push(`assets/sprites/${base(p)}:\n${formatZod(r.error)}`);
  else if (!SPRITE_URLS[r.data.image]) ASSET_ERRORS.push(`assets/sprites/${base(p)}: image "${r.data.image}" not found`);
  else SPRITES[name] = r.data;
}
