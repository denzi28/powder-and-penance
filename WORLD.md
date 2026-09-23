# Powder & Penance: Act 1 world

The Act 1 map. Every room is listed with its job: what it teaches, who is in it, and what it connects to. Rooms are built one at a time and ticked off here. The story is in [STORY.md](STORY.md).

Target: **~2 h** first playthrough (2 h 15 min with the optional Powder Vault). **45 rooms**, 6 areas, 4 main bosses + 1 optional.

```
                        [Act 2: the Cathedral]
                                  ^ ending cutscene
                          [Abbey nave: Chandler]
                                  ^ sealed: needs both Seals
   (one-way shortcut) ---> [Guttering Abbey: Tollwarden]
          |                       ^
   [The Waxmire] <--open-- [Wick's Rest (hub)] --toll key--> [Tallow Works]
                                  ^                               | hidden wall
                           [Penance Road]                   [Powder Vault]
```

## Area overview

| Area | id | Rooms | Tileset | Boss | Time |
|---|---|---|---|---|---|
| Penance Road | `road` | 5 | Dirt road, grass, earth cliffs | none | 10 min |
| Wick's Rest (hub) | `hub` | 3 | Timber and earth | none | 5 min |
| The Guttering Abbey | `abbey` | 13 | Abbey stone (built) | Tollwarden (mini), Chandler (final) | 40 + 15 min |
| Tallow Works | `works` | 10 | Soot brick, iron, grease | Mother Tallow | 30 min |
| The Waxmire | `mire` | 10 | Mud, wax pools, dead roots | Mire Matron | 30 min |
| Powder Vault (optional) | `vault` | 4 | Cellar stone, powder kegs | Master Gunner | 15 min |

**Critical path:**
1. Penance Road
2. Hub
3. Abbey up to the Gatehouse: the Tollwarden drops the **Toll Key**.
4. Tallow Works and the Waxmire, in either order. Each boss drops a **Seal**. The Waxmire is open from the start but hard.
5. With both Seals, the Nave door opens: the **Chandler**, then the Act 1 ending.

**Shrines (7):**
- Hill Wick (road) ✅
- Wick's Rest (hub)
- Porch Wick (abbey)
- Chapterhouse Wick (abbey)
- Foreman's Wick (works)
- Drowned Wick (mire)
- Vault Wick (vault)

