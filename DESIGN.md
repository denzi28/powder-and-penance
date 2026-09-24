# DESIGN.md — *Powder & Penance* (working title)

A top-down pixel-art action game. It **looks and moves** like a snappy 3/4-view dungeon shooter and **plays** like a Souls game: few, readable, telegraphed attacks; stamina; committed actions; limited healing; checkpoints with a death penalty. It is **not** a bullet hell.

All names, art, characters and UI are original. Every name below is a placeholder in data (`data/text/*.json`) and can be renamed without code changes.

---

## 1. Theme and names (placeholders)

A ruined candle-abbey where gunpowder replaced prayer. Light, wax and smoke are the visual motifs.

| Concept | Name | Notes |
|---|---|---|
| Player | The Penitent | Hooded, with a lantern at the belt |
| Checkpoint | **Wick Shrine** | A tall iron candle stand. You kneel and relight it. |
| Currency | **Tallow** | Dropped by enemies. Spent on level-ups. |
| Death marker | **Guttered Candle** | Marks where you died and holds the Tallow you lost |
| Healing flask | **Mending Phial** | Starts with 3 charges |
| +1 flask charge | Phial Shard | |
| +heal amount | Bitter Salt | |
| Boss barrier | **Smoke Veil** | A drifting grey curtain you walk into |
| Death screen text | **EXTINGUISHED** | |
| Boss-kill text | **FLAME QUELLED** | |
| First area | The Guttering Abbey | |

---

## 2. Technical foundation

### 2.1 Stack
- Phaser 3 (latest 3.x), TypeScript (strict), Vite. `npm run dev` runs the game.
- `zod` validates every data file at load and gives readable errors (for example `weapons/greataxe.json: light[1].recovery must be a number`).
- `vitest` covers the pure-logic modules: stamina, poise, state machine, damage math, save migration and room parsing.
- `pngjs` in a Node script (`npm run gen:art`) generates placeholder sprite sheets as **real PNG files** on disk. You can replace them one by one.

### 2.2 Pixel-perfect rendering
- The game canvas is 480×270. Phaser runs with `pixelArt: true` and `roundPixels: true`.
- **Integer scaling:** a custom resize handler picks `scale = max(1, floor(min(winW/480, winH/270)))`, sets the canvas CSS size to `480*scale × 270*scale`, centers it and letterboxes it in black. The CSS uses `image-rendering: pixelated`. Phaser's FIT mode is not used because it allows non-integer scales.
- Everything renders at 480×270, so rotated sprites such as weapons keep the same pixel size as everything else. No mixels.
- **Floats in the simulation, integers on screen.** Positions and velocities are floats. Each view snaps its draw position with `Math.round`.
- **No player/camera jitter:** the camera is not lerped toward the player's float position. It is computed as `cam = round(playerDrawPos) + round(smoothedOffset)`. Smoothing applies only to the offset (aim lead and recentring lag). The player therefore stays pixel-stable on screen during steady movement.
- **Render interpolation:** gameplay runs at a fixed 60 Hz. On 120/144 Hz monitors, views draw `lerp(prev, curr, alpha)` and then snap. Without this, high-refresh displays show judder.

### 2.3 Fixed timestep
- The simulation runs at 60 ticks per second using an accumulator in `core/FixedLoop.ts`. The accumulator is clamped to 5 steps so a slow frame cannot spiral.
- **All gameplay timings in data are in ticks (1 tick = 1/60 s).** Frame data is written the way fighting games and Souls games write it: "windup 18, active 4, recovery 22".
- Movement collision uses a small custom axis-separated box-vs-tile resolver (`world/collision.ts`), *not* Arcade Physics.
  - Why: Arcade bodies write positions into Phaser game objects and step on Phaser's own clock. That fights the sim/view split and the render interpolation below.
  - The custom resolver is ~50 lines, deterministic and unit-tested.
  - Body-vs-body pushing arrives with enemies in M2, done the same way.
- **Combat does not use Arcade overlaps.** Hitboxes and hurtboxes are resolved by our own `CombatSystem` every tick. This keeps the order deterministic and makes multi-hit rules explicit.
- Hit-stop pauses simulation ticks (global freeze for N ticks). Rendering, camera shake and particles keep running.

### 2.4 Input
- There is an action layer between hardware and game code. Game code asks for actions such as `input.pressed('roll')`, `held('block')`, `aimVector()` and `moveVector()`. It never reads keys directly.
- The input layer supports keyboard + mouse and gamepad (Phaser gamepad plugin, standard mapping). The active device switches automatically to whichever was used last, and the HUD button glyphs switch with it.
- **Input buffer:** an action pressed up to N ticks before it becomes legal still fires (default 8 ticks, in config). This is essential for committed-action games to feel responsive and not sluggish.
- Aim: on mouse, the world-space cursor. On gamepad, the right stick sets the aim direction and the aim point sits at a configurable distance. Optional light aim assist on gamepad only (toggle).
- Bindings are stored in localStorage and edited in the pause menu. Defaults come from `data/config/input.json`.

