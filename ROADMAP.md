# Powder & Penance: expansion roadmap

A bigger world, built one step at a time. Each step is one pass like the ones before: build it, show screenshots
(and audio previews), then push once it's approved. Every step leaves the game playable and saves compatible.

**Where we are:** Act 1 has 43 rooms in 5 areas (road, hub, Abbey, Works, Mire), 4 bosses with 6 forms,
11 enemy kinds, 18 NPCs, inventory, armour and equip load, and synthesised music and sound. It takes about 2 hours.

**Where this goes:** about 85 rooms and 4 hours. Three new **colourful** biomes, the unfinished Powder Vault,
14 new enemy kinds, 7 minibosses and 4 bosses, about 40 new items, and lore that ties it all to the one question
the story asks: *what is the Drip, and why doesn't it touch you?*

---

## The shape of the bigger world

```
                           [Act 2: the Cathedral]
                                    ^
                           [Abbey nave: Chandler]
                                    ^
 [BLOOMHOLLOW] <-- side path -- [Penance Road] --> [Wick's Rest (hub)] --> [Tallow Works] --> [Powder Vault]
  the Apiary Orchard                                  |        |                                    |
  gold, violet, green                               [Abbey]  [Waxmire] --> [MADDER MARSH]      [BRINEWELL]
                                                                            the Dyers' Quarter    the Saltpetre Deeps
                                                                            crimson, indigo,      white, rose, cyan
                                                                            saffron               glowing brine
```

Why these three: the Act 1 world is deliberately grey, brown and tallow-yellow, the colours of the Order.
Each new biome is somewhere the Order's grey never reached, and each hides a piece of the truth about wax and fire:

| Biome | Colours | What it reveals |
|---|---|---|
| **Bloomhollow**, the Apiary Orchard | honey gold, lavender violet, orchard green, poppy red | Candles were once **beeswax**. The Order burned the orchards and switched to tallow: cheaper, and made of people. |
| **Madder Marsh**, the Dyers' Quarter | madder crimson, woad indigo, saffron yellow, cloth white | The dyers made the Order's vestments and kept colour alive when it was declared vanity. Their vats hold something that slows the Drip. |
| **Brinewell**, the Saltpetre Deeps | salt white, rose quartz, brine cyan, lamp amber | Saltpetre, the thing in gunpowder, is what the Drip can't take. That's why it doesn't touch you. It sets up Act 2. |

---

## Step 1: Loot and lore foundations (done)
*The systems every new area will drop things into. It's small, but everything after it leans on it.*
- **Consumables and a quick-use belt.** C uses what's on the belt, X cycles it (R3 / D-pad up on a pad), and its icon and count sit bottom-left. Each of the 11 has its own lore, its own icon and its own effect:
  - Firebomb: thrown to where you aim, bursts for area damage.
  - Pilgrim's Knife: thrown straight, quick and cheap.
  - Wild Honeycomb: heals over six seconds.
  - Grey Salt Crust: wax, mud and spilled pools stop slowing you.
  - Warding Incense: you take a quarter less damage.
  - Paper Cartridge: loads every gun you carry at once, plus some spare shots.
  - Chandler's Oil: your hits deal 30% more.
  - Stale Wafer: stamina comes back 60% faster.
  - Smoke Pellet: enemies hunting you lose you, and notice you far slower.
  - Ringer's Grog: +40 poise, hard to stagger.
  - Pilgrim's Tallow Candle: turned into Tallow.
- **Rings**, 2 slots on the Equipment screen, 10 to find, each with its own passive: max stamina, max HP, more Tallow, more carrying capacity, keeping a third of your Tallow when you die, more damage at low HP, stronger phial drinks, stealth, stronger shots and throws, more poise.
- **Lore notes.** 8 letters, ledger pages, hymns and a child's drawing lie on the floor. Read one with E and it's kept in the new **NOTES** tab of the Inventory.
- **Minibosses.** Any placed enemy can be made one: a smaller name bar at the bottom of the screen, more health, dead for good once killed, and a unique drop. The Belfry Brute and Hesk, the Unrelieved Warden, drop rings.
- **Loot.** Enemies have loot tables, so consumables drop where they fall. Chests in 18 rooms hold rings and consumables.
- **Tests:** every consumable, ring and note is unique and can be found; modifiers; save migration (v3).

## Step 2: The economy
*Tallow finally buys things, so the bigger world has something to spend it on.*
- **Level up at Maudlin**, using Vitality, Endurance, Strength and Dexterity:
  - The cost curve is in data.
  - Endurance raises stamina and equip-load capacity.
  - Strength and Dexterity scale weapon damage (the scaling letters show on the Equipment screen).
