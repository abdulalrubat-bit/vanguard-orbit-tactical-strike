# Vanguard Orbit: Tactical Strike

Top-down gunship overwatch. You are a loitering asset above a city block,
watching it through a thermal sensor, and callsign ANVIL is driving a ground
element through the middle of it. ANVIL only moves while the road ahead is
clear. Eight phase lines, three guns, one convoy — and the convoy is both the
objective and the health bar.

Hand-written, no engine. Offline once loaded, no accounts, no network calls,
nothing leaving the device. Saves one best score and one audio toggle to
`localStorage` and nothing else.

```
index.html     shell, HUD, overlays, all CSS
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

## Balance, and what the harness cannot see

`tools/sim.mjs` runs whole missions with the renderer off, stepping the same
update functions the real loop calls, under three policies:

```
PASSIVE   nobody shoots                  loses in ~1min, every seed
ROOKIE    25mm only, 0.8s to react,      wins, mean integrity ~84
          a third of its rounds thrown
GUNNER    right gun, no waste, perfect   wins clean, ~3min
```

It has already earned its keep twice. The convoy's own suppressive fire used to
clear the entire first wave by itself, turning the tutorial into a cutscene.
And hostiles used to spawn nine hundred metres out, which gave the player
twenty uninterrupted seconds to shoot a wave in a queue — ROOKIE finished eight
waves on full integrity before they were moved in.

But read the ceiling honestly. GUNNER is omniscient: it always knows where
every Ghost is, and the camera is wherever it needs to be on the same frame.
Those two things are the actual difficulty of this game and the harness models
neither. GUNNER finishing untouched does not mean the mission is easy; it means
a player who has already solved acquisition wins cleanly, which is the right
ceiling. The number worth watching is the gap between ROOKIE and PASSIVE.

```
python3 -m http.server 8899          # from this directory
npm install && node tools/sim.mjs    # from another
```

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
