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
| Interact (weapon racks, pick up dropped weapons) | E | A / × |

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

- **Test room:** one Wickling stands facing the east wall in the south-east corner. Sneak up and backstab it.
- **Debug arena** (through the test room's east doorway):
  - **Weapon racks** along the north wall: straight sword, dagger, greataxe, revolver, flintlock, heavy crossbow, buckler, and "no shield". Press E to put one in your active slot.
  - **2 training dummies:** damage/poise numbers, and you can backstab them from behind (they face south).
  - **A sparring post** that swings on a fixed rhythm, for block, parry and riposte practice.
  - **2 Wicklings** and a pillar to hide behind.

## Tuning
All tuning lives in `data/`. Save a file and the running game picks it up instantly: no restart, and you keep your position. Invalid values show an on-screen error and the last good values stay active. Timings are in ticks (60 per second).
