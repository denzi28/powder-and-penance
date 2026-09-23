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
| `exit` entity: walk into it to change area | road_05 |
| Area name banner on entering an area | road_05 |
| Keyed doors (Toll Key, two Seals) | hub_01 |
| Dialogue, NPCs, cutscenes | Story systems milestone (after the road and hub are built) |
| Slow floors (wax pools) | mire_01 |
| Secret breakable walls | works_03 |
| Lift (a one-way shortcut that moves between areas) | works_04 |

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
| hub_01 | Waystation Yard | **Wick's Rest shrine**. Sister Maudlin (levelling). Oskar's stall appears here once he's freed. Pip sits by the fire once rescued. Exits: south to the road, west to the Waxmire, east through the **Toll Gate** (Toll Key) to the Tallow Works, north to the Hill Stair. |
| hub_02 | Maudlin's Chapel | Side room: Maudlin's quarters, lore notes, the Chandler's ledger turn-in later |
| hub_03 | Hill Stair | Switchback path up to the Abbey Porch (area exit) |

## The Guttering Abbey (`abbey`): built in M5, revised for Act 1
The 13 existing rooms stay. Changes:
- **Porch:** a new west entrance from the Hill Stair. New games no longer start here.
- **Scriptorium:** Brother Aldous hides here (NPC).
- **Gatehouse:** becomes the **Tollwarden** arena; drops the **Toll Key**.
- **Undercroft:** gets a sluice gate on its west side, the one-way shortcut up from the Waxmire.
- **Nave Approach → Nave:** the great door needs **both Seals**. The **Chandler** fight, then the ending cutscene and the lift to Act 2 (sealed).

## Tallow Works (`works`)
Where the dying pilgrims are "given to the flame": rendering vats, hooks, grease. The Act 1 twist is revealed here.

**New enemies:**
- **Renderer:** hook on a chain that pulls you in.
- **Vat Crawler:** a wax blob that splits in two when hit hard.

| # | Room | Contents |
|---|---|---|
| works_01 | Toll Gate | Entry from the hub (Toll Key). Wicklings in pilgrim robes. |
| works_02 | Receiving Pens | Empty cages, name tags on hooks. Lore. |
| works_03 | Tallow Stores | Crate maze, Acolytes on the catwalks. **A breakable wall leads to the Powder Vault.** |
| works_04 | Lift Shaft | Lift back up to the hub. It only works once called from the bottom (shortcut). |
| works_05 | Scalding Floor | Vats as cover, Vat Crawlers |
| works_06 | Hook Gallery | Renderers' first appearance |
| works_07 | Foreman's Office | **Foreman's Wick shrine**; the Chandler's ledger (quest item) |
| works_08 | Rendering Hall | *Cutscene: the vats, and what goes into them.* Mixed fight. |
| works_09 | Ember Flue | Chain bridge over the furnace, hounds |
| works_10 | The Great Vat | **Boss: Mother Tallow.** Drops the **Seal of Tallow**. |

## The Waxmire (`mire`)
The low ground where the Drip pools: a swamp of melted wax and drowned graves. **Wax pools slow you down.**

**New enemies:**
- **Drowned Pilgrim:** rises out of the wax as an ambush.
- **Mire Lantern:** a floating light that alerts the whole room when it sees you.

| # | Room | Contents |
|---|---|---|
| mire_01 | Mire Edge | Entry from the hub. The first wax pools. |
| mire_02 | Sunken Graves | Drowned Pilgrim ambush |
| mire_03 | Lantern Walk | Mire Lanterns; a stealth route through the reeds |
| mire_04 | Drowned Chapel | **Drowned Wick shrine** |
| mire_05 | Pip's Hollow | Pip, lost (NPC; escort to the hub) |
| mire_06 | Wax Falls | Vertical room, hounds on the ledges |
| mire_07 | Hanging Roots | Maze of roots, Wardens stuck in the wax |
| mire_08 | The Sluice | One-way sluice gate up to the Abbey Undercroft (shortcut) |
| mire_09 | Choir Pool | Ambush arena: pilgrims rise in waves |
| mire_10 | Matron's Bath | **Boss: Mire Matron.** Drops the **Seal of the Mire**. |

## Powder Vault (`vault`): optional
Oskar's hidden powder cache under the Tallow Works: the heretics' old workshop.

| # | Room | Contents |
|---|---|---|
| vault_01 | Collapsed Store | Entry through the breakable wall. **Vault Wick shrine**. |
| vault_02 | Fuse Corridor | Explosive kegs: break them to hurt enemies, or yourself |
| vault_03 | Oskar's Cache | The cache (completes Oskar's quest: gun upgrades) |
| vault_04 | The Range | **Optional boss: Master Gunner** |