**Default bindings (proposed; see Open Questions):**

| Action | Keyboard + mouse | Gamepad |
|---|---|---|
| Move | WASD | Left stick |
| Aim | Mouse | Right stick |
| Light attack / Fire | LMB | RT |
| Heavy attack (hold to charge) | F / Mouse4 | RB |
| Block / Parry (hold; parry = first frames) | RMB | LT |
| Roll | Space (on press) | B / ○ (on press) |
| Sprint (hold) | Shift | L3 or hold LB |
| Heal | Q | X / □ |
| Reload | R | Y / △ (tap) |
| Swap weapon | Tab / Mouse wheel | Y / △ (hold) or D-pad ↔ |
| Interact | E | A / × |
| Pause | Esc | Start |

---

## 3. Look and movement

### 3.1 Characters
- 3/4 top-down view. Characters are about 16×24 on a 32×32 frame cell, with the pivot at the feet (16, 28). Brutes use a 48×48 cell, bosses 64×64.
- **Two-layer body:** a **legs** layer (walk cycle, follows *movement* direction) and a **torso/head** layer (follows *aim* direction). Both share one pivot. If this looks bad at 16×24, we fall back to single-layer sprites that face the aim direction and play the walk cycle backwards when backpedaling. This is a flag in the character manifest.
- Directions: the torso has 8 directions, authored as 5 (S, SE, E, NE, N) with W/SW/NW mirrored. The legs have 4 directions, authored as 3 (S, E, N) with W mirrored.
- Every actor has a drop shadow: a separate ellipse sprite under the pivot that does not squash with the body.
- **Depth:** Y-sorting by the feet pivot. South-wall top faces are drawn above actors standing behind them.

### 3.2 Held weapon
- The weapon is a separate sprite that rotates around a **hand anchor**. Anchors are defined per torso direction and frame in the manifest.
- It flips vertically when the aim is on the left half, so the weapon is never drawn upside down.
- Draw order: **behind** the body when aiming into the upper arc (roughly 200°–340°, i.e. aiming "up"), **in front** otherwise. The thresholds are in config.
- Melee weapons idle at a resting angle offset from the aim. During swings, the swing animation drives the weapon angle: it sweeps from `arcStart` to `arcEnd` relative to the locked attack direction.

### 3.3 Movement feel
- Walk speed is about 88 px/s. It reaches full speed in about 3 ticks and stops in about 2. There is no ice-skating: when input stops or reverses, deceleration is very high.
- Sprint multiplies speed by 1.4 and drains stamina every tick.
- All values live in `data/config/player.json` (`walkSpeed`, `accelTicks`, `decelTicks`, `sprintMult`, ...).

### 3.4 Camera
- Aim lead: the camera shifts toward the cursor by `aimLeadFactor` (0.25) of the cursor distance, clamped to `aimLeadMax` (40 px). This lead is smoothed with an exponential lerp.
- **Room clamp:** the view stays inside the room you're in, including the wall-top row above its north wall. Rooms smaller than the screen are centred. Everything outside rooms is filled with solid rock tiles, so no black void is ever visible. Walking through a door blends the camera to the new room over `roomBlendMs`.
- Shake: trauma-based (trauma² × amplitude, decays per tick), with integer offsets.
- Hit-stop: per-event values in `data/config/juice.json` (for example light hit 2 ticks, heavy hit 5, parry 8, riposte 10).

### 3.5 Juice (all toggles and values in `juice.json`)
- White flash on hit (shader-free: a white tint for N ticks).
- Squash and stretch on roll start, roll end and heavy landings, as scale keyframes on the body layer only.
- Dust puffs on roll start and on footstep animation events.
- Knockback impulses on actors, decayed by friction.
- Blood and spark particles. Sparks appear on blocked or shielded hits.
- Muzzle flash sprite for 2 ticks, plus ejected shell casings that stay on the floor for a while (pooled, capped).
- Telegraph glint: a one-shot star sprite on the enemy's weapon at a specific windup frame, with an audio cue.

### 3.6 Rooms
- Rooms are handcrafted rectangles joined by doors and corridors. They are stitched into **one continuous world** per area, like the reference game's floors: no loading screens between rooms, and the camera flows freely.
- The tile grid is 16×16. Walls have a visible **top face**: a wall tile renders a front face and the tile above renders the top cap. This is autotiled from neighbours, so authors only place `#`.
- Destructible props (crate, pot, candle cluster) have HP and break into debris particles. They can drop small loot from a data loot table. Props respawn on rest, but their one-time loot does not.

