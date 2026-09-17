# UI lab

Four complete interface systems over the same frame of the same sector.

```
python3 -m http.server 8899      # from vanguard/
open http://127.0.0.1:8899/lab/
```

`1`–`4` switch system, `Space` flips between the combat screen and the hub,
`D` cycles phone / tablet / desktop. Nothing here is wired into the game.

Unlisted on purpose: nothing links to this, and `sw.js` does not cache it.

## Why a page and not four pictures

A HUD's whole job is staying legible over a moving, noisy, low-contrast sensor
image without burying it. Neither half of that can be judged from a still, so
the lab renders a real sector with the game's own `sector.js`, `hostiles.js`
and `thermal.js`, freezes a representative moment of a fight on it, and hands
every candidate the identical frame.

**Identical** is the load-bearing word. The scene is seeded, the hostiles are
placed by hand rather than spawned, and every system reads the same `MOCK`
state object and the same screen-space `view()` — so no candidate can flatter
itself by knowing something the others do not.

The frame is held at TRUE pixel size and scaled to fit with a CSS transform
rather than resized. A 62px stick ring judged at 0.7 scale is a 43px stick
ring, and half the point of this page is telling whether a control is big
enough for a thumb.

## The four questions

Each system answers these differently, and the answers are what to compare —
not which one looks coolest in a screenshot.

1. **How much does it claim to KNOW?** A bracket around a hostile is a promise
   that the aircraft has identified it. NVG makes almost no such promise;
   MIL-SPEC makes a great many.
2. **Where does the heat go?** It is the one number read mid-burst, and it
   decides where the thumb lives.
3. **What does it cost the sensor image?** Every pixel of furniture is a pixel
   of thermal the player cannot see through.
4. **Does it read as hardware, or as a game?**

## What the lab found on its first run

The point of building it, and it paid for itself before any of the candidates
were finished:

- **The shipped amber HUD collides with itself at phone size.** Put a hostile
  high on the screen and its bracket and class label land on top of the phase
  label, the ANVIL integrity bar and the inbound-shell countdown all at once.
  At 740x360 the top-centre is the busiest part of the interface and the only
  part with nothing reserving it. Flip to VANGUARD at PHONE to see it.
- **`Thermal.pass` could crash the render loop.** It indexed its cached grain
  tiles with `(t * 24 | 0) % grainN`, which returns a NEGATIVE index for a
  negative `t` — and `t` genuinely arrives negative, because a
  `requestAnimationFrame` timestamp is the start of the frame batch and can
  predate a clock zeroed after a slow startup. `grain[-4]` is undefined,
  `createPattern` throws, and the whole loop dies. On the low-end phones the
  sensor grade is being kept cheap for, startup is exactly what runs long.
  Fixed in `thermal.js`.

## Files

```
index.html   lab chrome, the device frame, and the four menu stylesheets
scene.js     the staged sector and the state every candidate reads
themes.js    the four systems, one function each
lab.js       tabs, true-size framing, the loop
```

The menus share one piece of markup and four stylesheets, which is the honest
test of whether a design system survives contact with a list, a progress bar
and three buttons — rather than only with a reticle.

All four draw the whole in-game interface on canvas, including the parts the
shipped game builds from DOM. That is deliberate for a mockup: one function per
system is comparable in a way that four tangles of markup and stylesheet are
not. Whichever wins gets split back apart on the way in.
