# Powder & Penance (working title)

Top-down pixel-art action game: reference-shooter movement and camera, Souls-like combat.
**Status and next steps: [STATUS.md](STATUS.md)** · Design: [DESIGN.md](DESIGN.md) · Milestones: [PLAN.md](PLAN.md) · Art spec: [ASSETS.md](ASSETS.md)

## Run
```
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests (stamina, animation phases, autotiling, collision)
npm run typecheck
npm run gen:art    # regenerate missing placeholder art (--force to overwrite all)
```

## Controls (defaults — `data/config/input.json`)
| Action | Keyboard + mouse | Gamepad |
|---|---|---|
| Move | WASD / arrows | Left stick |
| Aim | Mouse | Right stick |
| Right hand: attack / fire (tap again to combo) | Left mouse | RT |
| Left hand: block with a shield (hold; the first few ticks parry), or attack / fire with a one-handed weapon | Right mouse | LT |
| Heavy attack with the right hand (hold to charge) / gun bash | F / Mouse 4 | RB |
| Riposte / backstab | Light attack near a parried enemy, or behind an unaware or staggered one | |
| Reload the gun in use, else the one in the other hand (auto when firing empty) | R | Y / △ |
| Roll | Space | B / ○ |
| Sprint (hold) | Shift | L3 or LB |
| Drop the weapon in use on the ground (it leaves your inventory) | G | D-pad ↓ |
| Drink a Mending Phial (about 1 s; a hit before it lands wastes the charge) | Q | X / □ |
| Use the item on your belt (a throw, or a short eat/drink; a hit before it lands keeps the item) | C | R3 |
| Cycle the belt to the next consumable you carry | X | D-pad ↑ |
| Interact: talk, shrines, chests, doors, racks, dropped weapons | E | A / × |
| Dialogue: next line / choose / skip cutscene | E, Enter, Space, click / W S or arrows / Esc | A / D-pad / B |
| Map (pauses the game) | M (M or Esc closes) | Back / Select |
| Pause menu: Equipment, Inventory, Quit (pauses the game) | Esc | Start |
| Menus: choose / confirm / back | W S or arrows / Enter, E, Space / Esc | stick or D-pad / A / B |

**Maps:** the minimap in the top-right corner follows you. **M** opens the large map of the current area: every room you've visited, shrines, doors (locked ones in red), and each exit labelled with where it leads. Rooms appear on the map once you enter them, and are saved. Minimap size and on/off: `minimap` in `data/config/hud.json`.

**Consumables, rings and notes.** Chests, enemies and breakable pots give consumables: firebombs, throwing knives, honeycomb, grey salt, incense, cartridges, oil, wafers, smoke, grog and tallow candles. Each does something different (Inventory > Items says exactly what, with numbers, then its lore). Whatever is on your belt shows bottom-left, and timed effects show as small icons under the phials. Two **rings** can be worn (Equipment > Ring I/II); each changes one thing while worn. **Notes** lie on the floor in eight rooms; read one with E and it's kept under Inventory > Notes. **Minibosses** (the Belfry Brute in the ossuary, Hesk in the mire roots) have a name bar at the bottom, more health, stay dead once killed, and drop a ring.

**Two hands.** The right hand holds a weapon (left click). The left hand holds a shield, a one-handed weapon, or nothing (right click): sword and buckler, sword and flintlock, dagger and revolver. **Two-handed weapons** (greataxe, heavy crossbow) take both hands: equipping one empties the left hand, and putting a shield or weapon in the left hand takes the two-hander off. Change hands from Esc > EQUIPMENT; the HUD boxes bottom-right show each hand with its button.

