# Powder & Penance (working title)

Top-down pixel-art action game: reference-shooter movement and camera, Souls-like combat.
Design: [DESIGN.md](DESIGN.md) · Milestones: [PLAN.md](PLAN.md) · Art spec: [ASSETS.md](ASSETS.md)

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
| Light attack / fire (tap again to combo) | Left mouse | RT |
| Heavy attack (hold to charge) / gun bash | F / Mouse 4 | RB |
| Block (hold); the first few ticks parry | Right mouse | LT |
| Riposte / backstab | Light attack near a parried enemy, or behind an unaware or staggered one | |
| Reload (auto when firing empty) | R | Y / △ |
| Roll | Space | B / ○ |
| Sprint (hold) | Shift | L3 or LB |
| Swap weapon slot (disabled while holding a two-handed weapon) | Tab / wheel | D-pad ← → |
| Drop the weapon in hand (the slot becomes bare fists) | G | D-pad ↓ |
| Drink a Mending Phial (about 1 s; a hit before it lands wastes the charge) | Q | X / □ |
| Interact: talk, shrines, chests, doors, racks, dropped weapons | E | A / × |
| Dialogue: next line / choose / skip cutscene | E, Enter, Space, click / W S or arrows / Esc | A / D-pad / B |
| Map (pauses the game) | M (M or Esc closes) | Back / Select |
| Menus: choose / confirm / back | W S or arrows / Enter, E, Space / Esc | stick or D-pad / A / B |

**Maps:** the minimap in the top-right corner follows you. **M** opens the large map of the current area: every room you've visited, shrines, doors (locked ones in red), and each exit labelled with where it leads. Rooms appear on the map once you enter them, and are saved. Minimap size and on/off: `minimap` in `data/config/hud.json`.

**Two-handed weapons** (greataxe, heavy crossbow) take both hands. The other slot and the shield are disabled until you drop the two-hander or replace it.

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
  - Beat him for the Toll Key, which opens the Toll Gate at Wick's Rest.
  - Tuning: `data/enemies/tollwarden.json`.
- **The Tallow Works** (through the Toll Gate east of Wick's Rest), 10 rooms:
  - New enemies: Renderers (their hook drags you in) and Vat Crawlers (they split in two).
  - The Foreman's Wick shrine, and the Chandler's Ledger.
  - A lift back up to the hub once you pull its lever.
  - A cracked wall to smash.
  - The Rendering Hall reveal.
  - The boss, **Mother Tallow**, in two phases. When she falls, open the chest that rises from the floor, set her remains alight with the Igniter, then beat what gets up. She drops the Seal of Tallow.
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
| 11–12 Nave | Approach and the (still empty) boss arena for M6 |

- **Doors:** press E. Opened doors stay open (saved).
- **Props:** crates, pots and candle clusters break from any attack, projectile or firepot blast.
  - Some drop Tallow or powder. Walk over the drop to collect it.
  - Props come back when you rest; their loot drops only once per save.

## Tuning
All tuning lives in `data/`. Save a file and the running game picks it up instantly: no restart, and you keep your position. Invalid values show an on-screen error and the last good values stay active. Timings are in ticks (60 per second).