## Engine features Act 1 needs (built as their first room needs them)
| Feature | First needed in |
|---|---|
| Per-area tileset (`data/areas.json`) | road_01 ✅ |
| Named floor variants (`floor_dirt`, `floor_grass`...) | road_01 ✅ |
| `decor` entities: static scenery sprites, optionally solid: low (blocks movement and bullets) or tall (also blocks sight) | road_01 ✅, tall in road_03 ✅ |
| `weapon` entity: a weapon lying on the floor | road_01 ✅ |
| `exit` entity: walk into it to change area (fade out, arrive at a named `spawn`, fade in) | road_05 ✅ |
| Area name banner on entering an area | road_05 ✅ |
| Keyed doors (`requires`: a key item): Toll Key ✅, the two Seals later | hub_01 ✅ |
| Dialogue, NPCs, cutscenes (see STORY.md: "Writing dialogue and cutscenes") | ✅ road and hub |
| Slain enemies stay dead until you rest or die (`slain:` flags) | ✅ |
| Bosses: `ai: "boss"` + `boss` block (entrance, slams, line, last-words script), `arena` room entity (smoke seals), boss bar, stays dead (`boss:<kind>`), Tallow drops at the arena door | ✅ Tollwarden |
| Minimap and large map (M) | ✅ |
| Slow floors (wax pools, `data/terrain.json`), waders, ambushers (`ambush`), scanning lanterns with visible light cones (`scan`, `lightCone`) | mire ✅ |
| Secret breakable walls (prop with `secretWall`) | works_03 ✅ |
| Lift: an `exit` with a `when` condition, opened by a `lever` entity | works_04 ✅ |
| Hooks that pull (`pull` on a strike), enemies that split on death (`splitInto`), quest items | works ✅ |
| Shrines with a `when` condition (a boss's shrine appears when it falls) | ✅ |
| Quick travel between lit shrines (shrine menu, TRAVEL): dissolve into embers, fade, re-form | ✅ |
| Multi-phase bosses (`boss.next`: half-buried chest, item, use the remains), summons with a shield bubble (`summon` strike), bosses that crumble to dust (`boss.dust`) | ✅ Mother Tallow |

---

## Penance Road (`road`): prologue and tutorial
Dusk. A dirt road through a ravine toward the Abbey on its hill. It teaches the controls one at a time, then lets you use them together. It is strictly linear: going back only leads to the wreck.

| # | Room | Contents | Teaches |
|---|---|---|---|
| road_01 | **The Wreck** ✅ | Start. The prison wagon lies on its side; dead guards and a dead horse. A sword lies by one guard, a flintlock in the cart. Oskar is locked in the wagon cage (NPC comes with the story systems). *Cutscene: wagon crash (story systems).* | Move, aim, pick up a weapon (E) |
| road_02 | **The Cutting** ✅ | Narrow, winding road between cliffs. One Wickling stands on the road facing you. A dead guard who ran this way. | Attack and roll: the first fight |
| road_03 | **Gibbet Bend** ✅ | The road bends down into a hollow hung with gibbets. 3 Wicklings: the first stands at the bend with its back to you. Tall rocks block sight; once one sees you, the whole hollow knows. A ledge path to a **Powder Pouch**. | Backstab, then stealth |
| road_04 | **Collapsed Gate** ✅ | The fallen toll arch: two broken pillars, rubble, the lintel across the road. A Taper Hound and a Wickling together. A **Phial Shard** on the north-east ledge. | Fighting two at once; heal with the phial |
| road_05 | **Hill of Candles** ✅ | Switchback climb lined with candle cairns. The pilgrims' terrace below the path holds the **Hill Wick shrine**. *Cutscene: the Abbey on its hill.* Exit north to the hub (connected when the hub is built). | Shrines (breather) |

Scenery comes in two heights:
- **Low** (the wagon, the lintel, signposts, cairns): stops movement and bullets, but enemies see over it.
- **Tall** (boulders, large rocks, pillars): also blocks sight, so you can hide behind it.

Until you kindle the Hill Wick, dying anywhere on the road returns you to the Wreck.

**Items are in chests.** Press E: the lid opens while you keep moving, and the item pops out. The banner says exactly what changed, in numbers, with the item's flavour text underneath. Opened chests stay open.

## Wick's Rest (`hub`)
A half-ruined pilgrims' waystation in a hollow below the Abbey. Every Act 1 area opens from here.

| # | Room | Contents |
|---|---|---|
| hub_01 | **Waystation Yard** ✅ | **Wick's Rest shrine** at the crossroads. Merchant stall (Oskar's, once he's freed), campfire with bedrolls (Pip sits here once rescued), tents, a well, ruined timber walls, lanterns, a notice board. Exits: south to the road, west to the Waxmire, east through the **Toll Gate** (locked: Toll Key) to the carters' road and the Tallow Works, north to the Hill Stair, north-west to the chapel. No enemies. |
| hub_02 | **Maudlin's Chapel** ✅ | A grotto chapel in the hollow's side: flagstones, an altar with candles, prayer benches, a bookshelf, her bedroll. Later: lore notes and the Chandler's ledger turn-in. |
| hub_03 | **Hill Stair** ✅ | Switchback path up to the Abbey. It arrives through a new **north doorway in the Porch**, since the Porch's west wall is shared with the Nave. |

Exits into areas that aren't built yet (the Waxmire, the Tallow Works) show "The way is not open yet".

## The Guttering Abbey (`abbey`): built in M5, revised for Act 1
The 13 existing rooms stay. Changes:
- **Porch:** a new north doorway from the Hill Stair ✅. New games no longer start here.
- **Scriptorium:** Brother Aldous hides here (NPC).
- **Gatehouse:** the **Tollwarden**'s arena ✅. Beating him gives you the **Toll Key**.
  - Smoke seals both doorways when you walk in, and he performs his entrance while you keep control.
  - His name and health bar sit at the bottom of the screen.
  - Die and your Tallow lands just outside the doorway you came through.
  - When he falls, he kneels and speaks his last words.
- **Undercroft:** a sluice down to the Waxmire in its south wall ✅, opened by the lever in the Sluice (mire_08).
- **Nave Approach → Nave** ✅: the great door needs **both Seals** (`requires` takes a list). The Nave: the great altar and its fire, candelabra, pews, four pillars. The **Chandler** fight (two phases; the turn happens at the altar), the **Nave Wick** shrine after him, the ending, and the lift to Act 2 in the north-east corner (an exit that stays shut until `act2`; Act 2 will point it at the Cathedral).

## Tallow Works (`works`)
Where the dying pilgrims are "given to the flame": rendering vats, hooks, grease. The Act 1 twist is revealed here.

**New enemies:**
- **Renderer:** throws a hook on a chain from far off that drags you in close, then flays at close range.
- **Vat Crawler:** a wax blob. When it dies it bursts into two fast little **Vat Spawn**.

All 10 rooms are built ✅ (`tools/level-gen/works.mjs`).

| # | Room | Contents |
|---|---|---|
| works_01 | **Toll Gate** ✅ | Entry from the hub through the Toll Gate. The carters' booth, a tallow cart, Wicklings in pilgrim robes. *Narration on arrival.* |
| works_02 | **Receiving Pens** ✅ | Empty cages, robes with name tags. The first Renderer. Chest: Lump of Tallow. |
| works_03 | **Tallow Stores** ✅ | A maze of tallow stacks, two Acolytes, a Vat Crawler. Chest: Phial Shard. **A cracked section of the north wall**: smash it and the way to the Powder Vault opens (the Vault itself isn't built yet). |
| works_04 | **Lift Shaft** ✅ | **The lift up to Wick's Rest**: pull the lever to call the cage, and from then on it runs both ways (arriving at the hub yard's east side). |
| works_05 | **Scalding Floor** ✅ | Four great vats as cover, spilled tallow, three Vat Crawlers. Chest: Powder Pouch. |
| works_06 | **Hook Gallery** ✅ | Rows of hanging hooks, two Renderers and a Wickling |
| works_07 | **Foreman's Office** ✅ | **Foreman's Wick shrine**, the desk, **the Chandler's Ledger** (chest; Maudlin reacts to it). A door into the Hall that only opens from the office side (shortcut back to the shrine). |
| works_08 | **Rendering Hall** ✅ | *Cutscene: the reveal.* Five vats, the robe racks. Renderer, two Crawlers, an Acolyte. |
| works_09 | **Ember Flue** ✅ | Iron walkways over the furnace pit; two Hounds and a Renderer. Chest: Bitter Salt. |
| works_10 | **The Great Vat** ✅ | **Boss: Mother Tallow, two phases.** See below. Afterwards, the **Great Vat Wick** appears. |

**Mother Tallow**
- **Phase 1:** she rises from her vat, humming. Lobbed wax, ladle sweeps, a double stir, an unblockable crush.
- **When she falls:** she sinks into her pool, but the wax keeps moving, and a **half-buried chest** pushes up out of the floor holding **the Igniter**. Use it on her remains ("SET HER ALIGHT"); without it they only stir.
- **Phase 2, "Mother Tallow, Unrendered":** the wax burns away and her **bones** get up out of the fire. Much faster and harder-hitting:
  - a quick bone sweep
  - a lunging triple jab
  - five burning globs
  - an unblockable **leap crush**
  - **Brood:** she summons three **wax slimes** and sits in an invulnerable bubble until you kill them
- **When the bones fall** they come apart and blow away as dust. Then the **Seal of Tallow**.
- **If you die at any point** the whole fight resets. The Igniter stays yours.

**After every boss**, a shrine appears in its arena: the **Gatehouse Wick** (Tollwarden) and the **Great Vat Wick** (Mother Tallow).

## The Waxmire (`mire`)
The low ground where the Drip pools: a swamp of melted wax and drowned graves. All 10 rooms are built ✅ (`tools/level-gen/mire.mjs`).

**Wax pools** (`floor_wax`) slow walking and rolling to about half speed (`data/terrain.json`). Creatures of the mire (`wader`) move through them freely.

**New enemies:**
- **Drowned Pilgrim:** waits hidden under the wax (invulnerable, with a bubble now and then as the only tell) and rises when you come within about 3 tiles. Claws; a lunge that drags you in.
- **Mire Lantern:** floats at its post and sweeps a narrow cone of cold light back and forth. The cone is drawn in the world, and stops at walls, reeds and roots. Step into it and it sees you almost at once; then the whole room comes for you. Two hits kill it.

| # | Room | Contents |
|---|---|---|
| mire_01 | **Mire Edge** ✅ | Down from Wick's Rest. The first wax pools and the first ambush. *Narration on arrival.* |
| mire_02 | **Sunken Graves** ✅ | Rows of graves half under the wax; three drowned between the stones. Chest: Lump of Tallow. |
| mire_03 | **Lantern Walk** ✅ | Two Mire Lanterns sweep the reeds (reeds hide you). Two Wicklings. Chest: Powder Pouch. |
| mire_04 | **Drowned Chapel** ✅ | **Drowned Wick shrine**, weeping angels, sunken benches |
| mire_05 | **Pip's Hollow** ✅ | Pip, hiding in a ring of floating candles. Send them to Wick's Rest (they thank you there with a candle stub). Chest: Phial Shard. |
| mire_06 | **Wax Falls** ✅ | Tiered ledges with wax pouring down; two Hounds, an Acolyte, a Drowned Pilgrim |
| mire_07 | **Hanging Roots** ✅ | A maze of roots; two Wardens knee-deep in wax (slowed); two drowned |
| mire_08 | **The Sluice** ✅ | Pull the lever: the sluice becomes a two-way shortcut to the **Abbey Undercroft** (shut from both ends until then). Chest: Bitter Salt. |
| mire_09 | **Choir Pool** ✅ | One great wax pool with six drowned beneath it in a ring, and a Lantern over them |
| mire_10 | **Matron's Bath** ✅ | **Boss: the Mire Matron.** "Hush now. Have you come to be born again?" Five moves: drowning sweep, an unblockable **embrace** (a grab), lobbed wax, a **wail** that blasts you away, and **calling the drowned** (they sink into the wax and rise around you). Her last words (the Abbey's midwife); **Seal of the Mire**; then the **Matron's Wick** appears. |

## Powder Vault (`vault`): optional
Oskar's hidden powder cache under the Tallow Works: the heretics' old workshop.

| # | Room | Contents |
|---|---|---|
| vault_01 | Collapsed Store | Entry through the breakable wall. **Vault Wick shrine**. |
| vault_02 | Fuse Corridor | Explosive kegs: break them to hurt enemies, or yourself |
| vault_03 | Oskar's Cache | The cache (completes Oskar's quest: gun upgrades) |
| vault_04 | The Range | **Optional boss: Master Gunner** |