## Debug keys
| Key | Effect |
|---|---|
| F1 | Overlay: collider (yellow); hurtbox (green; cyan = i-frames; red = vulnerable roll recovery; orange = hyper-armor); active hitboxes (red); enemy vision cones; state/tick/HP/poise labels; FPS and attack-token readout |
| F2 | God mode (ignore all hits) |
| F3 | Refill HP and stamina |
| F4 | Kill all enemies |
| F5 | Time: normal → slow (×0.25) → frozen → normal |
| F6 | Step one tick (freezes first if running) |
| F8 | Test screen shake |
| 1 / 2 / 3 | Spawn a Wickling / training dummy / sparring post at the cursor |
| 4 / 5 / 6 / 7 | Spawn a Bulwark Warden / Powder Acolyte / Taper Hound / Belfry Brute at the cursor |
| ` (backquote) | Debug menu. **BOSSES...** (top): jump to the doorway of any boss arena, and walk in to start the fight. A beaten boss is revived first, so you can refight it. Below that: teleport to any room in any area; **World flags** lists every flag (shrines, items, doors, loot) and can clear them one by one or all at once. Cleared flags take effect after the area reloads (rest or teleport). |

- **Test room:** one Wickling stands facing the east wall in the south-east corner. Sneak up and backstab it.
- **Debug arena** (through the test room's east doorway):
  - **Weapon racks** along the north wall: straight sword, dagger, greataxe, revolver, flintlock, heavy crossbow, buckler, and "no shield". Press E to put one in your active slot.
  - **2 training dummies:** damage/poise numbers, and you can backstab them from behind (they face south).
  - **A sparring post** that swings on a fixed rhythm, for block, parry and riposte practice.
  - **2 Wicklings** and a pillar to hide behind.

## Shrines, saving and death (M4)
- The game opens on a **title screen**: Continue, or New Game (it asks before erasing an existing save).
- **Wick Shrines:** the test room and the arena each have one.
  - The first use kindles the shrine.
  - Resting restores HP, phials and ammo, respawns the enemies, **saves**, and opens the shrine menu.
  - Dying returns you to the last shrine you rested at.
- **Tallow:** you gain it from kills.
  - On death, everything you carry drops as a **Guttered Candle** where you fell. Walk into it to recover the Tallow.
  - If you die again before reaching it, it is replaced and the old Tallow is gone.
- **Saving:** to `localStorage`.
  - It happens on rest, death, item pickups and candle recovery, plus every 5 s when something changed, and on closing the tab.
  - Loading always puts you at your last shrine.
  - To wipe your progress, choose New Game on the title screen.
- **Test items:** test room: Phial Shard (+1 phial, south-west corner) and Bitter Salt (+heal, east of the thick block). Arena: Powder Pouch (ammo) and a Lump of Tallow. Each can be picked up once per save.

## Act 1 (in progress)
Act 1 is being built room by room: the plan is in [WORLD.md](WORLD.md) and the story in [STORY.md](STORY.md).
- **New games start on the Penance Road** (`road_01_wreck`) with bare fists. A sword and a flintlock lie in the wreck.
- **The story has started.** The game opens with a short cutscene at the wreck. Oskar is locked in the wagon cage: find the Cage Key down the road to free him, and he turns up at his stall in Wick's Rest. Sister Maudlin waits by the hub shrine. How to write dialogue and cutscenes: [STORY.md](STORY.md).
- **Slain enemies stay dead** until you rest at a shrine or die, even if you leave the area and come back.
- **First boss: the Tollwarden,** in the Abbey Gatehouse (from the Porch: Courtyard, Cloister, Bell Passage, Crypt Stair, Ossuary).
  - Watch his delayed thrust: it flashes early and strikes late. The red-glint slam can't be blocked.
  - Keep your distance and he digs into his purse and flings a spread of toll coins at you.
  - Beat him for the Toll Key, which opens the Toll Gate at Wick's Rest.
  - Tuning: `data/enemies/tollwarden.json`.
- **The Tallow Works** (through the Toll Gate east of Wick's Rest), 10 rooms:
  - New enemies: Renderers (their hook drags you in) and Vat Crawlers (they split in two).
  - The Foreman's Wick shrine, and the Chandler's Ledger.
  - A lift back up to the hub once you pull its lever.
  - A cracked wall to smash.
  - The Rendering Hall reveal.
  - The boss, **Mother Tallow**, in two phases. When she falls, open the chest that rises from the floor, set her remains alight with the Igniter, then beat what gets up. She drops the Seal of Tallow.
    - Stay back and she lifts her ladle high and tips it out over you: three slowing wax pools land around you.
- **The Waxmire** (west of Wick's Rest), 10 rooms:
  - Wax pools slow you down.
  - Drowned Pilgrims rise out of them to ambush you.
  - Mire Lanterns sweep the reeds with visible cones of light. Stay out of the light.
  - The Drowned Wick shrine.
  - Pip to send home.
  - A sluice shortcut into the Abbey Undercroft.
  - The boss, **the Mire Matron**, who drops the Seal of the Mire.
    - Her lullaby and her wail look different now: when she rears back with her arms flung behind her and her mouth wide, the wail (unblockable) is coming. Roll away.
- **The finale: the Chandler,** in the Abbey Nave. The great door in the Nave Approach needs **both Seals**.
  - Phase 1, the priest: wide snuffer sweeps, **Extinguish** (the bell comes down where you stand: unblockable, roll out), **taper volleys** thrown from his crown, and **censer smoke**: he vanishes and steps out behind you.
  - When his health runs out he doesn't fall. He walks to the altar and pours himself onto the fire, and **the Last Candle** rises out of it: fast combos, a leap slam that rings out black flame, lobbed volleys, and **wax floods** that leave slowing pools across the floor.
  - His last words, the lift waking, and **END OF ACT ONE**. The lift itself stays sealed until Act 2.
  - Tuning: `data/enemies/chandler.json` and `chandler_wick.json`.
- **A shrine appears after every boss.**
- **Quick travel:** rest at any shrine and choose TRAVEL to go to any other lit shrine, in any area.
- **Items come in chests** (press E). You keep control while the lid opens. The banner explains the effect in plain numbers (e.g. "phial drinks 3 -> 4"), with the flavour text below.
- **The route is walkable end to end:** Penance Road, then Wick's Rest (the hub), then up the Hill Stair to the Abbey Porch. Walking into an area exit fades to the next area and shows its name.
- The Toll Gate (east of the hub) needs the **Toll Key**, which the Tollwarden will drop. The Waxmire and Tallow Works exits say they aren't open yet.
- The debug menu (`) still jumps to any room, including area `test` with the weapon racks and training dummies.

