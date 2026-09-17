# Vanguard Orbit: Tactical Strike

Top-down gunship overwatch. You are a loitering asset above a city block,
watching it through a thermal sensor, and callsign ANVIL is driving a ground
element through the middle of it. ANVIL only moves while the road ahead is
clear — and the convoy is both the objective and the health bar.

You start with the aircraft's own 25mm and nothing else. Every sortie pays
requisition, requisition buys the next piece of capability in the order a real
programme would field it, and the opposition fields new problems as you climb.

Hand-written, no engine. Offline once loaded, no accounts, no network calls,
nothing leaving the device. Saves one career file and one audio toggle to
`localStorage` and nothing else.

```
index.html     shell, HUD, overlays, all CSS
career.js      the ladder: ranks, rungs, the save file, the roster gate
sector.js      the city: road grid, blocks, buildings, route, walkability
hostiles.js    the four hostiles — stats and thermal signatures
thermal.js     the sensor grade: grain, scanlines, tear, vignette
game.js        the game — camera, sticks, gunnery, waves, convoy
sw.js          offline cache — generated, run tools/stamp-sw.py
tools/         the service-worker stamper and the balance harness
```

There are no assets. No images, no fonts, no audio files, no `assets/`
directory. The city is generated, the hostiles are drawn from primitives, the
icons are rendered at build time and the gunfire is synthesised. The whole
shipped game is about 210KB and two thirds of that is three PNG icons.

Open `index.html` over http, or from `file://` — the service worker is skipped
there on purpose, so local dev and a WebView build both work.

## Asphalt is bright and rooftops are dark

That is the entire art direction, and it is backwards from how a top-down map
normally reads. It is also correct: a thermal sweep at night sees a road that
has been baking all day still giving its heat back, and sheet-metal roofs that
dumped theirs an hour after dusk.

It happens to be the most useful thing the view could possibly do, because the
route the player is protecting is then the brightest line on the screen, and
the buildings that block the shot are the darkest. The player reads the
tactical situation off the luminance before reading a single piece of
interface.

The interface, in turn, is the only amber on the screen. Nothing in the world
layer may be amber and nothing in the HUD may be grey. One `if` away from mud,
and the whole look depends on it.

## The map is not painted

A seed produces road centrelines, the blocks between them, the buildings inside
those blocks and the convoy's route through all of it. Three things fall out of
that, and the third is the one that mattered:

- **The route and the roads are the same data.** The convoy drives the polyline
  the renderer stroked.
- **Walkability is built from the building rectangles that were just drawn.**
  Hostiles path around exactly what the player can see.
- **Any building the route would drive through is deleted.** Before the route
  existed, a building on the road was not an obstacle, it was a convoy grinding
  against a wall forever.

Hostiles navigate a breadth-first distance field rebuilt from the convoy twice
a second — four thousand cells, cheap enough that nobody queues against a wall
the convoy drove past ten seconds ago. A\* per hostile was the first version.
It was correct, and it cost more than every other system put together once a
wave passed twenty.

## Every hostile takes a weapon away

A hostile that can be answered by holding the right stick down is not a
hostile, it is a delay. So each of the four removes something:

| | takes away |
|---|---|
| **Ghost infantry** | *Seeing them.* Thermal-dampening capes put them fifteen points of luminance above the dirt. They flare white for a second and a half when they fire, and that window is the fight. |
| **Jammer technician** | *The automatic trigger.* Never shoots. While its broadcast covers your window, deflecting the aim stick no longer spools the gun and you are on the manual trigger. |
| **Industrial Phalanx** | *The gun you have been using.* Advances behind a concrete-filled cable spool. A 25mm burst into the front arc is discarded — silently, apart from a spark, because noticing that nothing is happening is the lesson. Splash ignores the drum. So does anything arriving from behind. |
| **Over-clocked technical** | *Time.* Redlined engine block, bright enough to spot at 1.00x, and fast enough to reach the convoy in a quarter of the time infantry take. A direct 40mm on the block cooks the fuel off and takes its neighbours with it. |

## Heat is the 25mm's whole skill ceiling

Held down, the rotary cannon locks out in a little over five seconds and the
lockout is long. Killed by short bursts, it never heats at all. The gauge is
eighteen segments wrapped around the aim stick rather than a smooth arc,
because a smooth arc tells you how hot you are and segments tell you how many
more bursts you have — which is the question actually being asked.

## The ladder, and the rule that makes it playable

Capability arrives in the order a real programme would field it, not in the
order of a damage spreadsheet. You do not buy "+10% damage" — you get a better
sensor head, then a second gun station, then a fuze for it. Twelve rungs across
four tracks, and each one changes a decision rather than a number nobody sees.

The rule that makes that work is the second one:

> **The threat roster unlocks in step with the ladder.**

