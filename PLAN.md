# PLAN.md — Milestones

Each milestone ends with a playable build. I stop after each one and hand you:
- **what to test**
- **the tuning knobs that matter most**

All timings are in ticks (60/s). Everything tunable lives in `data/`, and edits hot-reload while the game runs.

## Status
| Milestone | State |
|---|---|
| 1 Foundation, movement, roll | ✅ Done. Playtested. Fix: walls now block their full visual footprint. |
| 2 Melee + first enemy | ✅ Built. Awaiting playtest. |
| 3 Ranged, loadout, shield, criticals | ⏭ Next |
| 4–7 | Planned |
| 8–12 (post-launch roadmap) | Proposed, see the end of this file |

---

## Milestone 1: Foundation, movement and roll

**Build**
1. Vite + TypeScript (strict) + Phaser 3 scaffold. Also: ESLint, vitest, and the `npm run dev / build / test / gen:art` scripts.
2. `PixelScaler`: 480×270 canvas, integer scaling, letterbox, `image-rendering: pixelated`.
3. `FixedLoop` (60 Hz accumulator) plus render interpolation. Arcade world stepped manually.
4. Data layer: zod schemas, JSON loaders and Vite HMR hot-apply for `data/config/*.json`.
5. Input layer:
   - action map for keyboard + mouse and gamepad
   - automatic device switching
   - input buffer
   - mouse and right-stick aim
6. Placeholder art generator (`tools/gen-art.ts`):
   - player legs and torso sheets (8/4 directions with mirroring): idle, walk, roll
   - drop shadow, tiles (floor and wall with top face), dust FX
   - one sword sprite
   - an original 5×7 pixel font
7. **ASSETS.md**: the full sprite-sheet and animation spec, including phase tags, events, anchors and hurtbox overrides.
8. `AnimPlayer` with phase-stretching and cosmetic events. `LayeredSprite`: legs follow movement, torso follows aim.
9. Held weapon view: rotates around the hand anchor, flips, and draws behind or in front of the body by aim angle.
10. Player states: idle, move, sprint, roll. Snappy acceleration and deceleration.
11. Stamina system: spend, regen delay, exhaustion rule. A temporary bar drawn on screen.
12. Dodge roll: distance curve, i-frame window, vulnerable recovery, cancel window, squash and stretch, dust puff.
13. `CameraRig`: pixel-stable follow, aim lead, trauma shake (triggered by a debug key for now).
14. Room loader (ASCII JSON) and autotiled walls with a top face, Y-sort. One test room with some pillars.
15. Debug overlay (F1):
    - state name and tick
    - hurtboxes, i-frame tint
    - stamina numbers, FPS
    - plus F5 slow-mo and F6 frame-step

**What you test:** window resizing (always crisp, always an integer scale); walking in all 8 directions while aiming elsewhere; backpedaling; the weapon flipping and layering as you circle the cursor; roll feel and distance; roll spam until you are exhausted; the camera lead; gamepad parity with keyboard + mouse; no jitter at 60 and 144 Hz.

**Key knobs:**
- `player.json`: `walkSpeed`, `accelTicks`, `decelTicks`, `sprintMult`
- `roll.json`: `distance`, `curve`, `iframeStart/End`, `totalTicks`, `cancelFrom`, `stamina`
- `stamina.json`: `max`, `regenDelayTicks`, `regenPerSec`
- `camera.json`: `aimLeadFactor`, `aimLeadMax`, `lerp`

---

## Milestone 2: Melee combat and the first enemy

**Build**
1. Action timeline and cancel windows, generalised for all actors. Input buffer integration.
2. Hitbox and hurtbox shapes (circle, aabb, arc) and the `CombatSystem` resolution order.
3. `DamageCalc` (base stats only for now), poise and stagger, knockback.
4. Straight sword:
   - 3-hit light combo with increasing recovery
   - charged heavy (hold, charge levels, release)
   - lunge
   - windup aim tracking, then lock on active frames
5. Juice: hit-stop (global tick freeze), white flash, sparks and blood particles, shake on heavy hits.
6. Minimal synthesised SFX: swing, hit, telegraph cue, roll, footstep.
7. **Wickling** grunt:
   - perception (cone and line of sight), notice delay, approach, strafe
   - 3 telegraphed attacks with glints
   - recover state, leash back to post
   - attack tokens
8. Player HP, taking hits, player poise and stagger.
9. Death, a simple EXTINGUISHED screen, and respawn at the room start (shrines come in M4).
10. Debug additions: hitbox drawing, poise numbers, perception cones, spawn hotkeys, F2/F3/F4.
11. Early test arena with a training dummy that shows last-hit damage and poise.

