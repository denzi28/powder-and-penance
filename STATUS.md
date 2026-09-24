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
  - Bosses resprited and re-animated: the Tollwarden (brass toll bell on his barbute, coin purse, gilt coat), Mother Tallow (smock over a wax bell that runs out in a ragged curtain, a crown of lit wicks, glowing throat when she spits), her Bones (two-tone bones, a ribcage full of embers), the Mire Matron (veil and wimple, wax tears, a swaddled bundle in a sling), the Chandler (embroidered vestments, a swinging censer), the Last Candle (wax lit from inside, cracks with hot lips). Their weapon arms now move: per-frame, per-direction `hands` in the manifests make the halberd, ladle and snuffer rise overhead in slam windups, haul back before sweeps and drive forward in thrusts. Idles have 4 frames (breathing, flame flicker).
  - Boss moves: the Tollwarden gained **Toll** (a spread of 5 coins at range, `toll_coin`), Mother Tallow gained **Spill** (her ladle tipped out: 3 slowing wax pools around the player), and the Matron's wail got its own animation (`wail`) so it no longer looks like her lullaby. Their numbers are first guesses for the balance pass.
  - Fixed: wax slimes were recoloured by exact palette matches, so the shaded crawler art left them pale; they are molten orange again.
  - Scenery redrawn: every decor sheet (road, hub, works, mire, nave), the breakable props, the shrine, chests and doors, with shading, a soft contact shadow under each object, and story details (a bolt in the dead horse, a skeleton in the gibbet, a wanted poster of you on the hub notice board, name tags on the Works robes, the Chandler's ledger on the foreman's desk).
  - The Abbey's rooms were bare: new `decor_abbey` sheet (17 pieces) placed room by room: saints and banners at the Porch doors, a dry mossy fountain in the Courtyard, an altar in the side chapel, the fallen bell in the Bell Passage, sarcophagi on the Crypt Stair, skull shelves and bone piles in the Ossuary, desks, shelves and scrolls in the Scriptorium, barrels and sacks in the Undercroft, statues at the great door.
  - Ivy: walls with moss at their foot grow ivy (`wall_front_floor_moss`, engine: wall faces by nearby floor), and the odd wall elsewhere; the road's ruined pillar and the hub's ruined wall are overgrown too.
  - Wick's Rest comes alive: the yard is laid out in quarters (shrine and ruins, market, camp and well, fire circle) with new pieces (log seats, woodpile and chopping block, laundry line, trestle table, water barrel). New townsfolk with routines: Tomas the lamplighter (directions based on progress), Hedda the water-carrier (points at unfound secrets), Bede the woodcutter (a gift), Old Agnes praying at the shrine; Maudlin tends the shrine, Oskar counts his takings, Pip sits by the fire. They chat with each other in speech bubbles (`data/chatter.json`), following the story. Engine: NPC routines and poses (`src/story/Npcs.ts`), chatter (`src/story/Chatter.ts`), 12-frame townsfolk sheets; see STORY.md.
  - Wick's Rest is wider (44x34, was 34x23) so the townsfolk have room: a west pilgrims' camp (Ulla keeps the fire, Jost sits by it), a fenced graveyard in the south-west where Agnes goes to kneel, a drying yard in the south-east where Hedda hangs the washing, and lanterns along the south road that Tomas lights on his rounds. New chats between the camp and the rest of the yard.
  - The biomes come alive (`data/ambience.json`, `src/world/Ambience.ts`): candles, lamps, fires and furnaces glow and flicker, fires smoke and spark, vats steam, moths circle lamps; ash and leaves blow over the road, fireflies and mist hang over the Mire, soot falls in the Works, dust hangs in the Abbey and wax drips from its ceilings; wax and grease bubble. Critters flee from you: crows fly off, rats slip into cracks, frogs hop away, a cat keeps its distance in the hub, bats flit through the Abbey's dark rooms. Keepers in the safe rooms, with routines and muttered lines: Brother Lome (Hill of Candles), Wenna (Drowned Chapel), Fennick (Foreman's Office), Brother Cuthwin and Old Hobb (Abbey Porch). Chat bubbles now stay on screen.
  - Ambient sound per biome (`data/audio/ambient.json`, `src/audio/Ambient.ts`, all synthesised): wind, crows, owls and a creaking gibbet on the road; crickets and a crackling campfire in the hub; frogs, bubbles, a low drone and faint humming over the Mire; machine hum, clanks, steam, chains and echoing drips in the Works; hollow wind, echoing drips, a humming choir and the great bell in the Abbey. The bell, choir and humming fall silent after their bosses. Critters make sounds as they flee.
  - Footsteps by surface (dirt, grass, stone, boards, iron grates, mud, grease, wax, moss), echoing in crypts, chapels, the nave and other enclosed rooms. Wren the harper sits by the hub's south road and plays a slow harp air, heard across the yard; she wanders over to the fire to chat with Pip and Tomas.
  - Boss music for every fight (`data/audio/music.json`, `src/audio/Music.ts`): a theme per phase that builds from the entrance to the fight to below half health, holds between phases, and ends on a closing chord when the last phase falls; it fades if you die. Themes are fast (138-188 bpm) with builds, a silent gap and drops.
  - Exploration music for every biome, Dark Souls quiet: slow, soft phrases with long silences between them, crossfading between areas, giving way to boss fights, ducking under Wren's harp.
  - Boss attack sounds: every boss move has its own layered sound. There's a wind-up tell (a grunt, chain, breath, hum, bone rattle or chant) and the swing or impact (bell-hammer tolls, ladle crashes in wax, bone rattles, black-flame roars), plus a roar for each boss and their own footsteps.
  - Regular enemy sounds: each of the 11 kinds has its own wind-up tells, attacks, footsteps, and a cry when it spots you, when it's hurt and as it dies (drowned pilgrims also moan as they rise out of the water).
  - Engine: optional `fringe_<variant>` tiles give floor kinds soft, ragged edges (grass frays onto dirt, wax pools spread a rounded lip). This fixes the square-edged wax pools.
- Dialogue voice blips per speaker.
- The Chandler finale, as above.
- Fixed: enemy thrown attacks ignored `count`/`spreadDeg` (always threw 1). Mother Tallow now really spits 3 globs and her bones 5 embers, so those fights got harder.
- Fixed: the player got stuck in the Nave doorway. The arena sealed while the player stood on the tile next to the seal, which then became solid. Arenas now wake only 2+ tiles away from every seal (`src/game/arenaWake.ts`); a test covers all arenas.

## Remaining for Act 1
- **Pixel-art beauty pass** ← in progress. Done: the player, all four tilesets, the regular enemies and the bosses. Still procedural placeholder: portraits (the four new townsfolk have simple ones), most weapons, regular enemies' death frames, the lever and weapon racks. The Chandler, the Last Candle and the Nave decor are the roughest.
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