A Phalanx cannot be killed without splash, so a Phalanx may not appear before
the 40mm station is within reach. A jammer takes the automatic trigger away,
which means nothing until the player has come to rely on it. Four lines of
code, and they are the entire difficulty curve:

```js
const r = ['ghost'];
if (tier >= 1) r.push('technical');
if (tier >= 2) r.push('jammer');
if (tier >= 3) r.push('phalanx');
```

Ranking up is therefore not "the numbers got bigger". It is a new problem
arriving, and the means to solve it — deliberately in that order, so the first
drum you ever meet is met with a gun that can just about handle it and a better
answer already on the shelf.

Rank is gated on **lifetime** requisition rather than the balance in hand, so
spending never costs you a rank. A ladder that punishes you for climbing it is
a ladder players learn to hoard against. The total cost of the ladder (41,600)
and the top rank's gate (42,000) are the same number on purpose: the last rung
and the last promotion arrive together.

The first rung is priced at 800 against a clean first sortie's ~980, so the
very first thing a player does after their first win is spend.

## Balance, and what the harness cannot see

`tools/sim.mjs` runs whole missions with the renderer off, stepping the same
update functions the real loop calls, under three policies and at whichever
rungs a player would plausibly own at that rank:

```
PASSIVE   nobody shoots
ROOKIE    25mm only, 0.8s to react, a third of its rounds thrown away
GUNNER    right station every time, no waste, heat respected

               passive        rookie                gunner
  tier 0       lost, 1.2min   won 4/4, 100 integ    won 4/4, 100 integ
  tier 1       lost, 1.2min   won 4/4, 100 integ    won 4/4, 100 integ
  tier 3       lost, 1.1min   won 1/4,   2 integ    won 4/4, 100 integ
  tier 5       lost, 0.9min   won 0/4,   0 integ    won 4/4,  81 integ
  tier 6       lost, 0.8min   won 0/4,   0 integ    won 4/4,  99 integ
```

Read down the ROOKIE column: that is the ladder working. A 25mm-only pilot
cruises the first two tiers, is pushed to the wire at tier 3, and cannot beat
tier 5 at all — which is correct, because by tier 5 the sector is fielding
Phalanxes and a 25mm cannot kill a drum from the front however well it is
aimed. The sim is proving that hostile does its job.

It has earned its keep four times now. The convoy's own suppressive fire used
to clear the entire first wave by itself, turning the tutorial into a cutscene.
Hostiles used to spawn nine hundred metres out, which gave the player twenty
uninterrupted seconds to shoot a wave in a queue. A direct 40mm did not quite
kill a technical, so the secondary detonation the weapon is sold on never
fired. And it put mean sortie pay at about 1,800 REQ — at the first prices the
entire ladder fell in twelve sorties, under an hour to exhaust everything the
game has, so every cost and every rank gate was doubled.

But read the ceiling honestly. GUNNER is omniscient: it always knows where
every Ghost is, and the camera is wherever it needs to be on the same frame.
Those two things are the actual difficulty of this game and the harness models
neither. GUNNER finishing untouched does not mean the mission is easy; it means
a player who has already solved acquisition wins cleanly, which is the right
ceiling. The number worth watching is the gap between ROOKIE and PASSIVE.

```
python3 -m http.server 8899                      # from this directory
npm install && node tools/sim.mjs                # from another
SIM_TIERS=0,1,3,5,6 SIM_RUNS=4 node tools/sim.mjs
```

There is one more blind spot worth naming, and it is tier 0's. A probationary
operator's whole problem is that Ghosts are nearly invisible until they fire —
and ROOKIE is handed their coordinates. The harness cannot measure the only
difficulty that tier has.

## What is not here yet

`CAMPAIGN` in `game.js` is an empty array and a comment. Authored sectors drop
into it and become the spine; `nextSortie()` already hands out `CAMPAIGN[n]`
while one exists for this sortie number and falls through to a generated sector
afterwards. The career underneath does not care which it got — the ladder, the
payouts and the roster gating all read the same plan object either way, which
is the whole reason that hook is two lines rather than a rewrite.

Also absent: opt-in rewarded video (the studio's rule is a benefit you choose,
never a gate), and the Android packaging, which by the Rivenmark precedent
belongs in its own repo and is deployed into this one as a web build.

## The sensor is not a shader

The honest version of the thermal grade — read four million subpixels, grade
them, write them back — costs about 40ms a frame on the phones this is aimed
at, which is the entire frame budget spent on a look. Every effect in
`thermal.js` is instead a cached tile or a gradient composited with a blend
mode.

The one thing that genuinely needs the pixels is the jammer's tear, and it gets
them by blitting the canvas onto itself in slices, which never leaves VRAM. The
contrast grade is baked into the sector bitmap once at generation rather than
applied to the blit sixty times a second.

If the frame still cannot be held, the grain and the scanlines come off
automatically after four seconds of play. A phone that cannot keep up gets a
plainer picture rather than a slideshow with beautiful grain on it.