## The Guttering Abbey (M5)

| Room | What's there |
|---|---|
| 1 Porch | Shrine. Door east. The barred gate in the south wall is the shortcut: it only opens from below. |
| 2 Courtyard | Wicklings among columns. South exit leads to the optional side chapel (Taper Hound, **Phial Shard**). |
| 3 Cloister | First **Bulwark Warden**. It blocks hits from the front until its guard breaks. Go around it or break the guard. |
| 4 Bell Passage | Two **Powder Acolytes** throwing firepots. Watch the landing ring; crates give cover. |
| 5 Crypt Stair | Two **Taper Hounds** (long lunge, fast bites) |
| 6 Ossuary | The **Belfry Brute**. Red glint = grab, which is unblockable: roll. **Bitter Salt** behind it. |
| 7 Gatehouse | Two Wardens. **Powder Pouch**. (The M6 mini-boss arena.) |
| 8 Chapterhouse | Second shrine, behind a door |
| 9 Scriptorium | Mixed group. **Lump of Tallow**. |
| 10 Undercroft | Lift the bar on the gate north to open the shortcut back to the Porch |
| 11 Nave Approach | The great door: set both Seals in it |
| 12 Nave | **The Chandler** (final boss of Act 1), the Nave Wick after him, and the sealed lift to the Cathedral |

- **Doors:** press E. Opened doors stay open (saved).
- **Props:** crates, pots and candle clusters break from any attack, projectile or firepot blast.
  - Some drop Tallow or powder. Walk over the drop to collect it.
  - Props come back when you rest; their loot drops only once per save.

## Tuning
All tuning lives in `data/`. Save a file and the running game picks it up instantly: no restart, and you keep your position. Invalid values show an on-screen error and the last good values stay active. Timings are in ticks (60 per second).
