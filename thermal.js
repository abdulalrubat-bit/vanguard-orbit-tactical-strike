/* Vanguard Orbit — the sensor.
 *
 * Everything the player sees of the world goes through here. The world layer
 * is drawn in pure greys by sector.js and hostiles.js; this file is what makes
 * those greys read as a sensor feed rather than as a grey drawing.
 *
 * It is deliberately NOT a per-pixel shader. The honest version of this —
 * getImageData, walk four million subpixels, putImageData — costs about 40ms a
 * frame on the phones this is aimed at, which is the whole frame budget spent
 * on a grade. Every effect below is instead a cached tile or a gradient
 * composited with a blend mode, so the cost is a handful of fullscreen blits
 * the GPU was going to be idle for anyway.
 *
 * The one thing that genuinely needs the pixels — the jammer's tear — gets
 * them by blitting the canvas onto itself in slices, which never leaves VRAM.
 */
'use strict';

const Thermal = (() => {

  let scan = null, scanH = 0;
  let grain = [], grainN = 6, grainSize = 256;
  let vig = null, vigW = 0, vigH = 0;

  /* Scanline plate. Four device pixels per band: a one-pixel band disappears
   * into the display's own subpixel grid at any DPR above 1 and reads as an
   * overall dimming instead of as lines. */
  function buildScan(dpr) {
    const h = Math.max(3, Math.round(4 * dpr));
    if (scan && scanH === h) return;
    scanH = h;
    scan = document.createElement('canvas');
    scan.width = 4; scan.height = h;
    const g = scan.getContext('2d');
    g.clearRect(0, 0, 4, h);
    g.fillStyle = 'rgba(0,0,0,0.20)';
    g.fillRect(0, 0, 4, Math.max(1, Math.round(h * 0.34)));
  }

  /* Six grain tiles, cycled. One tile shifted around each frame reads as a
   * texture sliding over the image; six swapped at random read as noise, which
   * is what sensor grain actually is. */
  function buildGrain() {
    if (grain.length) return;
    for (let n = 0; n < grainN; n++) {
      const c = document.createElement('canvas');
      c.width = c.height = grainSize;
      const g = c.getContext('2d');
      const img = g.createImageData(grainSize, grainSize);
      const d = img.data;
      for (let i = 0; i < d.length; i += 4) {
        const v = 110 + Math.random() * 90;
        d[i] = d[i + 1] = d[i + 2] = v;
        d[i + 3] = 26;
      }
      g.putImageData(img, 0, 0);
      grain.push(c);
    }
  }

  function buildVig(w, h) {
    if (vig && vigW === w && vigH === h) return;
    vigW = w; vigH = h;
    vig = document.createElement('canvas');
    vig.width = w; vig.height = h;
    const g = vig.getContext('2d');
    const r = Math.hypot(w, h) * 0.62;
    const gr = g.createRadialGradient(w / 2, h / 2, r * 0.42, w / 2, h / 2, r);
    gr.addColorStop(0, 'rgba(0,0,0,0)');
    gr.addColorStop(0.7, 'rgba(0,0,0,0.30)');
    gr.addColorStop(1, 'rgba(0,0,0,0.72)');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    // Optical distortion is not simulated, but its consequence is: the corners
    // of a real feed are soft. Four corner smudges sell more than a lens model.
    g.fillStyle = 'rgba(0,0,0,0.18)';
    g.fillRect(0, 0, w, 3); g.fillRect(0, h - 3, w, 3);
  }

  function init(w, h, dpr) { buildScan(dpr); buildGrain(); buildVig(w, h); }

  /* The jammer's tear. Slices of the frame shoved sideways, with a couple of
   * them duplicated as a bright ghost. Self-blit, so the frame is both the
   * source and the destination and nothing is read back to the CPU. */
  function tear(g, cv, w, h, power) {
    const slices = 2 + Math.floor(power * 5);
    for (let i = 0; i < slices; i++) {
      const sy = Math.random() * h;
      const sh = 4 + Math.random() * (24 + power * 60);
      const dx = (Math.random() - 0.5) * (18 + power * 90);
      g.drawImage(cv, 0, sy, w, sh, dx, sy, w, sh);
      if (Math.random() < 0.35) {
        g.save();
        g.globalCompositeOperation = 'lighter';
        g.globalAlpha = 0.16 + power * 0.2;
        g.drawImage(cv, 0, sy, w, sh, dx * -1.4, sy + 2, w, sh);
        g.restore();
      }
    }
    // Sync loss: the whole image jumps a few lines. Rare, and worth it.
    if (Math.random() < power * 0.25) {
      const off = (Math.random() - 0.5) * 30 * power;
      g.drawImage(cv, 0, 0, w, h, 0, off, w, h);
    }
  }

  /* Applied to the composited frame, in this order, on purpose:
   *   grain     — belongs to the sensor, so it sits UNDER the optics
   *   tear      — belongs to the interference, so it displaces the grain too
   *   scanlines — belongs to the display, so nothing displaces it
   *   vignette  — belongs to the lens
   *   cold cast — last, so it tints everything including the furniture
   */
  function pass(g, cv, w, h, t, jam, quality) {
    // Everything below is measured in DEVICE pixels, because the cached tiles
    // and the self-blit source rectangle are. The caller's canvas carries a
    // devicePixelRatio transform for the world layer; leaving it in place drew
    // the vignette at twice its size and tore the wrong slices.
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);

    if (quality > 0) {
      const tile = grain[(t * 24 | 0) % grainN];
      g.save();
      g.globalAlpha = 0.5 + (jam * 0.4);
      const ox = -Math.random() * grainSize, oy = -Math.random() * grainSize;
      const p = g.createPattern(tile, 'repeat');
      g.translate(ox, oy);
      g.fillStyle = p;
      g.fillRect(-ox, -oy, w, h);
      g.restore();
    }

    if (jam > 0.02) tear(g, cv, w, h, jam);

    if (quality > 0 && scan) {
      const p = g.createPattern(scan, 'repeat');
      g.fillStyle = p; g.fillRect(0, 0, w, h);
    }

    if (vig) g.drawImage(vig, 0, 0);

    // FLIR white-hot is monochrome, but the black end of a cooled sensor is
    // never neutral — it sits cold. Two points of blue in the shadows is the
    // difference between "grey" and "a camera".
    g.save();
    g.globalCompositeOperation = 'screen';
    g.fillStyle = 'rgba(12,20,30,0.55)';
    g.fillRect(0, 0, w, h);
    g.restore();

    g.restore();
  }

  return { init, pass };
})();
