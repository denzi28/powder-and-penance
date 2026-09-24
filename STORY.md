# Powder & Penance: story (Act 1 draft)

The map is in [WORLD.md](WORLD.md).

## The world
- For a thousand years the **Great Wick** in the Cathedral has held back **the Drip**: a slow curse that turns the living into wax.
  - The first sign is cold, stiff fingers. Then the skin shines.
  - At the end, a **Wickling**: a walking candle that remembers nothing but its last prayer.
- The **Order of the Taper** tends the flame. Its law: all fire must be lit from the Wick. Any other fire is heresy, and **gunpowder** (fire in a paper cartridge, owned by no one) is the worst heresy of all.
- **Tallow** is the Order's holy currency. It buys bread, absolution and passage. Everyone knows the Abbey makes it. No one asks how.
- Now the Wick is **guttering**. The Drip spreads faster every year, and the Order sends more and more "penitents" to the Guttering Abbey to "give themselves to the flame".

## You: the Penitent
- A condemned **powder-maker**, sentenced to walk the Penance Road to the Abbey.
- A silent protagonist: others talk, you choose "talk" or "leave".
- **The mystery:** the Drip does not touch you. Maudlin notices first. The answer is for Act 2 (a hint: powder-makers breathe saltpetre all their lives).

## Act 1, beat by beat
1. **The Wreck** (road_01). Wicklings attack the prison wagon at dusk; the guards die, and the wagon overturns. You crawl out and take a dead guard's sword and the pistol. Fellow convict **Oskar** is still locked in the cage.
2. **The road** (road_02–05). You fight your way along the ravine. From the Hill of Candles you see the Abbey on its hill, candles in every window, and above it a black column of smoke.
3. **Wick's Rest** (hub). Sister **Maudlin** keeps the last honest shrine. She is kind, tired, and careful with her words. She notices your hands are warm.
4. **The Abbey** (abbey). The Tollwarden guards the Gatehouse and collects the "toll" of every pilgrim who passes: themselves. Killing him gives you the **Toll Key**, used by the Order's carts to the Tallow Works. In the Scriptorium, **Brother Aldous**, a deserter already half wax, begs you not to go down there.
5. **The Tallow Works** (works). The pilgrims were never given to the flame. They were **rendered**. The vats, the hooks, the ledger in the Foreman's office: every Tallow in your pocket was a person. **Mother Tallow**, the Works' keeper, drowned in her own vats long ago and never stopped working.
6. **The Waxmire** (mire). Where the Abbey dumps what the vats won't take. The **Mire Matron**, once the abbey's midwife, sings to the drowned. **Pip**, a pilgrim child who slipped away from the carts, hides here.
7. **The Nave.** Both Seals open the great door. **The Chandler**, head of the Abbey, has fed the flame for forty years and watched it gutter anyway. Phase 2: he pours his own wax onto the altar fire.
8. **Ending.** Dying, the Chandler says the Wick was never starving: *"Something up there is drinking it."* The lift to the Cathedral groans awake. **End of Act 1.**

## Characters

| Character | Where | Arc |
|---|---|---|
| **Sister Maudlin** | Hub | Shrine keeper who levels you up. She knew about the rendering and stayed silent to keep the shrine open. Bring her the Chandler's ledger and she confesses. You can forgive her (she stays and helps in Act 2) or condemn her (she leaves; her shrine goes cold). |
| **Oskar Fennick** | Wreck → hub | A fellow convict: loud, funny, a smuggler of powder. Free him from the cage (after you find the key on the road) and he runs the hub stall: ammo and powder. Quest: his hidden cache in the Powder Vault unlocks gun upgrades. If you never free him, you find his cage empty and a new Wickling on the road. |
| **Brother Aldous** | Abbey Scriptorium | A Warden deserter turning to wax. Give him Bitter Salt to slow it and he fights beside you against the Chandler. Otherwise you meet him later in the Nave Approach as a Wickling that still carries his shield. |
| **Pip** | Waxmire | A pilgrim child, quiet, collects candle stubs. Escort them to the hub, where they sit by Maudlin's fire. Small lore lines. Pays off in Act 2. |
| **Tomas** | Hub | The lamplighter. Walks the yard lighting the lamps; ask him the way and he tells you where to go next. |
| **Hedda** | Hub | The water-carrier: well to fire and back. Wells are for talking at, so she hears everything: she points you at secrets you haven't found. |
| **Bede** | Hub | The woodcutter. Splits logs at his block and carries them to the fire. Gives you what he found in the woodpile. |
| **Old Agnes** | Hub | A pilgrim who kneels at the shrine, and at the graves in the south-west yard. Remembers when the Wick burned bright. |
| **Ulla** | Hub | A pilgrim wife from the coast who keeps the west camp's fire going. Talks about the graves and why they stay. |
| **Jost** | Hub | Ulla's husband, an old pilgrim with a scallop shell whose knees won't take the road home. Points the way to the Abbey. |
| **The Tollwarden** | Abbey Gatehouse | Speaks before the fight: "Toll is paid in tallow, pilgrim. And tallow is paid in you." |
| **Mother Tallow** | Works | Wordless. Hums a work song. |
| **Mire Matron** | Waxmire | Sings; asks if you've come to be born again |
| **The Chandler** | Abbey Nave | Not a monster. A tired man who did something monstrous because he believed the alternative was worse. |

