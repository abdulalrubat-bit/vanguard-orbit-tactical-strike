# Frontline × Vanguard — transition prototype

One question, answered by playing it: **does dropping from a turn-based grid
into a real-time gunship sortie and coming back out feel like one game?**

```
python3 -m http.server 8877        # from the repo root
open http://127.0.0.1:8877/prototype/
```

Pick a faction, then **CALL VANGUARD** in Frontline's own button bar, tap a
tile with enemies on it, and fly. What you kill up there is dead down here.

This is a throwaway branch. Nothing here is on `main` and neither game was
modified to make it work.

## The headline: Modern Frontline does not currently run

Found while wiring this up, and it matters more than the prototype does.
**Five functions are called and defined nowhere in the file.**

| Missing | Called by | Consequence |
|---|---|---|
| `screenToWorld` | the canvas `pointerup` handler | every tap throws; **no unit can ever be selected or moved** |
| `centerCameraOn` | `playerAction` | throws the moment a unit is selected |
| `targetValue` | `enemyTurn`, ×4 | — |
| `bestObjectiveFor` | `enemyTurn` | — |
| `bestMoveToward` | `enemyTurn` | ending your turn throws, so `phase` stays `"enemy"` and `enemyBusy` stays `true` — **the player can never act again** |

Verified by loading the file on its own, with no bridge and no iframe: tapping
your own unit leaves `selected` at `null` and logs
`screenToWorld is not defined`.

All five are reconstructed in `frontline/index.html` in this folder, each under
a `PROTOTYPE FIX` banner explaining the contract its call sites imply. They are
reconstructions, not recovered originals — written to be judged and replaced
rather than inherited. **The real fix belongs in the `modern-frontline`
repository**, which this session only has read access to.

With them in, Frontline plays: select, move, attack, end turn, enemy AI takes
its turn, turn counter advances, zero page errors.

## The second finding: these two cannot share a global scope

The games share **21 top-level names**, among them `setZoom`, `resize`,
`finish`, `ctx`, `zoom`, `tile` and `road`. Concatenating the files does not
"mostly work" — it silently breaks both.

So a merge is not a copy-paste job at any scale. This prototype is therefore
shaped the way the real thing has to be: **two worlds, one bridge.** Each game
runs in its own same-origin iframe, keeping its own scope, and `bridge.js` in
the parent reaches into both. That is the smallest possible stand-in for the
module boundary a real merge needs.

## What is real

- The tile you pick, its terrain, and the enemy units standing within one tile.
- The sector you fly over, seeded from the tile — the same ground always flies
  the same sector, which is what makes the two maps feel like one place.
- The hostiles, derived one-for-one from those units.
- The deaths, written back to the grid. Frontline's own `checkWin` then runs.
- The credits, spent from Frontline's own economy — so a strike competes with
  reinforcements for the same money. That tension is the whole reason to share
  a currency.

Each ground unit becomes one **signature** hostile plus escorts, and the
signature kinds are unique per unit type. That is what makes the result legible
in both directions — kill a Phalanx up there and a tank dies down here, and the
player can see why without being told.

| Ground unit | Signature | Escort |
|---|---|---|
| Tank | Phalanx | 1 ghost |
| Recon | Technical | — |
| Artillery | Jammer | 2 ghosts |
| Infantry | ghost ×3 | pooled damage |

## What is faked

- **Cross-frame reads go through `eval`.** A top-level `let units = []` is not
  `window.units`, so the bridge asks the frame's own global `eval` for it. Every
  such read is marked `X(` in `bridge.js`. A real merge exports them instead.
- **Terrain steers the roster and the seed, not the sector's shape.**
  `Sector.generate` takes a seed and nothing else today. A city tile fields more
  infantry and a road tile fields a technical, but the sector it generates does
  not yet look more built-up. That is the obvious next thing to pay for.
- **The convoy is not a Frontline unit.** It is Vanguard's own, standing in.
  Losing it aborts the sortie and you keep only what you had already killed.

## What it proves, and what it does not

It proves the seam holds: the translation in both directions is small, legible
and already works. Roughly three hundred lines of bridge, no changes to either
game.

It does **not** prove the pacing. A 60-second sortie inside a turn is a guess,
and the only way to know is to play twenty of them. That is the next question,
not a design one.
