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
| Roll | Space | B / ○ |
| Sprint (hold) | Shift | L3 or LB |
| Swap weapon (visual only in M1) | Tab / wheel | D-pad ← → |

## Debug keys
| Key | Effect |
|---|---|
| F1 | Overlay: collider (yellow), hurtbox (green; cyan = i-frames; red = vulnerable roll recovery), state + tick, stamina numbers, FPS |
| F3 | Refill HP and stamina |
| F5 | Time: normal → slow (×0.25) → frozen → normal |
| F6 | Step one tick (freezes first if running) |
| F8 | Test screen shake |

## Tuning
All tuning lives in `data/`. Save a file and the running game picks it up instantly: no restart, and you keep your position. Invalid values show an on-screen error and the last good values stay active. Timings are in ticks (60 per second).
