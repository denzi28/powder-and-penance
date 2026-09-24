// Turns gameplay events into feedback: hit-stop, shake, particles, sprites FX, sound, floating text,
// flinches and the player's damage vignette. The simulation never calls any of this directly.
import { DATA } from '../data/config';
import { BossSfx } from '../audio/BossSfx';
import { TILE } from '../world/TileGrid';
import { Enemy } from '../enemies/Enemy';
import { PROJECTILE_HEIGHT } from '../combat/Projectiles';
import { DEPTH } from '../render/depth';
import { hexToInt } from '../ui/colors';
import type { GameScene } from '../scenes/GameScene';

/** The arc in slash.png spans this radius; slashes are scaled to the strike's hitbox radius. */
const SLASH_RADIUS = 22;

export function wirePresentation(gs: GameScene) {
  const bus = gs.bus;
  const pal = () => DATA.palette;

  bus.on('dust', e => gs.fx.spawn('dust', e.kind === 'roll' ? 'puff' : 'step', e.x, e.y));
  bus.on('shake', e => gs.cam.addTrauma(e.trauma));
  bus.on('sfx', e => {
    let vol = e.volume ?? 1;
    if (e.x !== undefined && e.y !== undefined) {
      const d = Math.hypot(e.x - gs.player.x, e.y - gs.player.y);
      vol *= Math.max(0, 1 - d / DATA.audio.hearingDistance);
    }
    if (BossSfx.has(e.id)) gs.bossSfx.play(e.id, vol, e.x !== undefined ? (e.x - gs.player.x) / 200 : 0); // layered boss sounds
    else gs.sfx.play(e.id, vol, (e.pitch ?? 1) * (0.96 + Math.random() * 0.08));
  });

  bus.on('footstep', e => {
    // what the foot lands on: the floor kind, or plain floor as the area has it
    const tx = Math.floor(e.x / TILE);
    const ty = Math.floor((e.y - 2) / TILE);
    const fs = DATA.ambient.footsteps;
    const v = gs.grid.variant(tx, ty);
    const surface = fs.surfaces[v] ?? fs.floor[gs.area] ?? fs.floor.default ?? 'stone';
    if (!gs.ambientAudio.step(surface, e.sprint)) gs.sfx.play('footstep', e.sprint ? 1.3 : 1); // before the ambient engine is up
  });

  bus.on('hit', h => {
    const s = h.source;
    const t = h.target;
    const z = -t.hurtbox.offsetY;
    const pc = DATA.juice.particles;
    const fb = DATA.juice.hitFeedback;
    if (h.blocked) {
      gs.hitstop = Math.max(gs.hitstop, h.guardBroken ? 8 : 3);
      gs.cam.addTrauma(h.guardBroken ? 0.35 : 0.12);
      gs.particles.burst(t.x, t.y, z, h.angle + Math.PI, 1.6, pc.sparks * 2, 130, 'flame2', false);
      bus.emit('sfx', { id: h.guardBroken ? 'guard_break' : 'block', x: t.x, y: t.y });
      t.flinch(h.angle, fb.flinchBlocked);
      return;
    }
    const heavy = s.hitstop >= DATA.combat.heavyHitstop || h.staggered || h.killed || s.kind === 'critical';
    gs.hitstop = Math.max(gs.hitstop, s.hitstop + (h.killed ? 2 : 0));
    const trauma = s.shake * (t === gs.player ? 1.4 : 1) + (h.staggered ? 0.1 : 0);
    if (trauma > 0) gs.cam.addTrauma(trauma);
    gs.particles.burst(t.x, t.y, z, h.angle, 1.4, pc.sparks, 110, 'flame2', false);
    const blood = h.killed || s.kind === 'critical' ? pc.bloodOnKill : pc.blood;
    gs.particles.burst(t.x, t.y, z, h.angle, 1.0, blood, 90, t.bloodColor, true);
    bus.emit('sfx', { id: heavy ? 'hit_heavy' : 'hit', x: t.x, y: t.y });
    if (t instanceof Enemy && !h.killed && t.def.voice?.hurt) bus.emit('sfx', { id: t.def.voice.hurt, x: t.x, y: t.y }); // its cry of pain
    t.flinch(h.angle, heavy ? fb.flinchHeavy : fb.flinch);

    if (t === gs.player) {
      // Damage vignette, stronger on the side the hit came from.
      gs.hurt = { angle: Math.atan2(h.attacker.y - t.y, h.attacker.x - t.x), strength: heavy ? 1 : 0.65, t: 0 };
    }

    const training = t instanceof Enemy && t.def.immortal;
    const mode = DATA.juice.damageNumbers;
    if (mode === 'all' || (mode === 'dummy' && training)) {
      gs.numbers.add(String(h.damage), t.x, t.y - t.hurtbox.h - 12, hexToInt(h.staggered || s.kind === 'critical' ? pal().flame2 : pal().wax2));
      if (h.staggered) gs.numbers.add('BREAK', t.x, t.y - t.hurtbox.h - 20, hexToInt(pal().ember));
    }
  });

  bus.on('parry', e => {
    gs.hitstop = Math.max(gs.hitstop, DATA.combat.parryHitstop);
    gs.cam.addTrauma(0.25);
    const mx = (e.parrier.x + e.attacker.x) / 2;
    const my = (e.parrier.y + e.attacker.y) / 2;
    gs.particles.burst(mx, my, 12, Math.atan2(e.attacker.y - e.parrier.y, e.attacker.x - e.parrier.x), 2.4, 14, 150, 'wax2', false);
    gs.fx.spawn('glint', 'normal', mx, my - 12, { depth: DEPTH.overlay - 5 });
    bus.emit('sfx', { id: 'parry' });
    gs.numbers.add('PARRY', e.parrier.x, e.parrier.y - 34, hexToInt(pal().wax2));
  });

  bus.on('critical', e => {
    bus.emit('sfx', { id: 'critical' });
    gs.numbers.add(e.kind === 'riposte' ? 'RIPOSTE' : 'BACKSTAB', e.victim.x, e.victim.y - e.victim.hurtbox.h - 22, hexToInt(pal().ember));
  });

  bus.on('swing', e => {
    const s = e.strike;
    const thrust = s.sweep.fromDeg === s.sweep.toDeg;
    const dir = Math.sign(s.sweep.toDeg - s.sweep.fromDeg) || 1;
    const scale = (s.hitbox.radius + (s.hitbox.shape === 'circle' ? s.hitbox.offset : 0)) / SLASH_RADIUS;
    gs.fx.spawn('slash', thrust ? 'thrust' : 'swing', e.actor.x, e.actor.y + s.originY, {
      rotation: e.angle,
      scaleX: scale,
      scaleY: scale * e.mirror * dir,
      depth: DEPTH.actor(e.actor.y) + 0.3,
    });
    bus.emit('sfx', { id: s.sfx, x: e.actor.x, y: e.actor.y });
  });

  bus.on('shot', e => {
    const r = e.weapon.ranged!;
    const tip = gs.weaponTip(e.actor);
    if (r.muzzle !== 'none') gs.fx.spawn('muzzle', r.muzzle, tip.x, tip.y, { rotation: e.angle, depth: DEPTH.overlay - 6 });
    if (r.casing) {
      const side = e.angle + (Math.cos(e.angle) < 0 ? 1 : -1) * (Math.PI / 2 + 0.4);
      gs.particles.burst(e.actor.x, e.actor.y, 12, side, 0.5, 1, 60, 'flame1', true);
    }
    gs.particles.burst(tip.x, tip.y + PROJECTILE_HEIGHT, PROJECTILE_HEIGHT, e.angle, 0.8, 3, 60, 'stone4', false);
  });

  bus.on('projectileEnd', e => {
    if (!e.wall) return;
    gs.particles.burst(e.x, e.y + PROJECTILE_HEIGHT, PROJECTILE_HEIGHT, e.angle + Math.PI, 1.8, 4, 80, 'flame2', false);
    bus.emit('sfx', { id: 'bullet_wall', x: e.x, y: e.y });
  });

  bus.on('telegraph', e => {
    const tip = gs.weaponTip(e.actor);
    gs.fx.spawn('glint', e.kind, tip.x, tip.y, { depth: DEPTH.overlay - 5 });
    bus.emit('sfx', { id: e.kind === 'danger' ? 'telegraph_danger' : 'telegraph', x: e.actor.x, y: e.actor.y });
  });

  bus.on('chargeFull', e => {
    const tip = gs.weaponTip(e.actor);
    gs.fx.spawn('glint', 'normal', tip.x, tip.y, { depth: DEPTH.overlay - 5 });
    bus.emit('sfx', { id: 'charge_full' });
  });

  bus.on('blast', e => {
    gs.fx.spawn('blast', 'burst', e.x, e.y, { depth: DEPTH.actor(e.y) + 1, scaleX: e.radius / 20, scaleY: e.radius / 20 });
    gs.particles.burst(e.x, e.y, 4, -Math.PI / 2, Math.PI * 2, 14, 110, 'flame1', false);
    gs.particles.burst(e.x, e.y, 2, -Math.PI / 2, Math.PI * 2, 8, 70, 'stone4', false);
    gs.cam.addTrauma(Math.max(0, 0.45 - Math.hypot(e.x - gs.player.x, e.y - gs.player.y) / 400));
    bus.emit('sfx', { id: e.sfx, x: e.x, y: e.y });
  });

  bus.on('thrown', e => bus.emit('sfx', { id: e.strike.sfx === 'swing' ? 'throw' : e.strike.sfx, x: e.actor.x, y: e.actor.y }));

  bus.on('propBroken', e => {
    const p = e.prop;
    gs.particles.burst(p.x, p.y, 6, -Math.PI / 2, Math.PI * 2, 14, 90, p.def.debris, true);
    gs.fx.spawn('dust', 'puff', p.x, p.y);
    bus.emit('sfx', { id: p.def.sfx, x: p.x, y: p.y });
  });

  bus.on('grabbed', e => {
    gs.cam.addTrauma(0.3);
    gs.hitstop = Math.max(gs.hitstop, 5);
    bus.emit('sfx', { id: 'grab', x: e.by.x, y: e.by.y });
    gs.numbers.add('GRABBED', gs.player.x, gs.player.y - 34, hexToInt(pal().ember));
  });

  bus.on('healed', e => {
    gs.particles.burst(e.actor.x, e.actor.y, 6, -Math.PI / 2, 2.2, 14, 45, 'flame2', false);
    gs.particles.burst(e.actor.x, e.actor.y, 14, -Math.PI / 2, 2.2, 8, 35, 'wax2', false);
    bus.emit('sfx', { id: 'heal' });
  });

  bus.on('healFailed', e => {
    gs.particles.burst(e.actor.x, e.actor.y, 14, -Math.PI / 2, 3, 8, 70, 'steel2', false);
    bus.emit('sfx', { id: 'heal_fail' });
    gs.numbers.add('WASTED', e.actor.x, e.actor.y - 34, hexToInt(pal().ember));
  });
}
