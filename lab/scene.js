/* UI lab — the scene under the interface.
 *
 * A HUD cannot be judged against a flat colour. Half the job of this interface
 * is staying legible over a moving, noisy, low-contrast sensor image, and the
 * other half is not burying that image. So the lab renders a REAL sector using
 * the game's own sector.js, hostiles.js and thermal.js, freezes a
 * representative moment of a fight on top of it, and hands every candidate
 * interface the identical frame.
 *
 * Identical is the important word. The scene is seeded, the hostiles are
 * placed by hand rather than spawned, and nothing here reads a clock except
 * the small amount of motion that makes the picture honest — a HUD that only
 * works on a still is a HUD nobody has tested.
 */
'use strict';

const Scene = (() => {

  const SEED = 41207;
  let sector = null, terrain = null;

  /* The moment being staged: mid-sortie, third phase line, a jammer working,
   * a Ghost squad in the open having just fired, a technical coming down the
   * road and a Phalanx behind its drum. It is the busiest the screen honestly
   * gets, which is the frame an interface has to survive. */
  const MOCK = {
    phase: 3, phases: 8, label: 'ELECTRONIC WARFARE',
    integrity: 62, hostilesLeft: 9,
    heat: [0.38, 0.12, 0.0], weapon: 0, locked: false,
    stations: [true, true, false],
    zoomIdx: 0, zooms: [1.0, 1.75, 3.0],
    jam: 0.22, jammed: false,
    rank: 'SECTION LEAD', req: 3480, lifetime: 11600, nextAt: 18000,
    nextRank: 'FLIGHT LEAD', sorties: 14,
    stickL: { on: true, dx: 0.42, dy: -0.18 },
    stickR: { on: true, dx: 0.58, dy: -0.34 },
    inbound: 0.62                       // seconds to impact on the staged shell
  };

  let hostiles = [], convoyD = 0, cam = { x: 0, y: 0, z: 1 };
  let fx = [];

  function build() {
    sector = Sector.generate(SEED);
    sector.line = densify(sector.route, 18);
    terrain = sector.terrain;

    convoyD = sector.line.total * 0.34;
    const c = at(convoyD);
    // Framed so the convoy sits about a quarter in from the left and the
    // hostiles fill the rest. The first cut put ANVIL exactly on the left edge
    // at 1.75x, which flattered every candidate equally by hiding the one mark
    // all four of them have to draw.
    cam.x = c.x + 150; cam.y = c.y - 10; cam.z = 1;

    // Hand-placed, in world offsets from the convoy. Positions chosen so that
    // every candidate interface has to deal with the same three problems: a
    // cluster in open ground, a single fast mover coming in from an edge, and
    // something tucked against a building where the brackets will collide with
    // the furniture.
    const P = [
      ['ghost', 214, -104, 2.6, 1.0], ['ghost', 258, -62, 2.7, 0.85],
      ['ghost', 190, -36, 2.9, 0.0], ['ghost', 296, 34, 3.0, 0.55],
      ['ghost', 118, 116, 2.2, 0.0],
      ['technical', 330, 104, 3.1, 0.4],
      ['phalanx', 240, 96, 3.05, 0.0],
      ['jammer', 152, -138, 2.8, 0.0],
      ['ghost', 330, -126, 2.75, 0.3]
    ];
    hostiles = P.map(([kind, dx, dy, face, flare]) => {
      const k = Hostiles.KINDS[kind];
      return {
        kind, x: c.x + dx, y: c.y + dy, face, flare,
        hp: k.hp * (0.45 + Math.random() * 0.55), max: k.hp, tag: 1, hitT: 0
      };
    });

    // One blown highlight, kept small and pushed out of the middle. The first
    // version was a ninety-pixel fireball parked beside the reticle: it made
    // every interface look like it was competing with a searchlight, which
    // tests nothing except the fireball.
    fx = [
      { k: 'boom', x: c.x + 296, y: c.y - 128, r: 46, t: 0.2, life: 0.9, power: 0.8 },
      { k: 'scar', x: c.x + 296, y: c.y - 128, r: 34, t: 1.2, life: 26 },
      { k: 'scar', x: c.x + 140, y: c.y + 48, r: 30, t: 9, life: 26 }
    ];
    Hostiles.setGain(0);
    return sector;
  }

  /* Lifted from game.js rather than imported, because the lab must keep
   * working if the game's copies are refactored underneath it. Two small
   * functions is a cheaper coupling than a shared module nobody may touch. */
  function densify(pts, step) {
    const out = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const d = Math.hypot(b.x - a.x, b.y - a.y), n = Math.max(1, Math.round(d / step));
      for (let k = 0; k < n; k++) out.push({ x: a.x + (b.x - a.x) * k / n, y: a.y + (b.y - a.y) * k / n });
    }
    out.push(pts[pts.length - 1]);
    let acc = 0; out[0].d = 0;
    for (let i = 1; i < out.length; i++) {
      acc += Math.hypot(out[i].x - out[i - 1].x, out[i].y - out[i - 1].y);
      out[i].d = acc;
    }
    out.total = acc;
    return out;
  }

  function at(d) {
    const line = sector.line;
    d = Math.max(0, Math.min(line.total, d));
    let lo = 0, hi = line.length - 1;
    while (lo < hi - 1) { const m = (lo + hi) >> 1; if (line[m].d <= d) lo = m; else hi = m; }
    const a = line[lo], b = line[hi], seg = (b.d - a.d) || 1, t = (d - a.d) / seg;
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, a: Math.atan2(b.y - a.y, b.x - a.x) };
  }

  /* -------------------------------------------------------------- draw --- */

  let W = 0, H = 0;
  const sx = wx => (wx - cam.x) * cam.z + W / 2;
  const sy = wy => (wy - cam.y) * cam.z + H / 2;

  function frame(g, cv, w, h, t, theme) {
    W = w; H = h;
    cam.z = MOCK.zooms[MOCK.zoomIdx];

    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, cv.width, cv.height);
    const dpr = cv.width / w;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);

    g.fillStyle = '#05070a'; g.fillRect(0, 0, w, h);
    g.save();
    g.translate(w / 2, h / 2); g.scale(cam.z, cam.z); g.translate(-cam.x, -cam.y);
    g.drawImage(terrain, 0, 0);

    for (const f of fx) if (f.k === 'scar') {
      g.fillStyle = 'rgba(0,0,0,.5)';
      g.beginPath(); g.ellipse(f.x, f.y, f.r, f.r * 0.82, 0, 0, 7); g.fill();
    }

    // Convoy.
    for (let i = 2; i >= 0; i--) {
      const p = at(convoyD - i * 52);
      g.save(); g.translate(p.x, p.y); g.rotate(p.a);
      g.fillStyle = 'rgba(0,0,0,.5)'; g.fillRect(-17, -8, 38, 17);
      g.fillStyle = Hostiles.grey(80); g.fillRect(-19, -10, 38, 18);
      g.fillStyle = Hostiles.grey(52); g.fillRect(-13, -7, 14, 14);
      g.fillStyle = Hostiles.grey(96); g.fillRect(3, -6, 10, 12);
      g.fillStyle = Hostiles.grey(210); g.fillRect(13, -4, 7, 8);
      Hostiles.halo(g, 15, 0, 20, 0.3);
      g.restore();
    }

    // Hostiles. The flare is animated so the Ghosts breathe — a bracket that
    // sits comfortably on a bright signature and vanishes on a dim one is a
    // bracket the still frame would have passed.
    for (const e of hostiles) {
      const base = e.flare;
      e.flare = base > 0 ? Math.max(0.12, base * (0.7 + 0.3 * Math.sin(t * 2 + e.x * 0.01))) : 0;
      Hostiles.KINDS[e.kind].draw(g, e, t);
      e.flare = base;
    }

    // One explosion, looping, so the interface is judged against a blown
    // highlight rather than only against mid greys.
    const bt = (t * 0.5) % 1;
    const bm = fx[0];
    g.save(); g.globalCompositeOperation = 'lighter';
    Hostiles.halo(g, bm.x, bm.y, bm.r * (0.4 + bt * 1.0), (1 - bt) * 0.65);
    g.strokeStyle = 'rgba(255,255,255,' + ((1 - bt) * 0.6) + ')';
    g.lineWidth = 3;
    g.beginPath(); g.arc(bm.x, bm.y, bm.r * (0.3 + bt), 0, 7); g.stroke();
    g.restore();

    g.restore();

    Thermal.pass(g, cv, cv.width, cv.height, t, MOCK.jam * 0.4, 1);
    if (theme && theme.grade) theme.grade(g, cv, cv.width, cv.height, t);
  }

  /* What a HUD needs to know, already in screen space. Every candidate reads
   * this and nothing else, so no interface can cheat by knowing more. */
  function view() {
    const marks = [0, 1, 2].map(i => {
      const p = at(convoyD - i * 52);
      return { x: sx(p.x), y: sy(p.y), lead: i === 0 };
    });
    const tgts = hostiles.map(e => ({
      x: sx(e.x), y: sy(e.y), kind: e.kind,
      tag: Hostiles.KINDS[e.kind], hp: e.hp / e.max,
      r: Math.max(13, (Hostiles.KINDS[e.kind].r + 6) * cam.z),
      hot: e.flare > 0.3
    }));
    const c = at(convoyD);
    return {
      marks, tgts, zoom: cam.z,
      inbound: { x: sx(c.x + 300), y: sy(c.y - 128), t: MOCK.inbound },
      progress: convoyD / sector.line.total
    };
  }

  return { build, frame, view, MOCK, get sector() { return sector; } };
})();
