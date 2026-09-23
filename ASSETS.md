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
| `attack` | 10 | S SE E NE N | 3 frames: `windup`, `active`, `recovery` | Shared by every melee strike. The weapon sprite does the swinging (see *Weapon motion*). Faces the attack direction. The windup frame is held while a heavy is charging. |
| `stagger` | 15 | S SE E NE N | 2 (10t, 16t) | Flinch. Legs stay visible. |
| `death` | 20 | S | 5 | **Full body** collapse. Legs and weapon are hidden. |

`handAnchors` must match where the weapon hand is drawn in each direction.

### `wickling` (enemy, single layer, 32×32, pivot 16,28, 5 columns)
| Animation | Row | Dirs | Frames |
|---|---|---|---|
| `idle` | 0 | S SE E NE N | 2 (candle flicker) |
| `walk` | 5 | S SE E NE N | 4, `footstep` on 1 and 3. Playback speed scales with move speed. |
| `attack` | 10 | S SE E NE N | 3 phased: `windup` / `active` / `recovery` (shared by all its moves) |
| `stagger` | 15 | S SE E NE N | 2 |
| `death` | 20 | S | 5 (melts into a puddle) |

Enemies hold their weapon like the player does: `handAnchors` in the body manifest, plus a separate weapon sheet (`cleaver`, pivot = grip, drawn pointing right, `points.tip` for the telegraph glint).

### `dummy` (single layer, 32×32, S only)
`idle` (1 frame) and `hit` (4 frames of wobble, using `col` to reuse 3 drawings).

### Combat FX
| Sheet | Cell | Pivot | Animations | Notes |
|---|---|---|---|---|
| `slash` | 48×48 | 24,24 (the attacker) | `swing`, `thrust` | Drawn pointing right with a 22 px radius. It is rotated to the attack direction, scaled to the strike's hitbox radius, and mirrored for reverse swings. |
| `glint` | 11×11 | 5,5 | `normal` (row 0), `danger` (row 1) | Telegraph star at the weapon tip. Also flashes when a heavy reaches full charge. |
| `exclaim` | 7×11 | 3,10 | none (static) | "Noticed you" pip above an enemy's head |

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
The manifest's `tiles` block maps tile kinds to sheet indices (index = row × 8 + column). **Repeating an index weights it**: floor `[0,0,0,0,0,0,1,1,2,3]` makes plain slabs most common.

| Kind | Indices | Used for |
|---|---|---|
| `floor` | 0–3 | Walkable floor (variants picked by a stable per-cell hash) |
| `floor_moss` | 4–5 | `,` in room files |
| `wall_front` | 8–9 | Brick face of a wall with floor directly south of it |
| `wall_cap` | 16–31 | Top of a wall. **Index = 16 + edge mask**, where the mask bits say which sides are open: N=1, E=2, S=4, W=8. Draw a rim on the open sides. |

**How walls are drawn (3/4 view):** level authors only place `#`. A wall with floor directly south gets a **front face** on its own cell and a **cap on the cell above**. If that cap lands on a floor cell (for example above a free-standing pillar or a thin wall), that cell becomes **solid**, so a wall blocks everything it visibly covers. The cap is still depth-sorted, so tall sprites standing further north (big enemies, bosses) are correctly hidden behind it.

---

## 4. Pixel font (`assets/fonts/pixel5x7.png`)
- 96×48 image: a 16×6 grid of 6×8 cells, each holding a 5×7 glyph at the top-left.
- Characters run in ASCII order from space (32) to `~` (126).
- Draw in **white**; the game tints it. Lowercase currently reuses the uppercase glyphs.

---

## 5. Replacing art: checklist
1. Keep the same `cell` size and pivot, or update them in the `.anim.json`.
2. Keep the animation names. Rows, frame counts and per-frame `ticks` can change freely. Keep the **phase tags** on phased animations.
3. Weapons: point right, and set the pivot to the grip.
4. Save. The page reloads with the new art.
5. If something is wrong, the game shows a readable error naming the file and field instead of starting.