- **Oskar's shop** at his stall: ammo, consumables, a few rings, lore trinkets. The stock grows as you explore.
- **Smith (Bede at the chopping block):** weapon upgrades +1 to +5 using Tallow Ingots and Ember Salt, which get placed in the world.

## Step 3: The Powder Vault (finishes Act 1)
*The optional area that's planned but not built. 4 rooms off the Works' hidden wall.*
- **Rooms:**
  - Collapsed Store, with the Vault Wick.
  - Fuse Corridor, with explosive kegs that hurt you or them.
  - Oskar's Cache, which completes his quest and unlocks gun upgrades.
  - The Range.
- **New enemies:**
  - **Powder Mule:** carries a keg and explodes when killed near you.
  - **Fuse-Runner:** lights the kegs.
- **Boss: the Master Gunner.** A cannon on a track, then a duel with a blunderbuss.
- **Items:**
  - Blunderbuss (new weapon).
  - Gunner's Coat (armour).
  - Ring of the Steady Hand: faster reloads.

## Step 4: Bloomhollow, the Apiary Orchard (colourful biome #1)
*An early side area off the Penance Road: warm, golden, deceptively pretty.*
- **10 rooms:** the Orchard Gate, Lavender Rows, the Hive Walls, the Press House, the Burned Grove, the Queen's Garden and more.
- **Colours and scenery:**
  - Colours: honey gold, violet lavender, fresh green, poppy red.
  - New tileset: flowering grass, honeycomb stone, orchard paths.
  - Decor: hives, fruit trees, wax presses, flower beds, scarecrows.
- **Mechanics:**
  - **Bee swarms** chase whoever disturbs a hive, you or enemies, so you can lead them into foes.
  - **Smoke** (a Smoker item) calms them.
- **New enemies:**
  - **Beekeeper Husk:** a veiled wax figure with a smoker. Its smoke blinds.
  - **Drone Swarm:** a cloud you roll through, not fight.
  - **Orchard Guard:** a scarecrow with a scythe that wakes when you're close.
  - **Honey Slime:** a sticky floor that slows.
- **Miniboss: the Scarecrow Warden** in the Burned Grove.
- **Boss: the Hive Queen**, a queen who is half woman, half hive. The swarm is her second phase.
- **NPC: Maud the Beekeeper**, the last honest chandler. She sells beeswax candles, a light source that reveals hidden paths.
- **Items:**
  - Smoker (a light weapon that blinds).
  - Beekeeper's Veil and Coat.
  - Honeycomb (consumable).
  - Ring of the Queen: heal on a backstab.
- **Lore:** Maud's orchard notes, the burned grove's letter of decree, the first hint that tallow replaced beeswax.
- **Sound:** bees, birdsong, wind in the orchard; a pastoral waltz exploration theme; the Queen's buzzing choir boss theme.

## Step 5: Madder Marsh, the Dyers' Quarter (colourful biome #2)
*A half-flooded dyers' village off the Waxmire: streets of dye vats and hanging cloth, colour everywhere.*
- **10 rooms:** the Rinsing Steps, Crimson Row, the Indigo Vats, the Saffron Loft, the Drying Yards, the Guildhall and more.
- **Colours and scenery:**
  - Colours: madder crimson, woad indigo, saffron yellow, bleached white.
  - Tileset: dyed cobbles, plank walkways over coloured water.
  - Decor: vats, cloth lines and banners, mordant barrels, looms.
- **Mechanics: coloured pools.**
  - Red burns.
  - Blue numbs, which drains stamina.
  - Yellow makes you glow, so enemies see you from further away.
  - Hanging cloth blocks sight: stealth routes.
- **New enemies:**
  - **Stained Drowned:** Mire corpses dyed by the vats. Each colour behaves differently.
  - **Loom-Spider:** drops on threads from the rafters.
  - **Guild Enforcer:** a dye-paddle and a shield.
  - **Mordant Toad:** spits acid.
- **Miniboss: the Indigo Twins** in the Drying Yards. There are two of them, and they hide behind cloth.
- **Boss: the Master Dyer.** She dips herself in each vat and changes her moveset with the colour.
- **NPC: Tobiah the Dyer's Apprentice**, who dyes your armour any colour. This builds on the armour recolouring already in the game.
- **Items:**
  - Dye Paddle (a heavy weapon).
  - Guild Cloak (light armour).
  - Woad Salve: resist numbing.
  - Ring of Many Colours.
