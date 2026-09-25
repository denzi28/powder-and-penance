# ASSETS.md — Sprite sheets and animation spec

This spec lets you replace any placeholder PNG with real art without touching code or gameplay data.

- Every sprite lives in `assets/sprites/` as a pair of files:
  - `<name>.png`: the sheet
  - `<name>.anim.json`: its manifest
- The manifest describes where each frame is, where the pivot is, and which cosmetic events fire.
- **Gameplay timing is not stored here.** Roll length, i-frames, attack windup and so on live in `data/`. Animations are time-stretched to fit that timing (see *Phases*).

The placeholders come from `npm run gen:art`. That script **never overwrites existing files** unless you pass `--force`, so your replacements are safe.

---

## 1. Conventions

| Rule | Value |
|---|---|
| Resolution | The game renders at 480×270. One sheet pixel = one screen pixel. |
| Tiles | 16×16 |
| Characters | ~16×24 visible, on a **32×32 cell**. Brutes use 48×48, bosses 64×64. |
| Pivot | The ground point between the feet. The player's is (16, 28): x must be the **horizontal centre of the cell**, so mirroring works. |
| Palette | `data/palette.json`, 25 colours. Stay close to it for consistency. It isn't enforced. |
| Outline | 1px dark outline (`ink`) around characters, weapons and props |
| Transparency | Real alpha. The shadow sprite uses partial alpha. |
| Time unit | **ticks**, 1 tick = 1/60 s |

### Sheet layout
- Frames sit on a grid of `cell` size, left to right, then top to bottom.
- The number of columns is `image width / cell width`, so sheets can be any width.
- Each animation starts at a `row`. It takes **one row per authored direction**, in the order listed in `dirs`.
- Frames go left to right in that row. A frame can point at another column with `col`.

### Directions and mirroring
- Directions are `E SE S SW W NW N NE`.
- Author only what you need. Missing directions are shown by mirroring horizontally (W ← E, SW ← SE, NW ← NE) or, failing that, by using the nearest authored direction.
- **Torso and single-layer characters:** author `S, SE, E, NE, N` (5 rows). W, SW and NW are mirrored.
- **Legs:** author `S, E, N` (3 rows). W is mirrored. Diagonals use the nearest cardinal direction.

---

## 2. Manifest format (`*.anim.json`)

```jsonc
{
  "image": "player_body.png",       // file next to the manifest
  "cell": [32, 32],                  // frame size in px
  "pivot": [16, 28],                 // origin inside a cell (feet for characters, grip for weapons)
  "layer": "torso",                  // legs | torso | single | weapon | fx | ui | tiles
  "handAnchors": {                   // torso only: weapon hand, relative to the pivot, per authored dir
    "S": [4, -11], "SE": [4, -12], "E": [2, -12], "NE": [3, -13], "N": [3, -13]
  },
  "points": { "muzzle": [13, 2] },   // named points in cell px (weapons: tip, muzzle, ...)
  "animations": {
    "roll": {
      "row": 5,                      // first row of this animation
      "dirs": ["S", "SE", "E", "NE", "N"],
      "loop": false,
      "frames": [
        { "ticks": 3, "phase": "roll" },
        { "ticks": 4, "phase": "roll", "events": ["dust"] },
        { "ticks": 5, "phase": "recover", "hurtbox": { "x": -5, "y": -10, "w": 10, "h": 10 } }
      ]
    }
  }
}
```

### Frame fields
| Field | Meaning |
|---|---|
| `ticks` | Authored display duration. Used as-is for non-phased animations (idle, walk). For phased ones it sets the relative length of each frame. |
| `phase` | The gameplay phase this frame belongs to. See below. |
| `events` | Cosmetic events fired when the frame starts (list below) |
| `col` | Use a different column than the frame's position (reuse frames) |
| `hand` | Override the hand anchor (relative to pivot) for this frame, e.g. during a swing |
| `hands` | The same per direction: `{ "S": [x, y], "SE": ..., ... }`. Wins over `hand`. The bosses use it so the weapon follows the arm (raised overhead in a slam windup, hauled back before a sweep). |
| `torsoDy` | Legs layer only: vertical offset applied to the torso this frame (walk bob) |
| `hurtbox` | Override the body hurtbox for this frame, relative to the pivot (e.g. smaller mid-roll). Used from M2. |

### Phases (how art fits gameplay timing)
- Gameplay code starts an animation with target lengths per phase, for example roll = `{roll: travelTicks, recover: totalTicks − travelTicks}` from `data/config/roll.json`.
- All frames tagged with a phase are stretched or squeezed in proportion, so the phase lasts exactly that many ticks.
- So you can draw a 5-frame roll or a 12-frame roll and it will always take the same 20 ticks. Designers tune the timing and artists draw the look.