---

## 4. Combat

### 4.1 Action state machine
Every actor (player, enemy, boss) runs a state machine. Each state has `enter`, `tick` and `exit` hooks and an **action timeline** in ticks.

Player states: `idle, move, sprint, attackLight(n), attackHeavyCharge, attackHeavy, fire, reload, roll, block, parry, heal, swap, stagger, guardBroken, knockdown, critical (riposte/backstab, attacker), criticalVictim, interact, rest, dead`.

Rules:
- **Committed:** once an action starts, it runs to the end of its timeline.
- **Cancel windows** are explicit timeline events. Examples: `cancel: ["roll"]` from tick 20 in light-attack recovery, or `cancel: ["light"]` for combo chaining.
- Buffered inputs resolve at the first tick a cancel window allows them.
- Aim tracking during attacks: during windup the attack direction turns toward the aim at `trackDegPerTick` (weapon data). It **locks** when active frames start. This stops "360° spin" swings while keeping them from feeling unresponsive.

### 4.2 Who owns frame data (important)
- **Gameplay timing lives in gameplay data** (weapons, enemies, player config), in ticks. That covers windup, active and recovery, i-frames, cancel windows, when a hitbox is on, when the heal lands, and similar events.
- **Animations carry phase tags and cosmetic events.** Each animation frame is tagged `windup | active | recovery`. The animation player **time-stretches each phase** so it matches the gameplay tick counts exactly.
- Animation frames carry **cosmetic events**: `footstep`, `dust`, `sfx:<id>`, `glint`, `shellEject`, `muzzle`. They can also carry optional **per-frame hurtbox overrides** (for example a smaller hurtbox while crouched in a roll).
- Result: you can tune an attack from 18 to 14 windup ticks without re-authoring the art, and you can swap the art (a different frame count) without touching combat balance.
- ⚠ This deviates slightly from the brief, which puts "hitbox on" and "i-frames end" on animation frames. See Open Question 1.

### 4.3 Hitboxes and hurtboxes
- Shapes: `circle`, `aabb`, `arc` (sector: radius, half-angle, inner radius). Positions are relative to the actor's pivot, rotated by the attack direction.
- Hurtboxes: each actor has a default body hurtbox (config), optionally overridden per animation frame.
- A hitbox instance hits each hurtbox **at most once** per activation (tracked by a hit-set).
- Resolution order each tick: projectiles move → hitboxes activate → overlaps collected → per target, pick the strongest hit → apply parry/block/i-frame checks → damage, poise, stamina, knockback → juice events emitted.

### 4.4 Stamina
- `max` comes from Endurance. **Regen** starts `regenDelayTicks` (default 30) after the last spend, at `regenPerSec` (default 50). Regen while blocking is multiplied by `blockRegenMult` (0.3).
- **You can start any action if stamina > 0.** The cost is subtracted and the bar clamps at 0; it never goes negative.
- **At 0 stamina** no stamina-costing action can start until regen has restored at least `minToAct` (default 1). The bar shows an "exhausted" tint. Sprint stops at 0.
- Starting costs (all in data): roll 22, sprint 12/s, straight-sword light 14, heavy 26, block per hit = damage × `shieldStability` factor, gun fire 8, reload 10.

### 4.5 Dodge roll
- Default timeline (30 ticks): startup 1 → **i-frames ticks 2–13** → travel continues to tick 20 → vulnerable recovery 21–30. From tick 24, `cancel: [light, heavy, roll]` is allowed.
- The roll uses a distance curve (`rollDistance` 56 px with an ease-out profile), not a constant velocity. The direction is the move input, or the aim direction if there is no move input.
- Hit **during i-frames:** the hit is ignored, with no stamina or poise effect. A later hit from the same hitbox can still land after the i-frames end.
- The debug overlay shows the actor outline cyan during i-frames and red during vulnerable recovery.
- Collision: rolling does **not** pass through enemy bodies. The actor slides around them. Enemy hitboxes are what you roll *through*.
- Equip weight is a later-milestone hook and stays off by default.

