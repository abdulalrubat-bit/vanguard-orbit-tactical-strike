/* Vanguard Orbit — the sector.
 *
 * The map is generated, not painted. A seed produces a road grid, the blocks
 * between the roads, the buildings inside those blocks, and the convoy's route
 * through all of it. Two things fall out of that which matter more than the
 * saved bytes:
 *
 *   1. The route and the roads are the same data. The convoy drives the
 *      polyline the renderer stroked, so it cannot end up driving through a
 *      wall that got painted over its lane.
 *   2. The walkability grid is built from the building rectangles that were
 *      just drawn. Hostiles path around exactly what the player can see,
 *      because there is only one list of buildings.
 *
 * Everything here is drawn in grey. Nothing in this file knows it is going to
 * end up looking like a thermal camera — it just picks luminances, and the
 * choice of luminance is the whole art direction:
 *
 *   Asphalt is BRIGHT and rooftops are DARK.
 *
 * That is backwards from how a top-down map normally reads, and it is correct.
 * A FLIR sweep at night sees a road that has been baking all day still giving
 * its heat back, and sheet-metal roofs that dumped theirs an hour after dusk.
 * It also happens to be the most useful thing the view could do, because the
 * route the player is protecting is then the brightest line on the screen.
 */
'use strict';

const SECTOR_W = 2560, SECTOR_H = 1600;

/* Cell size of the walkability / flow-field grid. 32 is a hostile's shoulder
 * width give or take; smaller made the field cost more to rebuild than the
 * pathing was worth, larger let infantry clip building corners. */
const CELL = 32;
const GW = Math.ceil(SECTOR_W / CELL), GH = Math.ceil(SECTOR_H / CELL);

/* mulberry32 — small, fast, and the same sequence on every device, which is
 * the only property that matters here. A sector must look identical on the
 * phone and on the desktop it was tuned on. */
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