## Built so far
| Thread | State |
|---|---|
| Opening cutscene at the Wreck (`wreck_intro`): the crash, Oskar calls from the cage | ✅ |
| Oskar in the cage (`oskar_wreck`): questions; the **Cage Key** (chest by the dead guard in road_02); unlock him | ✅ |
| Oskar at his hub stall (`oskar_hub`): thanks, his story; the shop comes later | ✅ (no shop yet) |
| The Abbey view from the Hill of Candles (`abbey_view`) | ✅ |
| Arriving at Wick's Rest (`arrive_wicks_rest`): Maudlin calls you to the fire | ✅ |
| Maudlin at the shrine (`maudlin`): first meeting (warm hands), the Drip, the Abbey, the Toll Gate | ✅ (levelling comes later) |
| **The Tollwarden** (Abbey Gatehouse). His entrance line: "Toll is paid in tallow, pilgrim. And tallow is paid in you." His last words (`tollwarden_death`): he kept count of every pilgrim sent to the Works so they wouldn't be only tallow. His name was **Anselm**. He gives you the Toll Key. | ✅ |
| Maudlin hears of Anselm's death (a new option once you've heard his last words) | ✅ |
| Arriving at the Works (`works_arrive`) | ✅ |
| **The Rendering Hall reveal** (`rendering_reveal`): the robes with name tags, the carts, "The Tallow in your pouch is warm. It always has been. Now you know why." | ✅ |
| The Chandler's Ledger (Foreman's Office): names and weights. Showing it to Maudlin: her confession begins. | ✅ (the full forgive/condemn choice comes with the Chandler) |
| **Mother Tallow** (`mother_tallow_death`): wordless. She sinks back into the vat she never stopped tending, ladle still in her hand. **Seal of Tallow.** | ✅ |
| **Pip** (Waxmire, `pip_mire` → hub `pip_hub`): slipped off the carts, hides in a ring of candles, heard the singing lady call. Sent to Wick's Rest; gives you a candle stub; later notices the singing has stopped. | ✅ (the Act 2 payoff comes later) |
| **The Mire Matron** (`matron_death`): the Abbey's midwife. When the Drip came into the cradles she couldn't give the children to the flame, so she brought them down to the mire and sang to them, and never stopped. **Seal of the Mire.** | ✅ |
| **The Chandler** (Nave). Entrance: kneeling at the altar, he finishes his prayer first: "Kneel, child. It is quicker kneeling." His turn: "Forty years I fed it. Then let it have the last of me." He pours himself onto the altar fire and rises as **the Last Candle**, a black flame on his wick. | ✅ |
| **The ending** (`chandler_death`): he confesses the rendering and the ledger he signed; *"The Wick was never starving. Something up there is drinking it."* He asks you to climb for him. The lift chains wake; **END OF ACT ONE**. Sets `chandler_rests` and `act1_complete`; the lift opens with `act2`. | ✅ |
| Brother Aldous | Next, with the Abbey revision |

## Writing dialogue and cutscenes
Everything is data; the game hot-reloads it and checks every reference when it loads.

**Characters:** `data/npcs.json` gives each a name, a sprite, and a portrait frame.

**Voices:** as a line types out, the speaker "talks" in blips, like Undertale.
- Each character has a `voice`: `{ "sfx", "pitch", "every", "volume" }`.
  - `sfx` is a preset in `data/audio/sfx.json`: `voice` (a square chirp), `voice_soft` (round), or `voice_low` (a growl).
  - `pitch` sets how high it is. Small and young characters are high (Pip 1.75). Bosses are low (Tollwarden 0.62).
  - `every` means one blip per that many letters. Use 3 for slow, heavy talkers.
- `narration` is the voice of lines with no speaker. It is soft and quiet.
- Spaces and punctuation are silent. A line skipped with a press is silent too.

**Placing a character in a room:**
```json
{ "type": "npc", "id": "oskar_wreck", "npc": "oskar", "talk": "oskar_wreck", "when": "!oskar_freed", "at": [9, 7] }
```
- The character appears only while `when` holds.
- Press E nearby to run the `talk` script.