### 4.6 Melee weapons
Each weapon file (`data/weapons/<id>.json`) defines:
```jsonc
{
  "id": "straight_sword", "kind": "melee", "twoHanded": false,
  "scaling": { "str": 0.5, "dex": 0.5 },
  "light": [ // combo chain; index = combo step
    { "damage": 22, "poise": 12, "stamina": 14,
      "windup": 10, "active": 4, "recovery": 16,
      "comboWindow": [14, 26], "rollCancelFrom": 12,
      "trackDegPerTick": 6,
      "lunge": { "distance": 10, "startTick": 8, "ticks": 6 },
      "hitbox": { "shape": "arc", "radius": 26, "halfAngle": 70, "offset": 4 },
      "sweep": { "fromDeg": -80, "toDeg": 80 },
      "hitstop": 2, "knockback": 60 }
    // ... step 2 and 3, each with longer recovery
  ],
  "heavy": { "chargeMinTicks": 10, "chargeMaxTicks": 50, "chargeDamageMult": [1.0, 1.6],
             "chargePoiseMult": [1.0, 1.8], "stamina": 26, "hyperArmorPoise": 30, ... },
  "backstabMult": 2.5, "riposteMult": 3.0
}
```
Starter set:
| Weapon | Character | Light chain | Heavy | Notes |
|---|---|---|---|---|
| Straight sword | Balanced | 3 hits, 10/12/14 windup | Charged thrust | The baseline everything is tuned against |
| Greataxe | Slow, crushing | 2 hits, 22/26 windup | Overhead cleave, **hyper-armor** during windup | Huge poise damage, two-handed |
| Dagger | Fast, cheap | 3 hits, 5/5/7 windup | Short lunge stab | Low stamina, backstab ×4 |

### 4.7 Ranged weapons
Ranged is a **resource**, not the default.
- `clip`, `reserveMax`, `fireWindup` (a short pre-shot aim), `fireRecovery`, `reloadTicks` (committed; you can walk at `reloadMoveMult`), and a stamina cost for firing and reloading.
- Firing aims exactly at the cursor. `spreadDeg` is 0 for crossbow and flintlock and small for the revolver.
- Reload is automatic when you fire with an empty clip, or manual with R. Reload always refills the full clip from reserve, using a single-motion animation.
- Ammo: reserve refills at shrines. Occasional **ammo pouch** drops restore a fraction of reserve. Each weapon has its own reserve (bolts, shot, powder).
- Projectiles: speed, lifetime, `pierce` count, damage, poise, knockback. Walls stop them. Shields stop them from the front.

| Weapon | Clip | Feel |
|---|---|---|
| Heavy crossbow | 1 | Slow bolt that pierces 2 targets and hits hard. Two-handed. |
| Revolver | 6 | Moderate damage, 40-tick fire recovery, long 110-tick reload. One-handed. |
| Flintlock | 1 | Huge single shot with high poise damage and a 150-tick reload. One-handed. |

Heavy input with a ranged weapon does a short **weapon bash**: low damage, some poise damage, a panic-button tool (see Open Question 4).

### 4.8 Loadout
- Two weapon slots, any mix of melee and ranged, plus an optional **off-hand shield**.
- Swapping takes a short committed animation (`swapTicks` 18) and costs no stamina.
- A two-handed weapon stows the shield: no block while it is equipped (see Open Question 3).

### 4.9 Block, parry, riposte
- Holding block raises the shield (`raiseTicks` 3). While blocking, frontal hits (within `blockArcDeg` 120) are blocked.
- A blocked hit costs stamina equal to `damage × (1 − stability)` and deals chip damage of `damage × (1 − absorption)`. If stamina hits 0, you are **guard broken**: a long stagger, vulnerable to riposte.
- **Parry window:** the first `parryWindowTicks` (6) after the block press. A frontal melee hit in that window is **parried**: no damage, the enemy enters `parried` (a long stagger), and you get hit-stop, a spark and an sfx.
  - Mashing is prevented: a parry can only be retriggered after block has been released for `parryRearmTicks`.
  - Projectiles cannot be parried, only blocked.
- **Riposte:** pressing light near (≤ 20 px) a parried or guard-broken enemy, roughly facing them, starts a paired critical animation. Both actors are locked and the attacker is invulnerable during it. It deals `riposteMult` damage.

### 4.10 Poise and stagger
- Each actor has `poiseMax`. Poise damage accumulates, and poise regenerates fully after `poiseResetTicks` without taking poise damage.
- When accumulated poise damage reaches `poiseMax`, the actor is **staggered**: the current action is interrupted, the stagger animation plays, and poise resets.
- **Hyper-armor:** some attack windups add a temporary poise buffer, for example greataxe heavies and brute swings.
- The player also has poise (from base + armour hooks), so heavy enemy hits stagger the player.

### 4.11 Backstab
- Available when the attacker is within `backstabRange` (18 px), inside the target's rear arc (`backstabArcDeg` 90, measured from the target's facing), **and** the target is unaware (not in `alert`/`combat`) **or** staggered.
- Pressing light then starts a paired critical animation for `backstabMult` damage.
- The debug overlay shows the rear arc when the overlay is on.

### 4.12 Damage model
`final = base × (1 + scalingBonus(stats, weapon.scaling)) × motionMult × critMult` minus flat defence. Stat bonus curves with soft caps live in `data/progression.json`. There is no randomness in damage.

