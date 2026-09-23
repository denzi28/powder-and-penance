// Debug hotkeys (not rebindable, not part of the action map).
//   F1 overlay   F3 refill HP/stamina   F5 cycle time: normal -> slow -> frozen   F6 step one tick   F8 test shake
import { DATA } from '../data/config';
import type { GameScene } from '../scenes/GameScene';

export function installDebugKeys(scene: GameScene): () => void {
  const onKey = (e: KeyboardEvent) => {
    if (e.repeat) return;
    const loop = scene.loop;
    switch (e.code) {
      case 'F1':
        scene.debug.enabled = !scene.debug.enabled;
        break;
      case 'F3':
        scene.player.refill();
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
      default:
        return;
    }
    e.preventDefault();
  };
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}