**What you test:**
- Can you read every Wickling attack on the first try?
- Can you roll through each one on reaction?
- Does the light combo feel committed but not sluggish?
- Charged heavy timing.
- How hit-stop feels.
- Getting staggered by the grunt.
- Running out of stamina mid-fight should feel like your fault.

**Key knobs:**
- `weapons/straight_sword.json`: per-hit `windup/active/recovery`, `comboWindow`, `rollCancelFrom`, `trackDegPerTick`, `lunge`, `hitbox`
- `enemies/wickling.json`: `reactionTicks`, move `windup`, `telegraphTick`, `recovery`, `weights`, `cooldownTicks`
- `juice.json`: `hitstop.*`, `shake.*`, `flashTicks`
- `input.json`: `bufferTicks`

---

## Milestone 3: Ranged, loadout, shield, criticals

**Build**
1. Ranged weapon runtime:
   - clip and reserve, fire windup and recovery, committed reload (auto-reload on empty)
   - Dex reload hook
   - projectile system with pierce and wall hits
2. Revolver, flintlock and heavy crossbow, with muzzle flash, casings and recoil kick on the weapon sprite.
3. Greataxe (hyper-armor heavy) and dagger.
4. Two weapon slots with the swap animation, and the two-handed rule.
5. Shield:
   - hold to block, frontal arc, stamina drain per hit, chip damage
   - guard break
   - parry window with re-arm rule
6. Riposte on parried or guard-broken enemies, and backstab on unaware or staggered enemies from behind. Paired critical animations with invulnerable attackers.
7. HUD v1: HP, stamina, weapon slots, ammo, reload indicator.
8. Test arena: a weapon rack, and a dummy that attacks on a fixed rhythm for parry practice.

**What you test:**
- Does the ranged combat feel deliberate and resource-limited?
- Reload vulnerability.
- Parry window tightness.
- Riposte and backstab reliability, with no whiffs when the prompt should work.
- The greataxe trading through grunt hits.
- Swap timing.

**Key knobs:**
- ranged: `fireRecovery`, `reloadTicks`, `clip`, `reserveMax`, `projectileSpeed`
- `shields/*.json`: `parryWindowTicks`, `parryRearmTicks`, `stability`, `blockArcDeg`
- `combat.json`: `backstabArcDeg`, `backstabRange`, `riposteRange`

---

## Milestone 4: Healing, shrines, saving, death loop

**Build**
1. Mending Phial: committed drink, slow movement, late heal application, wasted charge if hit first.
2. Wick Shrine:
   - discovery and rest
   - restores HP, phials and ammo
   - respawns non-boss enemies and props (a respawn registry per room)
3. Save system: schema v1, migrations scaffold, zod validation, corrupt-save fallback, autosave triggers.
4. Tallow drops from enemies. The Guttered Candle death marker: recovery, overwrite on second death, boss-arena exception.
5. The full death sequence: EXTINGUISHED, fade, respawn at the last shrine.
6. World flags (pickups, doors) and the title screen with Continue / New Game.
7. HUD: phial count and Tallow counter.

**What you test:** healing mid-fight (the risk should feel fair); the full death → recover-currency loop; double death; reloading the page and continuing exactly where you rested; enemies respawning on rest.

**Key knobs:**
- `phial.json`: `healTicks`, `healApplyTick`, `healMoveMult`, `healAmount`
- `enemies/*.json`: `tallowDrop`
- `death.json`: `screenHoldTicks`

---

## Milestone 5: Full roster and the Guttering Abbey

**Build**
1. Bulwark Warden (enemy shield blocking, guard break, unparryable red-glint move).
2. Powder Acolyte (keeps distance, lobbed firepot with a ground marker).
3. Taper Hound (lunge, flurry).
4. Belfry Brute (slam AoE, sweep, unblockable grab, partial hyper-armor).
5. The Guttering Abbey: rooms 1–12 (plus side chapel 2b), 2 shrines.
   - Doors.
   - The **shortcut gate** that opens only from room 10 and persists.
   - The locked-side message.
6. Destructible props (crate, pot, candle cluster) with loot tables, plus Phial Shard and Bitter Salt pickups and ammo pouches.
7. Debug: room teleport menu, flag editor, full test arena.

**What you test:**
- A full run from Shrine A to the mini-boss door.
- Does each archetype teach itself in its intro room?
- Opening the shortcut should be a satisfying moment.
- Do mixed groups stay fair (attack tokens)?