---

## 5. Enemies

### 5.1 AI
Each enemy has a small state machine:
`idle → suspicious ("?") → notice ("!", reaction delay) → approach ⇄ strafe → attack (chooses from its moves) → … → return to post`.
Stagger, parried and critVictim can interrupt any state.

**Stealth and awareness** (added at the user's request in M3):
- **No sight range limit.** Only walls (line of sight, via a grid raycast) and the facing cone (`halfAngleDeg`) hide you.
- **Detection builds up.** While seen, an `awareness` meter (0..1) fills. It takes `detectTicksNear` at ≤ `nearDistance`, rising linearly to `detectTicksFar` at ≥ `farDistance`. Close = spotted fast, far = slow. A small meter shows above the enemy while it is filling.
- **Suspicious.** At `suspicionAt` the enemy becomes suspicious ("?"). While it can still see you, it freezes and stares. Once it can't, it walks to your last seen spot and looks around for `investigateTicks`, then gives up and goes home. Unseen, awareness fades by `forgetPerTick`.
- **Certain.** At 1.0 it is certain ("!"). After `reactionTicks` it attacks, and it **alerts every enemy in its room**.
- **Alerted room.** Alerted enemies know where you are while you are inside that room, even behind walls. After you leave the room and stay unseen for `loseTicks`, they drop back to suspicious and search.
- **Getting hit** makes an enemy certain immediately, and it alerts the room too.
- **Backstabs** work on enemies that are unaware (idle, suspicious, returning), staggered or parried. Sneaking up from behind is the payoff for stealth.
- **Navigation:** an enemy walks straight when the line is clear. Otherwise it follows a grid A* path (8-directional, no corner cutting, smoothed) and re-plans about every ⅓ s or when its goal moves. This is used for chasing, searching and returning home. Press F1 to see paths in cyan.
- **Move selection:** each attack has `range [min,max]`, `weight`, `cooldownTicks` and optional conditions (`playerHealing`, `playerBehind`, `phase>=2`). Weighted random choice uses a seeded RNG.
- **Aggression tokens:** at most `maxAttackers` (2) enemies can be in `attack` at once. The rest strafe. This keeps groups fair and readable.
- Returning enemies heal if `healOnReturn` is set per archetype (default true).

### 5.2 Telegraph contract (every enemy attack)
1. A distinct windup pose held for at least 12 ticks (in data).
2. A glint or flash at a set tick (`telegraphTick`), with a matching audio cue. Stronger attacks, and unparryable ones, use a red glint.
3. A readable active arc.
4. A **punishable recovery** of at least 18 ticks for most attacks.

### 5.3 Roster (Milestone 5; the grunt comes in M2)
| Archetype | Name | Attacks | Weakness |
|---|---|---|---|
| Basic grunt | **Wickling** | Overhead chop, 2-hit swipe, short shove | Parry, backstab |
| Shielded knight | **Bulwark Warden** | Shield bash, thrust, overhead (unparryable, red glint) | Flank, guard break with heavies, parry the thrust |
| Ranged | **Powder Acolyte** | Slow lobbed firepot (arcs, lands after 40 ticks with a ground marker), a close-range shove when crowded | Rush it. It retreats to keep distance. |
| Fast lunger | **Taper Hound** | Lunge bite (long reach, fast), a 3-bite flurry | Long recovery after lunge. Roll sideways. |
| Heavy brute | **Belfry Brute** | Bell-hammer slam (AoE ring), sweep, grab (unblockable) | Slow, and exposed behind. Hyper-armor on its slam only. |

### 5.4 Enemy projectiles
They are few, slow (60–110 px/s) and clearly shaped, with a warm-coloured outline so they always contrast with the floor. No enemy fires more than 3 projectiles in a burst.

---

## 6. Bosses

- A **Smoke Veil** doorway: walking in plays a short push-through animation. The veil seals behind you until the boss dies.
- The boss bar sits across the bottom of the screen with a name plate. A delayed "damage taken" segment trails behind the real HP.
- **Mini-boss, The Tollwarden:** an armoured gatekeeper with a halberd, 4 moves: sweeping arc, delayed thrust (a timing trap), spin, and a ground-stab shockwave line. One phase.
- **Main boss, The Chandler:** a towering wax-draped priest with a candelabrum staff.
  - Phase 1 (100–55%): staff sweep combo (2–3), overhead slam, wax-drip trail (a lingering slow zone), backstep.
  - Transition: sets itself alight, with a 60-tick invulnerable roar and a shockwave knockback.
  - Phase 2: faster rhythm with delayed attacks mixed in, plus a **3-flame volley** (slow, fanned), a charging leap slam, and a combo extension on the sweep.
- Patterns are fully data-driven (move lists, weights, phase conditions), so rhythm can be tuned in JSON.
- Bosses do not respawn once defeated, and their veil disappears permanently.

---

## 7. Healing
- Mending Phials: start with 3 charges; the maximum and heal amount can be upgraded.
- Drinking: `healTicks` 60 (~1 s) committed, with movement at `healMoveMult` 0.35. HP is restored at tick `healApplyTick` 48.
- **If the player takes damage before tick 48, the charge is consumed and wasted.** This matches the brief: any damage, not just a stagger. The drink is interrupted and a "shatter" cue plays.
- Charges refill only at shrines.

---

## 8. Shrines, saving and death

### 8.1 Wick Shrine
- An interact prompt appears when nearby. First use lights it (the discovery animation).
- **Rest:** restore HP, refill phials and ammo, respawn all non-boss enemies and props, save, then open the shrine menu (Level Up, Travel [M-later], Leave).

### 8.2 Save (localStorage)
```ts
SaveV1 {
  version: 1, lastShrine: ShrineId, discoveredShrines: ShrineId[],
  stats: { vit, end, str, dex, level }, tallow: number,
  inventory: { weapons: WeaponId[], shield: ShieldId|null, loadout: [slotA, slotB, shield],
               ammo: Record<AmmoId, number>, items: Record<ItemId, number> },
  phials: { max, healAmountLevel },
  world: { flags: string[] /* shortcuts, doors, bosses, pickups: "pickup:abbey_03_shard" */ },
  deathMarker: { roomId, x, y, tallow } | null,
  settings: { bindings, volume, screenshake }
}
```
- There is a versioned schema with migration functions (`migrate(v0→v1)`) and zod validation. A corrupt save is backed up and a new game starts, with a clear message.
- Autosave happens on rest, boss kill, shortcut open, item pickup and death.

### 8.3 Death
- The **EXTINGUISHED** screen: gameplay fades to desaturated, the text fades in, holds for ~2.5 s, then everything fades to black.
- You respawn at the last shrine. Enemies and props reset. HP, phials and ammo are restored, as with a rest, but there is no level-up prompt.
- All carried Tallow drops as a **Guttered Candle** at the death position. If you died inside a boss arena, the candle goes just outside the veil. Touching it recovers the Tallow.
- **Dying again before you recover it destroys the old marker** and places a new one.
- Persistent: defeated bosses, opened shortcuts, unlocked doors and picked-up items stay that way (world flags).

---

## 9. Progression
- Level up at shrines. Each level raises one stat by 1. The cost is a curve in `progression.json` (`cost(level) = round(a·level² + b·level + c)`).
- **Vitality** raises max HP. **Endurance** raises max stamina (and slightly raises regen). **Strength** raises melee damage by weapon scaling and adds heavy poise damage. **Dexterity** raises ranged and light-weapon damage and reload speed (reload ticks × `dexReloadCurve`).
- Soft caps are defined per stat in data.
- Smith and weapon upgrades are a later milestone (hooks only: weapon `level` field, materials in inventory).

---

## 10. World: The Guttering Abbey (first area)

### 10.1 Layout (12 rooms, 2 shrines, 1 shortcut, 1 mini-boss, 1 boss)
```
                         [11 Nave Approach]──(Smoke Veil)──[12 BOSS: The Chandler]
                                 │
 [1 SHRINE A: Porch]──[2 Courtyard]──[3 Cloister]──[4 Bell Passage]
        ║                   │                            │
   (SHORTCUT gate,       [2b Side chapel:            [5 Crypt Stair]
    opens from 10)        Phial Shard]                   │
        ║                                           [6 Ossuary]──[7 MINI-BOSS: Tollwarden]
 [10 Undercroft]──[9 Scriptorium]──[8 SHRINE B: Chapterhouse]──┘
        │
   (stairs up to 11)
```
- The route loops **1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10**, and the **shortcut gate** in room 10 opens back into room 1 (Shrine A). It is barred from room 1's side ("Barred from beyond.").
- Room 10 also climbs to **11 → 12** (the boss). After opening the shortcut, the route from Shrine A to the boss is short, which is the Souls loop payoff.
- Enemies are introduced one per room first, then mixed: 2 = grunts, 3 = knight, 4 = acolyte, 5 = hounds, 6 = brute, 9/10/11 = mixes.

### 10.2 Room data format
**Recommendation: a custom JSON format with an ASCII tile grid**, validated by zod:
```jsonc
{
  "id": "abbey_02_courtyard", "origin": [20, 0],   // tile coordinates in the area world
  "legend": { "#": "wall", ".": "floor", ",": "floor_moss", "~": "pit" },
  "tiles": [
    "##########D#########",
    "#........,,........#",
    "#..................#",
    "D..................D"
  ],
  "entities": [
    { "type": "enemy", "kind": "wickling", "at": [5, 2], "facing": "S", "patrol": [[5,2],[12,2]] },
    { "type": "prop", "kind": "crate", "at": [2, 1], "loot": "common_small" },
    { "type": "door", "id": "d_2_3", "at": [19, 3], "to": "abbey_03_cloister" },
    { "type": "shrine", "id": "shrine_porch", "at": [9, 5] },
    { "type": "pickup", "id": "abbey_02b_shard", "item": "phial_shard", "at": [3, 3] }
  ]
}
```
Why not Tiled?
- **Authorable and diffable as text.** I can write and review rooms directly, and a change shows up clearly in git.
- **No external tool** is needed to get started, and there is no heavy Tiled JSON (base64 layers, gid offsets, object property arrays).
- **Typed entities:** zod checks entity fields, which Tiled object properties don't.
- **Visual composition is the trade-off.** Mitigations: the debug room-teleport and live reload (edit JSON, save, and the room rebuilds in-game via Vite HMR). A Tiled importer can be added later behind the same `RoomData` interface without changing any game code (see Open Question 5).

---

## 11. UI / HUD (480×270, original 5×7 pixel font, generated)
- **Top-left:** HP bar (red, with a trailing "recent damage" segment), stamina bar (yellow-green, exhausted tint at 0), phial icons ×N.
- **Top-right:** Tallow counter (animates on gain or loss).
- **Bottom-right:** two weapon slots (the active one is highlighted) with an ammo readout `4 | 18` and a reload progress ring. The shield icon sits small beside them.
- **Bottom-centre:** the boss bar with its name.
- **Interact prompts** show device-aware glyphs.
- **Pause menu:** Resume / Equipment (slots, weapon stats) / Inventory / Controls (rebinding with conflict detection) / Settings (volume, screenshake %, aim assist) / Quit to title.
- **Title screen:** Continue / New Game.

---

## 12. Audio
- Placeholder SFX are **synthesised at runtime with WebAudio** (a small sfxr-style generator, with presets in `data/audio/sfx.json`). These include swing, hit, block, parry, roll, footstep, gunshot, reload clicks, telegraph cues, phial, shrine, death and UI.
- Ambient sound is synthesised the same way (`src/audio/Ambient.ts`, `data/audio/ambient.json`). Each area has beds (gusting `wind`, a low `rumble`, a soft `drone` chord or a machine `hum`) that crossfade when the area changes. Each area also has one-off events every few seconds (crows, a creaking gibbet, owls, crickets, frogs, bubbles, drips, clanks, steam, chains, a monks' choir, someone humming over the Mire, the distant bell), panned left and right. Events can hang on story conditions: the bell and choir stop once the Chandler falls, and the humming stops once the Matron does. An area can send sounds through an echo. Scenery makes sound when you're near it (campfire and cairn crackle, furnace roar, vat bubbling, gibbet creak), and fleeing critters flap, squeak or plop.
- The player's footsteps depend on what they land on (`footsteps` in `data/audio/ambient.json`). Each floor kind maps to a surface: dirt, grass, stone, wood, metal grate, mud, grease, wax or moss. Plain floor takes its area's surface (dirt on the road, mud in the Mire, stone in the Works and Abbey). Enclosed rooms echo (`roomEcho`: crypts, the nave, the flue, the chapels), and footsteps and ambient sounds carry into the echo.
- Music: an NPC with `"music": "harp"` (Wren in the hub) plays a synthesised harp air (in D minor, 3/4) while at her work pose. It is heard across the hub, fades with distance and pans, and stops while she walks or talks.
- Boss music (`src/audio/Music.ts`, `data/audio/music.json`) is a synthesised orchestra in a stone hall. Every section is several detuned voices spread across the stereo field: strings, spiccato ostinatos, an "aah" choir through vowel formants, French horns, brass, a pipe organ, celesta and harp over low strings. The percussion is taiko, pitched timpani, snare and cymbal swells. Everything plays into a generated cathedral reverb. Each boss phase has its own theme: a chord progression with layered step-pattern parts and melodies doubled across horns, strings and choir. Chords are voiced wide ("1, 5, 1 5"). Layers come in by intensity: 0 during the boss's entrance, 1 in the fight, 2 below half health. Between phases only the `hold` layers continue. When the last phase falls, the whole orchestra lands on a major chord with a timpani roll and a cymbal; if you die, the music fades. The ambience ducks under it. Themes:
  - Tollwarden, "Toll": a heroic D-minor march (i–VI–III–VII) with horn fanfares over a string ostinato, timpani and a tolling bell. Choir and high strings join when he's hurt.
  - Mire Matron, "Lullaby": an angelic celesta-and-harp waltz over a soprano choir. Strings take up the tune, then taiko and ostinatos come in below half health.
  - Mother Tallow, "Work Song": the tune she hums, picked up by horns and strings over anvil hammers in 6/8. "Unrendered", her second phase, is the same song as a brass-led charge.
  - The Chandler, "Chorale": a cathedral chorale of organ, choir, bell and celesta, with the melody sung by the choir. "Last Candle", his second phase, is the epic finale: driving strings, brass and horns, choir, organ and drums.
- Real audio files can replace any preset later: if `public/assets/audio/<id>.ogg` exists, it wins.
- Minimal cues exist from Milestone 2, because telegraphs need audio. The full pass is in Milestone 7.

---

## 13. Debug tools
- **F1** toggles the overlay: hitboxes (red), hurtboxes (green), i-frames (cyan outline), backstab arcs, perception cones, state name + tick above each actor, HP/stamina/poise numbers, and FPS/tick time.
- **F2** god mode. **F3** refills HP, stamina and ammo. **F4** kills all enemies in the room. **F5** slows time to ×0.25 to check frame data. **F6** advances a single tick while paused.
- **1–6** spawn enemy archetypes at the cursor. **Ctrl+1–9** gives weapons.
- **`~`** opens a teleport menu listing rooms and shrines, plus a flag editor for world flags.
- **Test arena** room `debug_arena`: every enemy type on pedestals (spawn on demand), a weapon rack, a training dummy that shows the damage and poise of the last hit, and a toggleable dummy "attacker" that swings on a fixed rhythm for parry and roll practice.
- **Live tuning:** editing any file in `data/` hot-reloads in-game without restarting the run.

---

## 14. Code architecture
```
src/
  main.ts                    // Phaser boot, integer scaler
  core/      FixedLoop, Rng, EventBus, math (angles, shapes), Timeline
  data/      loaders + zod schemas for everything in /data, HMR hookup
  input/     ActionMap, bindings, devices, buffer, aim
  render/    PixelScaler, CameraRig, YSort, Juice (shake, hitstop, flash), Particles, Shadows
  anim/      Manifest types, AnimPlayer (phase-stretching, cosmetic events), LayeredSprite
  actors/    Actor (sim state), ActorView, Health, Stamina, Poise, StateMachine
  player/    PlayerController + player states
  enemies/   Brain (HSM), perception, move selection, archetype behaviours, AttackTokens
  bosses/    boss controllers, phases, BossBar binding
  combat/    Hitbox/Hurtbox, CombatSystem (resolution), DamageCalc, Criticals (backstab/riposte), Projectiles
  weapons/   WeaponDef runtime, Melee, Ranged, Shield, WeaponView (rotation/layering)
  world/     RoomLoader, WorldBuilder (stitch + autotile), Doors, Props, Pickups, Shrine, DeathMarker
  progression/ stats, scaling, level costs
  save/      schema, migrations, storage
  ui/        HUD, BossBar, DeathScreen, ShrineMenu, PauseMenu, Rebind, PixelFont
  audio/     SfxSynth, AudioBus
  debug/     Overlay, Hotkeys, Teleport, DebugArena
  scenes/    Boot, Preload, Title, Game (sim + world), UI (overlay scene), Pause
data/        config/, weapons/, shields/, enemies/, bosses/, items/, rooms/, text/, audio/, progression.json
public/assets/sprites/  <name>.png + <name>.anim.json  (see ASSETS.md)
tools/       gen-art.ts (placeholder sprite generator), gen-font.ts
```
- **Sim and view are separated:** `Actor` holds float state and logic, and `ActorView` renders it. This makes render interpolation, testing and hit-stop straightforward.
- Systems talk through a typed `EventBus` (for example `hit`, `parry`, `death`, `shrineRest`), so juice, audio and UI subscribe instead of being called from combat code.

---

## 15. Art pipeline and ASSETS.md (written in Milestone 1)
- `npm run gen:art` writes chunky placeholder sheets into `public/assets/sprites/`: characters, weapons, tiles, props, FX and UI. It uses a fixed 24-colour original palette (`data/palette.json`).
- **ASSETS.md** will specify, for every sprite sheet:
  - cell size
  - pivot
  - layer (legs, torso or single)
  - animation list, with directions per row and frames per animation
  - phase tags per frame (windup, active, recovery)
  - default frame durations (used for non-phase animations such as idle and walk)
  - hand anchors per direction and frame (for weapons)
  - optional hurtbox overrides
  - cosmetic events
- **Contract:** you replace a PNG, and optionally its `.anim.json` if the frame counts change. No code or gameplay data changes.
