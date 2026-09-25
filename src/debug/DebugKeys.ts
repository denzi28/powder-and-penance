// Debug hotkeys (not rebindable, not part of the action map).
//   F1 overlay   F2 god mode   F3 refill HP/stamina   F4 kill all enemies   F5 time: normal -> slow -> frozen
//   F6 step one tick   F8 test shake   ` debug menu (teleport, world flags)
//   1-7 spawn at cursor: Wickling, dummy, sparring post, Bulwark Warden, Powder Acolyte, Taper Hound, Belfry Brute
import { DATA } from '../data/config';
import type { GameScene } from '../scenes/GameScene';

const SPAWN_KEYS: Record<string, string> = {
  Digit1: 'wickling',
  Digit2: 'dummy',
  Digit3: 'sparring_dummy',
  Digit4: 'bulwark_warden',
  Digit5: 'powder_acolyte',
  Digit6: 'taper_hound',
  Digit7: 'belfry_brute',
};

export function installDebugKeys(scene: GameScene): () => void {
  const onKey = (e: KeyboardEvent) => {
    if (e.repeat || !DATA.debug.enabled) return; // off in release (data/config/debug.json)
    const loop = scene.loop;
    const p = scene.player;
    switch (e.code) {
      case 'F1':
        scene.debug.enabled = !scene.debug.enabled;
        break;
      case 'F2':
        p.god = !p.god;
        break;
      case 'F3':
        p.refill();
        break;
      case 'F4':
        scene.enemies.forEach(en => en.kill());
        break;
      case 'F5':
        if (loop.frozen) {
          loop.frozen = false;
          loop.timeScale = 1;
        } else if (loop.timeScale === 1) loop.timeScale = DATA.debug.slowmoScale;
        else loop.frozen = true;
        break;
      case 'F6':
        if (loop.frozen) loop.stepOnce();
        else loop.frozen = true;
        break;
      case 'F8':
        scene.bus.emit('shake', { trauma: DATA.juice.shake.debugTrauma });
        break;
      case 'Backquote':
        if (scene.menu) scene.closeMenu();
        else scene.openDebugMenu();
        break;
      default:
        if (SPAWN_KEYS[e.code]) {
          const facing = Math.atan2(p.y - p.aimY, p.x - p.aimX);
          scene.spawnEnemy(SPAWN_KEYS[e.code], p.aimX, p.aimY, facing);
          break;
        }
        return;
    }
    e.preventDefault();
  };
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}