| Animation | Phases | Driven by |
|---|---|---|
| `roll` | `roll`, `recover` | `data/config/roll.json` |
| `attack` | `windup`, `active`, `recovery` | each strike in `data/weapons/*.json` / `data/enemies/*.json` |
| heal (M4) | `drink`, `recover` | `data/config/phial.json` |

### Cosmetic events
Events only trigger presentation (dust, sound, particles). Gameplay never depends on them.

| Event | Effect |
|---|---|
| `footstep` | Footstep sound (M7), plus a dust puff when sprinting (`juice.dust.footstep`) |
| `dust` | Dust puff at the feet |
| `sfx:<id>` | Play a sound (M2+) |
| `glint` | Telegraph glint on the weapon (enemies, M2) |
| `muzzle`, `shellEject` | Gun effects (M3) |

---

## 3. Current sheets

### `player_legs` (legs layer, 32×32, pivot 16,28)
| Animation | Row | Dirs | Frames | Notes |
|---|---|---|---|---|
| `idle` | 0 | S E N | 1 × 60t | |
| `walk` | 3 | S E N | 4 × 6t | `torsoDy` 0/−1/0/−1, `footstep` on frames 0 and 2. Playback speed scales with move speed (`player.legs.walkAnimSpeedAt`) and runs backwards when backpedalling. |

Draw the legs and boots in roughly rows 21–27 of the cell. The torso layer covers everything above.

### `player_body` (torso layer, 32×32, pivot 16,28)
| Animation | Row | Dirs | Frames | Notes |
|---|---|---|---|---|
| `idle` | 0 | S SE E NE N | 2 × 36t | Breathing. Also used while walking; the legs supply the bob. |
| `roll` | 5 | S SE E NE N | 7 frames: 5 `roll` + 2 `recover` | **Full body.** The legs layer and weapon are hidden during the roll. The direction is the roll direction, not the aim. |
| `attack` | 10 | S SE E NE N | 6 frames: 2 `windup`, 2 `active`, 2 `recovery` | Swings. The weapon sprite does the swinging (see *Weapon motion*). Faces the attack direction. The last windup frame is held while a heavy charges. |
| `thrust` | 31 | S SE E NE N | 6 frames, same phases | Used automatically for thrusts (strikes whose sweep has `fromDeg == toDeg`) and for criticals |
| `stagger` | 15 | S SE E NE N | 3 | Flinch, snap back, settle. Legs stay visible. |
| `death` | 20 | S | 5 | **Full body** collapse. Legs and weapon are hidden. |

| `kneel` | 21 | S SE E NE N | 1 | **Full body.** Resting or kindling at a shrine. |
| `drink` | 26 | S SE E NE N | 3 phased: `raise` / `drink` / `lower` | The phial is drawn in the off hand and at the mouth on the `drink` frame. Timing comes from `data/config/phial.json`. |

`handAnchors` must match where the weapon hand is drawn in each direction.

### Shrines and resources (M4)
| Sheet | Cell | Pivot | Animations |
|---|---|---|---|
| `shrine` | 24×44 | 12,42 | `unlit` (col 0), `lit` (cols 1–3, flame flicker) |
| `guttered` | 12×14 | 6,12 | `flicker`: the death-marker candle with a pale flame |
| `item_glint` | 9×9 | 4,6 | `shine`: twinkle marking a pickup |
| `phial_icon` | 8×10 | 0,0 | HUD icon. Frame 0 = full, frame 1 = spent. |
| `tallow_icon` | 8×9 | 0,0 | HUD icon |

### `wickling` (enemy, single layer, 32×32, pivot 16,28, 7 columns)
| Animation | Row | Dirs | Frames |
|---|---|---|---|
| `idle` | 0 | S SE E NE N | 2 (candle flicker) |
| `walk` | 5 | S SE E NE N | 4, `footstep` on 1 and 3. Playback speed scales with move speed. |
| `overhead` | 10 | S SE E NE N | 7 phased: 3 `windup` (rears back; the last is the held "tense" pose), 2 `active`, 2 `recovery` |
| `swipe` | 15 | S SE E NE N | 7 phased (twists to one side, whips across) |
| `shove` | 20 | S SE E NE N | 7 phased (crouches, springs forward) |
| `attack` | 10 | S SE E NE N | Alias of `overhead`, used by strikes without an `anim` |
| `stagger` | 25 | S SE E NE N | 3 |
| `death` | 30 | S | 5 (melts into a puddle) |

