// One Input shared by every scene (title, game, menus).
import { DATA } from '../data/config';
import { Input } from './Input';

export const INPUT = new Input(() => DATA.input);