const Sector = (() => {

  /* ---------------------------------------------------------- geometry --- */

  function layout(seed) {
    const R = mulberry32(seed);
    const rint = (a, b) => a + Math.floor(R() * (b - a + 1));
    const pick = arr => arr[Math.floor(R() * arr.length)];

    // Road centrelines. Irregular spacing: an even grid reads as a spreadsheet
    // from altitude and gives every block the same tactical shape.
    const ROAD_W = 86, SIDEWALK = 22;
    const vx = [], hy = [];
    for (let x = 150; x < SECTOR_W - 120; x += rint(285, 405)) vx.push(x);
    for (let y = 170; y < SECTOR_H - 140; y += rint(290, 390)) hy.push(y);

    const buildings = [], lots = [], props = [], hotspots = [];

    // Blocks: the rectangles left over between roads, inset by the pavement.
    const blocks = [];
    for (let i = -1; i < vx.length; i++) {
      for (let j = -1; j < hy.length; j++) {
        const x0 = (i < 0 ? 0 : vx[i] + ROAD_W / 2 + SIDEWALK);
        const x1 = (i + 1 >= vx.length ? SECTOR_W : vx[i + 1] - ROAD_W / 2 - SIDEWALK);
        const y0 = (j < 0 ? 0 : hy[j] + ROAD_W / 2 + SIDEWALK);
        const y1 = (j + 1 >= hy.length ? SECTOR_H : hy[j + 1] - ROAD_W / 2 - SIDEWALK);
        if (x1 - x0 < 90 || y1 - y0 < 90) continue;
        blocks.push({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
      }
    }

    // Fill each block. Roughly one in five is left open — a yard, a car park,
    // a bombed-out slab. Those open blocks are what make the sector playable:
    // they are the only places a 105mm can be walked onto a group without a
    // roof in the way, and they are where the Phalanx has to be met.
    for (const b of blocks) {
      if (R() < 0.20 || b.w < 150 || b.h < 150) {
        lots.push({ ...b, kind: R() < 0.5 ? 'gravel' : 'rubble', seed: rint(0, 1e6) });
        // Open ground gets clutter, because open ground with nothing in it is
        // a killing field and the player should have to work a little.
        const n = rint(2, 6);
        for (let k = 0; k < n; k++) {
          props.push({
            x: b.x + 26 + R() * (b.w - 52), y: b.y + 26 + R() * (b.h - 52),
            rot: R() * Math.PI, kind: pick(['container', 'container', 'wreck', 'barrier', 'spool'])
          });
        }
        continue;
      }
      subdivide(b, buildings, R, rint, 0);
    }

    // Rooftop plant. These are the hot points in an otherwise cold skyline and
    // they are the reason the rooftops read as buildings at all rather than as
    // holes in the map.
    for (const bd of buildings) {
      if (bd.w < 70 || bd.h < 70) continue;
      const n = Math.min(4, Math.floor((bd.w * bd.h) / 26000));
      for (let k = 0; k < n; k++) {
        const w = rint(16, 30), h = rint(14, 26);
        const hx = bd.x + 12 + R() * (bd.w - 24 - w), hy2 = bd.y + 12 + R() * (bd.h - 24 - h);
        bd.plant = bd.plant || [];
        bd.plant.push({ x: hx, y: hy2, w, h, hot: R() < 0.55 });
        if (R() < 0.55) hotspots.push({ x: hx + w / 2, y: hy2 + h / 2, r: 46, i: 0.30 });
      }
      if (R() < 0.30) {                     // stairwell head, cold
        bd.plant = bd.plant || [];
        bd.plant.push({ x: bd.x + bd.w * 0.5 - 14, y: bd.y + bd.h * 0.5 - 12, w: 28, h: 24, hot: false });
      }
    }

    /* ----------------------------------------------------------- route --- */

    // The convoy runs west to east, changing lanes once or twice. A straight
    // run down one avenue is over in a minute and asks one question; a route
    // that turns forces the player to re-aim the whole observation window and
    // re-learn which rooftops overlook the new lane.
    const laneIdx = [];
    let cur = Math.max(0, Math.min(hy.length - 1, Math.floor(hy.length / 2) + rint(-1, 1)));
    laneIdx.push(cur);
    const turns = hy.length > 2 ? rint(1, 2) : 0;
    for (let t = 0; t < turns; t++) {
      const dir = (cur === 0) ? 1 : (cur === hy.length - 1) ? -1 : (R() < 0.5 ? -1 : 1);
      cur = Math.max(0, Math.min(hy.length - 1, cur + dir));
      laneIdx.push(cur);
    }

    const route = [];
    const segX = (SECTOR_W + 300) / laneIdx.length;
    let x = -140;
    for (let i = 0; i < laneIdx.length; i++) {
      const y = hy[laneIdx[i]];
      route.push({ x, y });
      const junction = (i === laneIdx.length - 1)
        ? SECTOR_W + 140
        : nearestRoadX(vx, x + segX * 0.85);
      route.push({ x: junction, y });
      x = junction;
    }
    // Deduplicate the corner doubles the loop above can produce.
    const clean = [route[0]];
    for (let i = 1; i < route.length; i++) {
      const p = route[i], q = clean[clean.length - 1];
      if (Math.abs(p.x - q.x) > 1 || Math.abs(p.y - q.y) > 1) clean.push(p);
    }

    // Anything the route drives through has to go. A building placed before
    // the route was chosen is not an obstacle, it is a bug, and it is the one
    // the convoy would sit grinding against forever.
    const clear = 78;
    for (let i = 0; i < clean.length - 1; i++) {
      const a = clean[i], b = clean[i + 1];
      const box = {
        x: Math.min(a.x, b.x) - clear, y: Math.min(a.y, b.y) - clear,
        w: Math.abs(b.x - a.x) + clear * 2, h: Math.abs(b.y - a.y) + clear * 2
      };
      for (let k = buildings.length - 1; k >= 0; k--) if (hits(buildings[k], box)) buildings.splice(k, 1);
      for (let k = props.length - 1; k >= 0; k--) {
        const p = props[k];
        if (p.x > box.x && p.x < box.x + box.w && p.y > box.y && p.y < box.y + box.h) props.splice(k, 1);
      }
    }

    return { vx, hy, ROAD_W, SIDEWALK, buildings, lots, props, hotspots, route: clean };
  }

  function nearestRoadX(vx, x) {
    let best = vx[0], d = Infinity;
    for (const v of vx) { const dd = Math.abs(v - x); if (dd < d) { d = dd; best = v; } }
    return best;
  }

  function hits(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  // Recursive block split. Depth-limited and size-limited so a block becomes
  // two or three buildings with an alley between, not a fractal of sheds.
  function subdivide(b, out, R, rint, depth) {
    const canSplit = depth < 2 && (b.w > 205 || b.h > 205) && R() < 0.78;
    if (!canSplit) {
      const inset = rint(4, 16);
      const bb = { x: b.x + inset, y: b.y + inset, w: b.w - inset * 2, h: b.h - inset * 2 };
      if (bb.w > 46 && bb.h > 46) { bb.tone = 0.86 + R() * 0.3; out.push(bb); }
      return;
    }
    const alley = rint(18, 34);
    if (b.w >= b.h) {
      const cut = b.w * (0.34 + R() * 0.32);
      subdivide({ x: b.x, y: b.y, w: cut - alley / 2, h: b.h }, out, R, rint, depth + 1);
      subdivide({ x: b.x + cut + alley / 2, y: b.y, w: b.w - cut - alley / 2, h: b.h }, out, R, rint, depth + 1);
    } else {
      const cut = b.h * (0.34 + R() * 0.32);
      subdivide({ x: b.x, y: b.y, w: b.w, h: cut - alley / 2 }, out, R, rint, depth + 1);
      subdivide({ x: b.x, y: b.y + cut + alley / 2, w: b.w, h: b.h - cut - alley / 2 }, out, R, rint, depth + 1);
    }
  }

  /* ------------------------------------------------------------- paint --- */

  // Luminances. Read this as a legend for the whole game: the numbers ARE the
  // art direction, and every one of them is a claim about what holds heat.
  const G = {
    ground: 26,      // packed dirt and vegetation between everything
    asphalt: 74,     // sun-soaked road, the brightest terrain by a mile
    pavement: 52,    // concrete, cools faster than asphalt
    gravel: 58,      // loose stone, holds heat well
    rubble: 46,
    roof: 30,        // sheet metal, dumps its heat first — near black
    parapet: 44,     // the edge catches and re-radiates off the street
    plantCold: 40,
    plantHot: 150,   // running compressors, the only steady white on a roof
    metal: 62
  };
  const grey = v => 'rgb(' + (v | 0) + ',' + (v | 0) + ',' + (v | 0) + ')';

  function paint(L, seed) {
    const c = document.createElement('canvas');
    c.width = SECTOR_W; c.height = SECTOR_H;
    const g = c.getContext('2d');
    const R = mulberry32(seed ^ 0x9e37);

    g.fillStyle = grey(G.ground); g.fillRect(0, 0, SECTOR_W, SECTOR_H);
    speckle(g, R, 0, 0, SECTOR_W, SECTOR_H, 2600, 10, 0.5);

    // Pavement first as a fat underlay, then the carriageway on top of it.
    // Two rectangles per road instead of a stroke-and-outline, because the
    // junctions then resolve themselves for free where roads cross.
    const pw = L.ROAD_W / 2 + L.SIDEWALK;
    g.fillStyle = grey(G.pavement);
    for (const x of L.vx) g.fillRect(x - pw, 0, pw * 2, SECTOR_H);
    for (const y of L.hy) g.fillRect(0, y - pw, SECTOR_W, pw * 2);
    g.fillStyle = grey(G.asphalt);
    for (const x of L.vx) g.fillRect(x - L.ROAD_W / 2, 0, L.ROAD_W, SECTOR_H);
    for (const y of L.hy) g.fillRect(0, y - L.ROAD_W / 2, SECTOR_W, L.ROAD_W);

    // Lane markings are paint over asphalt: less mass, so slightly cooler.
    g.strokeStyle = grey(G.asphalt - 16); g.lineWidth = 3; g.setLineDash([26, 22]);
    g.beginPath();
    for (const x of L.vx) { g.moveTo(x, 0); g.lineTo(x, SECTOR_H); }
    for (const y of L.hy) { g.moveTo(0, y); g.lineTo(SECTOR_W, y); }
    g.stroke(); g.setLineDash([]);

    for (const x of L.vx) speckle(g, R, x - L.ROAD_W / 2, 0, L.ROAD_W, SECTOR_H, 900, 8, 0.35);
    for (const y of L.hy) speckle(g, R, 0, y - L.ROAD_W / 2, SECTOR_W, L.ROAD_W, 900, 8, 0.35);

    for (const lot of L.lots) {
      g.fillStyle = grey(lot.kind === 'gravel' ? G.gravel : G.rubble);
      g.fillRect(lot.x, lot.y, lot.w, lot.h);
      speckle(g, R, lot.x, lot.y, lot.w, lot.h, Math.floor(lot.w * lot.h / 260), 14, 0.7);
    }

    // Buildings. The drop shadow is drawn cold and offset down-right: from a
    // loitering asset the sensor is never exactly overhead, and a flat roof
    // with no shadow at all reads as a hole cut in the map.
    for (const b of L.buildings) {
      g.fillStyle = 'rgba(0,0,0,0.55)';
      g.fillRect(b.x + 7, b.y + 9, b.w, b.h);
    }
    for (const b of L.buildings) {
      const tone = b.tone || 1;
      g.fillStyle = grey(G.roof * tone);
      g.fillRect(b.x, b.y, b.w, b.h);
      g.strokeStyle = grey(G.parapet * tone); g.lineWidth = 3;
      g.strokeRect(b.x + 1.5, b.y + 1.5, b.w - 3, b.h - 3);
      speckle(g, R, b.x, b.y, b.w, b.h, Math.floor(b.w * b.h / 900), 10, 0.35);
      for (const p of (b.plant || [])) {
        g.fillStyle = grey(p.hot ? G.plantHot : G.plantCold);
        g.fillRect(p.x, p.y, p.w, p.h);
        g.strokeStyle = grey(p.hot ? 200 : 54); g.lineWidth = 1;
        g.strokeRect(p.x + .5, p.y + .5, p.w - 1, p.h - 1);
      }
    }

    // Static heat bloom, baked. Doing this live would mean a second full-screen
    // buffer and a blur every frame for emitters that never move.
    for (const h of L.hotspots) {
      const gr = g.createRadialGradient(h.x, h.y, 0, h.x, h.y, h.r);
      gr.addColorStop(0, 'rgba(255,255,255,' + h.i + ')');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(h.x - h.r, h.y - h.r, h.r * 2, h.r * 2);
    }

    for (const p of L.props) prop(g, p);

    // The contrast grade is baked in here, once, rather than applied to the
    // blit every frame. A `filter` on a 2560x1600 source is a full extra pass
    // over four million pixels sixty times a second, and it is the difference
    // between this holding frame on a mid-range phone and not.
    const out = document.createElement('canvas');
    out.width = SECTOR_W; out.height = SECTOR_H;
    const og = out.getContext('2d');
    og.filter = 'contrast(1.16) brightness(1.03)';
    og.drawImage(c, 0, 0);
    og.filter = 'none';
    c.width = c.height = 0;            // release the ungraded copy immediately
    return out;
  }

  function speckle(g, R, x, y, w, h, n, amp, a) {
    g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip();
    for (let i = 0; i < n; i++) {
      const v = (R() - 0.5) * 2 * amp;
      g.fillStyle = (v > 0 ? 'rgba(255,255,255,' : 'rgba(0,0,0,') + (Math.abs(v) / amp * a * 0.5) + ')';
      g.fillRect(x + R() * w, y + R() * h, 1 + R() * 2, 1 + R() * 2);
    }
    g.restore();
  }

  // Ground clutter, drawn from primitives. At 1x these are twenty pixels wide;
  // at 3x optical they are what the player is reading cover from, so each one
  // gets a silhouette that survives the zoom.
  function prop(g, p) {
    g.save(); g.translate(p.x, p.y); g.rotate(p.rot);
    if (p.kind === 'container') {
      g.fillStyle = 'rgba(0,0,0,.5)'; g.fillRect(-29, -13, 60, 28);
      g.fillStyle = grey(G.metal); g.fillRect(-32, -16, 60, 28);
      g.strokeStyle = grey(G.metal + 22); g.lineWidth = 1;
      for (let i = -28; i < 26; i += 7) { g.beginPath(); g.moveTo(i, -16); g.lineTo(i, 12); g.stroke(); }
      g.strokeRect(-31.5, -15.5, 59, 27);
    } else if (p.kind === 'wreck') {
      g.fillStyle = 'rgba(0,0,0,.5)'; g.fillRect(-19, -10, 40, 21);
      g.fillStyle = grey(44); g.fillRect(-21, -12, 40, 21);
      g.fillStyle = grey(30); g.fillRect(-9, -9, 17, 15);          // burnt-out cabin
      g.fillStyle = grey(96); g.fillRect(-21, -8, 8, 13);          // block, still faintly warm
    } else if (p.kind === 'barrier') {
      g.fillStyle = 'rgba(0,0,0,.45)'; g.fillRect(-21, -6, 44, 13);
      g.fillStyle = grey(G.pavement + 10); g.fillRect(-23, -8, 44, 13);
      g.fillStyle = grey(G.pavement - 12); g.fillRect(-23, -1, 44, 3);
    } else {                                                        // cable spool
      g.fillStyle = 'rgba(0,0,0,.5)'; g.beginPath(); g.arc(2, 3, 19, 0, 7); g.fill();
      g.fillStyle = grey(G.metal - 10); g.beginPath(); g.arc(0, 0, 19, 0, 7); g.fill();
      g.strokeStyle = grey(34); g.lineWidth = 2;
      g.beginPath(); g.arc(0, 0, 12, 0, 7); g.stroke();
      g.fillStyle = grey(30); g.beginPath(); g.arc(0, 0, 6, 0, 7); g.fill();
    }
    g.restore();
  }

  /* -------------------------------------------------------- walkability --- */

  // One byte per cell, built from the same building list that was drawn. A
  // hostile can stand anywhere a building is not; roads, lots and alleys are
  // all equally walkable, because a man on foot does not care about kerbs.
  function walkGrid(L) {
    const w = new Uint8Array(GW * GH);
    for (const b of L.buildings) {
      const x0 = Math.max(0, Math.floor((b.x - 6) / CELL)), x1 = Math.min(GW - 1, Math.floor((b.x + b.w + 6) / CELL));
      const y0 = Math.max(0, Math.floor((b.y - 6) / CELL)), y1 = Math.min(GH - 1, Math.floor((b.y + b.h + 6) / CELL));
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) w[y * GW + x] = 1;
    }
    return w;
  }

  /* --------------------------------------------------------- line of fire --- */

  // Buildings block the shot. Sampled rather than solved: a 25mm burst is not
  // a ray-triangle intersection problem, and eighteen samples down the line is
  // exact enough to be indistinguishable while costing nothing.
  function blocked(L, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay, d = Math.hypot(dx, dy);
    const n = Math.min(24, Math.max(4, d / 24 | 0));
    for (let i = 1; i < n; i++) {
      const t = i / n, x = ax + dx * t, y = ay + dy * t;
      for (const b of L.buildings)
        if (x > b.x && x < b.x + b.w && y > b.y && y < b.y + b.h) return true;
    }
    return false;
  }

  function generate(seed) {
    const L = layout(seed);
    L.terrain = paint(L, seed);
    L.walk = walkGrid(L);
    L.blocked = (ax, ay, bx, by) => blocked(L, ax, ay, bx, by);
    L.inBuilding = (x, y) => {
      for (const b of L.buildings)
        if (x > b.x && x < b.x + b.w && y > b.y && y < b.y + b.h) return true;
      return false;
    };
    return L;
  }

  return { generate, grey, G, CELL, GW, GH };
})();