**Per-attack animations:** a strike in `data/enemies/*.json` (or `data/weapons/*.json`) can name its body animation with `"anim"`. Give every enemy attack its own windup silhouette: the pose is the real telegraph, and the glint only confirms it.

Enemies hold their weapon like the player does: `handAnchors` in the body manifest, plus a separate weapon sheet (`cleaver`, pivot = grip, drawn pointing right, `points.tip` for the telegraph glint).

### `dummy` (single layer, 32×32, S only)
`idle` (1 frame) and `hit` (4 frames of wobble, using `col` to reuse 3 drawings).

### Combat FX
| Sheet | Cell | Pivot | Animations | Notes |
|---|---|---|---|---|
| `slash` | 48×48 | 24,24 (the attacker) | `swing`, `thrust` | Drawn pointing right with a 22 px radius. It is rotated to the attack direction, scaled to the strike's hitbox radius, and mirrored for reverse swings. |
| `glint` | 11×11 | 5,5 | `normal` (row 0), `danger` (row 1) | Telegraph star at the weapon tip. Also flashes when a heavy reaches full charge. |
| `exclaim` | 7×11 | 3,10 | none (static) | "Noticed you" pip above an enemy's head |

### Arsenal (M3)
| Sheet | Cell | Pivot (grip) | Points | Notes |
|---|---|---|---|---|
| `dagger` | 14×8 | 2,4 | tip | |
| `greataxe` | 31×17 | 5,8 | tip | Two-handed: the shield is hidden while it's equipped |
| `crossbow` | 21×15 | 5,7 | muzzle | Two-handed |
| `flintlock` | 20×10 | 3,5 | muzzle | |
| `buckler` | 11×11 | 5,5 | none | Off-hand. Drawn at the mirrored hand anchor, or pushed toward the aim while blocking. |
| `bullet`, `bolt`, `ball` | small | center-front | none | Projectiles drawn pointing right, rotated to their velocity, and flown 10 px above the ground plane |
| `muzzle` | 20×16 | 0,8 | none | Animations `small` (row 0) and `large` (row 1). The flame extends right from the pivot. |
| `rack` | 18×22 | 9,20 | none | Its weapon/shield is drawn on top at runtime |
| `sparring` + `stick` | 32×32 / 18×5 | feet / grip | none | S only, 3 columns: rest, wind back, swing through |
| `question` | 7×11 | 3,10 | none | "Suspicious" pip (the "!" pip is `exclaim`) |
| `warden_spear` | 29×7 | 6,3 | tip | Bulwark Warden's spear. The Warden's shield is part of its body sheet. |
| `bell_hammer` | 32×16 | 4,8 | tip (30,8) | Belfry Brute's weapon |
| `firepot` | 8×8 | 4,4 | none | Acolyte's lobbed pot. It tumbles in flight; the landing ring and shadow are drawn at runtime. |
| `blast` | 40×40 | 20,24 | none | `burst`: firepot explosion |
| `door` | 16×32 | 8,32 | none | Frame 0 = in a horizontal wall (face-on), frame 1 = in a vertical wall (seen from above). Hidden when open. |
| `prop_crate`, `prop_pot`, `prop_candles` | 16×16 | 8,14 | none | Frame 0 = intact, frame 1 = rubble |
| `loot` | 7×7 | 3,5 | none | Frame 0 = Tallow drop, frame 1 = powder drop |
| `knife` | 9×3 | 4,1 | none | A thrown Pilgrim's Knife in flight, pointing right |
| `note` | 10×7 | 5,4 | none | A lore note lying on the floor (it glints with `item_glint`) |
| `prop_keg` | 16×16 | 8,14 | none | Powder keg: frame 0 whole, frame 1 blown apart |
| `cannonball`, `spark` | 8×8, 5×5 | centre | none | The Gunner's cannonball; a Fuse-Runner's thrown spark |
| `blunderbuss` | 24×11 | 3,6 | muzzle (22,5) | The Gunner's (and then your) blunderbuss |
| `mule`, `runner` | 32×32 | 16,28 | none | Powder Mule (`idle`, `walk`, `shove`, `stagger`, `death`), Fuse-Runner (`idle`, `walk`, `throw`, `jab`, `stagger`, `death`) |
| `gunner_cannon` | 64×64 | 32,58 | none | The Master Gunner's cannon: `idle`, `walk` (rolling), `fire`, `lob`, `ram`, `intro`, `dismount` (his turn), `stagger`, `death` |
| `gunner` | 48×48 | 24,44 | hand anchors | The Master Gunner on foot: `idle`, `walk`, `shoot`, `club`, `toss`, `leap`, `intro`, `stagger`, `death` |
| `decor_vault` | 64×64 | 32,62 | none | 0 keg stack, 1 powder barrel, 2 cannonball pyramid, 3 practice target, 4 spilled powder, 5 rubble, 6 shot crate, 7 cannon rail |
| `prop_hive` | 24×32 | 12,29 | none | A straw hive on its post: frame 0 whole, frame 1 broken open |
| `prop_seal` | 16×16 | 8,16 | none | A Synod tallow seal set in a wall: frame 0 whole, frame 1 melting |
| `smoker`, `scythe`, `warden_scythe`, `comb_sceptre` | weapon layer | hand | none | The Smoker (yours and the Husks'), the Guards' scythe, the Warden's great scythe, the Queen's comb sceptre |
| `royal_jelly`, `bee_dart`, `crow_dart` | small | centre | none | The Queen's lobbed jelly; her sting darts; the Warden's crows |
| `husk`, `orchard_guard`, `honey_slime` | 32×32 | 16,28 | none | Beekeeper Husk (`idle`, `walk`, `puff`, `bash`, `stagger`), Orchard Guard (`dormant`: standing like a scarecrow, `rise`, `idle`, `walk`, `reap`, `stagger`), Honey Slime (`idle`, `walk`, `rise`, `engulf`, `stagger`) |
| `scarecrow_warden` | 48×48 | 24,44 | none | `dormant`, `rise`, `idle`, `walk`, `reap`, `spin`, `crows`, `leap`, `stagger` |
| `hive_queen` | 64×64 | 32,58 | none | `idle`, `walk`, `intro`, `sweep`, `thrust`, `spit`, `release`, `pour` (her turn), `stagger` |
| `queen_swarm` | 64×64 | 32,58 | none | The Swarm Unbound: `idle`, `walk`, `intro`, `dive`, `engulf`, `volley`, `stagger` |
| `npc_hild` | 32×32 | 16,28 | none | Hild, in her straw hat and veil pushed back (the 12-frame townsfolk layout) |
| `decor_bloom` | 64×64 | 32,62 | none | 0 apple tree in blossom, 1 in fruit, 2 burned tree, 3 wax press, 4 flower bed, 5 scarecrow, 6 skep bench, 7 lavender bush, 8 hive box, 9 Synod notice, 10 orchard gate, 11 honey barrels, 12 mead rack, 13 bee altar, 14 great skep, 15 charred stump, 16 honey cart, 17 comb frames, 18 bee saint, 19 fallen skep, 20 chapel pew, 21 votive stand, 22 hollyhocks, 23 ash heap |

### NPCs (`npc_oskar`, `npc_maudlin`, `npc_pip`: 32×32, pivot 16,28)
- Frames: 0–1 idle (breathing), 2–3 talking (mouth open, then closed).
- Drawn facing the viewer; the game mirrors them to turn toward the player. Skin is pale wax (`wax1`).

### `portraits` (48×48 per frame, ui)
- Dialogue-box portraits, painted by `tools/portraits.ts` (lit volumes, hue-shifted ramps, a warm rim light): 0 Oskar,
  1 Maudlin, 2 Pip, 3 the Tollwarden, 4 the Mire Matron, 5 the Chandler, 6 Tomas, 7 Hedda, 8 Bede, 9 Agnes, 10 Ulla,
  11 Jost, 12 Lome, 13 Wenna, 14 Fennick, 15 Cuthwin, 16 Hobb, 17 Wren, 18 the Master Gunner, 19 Hild, 20 the Hive Queen (Mother Aldith), 21 the Scarecrow Warden (`portrait` in data/npcs.json).
- `data/npcs.json` picks each character's frame.

### Bosses
| Sheet | Cell | Pivot | Notes |
|---|---|---|---|
| `tollwarden` | 48×48 | 24,44 | Animations: `idle`, `walk`, `sweep`, `thrust`, `slam`, `intro` (loop: rear back, slam on frame 3 = tick 20 of each 40, straighten), `stagger`, `death` (sinks to his knees and stays kneeling for his last words) |
| `toll_halberd` | 46×13 | 9,6 (grip) | tip (44,6) |
| `smoke_veil` | 16×32 | 8,32 | 4 looping frames of pale smoke in a sealed doorway |

| `mother_tallow` | 64×64 | 32,58 | `idle`, `walk`, `sweep`, `spit`, `crush`, `intro` (rises out of her vat's pool), `stagger`, `death` (sinks back into the wax) |
| `mother_ladle` | 48×16 | 8,8 (grip) | tip (46,8) |
| `mother_bones` | 64×64 | 32,58 | Phase 2. Animations: `idle`, `walk`, `sweep`, `jab`, `spit`, `leap`, `summon` (arms raised, wax gathering between the hands), `intro` (rising out of the fire), `stagger`, `death` (the bones come apart into a heap of dust) |
| `wax_slime` | 32×32 | 16,28 | Summoned molten wax: the Vat Crawler drawing, smaller and recoloured orange |
| `ember_glob` | 8×8 | 4,4 | Phase 2's burning lobbed globs |

The `chest` sheet has 10 frames: 0–4 as below, and 5–9 the same chest half-buried (for chests that rise out of the floor mid-fight).

Portrait frame 3 is the Tollwarden.

### The Waxmire
| Sheet | Cell | Notes |
|---|---|---|
| `tiles_mire` | 16×16 | Floors: `floor` (wet mud with a shine here and there), `floor_grass` (swamp grass), **`floor_wax`** (dull pale wax with a wrinkled skin: slows movement), `floor_stone` (sunken, greened flagstones). Earth banks with pale roots and hanging moss (one with lit candle offerings: `glow`); tangled root and reed tops; black water outside. Fringes: wax pools spread a rounded lip over the grass and mud; grass frays onto the mud. |
| `decor_mire` | 64×64, pivot 32,62 | 0 `gravestone`, 1 `grave_cross`, 2 `reeds` (tall: hide in them), 3 `root_tangle` (2 tiles, tall), 4 `stone_angel` (tall), 5 `coffin` (flat), 6 `drowned_candles` (flat), 7 `dead_willow` (tall), 8 `sunken_bell` |
| `drowned_pilgrim` | 32×32 | `idle`, `walk`, **`rise`** (up out of the wax, drawn cut off at the surface line), `claw`, `stagger`, `death` |
| `mire_lantern` | 32×32 | `idle` (bobbing), `walk`, `stagger`, `death` (the cage falls and breaks). Its light cone is drawn at runtime. |
| `mire_matron` | 64×64, pivot 32,58 | `idle`, `walk`, `sweep`, `embrace`, `sing` (arms open wide), `intro` (rises from her pool), `stagger`, `death` (lies back into the wax) |
| `mire_glob` | 8×8 | Her lobbed wax |

Portrait frame 4 is the Mire Matron.

### The Nave: the Chandler
| Sheet | Cell | Notes |
|---|---|---|
| `chandler` | 64×64, pivot 32,58 | The priest: cream chasuble with a gold orphrey over a red robe, red sleeves, a crown of lit tapers. `idle`, `walk`, `sweep`, `slam` (Extinguish), `jab`, `flick` (plucks a taper from his crown), `censer` (smoke swallows him), `intro` (kneeling at the altar, then rising), `pour` (loop: hands over the altar fire, wax running off them; the snuffer is laid down meanwhile), `stagger`, `death` (unused: he turns instead of falling) |
| `chandler_wick` | 64×64, pivot 32,58 | The Last Candle: a column of melting wax, flames up one flank, burnt rags at the hips, a melted face with one ember eye, a wick with a **black flame** (dark teardrop, pale rim). `idle`, `walk`, `sweep`, `jab`, `slam`, `leap`, `volley` (the flame swells), `flood` (arms wide; snuffer laid down), `intro` (rising out of the altar fire), `stagger`, `death` (melts into his pool; the flame goes out) |
| `chandler_snuffer`, `chandler_snuffer_lit` | 64×16, pivot 8,8 (grip) | Iron staff with a brass collar and the snuffer's bell; tip (58,8). The lit one burns with black flame (phase 2). |
| `taper_shot` | 12×6, pivot 6,3 | A flung lit taper, flame first (rotates with its flight) |
| `black_flame` | 8×10, pivot 4,6 | Phase 2's projectiles |
| `decor_nave` | 64×64, pivot 32,62 | 0 `great_altar` (3 tiles, its fire in an iron bowl), 1 `candelabrum`, 2 `pew` (2 tiles), 3 `pew_broken`, 4 `lift_gate` (iron bars over a dark shaft, set in a wall gap) |
| `decor_abbey` | 64×64, pivot 32,62 | 0 `saint_statue` (tall), 1 `stone_bench` (2 tiles), 2 `dry_fountain` (2), 3 `rubble` (flat), 4 `fallen_bell` (2), 5 `bell_rope` (hangs, no footprint), 6 `sarcophagus` (2), 7 `bone_pile` (tall), 8 `skull_shelf` (2, tall), 9 `bones` (flat), 10 `lectern`, 11 `writing_desk` (2), 12 `scroll_pile` (flat), 13 `barrels` (tall), 14 `sacks`, 15 `candle_stand`, 16 `banner` (hangs on the wall above, no footprint) |

Portrait frame 5 is the Chandler.

Spilled wax (`strike.pools`) is drawn at runtime, not from a sheet.

### Tallow Works
| Sheet | Cell | Notes |
|---|---|---|
| `tiles_works` | 16×16 | Floors: `floor` (soot-black flagstones; rare cracks, stains and drain covers), `floor_grate` (iron over the drains; one in five glows from the fires below: `glow`), `floor_grease` (spilled tallow: a flat sheen, never blob-shaped, so it can't be mistaken for a Vat Crawler), `floor_plank`. Soot brick in running bond under an iron band, with soot runs, pipes and furnace vents (`glow`); riveted iron wall tops; black slag rock. Fringe: grease seeps onto the stones around a spill. |
| `decor_works` | 64×64, pivot 32,62 | 0 `vat` (3 tiles, tall), 1 `hook_chain` (hangs, no footprint), 2 `cage`, 3 `tallow_stack` (tall), 4 `furnace` (tall), 5 `pipe` (tall), 6 `robe_rack`, 7 `desk`, 8 `lift_cage` (flat, anchor + east), 9 `chain_heap`, 10 `tallow_cart`, 11 `toll_booth` |
| `renderer` | 32×32 | Animations: `idle`, `walk`, `throw`, `swipe`, `stagger`, `death`. Weapon `renderer_hook` (40×9, a chain and hook; the throw's `reach` slides it out). |
| `vat_crawler`, `vat_spawn` | 32×32 | The same blob at two sizes: `idle`, `walk`, `engulf`, `stagger`, `death` |
| `wax_glob` | 8×8 | Mother Tallow's lobbed wax |
| `lever` | 16×24, pivot 8,23 | Frame 0 up, 1 pulled |
| `prop_cracked_wall` | 16×16, pivot 8,16 | Frame 0 = cracks drawn over a wall face, 1 = rubble |

### `chest` (20×18, pivot 10,16)
Frames: 0 closed; 1–3 opening (lid rising, light spilling out); 4 open and empty. The game picks the frame from the opening tick (`OPEN_TICKS` in `src/world/Pickups.ts`). The item pops out at `POP_TICK`. Closed chests show an occasional `item_glint` twinkle on the lid.

### Area tilesets
Each area picks its tileset in `data/areas.json`. Autotiling only reads the manifest's `tiles` block (§ tiles below), so each sheet can lay its tiles out however it likes. Floor variants are extra keys in the manifest's `tiles` block, used by room legends as `floor_<name>`; a variant a tileset lacks falls back to `floor`.

| Sheet | Area | Floor variants |
|---|---|---|
| `tiles` | abbey, test | `floor` (stone), `floor_moss` |
| `tiles_road` | road, hub | `floor` (dirt with clods and pebbles), `floor_grass` (tufts, the odd pale flower), `floor_road` (packed pale earth, no ruts, so it works running any way), `floor_plank` (boards with grain and nails), `floor_stone` (warm flagstones). Walls are earth cliffs under a grass lip (some with a hung lantern: `glow`); caps and rock are dark brush. Fringes: grass frays onto the ground beside it; the road's packed edge spreads into the dirt. |
| `tiles_orchard` | bloom | `floor` (orchard grass with clover and tufts), `floor_path` (worn earth), `floor_flowers` (poppies, daisies, cornflowers), `floor_lavender` (violet rows), `floor_honey` (a deep amber pool with slow ripples, glints, a drowned bee: slows), `floor_comb` (six-sided honey-stone paving), `floor_ash` (the burned grove), `floor_plank` (the press house), `floor_stone` (warm flagstones). Walls are dry-stone honey limestone under a flowering hedgerow (some with a lit beeswax niche: `glow`; charred faces over ash). Fringes: honey spreads a lip, flowers spill over, the path frays into the grass. |

### Decor (`decor_hub`: 64×64 cells, pivot 32,62)
Two-tile pieces cover the anchor tile and the one west of it; three-tile pieces cover one tile each side.

| Frame | Decor | Frame | Decor |
|---|---|---|---|
| 0 | `stall` (3 tiles) | 7 | `altar` (2) |
| 1 | `campfire` | 8 | `prayer_bench` (2) |
| 2 | `well` (tall) | 9 | `bedroll` (flat) |
| 3 | `tent` (2, tall) | 10 | `bookshelf` (2, tall) |
| 4 | `fence` | 11 | `ruin_wall` (3, tall) |
| 5 | `lantern_post` | 12 | `notice_board` |
| 6 | `hand_cart` (2) | | |

### Decor (`decor_road`: 64×48 cells, pivot 32,46 = ground centre)
Static scenery, referenced by `data/decor.json`, which picks a sheet and frame and lists which tiles each decor makes solid.

| Frame | Decor | Frame | Decor |
|---|---|---|---|
| 0 | `wagon` (overturned prison wagon) | 4 | `dead_tree` |
| 1 | `horse` (dead) | 5 | `wheel_debris` (flat) |
| 2 | `guard_dead` (flat) | 6 | `signpost` |
| 3 | `boulder` | 7 | `candle_cairn` |

### Icons (`icons`: 16×16 cells, one row; the inventory and equipment screens)
0 fists, 1 dagger, 2 straight sword, 3 greataxe, 4 revolver, 5 flintlock, 6 heavy crossbow, 7 buckler, 8 pilgrim's hood, 9 drowned veil, 10 gaoler's helm, 11 acolyte's robe, 12 renderer's apron, 13 warden's hauberk, 14 tallow lump, 15 powder pouch, 16 phial shard, 17 bitter salt, 18 cage key, 19 toll key, 20 igniter, 21 ledger, 22 seal of tallow, 23 seal of the mire, 24 mending phial, 25 empty slot. Consumables: 26 firebomb, 27 pilgrim's knife, 28 wild honeycomb, 29 grey salt crust, 30 warding incense, 31 paper cartridge, 32 chandler's oil, 33 stale wafer, 34 smoke pellet, 35 ringer's grog, 36 pilgrim's tallow candle. Rings: 37 band of steady breath, 38 parish signet, 39 cutpurse's band, 40 porter's knot, 41 miser's band, 42 ring of the last candle, 43 mourner's ring, 44 ring of the quiet step, 45 powder-maker's ring, 46 warden's ward. 47 lore note. Materials and shop rings: 48 tallow ingot, 49 ember salt, 50 hawker's ring, 51 gunner's band. The Powder Vault: 52 blunderbuss, 53 gunner's coat, 54 ring of the steady hand, 55 keg charge, 56 Oskar's strongbox. Bloomhollow: 57 smoker, 58 beekeeper's veil, 59 beekeeper's coat, 60 ring of the queen, 61 beeswax candle, 62 Hild's letter, 63 Maudlin's reply. Weapons, shields, armour, items, consumables and rings choose theirs with `icon`; a consumable dropped on the floor is drawn with its icon at 5/8 scale.

### Ambient life (`critters`: 16×16 cells, pivot 8,14, facing right) and `data/ambience.json`
The critters sheet holds small animals that wander rooms and flee from the player (`src/world/Ambience.ts`):
0-3 rat (idle, sniff, run a/b), 4-7 crow (idle, peck, fly a/b), 8-11 frog (sit, croak, hop a/b), 12-13 moth, 14-17 cat (sit, tail flick, walk a/b), 18-19 bat (wings up/down). Air effects include `petals` and `pollen` (Bloomhollow).

`data/ambience.json` brings the scenery to life. Nothing in it affects play.
- `decor.<kind>`: flame points in px from the decor anchor (`at`), plus optional `glow` (light scale), `flicker` (dancing flame tips, on by default), `smoke` / `embers` / `steam` (per second; `steamAt` for where steam rises) and `moths`.
- `areas.<area>`: `air` (`ash`, `dust`, `soot`, `fireflies`, `mist`, `leaves`, each with a `count` in view), `critters` (`kind`, `perRoom` [min, max], optional `on` floor kinds and `rooms`), `bubbles` (floor kinds that bubble) and `drips` (drops from the ceiling per second).

### Abbey enemies (single-layer sheets, dirs S SE E NE N)
| Sheet | Cell | Pivot | Animations |
|---|---|---|---|
| `warden` | 32×32 | 16,28 | `idle`, `walk`, `bash`, `thrust`, `overhead`, `stagger`, `death` |
| `acolyte` | 32×32 | 16,28 | `idle`, `walk`, `throw`, `shove`, `stagger`, `death` |
| `hound` | 32×32 | 16,28 | `idle`, `walk`, `lunge`, `bite`, `stagger`, `death` |
| `brute` | 48×48 | 24,44 | `idle`, `walk`, `slam`, `sweep`, `grab`, `stagger`, `death` |

Attack animations are phased (`windup` / `active` / `recovery`) and stretched to each strike's ticks. A strike picks its animation with `anim`.

Shell casings, gun smoke and wall sparks are pixel particles, not sprites.

### Weapon motion during attacks
- The weapon sprite's swing comes from **gameplay data**, not art: each strike's `sweep` (`fromDeg` → `toDeg`, plus `reach` for thrusts) in `data/weapons/*.json` and `data/enemies/*.json`.
- The windup eases from the rest angle to `fromDeg`, the active frames sweep to `toDeg`, and recovery returns to rest.
- Swings aimed into the left half are mirrored automatically.

### Weapons (`sword`, `revolver`; weapon layer, single frame)
- The pivot is the **grip**: the weapon rotates around it and sits on the torso's hand anchor.
- Draw the weapon **pointing right (east)**. It is rotated toward the aim and flipped vertically when aiming left.
- `points.muzzle` / `points.tip` are used from M3 for muzzle flash and projectile spawn.

### `shadow` (fx, 12×5, pivot 6,2)
A semi-transparent ellipse under every character. It is not scaled by squash and stretch.

### `dust` (fx, 10×10, pivot 5,8)
Animations: `puff` (roll start, 4 frames) and `step` (small, 3 frames using `col`).

### `crosshair` (ui, 13×13, pivot 6,6)

### `tiles` (16×16, 8 columns)
The manifest's `tiles` block maps tile kinds to sheet indices (index = row × 8 + column). **Repeating an index weights it**: the abbey floor lists its plain slabs many times so that cracks, wax spills and grave slabs stay rare finds.

| Kind | Abbey indices | Used for |
|---|---|---|
| `floor` | 0–7, 40–41 | Walkable floor (variants picked by a stable per-cell hash): plain slabs, split slabs, cobbles, a crack, a wax spill, a grave slab |
| `floor_moss` | 8–9, 42–44 | `,` in room files. Moss grows out of the joints in short runs, never along a whole edge, so the tile grid doesn't show. |
| `rock` | 10–11 | Solid dark mass filling everything outside rooms, so no black void is ever on screen |
| `wall_front` | 12–15 | Brick face of a wall with floor directly south of it: plain ashlar, a broken block, a **candle niche**, wax runs |
| `wall_cap` | 16–31 | Top of a wall. **Index = 16 + edge mask**, where the mask bits say which sides are open: N=1, E=2, S=4, W=8. Draw a rim on the open sides. |
| `shade` (optional) | 32–39 | Soft wall shadow drawn over the floor. **Index = 32 + mask** of the floor cell's closed sides: N=1, E=2, W=4 (32 itself is never drawn). Semi-transparent black. |
| `glow` (optional) | 14 | Tiles that give off light: each gets a flickering `light_glow` added on top (the candle niche). |
| `wall_front_<variant>` (optional) | 48–51 | Wall faces used instead of `wall_front` when that floor variant lies at the wall's foot (the cell below, either side of it, or two below). The abbey's `wall_front_floor_moss` grows ivy down the stone and moss up its foot. |
| `fringe_<variant>` (optional) | 16 each | Soft edge of a floor variant, drawn over the floor cells that border it. **Index = mask** of the sides where that variant is (N=1, E=2, S=4, W=8; mask 0 is never drawn). List the fringe sets top layer first: a variant spreads over the ones listed after it and over floors without a fringe, never over one listed before it. The abbey has none; see the other tilesets. |

**Lighting:** light comes from the top left. Edges facing up or left catch a highlight; edges facing down or right fall into shadow. `light_glow` (fx, 56×56, pivot at its centre) is stepped rings of warm colour with a thin dithered band between steps, drawn with additive blending.

**How walls are drawn (3/4 view):** level authors only place `#`. A wall with floor directly south gets a **front face** on its own cell and a **cap on the cell above**. If that cap lands on a floor cell (for example above a free-standing pillar or a thin wall), that cell becomes **solid**, so a wall blocks everything it visibly covers. The cap is still depth-sorted, so tall sprites standing further north (big enemies, bosses) are correctly hidden behind it.

---

## 4. Pixel font (`assets/fonts/pixel5x7.png`)
- 96×48 image: a 16×6 grid of 6×8 cells, each holding a 5×7 glyph at the top-left.
- Characters run in ASCII order from space (32) to `~` (126).
- Draw in **white**; the game tints it. Lowercase currently reuses the uppercase glyphs.
- Fine print (the message box, item descriptions) uses the same font on a screen-resolution overlay (`src/render/FineText.ts`), at 2/3 of the game's pixel scale, so it is smaller but still crisp.

---

## 5. Replacing art: checklist
1. Keep the same `cell` size and pivot, or update them in the `.anim.json`.
2. Keep the animation names. Rows, frame counts and per-frame `ticks` can change freely. Keep the **phase tags** on phased animations.
3. Weapons: point right, and set the pivot to the grip.
4. Save. The page reloads with the new art.
5. If something is wrong, the game shows a readable error naming the file and field instead of starting.