**Giving a character a life (routines):** townsfolk walk from stop to stop and do their job at each one.
```json
{ "type": "npc", "id": "hedda", "npc": "hedda", "at": [10, 16], "talk": "hedda",
  "routine": [
    { "at": [10, 16], "do": "work", "ticks": 220, "face": -1 },
    { "via": [[11, 14], [16, 14]], "at": [20, 16], "do": "work", "ticks": 150, "face": 1 },
    { "at": [21, 18], "do": "idle", "ticks": 280 }
  ] }
```
- Each stop: walk there in straight lines through the `via` points (room tiles), then `do` it for `ticks`: `idle`, `work` (their job: lighting lamps, drawing water, chopping), `sit` or `kneel`. `face` turns them left (-1) or right (1). The routine loops.
- Without a routine, `"pose": "sit"` / `"kneel"` / `"work"` keeps them at it where they stand.
- Walks must stay on open floor, clear of solid scenery: `tests/npcs.test.ts` checks every route.
- They stop and give way if you stand in their path, stand still while any script runs, and face you when you come close.
- `workSfx` in `data/npcs.json` plays on each stroke of the work pose when you're near (Bede's axe).
- Walking and working need the 12-frame townsfolk sheets (`genTownsfolk` in tools/gen-art.ts): 0-1 idle, 2-3 talk, 4-7 walk, 8-9 work, 10 sit, 11 kneel.

**Chatter between characters (`data/chatter.json`):** now and then, people standing near each other trade a few lines in speech bubbles, if you're close enough to see.
```json
{ "id": "anselm", "who": ["tomas", "maudlin"], "when": "boss:tollwarden",
  "lines": [["tomas", "They say the Tollwarden fell. Old Anselm."], ["maudlin", "He kept a count of every one he sent down."]] }
```
- `who` are placement ids; they must all be present and within `range` px (default 80) of the first.
- `when` ties the talk to the story. A chat isn't repeated until the others have been heard.
- They pause what they're doing and face each other while they talk. Talking to one of them yourself interrupts it.
- Lines are short (90 characters at most): they sit in a bubble over the speaker's head.
- `tests/npcs.test.ts` checks that every chat pairs people whose routines bring them within range.

**Cutscene trigger:**
```json
{ "type": "cutscene", "id": "abbey_view", "script": "abbey_view", "at": [19, 5], "size": [2, 3] }
```
- It plays once per save, when the player walks into the rectangle.
- Add `"when"` for extra conditions.

**Camera point:** `{ "type": "point", "id": "wagon", "at": [8, 7] }` gives a cutscene camera something to look at.

**Scripts:** `data/scripts/<id>.json`, as `{ "id", "skippable": true|false, "steps": [...] }`. Steps:

| Step | Does |
|---|---|
| `{ "say": "...", "who": "oskar" }` | A line. Without `who`, it's narration. |
| `{ "menu": [{ "text", "when"?, "do": [steps], "end"?: true }] }` | Choices. The menu comes back until an option with `end` is picked, and it remembers the cursor. |
| `{ "if": cond, "then": [steps], "else": [steps] }` | Branch on flags |
| `{ "set": "name" }` / `{ "clear": "name" }` | Story flags (saved) |
| `{ "wait": ticks }` | Pause |
| `{ "camera": "player" \| "npc:<id>" \| "point:<id>", "ticks"? }` | Pan the camera. End a script with `"player"` to give it back smoothly. |
| `{ "fade": "out" \| "in", "ticks"? }` | Fade to or from black. Narration stays visible over black. |
| `{ "sfx": id }`, `{ "shake": 0..1 }`, `{ "toast": [title, body] }` | Presentation |
| `{ "give": itemId }` | Give an item, explained like a chest's |

**Conditions:**
- A bare name is a story flag (`"oskar_freed"`).
- A name with a colon can be any world flag (`"key:toll_key"`, `"shrine:shrine_rest"`).
- A leading `!` negates, and a list means all of them must hold.

**While a script runs, the world pauses.**
- E, Enter, Space or a click advances a line (the first press finishes the typing).
- W/S or the arrow keys move through choices.
- Esc skips a skippable cutscene; flags it would set are still set.

## Cutscenes (Act 1)
All in-game and short (under 30 s), and skippable.
1. The wagon crash (opening)
2. Arriving at Wick's Rest
3. The Tollwarden's intro
4. The Rendering Hall reveal
5. The Chandler: intro, and his phase-2 turn ✅ (in-fight, like every boss)
6. Ending: the Chandler's last words, the lift, the Cathedral ✅ (a `card` step shows END OF ACT ONE over the fade)