**Key knobs:**
- `ai.json`: `maxAttackers`, `alertShareRadius`
- per-enemy reaction and telegraph ticks, `leashDistance`, projectile speeds

---

## Milestone 6: Bosses

**Build**
1. Smoke Veil (enter animation, seal, permanent removal on kill), boss bar with a trailing damage segment and a name plate.
2. **The Tollwarden** mini-boss: 4 moves, with the delayed thrust as the timing check.
3. **The Chandler**, a two-phase boss:
   - Phase transition roar.
   - Phase 2 adds moves and a new rhythm: flame volley, leap slam, extended combo.
   - The wax slow zone.
4. Boss persistence in the save, FLAME QUELLED on kill, and the boss arena death-marker rule.

**What you test:** whether each boss is learnable in a few attempts; that every attack feels avoidable; whether phase 2 feels distinct.

**Key knobs:** `bosses/*.json` (move weights, windups, `phase2Threshold`, combo chains).

---

## Milestone 7: Progression, polish, sound

**Build**
1. Shrine level-up menu (Vit, End, Str, Dex), cost curve, stat scaling on damage, stamina, HP and reload speed, soft caps.
2. HUD polish, the pause menu (equipment, inventory, key rebinding with conflict detection, settings), and device-aware button glyphs.
3. The full synthesised SFX set with file-override support, and volume settings.
4. Juice pass:
   - landing squash, footstep dust
   - casing bounce, stronger parry and riposte feedback
   - screenshake setting
5. Fast travel between discovered shrines, if time allows. Otherwise it moves to a later milestone along with the smith.

**What you test:** whether levelling feels meaningful after 3–5 levels; the menus with gamepad only; that rebinding persists.

**Key knobs:** `progression.json` (cost curve, per-stat gains, soft caps), weapon `scaling`.

---

## Roadmap after Milestone 7 (proposed; reorder or cut freely)

### Milestone 8: Smith and gear depth
- Smith NPC at a shrine hub. Weapon upgrade levels +1…+5 using found materials (Tallow Ingots, Ember Salts), with data-driven cost tables.
- **Armour** (head/body) with defence, poise and weight. **Equip load** changes roll feel: light rolls far, heavy rolls short and slow. Everything lives in `data/`.
- Rings/charms, 2 slots, small passive effects: +stamina regen, a longer parry window, backstab heal.
- Fast travel between lit shrines (if not already done in M7).

### Milestone 9: Second area, *The Sunken Foundry*
- A new tileset (gen-art variant), 10–14 rooms and 2 shrines, connected back to the Abbey by a lift or shortcut.
- 3 new archetypes that test new skills:
  - a shield-bashing charger (bait, then roll behind it)
  - a mortar crew (area-denial markers)
  - an ambusher that hides in pots (breaking props becomes risky)
- 1 new boss, with an arena hazard such as molten channels that pulse.
- Environmental hazards: pits (fall damage plus respawn at the edge), traps triggered by pressure plates.

### Milestone 10: NPCs, lore and secrets
- A simple dialogue system (data-driven lines, choices limited to "talk / leave").
- 2–3 NPCs with small questlines that change the world state (a merchant who moves to the shrine, a rival who can be summoned or invaded).
- A merchant shop: ammo, phial shards, consumables (firebombs, throwing knives, warding incense).
- Item descriptions with lore, illusory walls (hit to reveal), hidden items.

### Milestone 11: Feel and presentation polish
- A real art and audio drop-in pass using ASSETS.md; music per area and a boss theme with a phase-2 layer.
- Controller rumble, better aim assist, and a lock-on toggle option for gamepad.
- Accessibility: screenshake %, flash reduction, colour-blind-safe telegraph palette, hold-vs-toggle options, a UI scale of 1× or 2× HUD.
- Title screen, credits, settings menu, save slots (3).

### Milestone 12: Replayability
- **New Game+**: enemy stats scale, and a few extra enemy placements.
- Challenge options: no-phial run, hardcore (one death wipes the save).
- A stats screen at the end: deaths, time, bosses and most-killed-by.

### Ideas parking lot (not scheduled)
- Magic-like "rites" using a candle resource (a short-range flame burst, a smoke-veil dodge).
- Two-handing toggle for one-handed weapons (more damage, no shield).
- Weapon special arts on heavy + block.
- Co-op or online play: very expensive, and not recommended for this scope.
- A procedural "trial crypt" side mode for combat practice.