- **Lore:** the guild charter, the Order's edict against colour, the dyers' secret remedy for the Drip.
- **Sound:** dripping cloth, sloshing vats, a busy-then-abandoned market ambience; an accordion-like folk tune.

## Step 6: Brinewell, the Saltpetre Deeps (colourful biome #3)
*Caves below the Powder Vault, crystal-white and rose, lit by glowing brine: the answer to the protagonist's mystery.*
- **10 rooms:** the Salt Stair, Crystal Gallery, Brine Lakes, the Miners' Chapel, the Evaporating Pans, the Heart of Salt and more.
- **Colours and scenery:**
  - Colours: salt white, rose quartz, glowing cyan brine, amber miners' lamps.
  - Tileset: crystal walls, salt flats, brine channels.
  - Decor: crystal clusters, mine carts, pulleys, salt pillars.
- **Mechanics:**
  - **Crystals** refract the light cones of lantern enemies, so you can block or redirect their gaze.
  - **Brine** heals you but hurts wax creatures.
  - **Collapsing salt floors.**
- **New enemies:**
  - **Salt-Crusted Miner:** a pick, and it's armoured until its crust cracks.
  - **Crystal Mite:** small, and it shatters into shards.
  - **Brine Eel:** comes out of the channels.
  - **Pale Acolyte:** an Order hunter sent to seal the caves.
- **Miniboss: the Foreman of Salt.**
- **Boss: the Salt Saint.** A statue of salt that remembers being a man, and the first one immune to the Drip, like you.
- **NPC: Ysolde**, a miner who has also never taken the Drip. She knows why.
- **Items:**
  - Salt Pick (a weapon that breaks crusts and shields).
  - Miner's Helm, a helm with a lamp that lights dark rooms.
  - Saltpetre Charm: halves the Drip's effects.
  - Brine Flask (a second healing flask).
- **Lore:** the saint's confession, Ysolde's family and the powder-makers' guild, the reason the Order outlawed gunpowder.
- **Sound:** crystal chimes, echoing drips, the hum of brine; a glassy, choral exploration theme.

## Step 7: Minibosses across the old world, and stitching it together
*The existing biomes get bigger and stranger, and the world becomes one connected map.*
- **4 minibosses** in existing areas, each on a quest thread that's already set up:
  - **The Hanged Reeve** at Gibbet Bend (road). He rises from his gibbet at night.
  - **The Eel-Mother** in the Drowned Chapel's pools (mire). She's Wenna's quest.
  - **The Foreman** in the Works' office cellar. This is Fennick's thread.
  - **Aldous the Unmade** in the Nave Approach, if you don't save him.
- **Shortcuts** between the new biomes and the old ones (a Mire-to-Marsh ferry, an Orchard-to-Road gate, the Vault lift to Brinewell).
- **The map screen shows every area**, and fast travel works between all of them.
- **Two or three new rooms** in each old biome where the paths join.

## Step 8: Balance, difficulty curve and replay
*Everything together, tuned.*
- Pass over enemy HP and damage along the new route order, the Tallow economy, and upgrade costs.
- **New Game+**: stronger enemies and some extra placements.
- An end-of-game stats screen: time, deaths, bosses, and what killed you most.
- Tests for level reachability, every item obtainable, and every lore note placed.

---

## How each biome is built (the recipe)
Each biome follows the same list, so every one lands complete:
1. Tileset and decor art (gen-art), plus critters and ambience (`data/ambience.json`).
2. Rooms with connections, a shrine and a shortcut; the reachability and placement tests pass.
3. 3-4 enemies with sprites, animations, AI, and tells and sounds.
4. A miniboss, and a boss with its arena, a theme with drops, and last words.
5. An NPC with routines, dialogue and a quest; lore notes; items with icons and descriptions.
6. Exploration music, ambient sounds and footstep surfaces.
7. Screenshots and audio previews for your approval, then the push.

## My suggested order and why
1. **Foundations** first: every new area drops consumables, rings and notes, so the systems need to exist before the loot.
2. **Economy** next: with more to find, Tallow needs somewhere to go, and levels and upgrades make the new bosses fair.
3. **Powder Vault**: a small, already-designed area. It finishes Act 1 and tests the pipeline before the big biomes.
4. **Bloomhollow**: the brightest and earliest biome, the best first impression of "colourful".
5. **Madder Marsh**: the most colourful mechanics (the pools, and dyeing your armour).
6. **Brinewell**: the story payoff, so it comes last of the three.
7. **Old-world minibosses and stitching**, once there's a bigger world to stitch together.
8. **Balance and replay** at the end, when everything exists.

Every step can be reordered. The biomes don't depend on each other, only on Steps 1-2.
