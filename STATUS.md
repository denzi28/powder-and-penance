# Powder & Penance: project status and handoff

Read this first in a new session (local or cloud). It says where the project stands, how it's built, and what comes next. Keep it up to date when a milestone lands.

Repo: https://github.com/denzi28/powder-and-penance (branch `main`)
Game: top-down pixel-art action game. Enter the Gungeon look and camera, Dark Souls combat (stamina, rolls, parry, riposte, bosses, shrines, lose your currency on death).
Stack: Phaser 3 + TypeScript + Vite. Zod-validated data files, Vitest tests.

## How the project works
- **Everything is data-driven.** Tuning lives in `data/` (enemies, weapons, rooms, scripts, npcs, sfx, config/*.json). The game hot-reloads data, and `src/data/config.ts` checks every reference when it loads.
- **Fixed 60 Hz simulation.** GameScene owns the sim; feature logic lives in `src/game/*`; the UI lives in UIScene.
- **Rooms** are JSON in `data/rooms/`. Each area is one world grid built from its rooms. `tools/level-gen/*.mjs` were one-shot generators, and the JSON files are now the source of truth (re-running a generator overwrites hand edits).
- **Art is procedurally generated placeholder art:** `npm run gen:art` (`tools/gen-art.ts`) only writes missing files, and `--force` regenerates all of them. [ASSETS.md](ASSETS.md) is the art spec.
- **Docs:**
  - [DESIGN.md](DESIGN.md): design
  - [PLAN.md](PLAN.md): milestones
  - [WORLD.md](WORLD.md): every room of Act 1
  - [STORY.md](STORY.md): story, NPCs, script-writing guide
  - [ASSETS.md](ASSETS.md): every sprite sheet
  - [README.md](README.md): controls, debug keys, what's in each area
- **Commands:** `npm run dev`, `npm test`, `npm run typecheck`, `npm run gen:art`.
- **Debug:** press ` to open the debug menu. BOSSES... teleports to any boss door (and revives beaten bosses). You can also teleport to any room and edit world flags. F1 overlay, F2 god mode, F4 kill all, F5 slow/freeze, F6 step one tick.
- **Git identity** isn't set globally on the dev machine. Commit with `git -c user.name="Powder & Penance dev" -c user.email="recepdeniz2005@gmail.com" commit ...`.
- **Testing in a hidden or background browser tab:** the animation frame loop gets throttled. Step the game by hand (`window.__game` in dev builds; `game.step(...)`, or the game scene's `tick()`).

## How the owner likes to work
- Build whole biomes/areas at once, then discuss additions.
- The owner playtests and reports bugs. Balance (boss damage, HP) is deferred to a later balance pass the owner does.
- Small UI text, so the game stays visible.
- Items must be explained plainly (e.g. "phial drinks 3 -> 4"), with the flavour text below.
- Bosses: the intro happens in-fight (no cutscene), with the name and health bar at the bottom. Every boss has regretful last words, and a shrine appears after every boss.
- Dialogue is Undertale-style: typewriter text with a per-letter voice blip (bosses low-pitched, NPCs high-pitched).
- When the owner asks a question ("just answer"), answer without coding.

## Milestones done
1. **M1 Foundation:** movement, roll with i-frames, camera, stamina, tile collision (walls block their full visual footprint, including the cap row above brick faces).
2. **M2 Melee combat + first enemy (Wickling):** light/heavy/charge attacks, poise and stagger, hitstop, telegraphs, perception/stealth (vision cones, suspicious/notice states).
3. **M3 Ranged, loadout, shield, criticals:** revolver, flintlock, heavy crossbow, sword, dagger, greataxe, buckler. Block/parry/riposte/backstab, two-handed weapons, dropping and picking up weapons.
4. **M4 Healing, shrines, saving, death loop:** Mending Phials, shrines (rest, respawn, world reset), save system, Tallow currency dropped on death as a Guttered Candle you can recover.
5. **M4.5 Improvement pass:** A* pathfinding, hit feedback (flinch, damage trail, directional vignette), camera clamped to rooms.
6. **M5 Full roster + the Guttering Abbey:** Bulwark Warden (guard break), Powder Acolyte (lobbed firepots), Taper Hound, Belfry Brute (grab). Doors, one-way shortcut gate, breakable props with loot, debug teleport and flag editor.
7. **M6 Bosses (all built):**
   - **Tollwarden** (mini-boss, Abbey Gatehouse): drops the Toll Key.
   - **Mother Tallow** (Tallow Works), 2 phases: she dies, a half-buried chest rises with the Igniter, you burn her remains, and her skeleton rises (faster; summons wax slimes and shelters in a bubble). Drops the Seal of Tallow.
   - **Mire Matron** (Waxmire): drops the Seal of the Mire.
   - **The Chandler** (Abbey Nave, Act 1 final boss), 2 phases:
     - Phase 1, the priest: snuffer sweeps, Extinguish (unblockable bell slam), taper volley, censer smoke (vanishes and reappears behind you).
     - At 0 HP he doesn't die. He walks to the altar and pours himself onto the fire (`boss.turn`).
     - Phase 2, "the Last Candle": 5-hit combo, leap slam with a black-flame ring, lobbed flame volley, wax flood (slowing pools, `strike.pools`).
     - His last words ("Something up there is drinking it"), the lift wakes, the END OF ACT ONE title card, and the Nave Wick shrine appears. The lift to Act 2 stays sealed (opens with story flag `act2`).
   - Boss system: arena smoke seals (they wake only 2+ tiles past the doorway), the boss bar, a shrine after each boss, Tallow drops at the arena door when you die inside, bosses stay dead (`boss:<kind>`).
8. **Act 1 world built:** Penance Road (5 rooms), Wick's Rest hub (3), Guttering Abbey (14 incl. side chapel), Tallow Works (10), Waxmire (10). The Nave's great door needs BOTH Seals.
9. **Systems built along the way:**
   - Per-area tilesets and floor variants; decor (solid, and tall that blocks sight); chests with an open animation (you keep control).
   - Area exits with fades and name banners; levers; secret breakable walls; lifts/shortcuts.
   - Slow wax floors, ambushers that rise from wax, lanterns with visible light cones, splitting enemies, summons.
   - Minimap plus a large map (M).
   - Slain enemies stay dead until you rest.
   - Quick travel between lit shrines (TRAVEL in the shrine menu, with a warp effect).
10. **Story system** (`src/story/Story.ts`, `data/scripts/*.json`):
    - Script steps: `say` (with `who`), `menu` choices, `if`/`set`/`clear` flags, `wait`, camera pans, fades, `sfx`, shake, `give` item, `toast`, `card` (title card).
    - Cutscene triggers, NPCs with portraits.
    - Per-character voices in `data/npcs.json` (pitch, sound, every N letters).
11. **Story content done:**
    - Oskar (wagon wreck; the cage key)
    - Sister Maudlin (hub shrine keeper)
    - Pip (Waxmire, then the hub)
    - The Rendering Hall reveal
    - The Chandler's Ledger
    - Every boss's last words
    - The Act 1 ending

## Most recent work
- **Pixel-art pass started** (`tools/gen-art.ts`; regenerate single sheets with `npm run gen:art -- --only=tiles,player_body`):
  - The player: a tall pointed penitent's hood, a shoulder mantle over the cloak, a bandolier with brass powder charges, a lit lantern, folds and a ragged hem, and a stitched flame on the back. Shaded with light from the top left.
  - The Abbey tileset: calmer, darker flagstones (plain slabs mostly; cracks, wax spills and grave slabs are rare), moss that grows out of the joints, ashlar walls with a lit lip (plus broken blocks, candle niches and wax runs), wall tops with a pale coping stone.
  - Engine: optional `shade` tiles (a soft shadow on the floor along walls) and `glow` tiles (candle niches cast a flickering warm light, `light_glow`). See ASSETS.md § tiles.
  - The other tilesets: Penance Road and Wick's Rest (soil, grass tufts, forest brush, earth cliffs with grass lips and hung lanterns, packed roads, planks), the Tallow Works (soot flagstones, iron grates glowing from below, running-bond soot brick with pipes and furnace vents, riveted iron tops), the Waxmire (wet mud, swamp grass, rippling black water, root banks with candle offerings, wrinkled wax pools).
  - Enemies redrawn with shaded material ramps (same poses, anchors and frames): Wickling (a wax face in a brown cowl, drips, rope belt), Bulwark Warden (plate with a red plume, gilt-trimmed tabard, planked tower shield with the Abbey's flame), Powder Acolyte (scorched robe, painted porcelain mask, clay pot bandolier), Taper Hound (fur sheen, ribs, wax running off its taper), Belfry Brute (banded bronze bell with verdigris, rope-bound arms, apron straps), Renderer (greasy apron, mouth-cloth, spare hook), Vat Crawler / Vat Spawn / wax slimes (glossy wax with half-rendered bones inside), Drowned Pilgrim (sodden, teal-tinged robe, wax running off the hood), Mire Lantern (iron cage filled with cold light).
  - Engine: optional `fringe_<variant>` tiles give floor kinds soft, ragged edges (grass frays onto dirt, wax pools spread a rounded lip). This fixes the square-edged wax pools.
- Dialogue voice blips per speaker.
- The Chandler finale, as above.
- Fixed: enemy thrown attacks ignored `count`/`spreadDeg` (always threw 1). Mother Tallow now really spits 3 globs and her bones 5 embers, so those fights got harder.
- Fixed: the player got stuck in the Nave doorway. The arena sealed while the player stood on the tile next to the seal, which then became solid. Arenas now wake only 2+ tiles away from every seal (`src/game/arenaWake.ts`); a test covers all arenas.

## Remaining for Act 1
- **Pixel-art beauty pass** ← in progress. Done: the player, all four tilesets and the regular enemies. Still procedural placeholder: bosses, weapons, decor, portraits, death frames. The Chandler, the Last Candle and the Nave decor are the roughest.
- **Brother Aldous** (Abbey Scriptorium): give him Bitter Salt and he fights beside you against the Chandler (needs an ally AI). Otherwise you meet him later as a Wickling in the Nave Approach.
- **Sister Maudlin's forgive/condemn choice** (after the Chandler's ledger). Forgive: she stays and helps in Act 2. Condemn: she leaves and her shrine goes cold.
- **Progression:** level up at Maudlin with Tallow (Vit/End/Str/Dex, cost curve, stat scaling).
- **Oskar's shop** at the hub.
- **Powder Vault** (optional area behind a hidden wall in the Works; boss: Master Gunner).
- **Balance pass** (done by the owner after playtesting): boss HP and damage, enemy numbers.

## Later roadmap (from PLAN.md, proposed)
- **M8:** smith, weapon upgrades, armour and equip load, rings.
- **M9:** a second area.
- **M10:** more NPC questlines, merchant, lore, illusory walls.
- **M11:** real art and audio, music, accessibility options, settings, save slots.
- **M12:** NG+, challenge modes, end-of-run stats.
- **Act 2:** the Cathedral (up the Nave lift). The "something drinking the Wick" mystery; Pip's payoff.

## What to do next (suggested order)
1. **Pixel-art pass.** Start with what's on screen most: the player, then the Abbey tileset, then enemies, then bosses. Work in `tools/gen-art.ts`, or drop real hand-made art into `assets/sprites/` following ASSETS.md (gen:art never overwrites existing files without `--force`).
2. Playtest Act 1 end to end. Fix bugs, then do the balance pass.
3. Progression (level-up at Maudlin), since Tallow currently has nothing to spend on.
4. Maudlin's forgive/condemn choice, then Brother Aldous.
5. Oskar's shop, then the optional Powder Vault.
