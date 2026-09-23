// Story conditions over world flags. Bare names are story flags ("story:<name>"); names with a colon are any
// world flag ("key:toll_key", "shrine:shrine_rest"). "!name" means "not set"; a list means all must hold.
import type { Cond } from '../data/schemas';

export const storyFlag = (name: string) => (name.includes(':') ? name : `story:${name}`);

export function check(flags: ReadonlySet<string>, cond: Cond | undefined): boolean {
  if (cond === undefined) return true;
  const all = Array.isArray(cond) ? cond : [cond];
  return all.every(c => (c.startsWith('!') ? !flags.has(storyFlag(c.slice(1))) : flags.has(storyFlag(c))));
}
