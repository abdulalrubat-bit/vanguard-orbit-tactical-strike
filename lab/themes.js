/* UI lab — four complete interface systems.
 *
 * Every one of these is handed the same frame and the same state object, so
 * the only thing that varies is the design. Each answers the same four
 * questions differently, and the answers are what to actually compare:
 *
 *   1. How much does the interface claim to KNOW? A bracket around a hostile
 *      is a promise that the aircraft has identified it. NVG makes almost no
 *      such promise and MIL-SPEC makes a great many.
 *   2. Where does the heat go? It is the one number the player reads mid-burst
 *      and it decides where the thumb lives.
 *   3. What happens to the sensor image underneath? Every pixel of furniture
 *      is a pixel of thermal the player cannot see through.
 *   4. Does it look like hardware, or like a game?
 *
 * All four draw the WHOLE in-game interface on canvas, including the parts the
 * shipped game builds out of DOM. That is deliberate for a mockup: one
 * function per system is comparable in a way that four tangles of markup and
 * stylesheet are not. Whichever wins gets split back apart on the way in.
 */
'use strict';

const Themes = (() => {

  /* --------------------------------------------------------- utilities --- */

  const ring = (g, x, y, r, col, lw, dash) => {
    g.save();
    if (dash) g.setLineDash(dash);
    g.strokeStyle = col; g.lineWidth = lw;
    g.beginPath(); g.arc(x, y, r, 0, 7); g.stroke();
    g.restore();
  };

  const txt = (g, s, x, y, font, col, align) => {
    g.font = font; g.fillStyle = col; g.textAlign = align || 'left';
    g.fillText(s, x, y); g.textAlign = 'left';
  };

  const box = (g, x, y, w, h, fill, stroke, r) => {
    g.beginPath();
    if (r && g.roundRect) g.roundRect(x, y, w, h, r); else g.rect(x, y, w, h);
    if (fill) { g.fillStyle = fill; g.fill(); }
    if (stroke) { g.strokeStyle = stroke; g.lineWidth = 1.2; g.stroke(); }
  };

  const MONO = 'ui-monospace,Menlo,Consolas,"DejaVu Sans Mono",monospace';
  const SANS = '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif';

  // Corner brackets, the one piece of furniture three of the four share.
  function corners(g, x, y, r, col, lw, frac) {
    g.strokeStyle = col; g.lineWidth = lw;
    const c = r * (frac || 0.45);
    for (let q = 0; q < 4; q++) {
      const ax = q & 1 ? 1 : -1, ay = q & 2 ? 1 : -1;
      g.beginPath();
      g.moveTo(x + ax * r, y + ay * r - ay * c);
      g.lineTo(x + ax * r, y + ay * r);
      g.lineTo(x + ax * r - ax * c, y + ay * r);
      g.stroke();
    }
  }

  /* ============================================================ VANGUARD == */

  const vanguard = {
    id: 'vanguard', name: 'VANGUARD', accent: '#ffb01e',
    tagline: 'Amber AR over monochrome FLIR — what is in the game today.',
    notes: [
      ['Claims', 'Full identification. Every hostile gets a bracket, a class label and a health bar — the aircraft is asserting it knows what it is looking at.'],
      ['Heat', 'Wrapped around the aim stick, because heat belongs to the trigger and the trigger is that thumb. Segmented, so it reads as bursts remaining rather than as a temperature.'],
      ['Cost to the image', 'Low. Thin strokes, one colour, nothing opaque. The sensor picture is never covered.'],
      ['Reads as', 'Aircraft hardware. Diegetic — the amber is the aircraft’s own display, not a game overlay.']
    ],
    hud(g, w, h, t, V, M) {
      const A = '#ffb01e', D = 'rgba(255,176,30,', LO = D + '0.45)';
      g.font = '700 9px ' + MONO;

      for (const e of V.tgts) {
        if (e.kind === 'ghost' && !e.hot) continue;
        g.save(); g.globalAlpha = e.hot ? 1 : 0.85;
        corners(g, e.x, e.y, e.r, A, 1.5);
        const sweep = ((t * 0.9 + e.x * 0.01) % 1) * 2 - 1;
        g.strokeStyle = D + '0.5)'; g.lineWidth = 1;
        g.beginPath(); g.moveTo(e.x - e.r, e.y + sweep * e.r); g.lineTo(e.x + e.r, e.y + sweep * e.r); g.stroke();
        if (e.hp < 1) {
          g.fillStyle = 'rgba(0,0,0,.5)'; g.fillRect(e.x - e.r, e.y + e.r + 4, e.r * 2, 3);
          g.fillStyle = A; g.fillRect(e.x - e.r, e.y + e.r + 4, e.r * 2 * e.hp, 3);
        }
        txt(g, e.tag.tag, e.x - e.r, e.y - e.r - 5, '700 9px ' + MONO, A);
        g.restore();
      }

      for (const m of V.marks) {
        const r = 15 * Math.min(1.6, V.zoom);
        g.strokeStyle = A; g.lineWidth = 1.6;
        g.beginPath();
        g.moveTo(m.x, m.y - r); g.lineTo(m.x + r, m.y);
        g.lineTo(m.x, m.y + r); g.lineTo(m.x - r, m.y); g.closePath(); g.stroke();
        if (m.lead) txt(g, 'ANVIL', m.x + r + 5, m.y + 3, '700 10px ' + MONO, A);
      }

      // Inbound shell.
      const ib = V.inbound, rad = 14 + (1 - 0.4) * 40;
      ring(g, ib.x, ib.y, rad, D + '0.6)', 1.4, [5, 5]);
      txt(g, ib.t.toFixed(1) + 'S', ib.x + rad + 4, ib.y - 3, '700 9px ' + MONO, A);

      // Top telemetry.
      txt(g, 'PHASE ' + M.phase + '/' + M.phases, w / 2, 26, '700 11px ' + MONO, A, 'center');
      txt(g, M.label, w / 2, 39, '700 9px ' + MONO, D + '0.6)', 'center');
      const bw = Math.min(300, w * 0.42), bx = w / 2 - bw / 2;
      txt(g, 'ANVIL', bx - 8, 55, '700 8.5px ' + MONO, D + '0.55)', 'right');
      box(g, bx, 48, bw, 7, D + '0.08)', LO);
      g.fillStyle = A; g.fillRect(bx + 1, 49, (bw - 2) * M.integrity / 100, 5);
      txt(g, String(M.integrity).padStart(3, '0'), bx + bw + 8, 55, '700 10px ' + MONO, A);

      // Orbit ring.
      const ox = w - 46, oy = 44, orr = 20;
      g.strokeStyle = D + '0.35)'; g.lineWidth = 1.2;
      g.beginPath(); g.ellipse(ox, oy, orr, orr * 0.42, 0, 0, 7); g.stroke();
      g.beginPath(); g.ellipse(ox, oy, orr * 0.42, orr, 0, 0, 7); g.stroke();
      g.fillStyle = A;
      g.beginPath(); g.arc(ox + Math.cos(t * 0.42) * orr, oy + Math.sin(t * 0.42) * orr * 0.42, 3, 0, 7); g.fill();
      g.strokeStyle = A; g.lineWidth = 2.4;
      g.beginPath(); g.arc(ox, oy, orr + 7, -Math.PI / 2, -Math.PI / 2 + V.progress * 6.283); g.stroke();

      // Zoom rail.
      const rx = w - 30, y0 = h * 0.20, y1 = h * 0.46, last = M.zooms.length - 1;
      g.strokeStyle = D + '0.45)'; g.lineWidth = 1.4;
      g.beginPath(); g.moveTo(rx, y0); g.lineTo(rx, y1); g.stroke();
      for (let i = 0; i < M.zooms.length; i++) {
        const y = y1 - (i / last) * (y1 - y0), on = i === M.zoomIdx;
        g.strokeStyle = on ? A : D + '0.5)'; g.lineWidth = on ? 2.4 : 1.2;
        g.beginPath(); g.moveTo(rx - (on ? 13 : 8), y); g.lineTo(rx + (on ? 13 : 8), y); g.stroke();
        txt(g, M.zooms[i].toFixed(2) + 'X', rx - 17, y + 3, '700 9px ' + MONO, on ? A : D + '0.45)', 'right');
      }

      // Sticks, and the heat gauge wrapped around the right one.
      const R = 62;
      const lp = { x: 108, y: h - 108 }, rp = { x: w - 108, y: h - 108 };
      for (const [p, s, lbl] of [[lp, M.stickL, 'PAN'], [rp, M.stickR, null]]) {
        g.save(); g.globalAlpha = 0.95;
        ring(g, p.x, p.y, R, A, 1.4);
        g.fillStyle = D + '0.2)';
        g.beginPath(); g.arc(p.x + s.dx * R, p.y + s.dy * R, 19, 0, 7); g.fill();
        ring(g, p.x + s.dx * R, p.y + s.dy * R, 19, A, 1.6);
        if (lbl) txt(g, lbl, p.x, p.y + R + 16, '700 9px ' + MONO, A, 'center');
        g.restore();
      }
      ring(g, rp.x, rp.y, R * 0.45, D + '0.5)', 1.2, [3, 4]);
      const heat = M.heat[M.weapon], segs = 18;
      for (let i = 0; i < segs; i++) {
        const a0 = -Math.PI / 2 + (i / segs) * 6.283 + 0.035;
        const a1 = -Math.PI / 2 + ((i + 1) / segs) * 6.283 - 0.035;
        const on = (i + 1) / segs <= heat + 1e-6;
        g.beginPath(); g.arc(rp.x, rp.y, R + 9, a0, a1); g.arc(rp.x, rp.y, R + 17, a1, a0, true); g.closePath();
        g.fillStyle = on ? (i / segs > 0.72 ? '#ff7a2f' : A) : D + '0.13)';
        g.fill();
      }

      // Bottom bar.
      const names = [['25', 'ROTARY'], ['40', 'AUTO'], ['105', 'HOWITZER']];
      const bwid = 74, gap = 6, total = 74 + gap + names.length * (bwid + gap) - gap;
      let bxx = w / 2 - total / 2;
      box(g, bxx, h - 46, 74, 34, 'rgba(8,12,16,.68)', D + '0.5)');
      txt(g, 'FIRE', bxx + 37, h - 25, '700 11px ' + MONO, A, 'center');
      bxx += 74 + gap;
      names.forEach((n, i) => {
        const on = i === M.weapon, lk = !M.stations[i];
        box(g, bxx, h - 46, bwid, 34, on ? D + '0.18)' : 'rgba(8,12,16,.68)', lk ? D + '0.25)' : (on ? A : D + '0.5)'));
        g.save(); g.globalAlpha = lk ? 0.42 : 1;
        txt(g, n[0], bxx + bwid / 2, h - 27, '700 15px ' + MONO, A, 'center');
        txt(g, lk ? 'NOT FITTED' : n[1], bxx + bwid / 2, h - 16, '700 7px ' + MONO, D + '0.6)', 'center');
        g.restore();
        bxx += bwid + gap;
      });

      // Reticle.
      const cx = w / 2 + M.stickR.dx * Math.min(w, h) * 0.40;
      const cy = h / 2 + M.stickR.dy * Math.min(w, h) * 0.40;
      g.strokeStyle = A; g.lineWidth = 1.6;
      ring(g, cx, cy, 13, A, 1.6);
      for (let i = 0; i < 4; i++) {
        const a = i * Math.PI / 2 + t * 7;
        g.beginPath();
        g.moveTo(cx + Math.cos(a) * 17, cy + Math.sin(a) * 17);
        g.lineTo(cx + Math.cos(a) * 26, cy + Math.sin(a) * 26);
        g.stroke();
      }
      g.fillStyle = A; g.fillRect(cx - 1, cy - 1, 2, 2);
    }
  };

  /* ================================================================ NVG == */

  /* The interesting one, because it changes the SENSOR and not the paint. An
   * image intensifier does not classify anything — it amplifies photons. So
   * this interface is not allowed to tell the player what a contact is, only
   * that the gunner has put a box on something. Fewer promises, and the
   * identification problem moves from the HUD back into the player's eyes.
   *
   * That is either the best idea in this file or a step too far, and it is
   * exactly the sort of thing a mockup exists to settle. */
  const nvg = {
    id: 'nvg', name: 'NVG PHOSPHOR', accent: '#7dff9a',
    tagline: 'Image intensifier, not thermal. The tube sees; it does not think.',
    notes: [
      ['Claims', 'Almost nothing. No class labels, no health bars, no automatic tagging — one manual box on whatever the gunner has slewed onto. Identification goes back to the player.'],
      ['Heat', 'A vertical thermometer pinned to the tube edge, away from both thumbs. Read between bursts, not during — which suits a weapon you are already firing in short bursts.'],
      ['Cost to the image', 'High, and deliberately. The circular tube throws away the screen corners entirely. You see less sector at once and the pan stick matters far more.'],
      ['Reads as', 'Hardware, hard. The most distinctive of the four and the furthest from the GDD’s thermal brief — this is a different aircraft, not a reskin.']
    ],
    grade(g, cv, w, h, t) {
      g.save();
      g.setTransform(1, 0, 0, 1, 0, 0);
      // Phosphor. Multiply carries the greys into green, then a screen pass
      // lifts the blacks so the shadows glow the way a real tube's do.
      // Lift before tinting. A tube AMPLIFIES photons, so the picture gets
      // brighter — tinting the already-graded thermal frame straight to green
      // crushed the whole city into an unreadable smear.
      g.globalCompositeOperation = 'lighter';
      g.globalAlpha = 0.55; g.drawImage(cv, 0, 0); g.globalAlpha = 1;
      g.globalCompositeOperation = 'multiply';
      g.fillStyle = 'rgb(104,255,146)'; g.fillRect(0, 0, w, h);
      g.globalCompositeOperation = 'screen';
      g.fillStyle = 'rgba(6,34,12,0.6)'; g.fillRect(0, 0, w, h);
      g.globalCompositeOperation = 'source-over';

      /* The tube. Everything outside it is not dark, it is absent.
       *
       * An ELLIPSE, not a circle. A true circle on a 740x360 phone threw away
       * both thirds of the screen either side of it, which is not a design
       * statement, it is a smaller game. Binocular tubes give a wide oval
       * anyway, so this is the more honest shape as well as the usable one. */
      const cx = w / 2, cy = h / 2, rx = w * 0.455, ry = h * 0.495;
      const gr = g.createRadialGradient(cx, cy, Math.min(rx, ry) * 0.7, cx, cy, Math.max(rx, ry));
      gr.addColorStop(0, 'rgba(0,0,0,0)');
      gr.addColorStop(0.72, 'rgba(0,8,2,0.5)');
      gr.addColorStop(1, 'rgba(0,4,1,0.95)');
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
      g.fillStyle = '#010603';
      g.beginPath();
      g.rect(0, 0, w, h);
      // moveTo before the ellipse, or the implicit line from the rectangle's
      // last corner to the ellipse's start point is filled as a black wedge
      // straight across the picture.
      g.moveTo(cx + rx, cy);
      g.ellipse(cx, cy, rx, ry, 0, 0, 7, true);
      g.fill('evenodd');
      g.strokeStyle = 'rgba(125,255,154,.22)'; g.lineWidth = 2;
      g.beginPath(); g.ellipse(cx, cy, rx, ry, 0, 0, 7); g.stroke();
      const r = Math.min(rx, ry);
      // Scintillation: the speckle a tube makes when it is working hard.
      g.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 40; i++) {
        g.fillStyle = 'rgba(160,255,180,' + (Math.random() * 0.4) + ')';
        const a = Math.random() * 6.283, rr = Math.random() * r;
        g.fillRect(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, 2, 2);
      }
      g.restore();
    },
    hud(g, w, h, t, V, M) {
      const G = '#7dff9a', D = 'rgba(125,255,154,';
      const cx = w / 2, cy = h / 2, RX = w * 0.455, RY = h * 0.495, R = RY;
      const inTube = (x, y) =>
        Math.pow((x - cx) / (RX - 10), 2) + Math.pow((y - cy) / (RY - 10), 2) < 1;

      // Only the contact nearest the reticle gets a box, and it is a dumb box.
      const rx = cx + M.stickR.dx * Math.min(w, h) * 0.34;
      const ry = cy + M.stickR.dy * Math.min(w, h) * 0.34;
      let near = null, nd = 1e9;
      for (const e of V.tgts) {
        if (!inTube(e.x, e.y)) continue;
        const d = Math.hypot(e.x - rx, e.y - ry);
        if (d < nd) { nd = d; near = e; }
      }
      if (near && nd < 150) {
        g.strokeStyle = G; g.lineWidth = 2;
        g.strokeRect(near.x - near.r, near.y - near.r, near.r * 2, near.r * 2);
        txt(g, 'CONTACT', near.x - near.r, near.y - near.r - 6, '700 10px ' + MONO, G);
      }
      // Everything else is a one-pixel tick. The tube saw something move.
      for (const e of V.tgts) {
        if (e === near || !inTube(e.x, e.y)) continue;
        g.fillStyle = D + '0.5)';
        g.fillRect(e.x - 1.5, e.y - 1.5, 3, 3);
      }

      for (const m of V.marks) {
        if (!inTube(m.x, m.y)) continue;
        g.strokeStyle = G; g.lineWidth = 2;
        g.beginPath(); g.moveTo(m.x - 9, m.y - 9); g.lineTo(m.x + 9, m.y + 9);
        g.moveTo(m.x + 9, m.y - 9); g.lineTo(m.x - 9, m.y + 9); g.stroke();
      }

      // Mil-dot reticle: a cross and a ladder, nothing animated.
      g.strokeStyle = G; g.lineWidth = 1.6;
      g.beginPath();
      g.moveTo(rx - 34, ry); g.lineTo(rx - 9, ry); g.moveTo(rx + 9, ry); g.lineTo(rx + 34, ry);
      g.moveTo(rx, ry - 34); g.lineTo(rx, ry - 9); g.moveTo(rx, ry + 9); g.lineTo(rx, ry + 34);
      g.stroke();
      g.fillStyle = G;
      for (let i = 1; i <= 3; i++) {
        g.fillRect(rx - 1.5, ry + 12 + i * 8, 3, 2);
        g.fillRect(rx - 1.5, ry - 14 - i * 8, 3, 2);
      }

      // Tube furniture. Everything lives on the arc, because the corners of
      // this design do not exist.
      txt(g, 'GAIN 7   SCAN 30HZ   IR OFF', cx, cy - R + 26, '700 10px ' + MONO, D + '0.75)', 'center');
      txt(g, 'PHASE ' + M.phase + '/' + M.phases + '   ·   ' + M.label,
        cx, cy + R - 30, '700 10px ' + MONO, D + '0.75)', 'center');

      // Integrity as an arc following the bottom of the tube.
      const a0 = Math.PI * 0.62, a1 = Math.PI * 0.38;
      g.strokeStyle = D + '0.2)'; g.lineWidth = 6;
      g.beginPath(); g.arc(cx, cy, R - 14, a0, a1, true); g.stroke();
      g.strokeStyle = M.integrity < 30 ? '#ff6a4a' : G; g.lineWidth = 6;
      g.beginPath(); g.arc(cx, cy, R - 14, a0, a0 - (a0 - a1) * (M.integrity / 100), true); g.stroke();
      txt(g, 'ANVIL ' + M.integrity, cx, cy + R - 46, '700 12px ' + MONO, G, 'center');

      // Heat thermometer, pinned to the left edge clear of both thumbs.
      const hx = 30, hy0 = h * 0.30, hy1 = h * 0.70;
      box(g, hx - 7, hy0, 14, hy1 - hy0, 'rgba(0,10,3,.6)', D + '0.5)');
      const heat = M.heat[M.weapon];
      g.fillStyle = heat > 0.72 ? '#ff6a4a' : G;
      g.fillRect(hx - 5, hy1 - (hy1 - hy0) * heat + 2, 10, (hy1 - hy0) * heat - 4);
      txt(g, 'HEAT', hx, hy0 - 8, '700 8px ' + MONO, D + '0.7)', 'center');
      for (let i = 1; i < 4; i++) {
        const y = hy1 - (hy1 - hy0) * (i / 4);
        g.strokeStyle = D + '0.4)'; g.lineWidth = 1;
        g.beginPath(); g.moveTo(hx + 7, y); g.lineTo(hx + 12, y); g.stroke();
      }

      // Station selector as a stencilled stack, right edge.
      const names = ['25MM', '40MM', '105MM'];
      names.forEach((n, i) => {
        const y = h * 0.34 + i * 30, on = i === M.weapon, lk = !M.stations[i];
        g.save(); g.globalAlpha = lk ? 0.3 : 1;
        if (on) { box(g, w - 84, y - 12, 62, 22, D + '0.18)', G); }
        txt(g, n, w - 53, y + 3, '700 11px ' + MONO, G, 'center');
        g.restore();
      });

      // Sticks: two arcs on the tube edge rather than rings, because a ring
      // down here would be cut in half by the vignette anyway.
      for (const [s, side] of [[M.stickL, -1], [M.stickR, 1]]) {
        const bx = cx + side * RX * 0.72, by = cy + RY * 0.55;
        ring(g, bx, by, 34, D + '0.35)', 1.4);
        g.fillStyle = D + '0.25)';
        g.beginPath(); g.arc(bx + s.dx * 34, by + s.dy * 34, 13, 0, 7); g.fill();
        ring(g, bx + s.dx * 34, by + s.dy * 34, 13, G, 1.5);
      }
    }
  };

  /* =========================================================== MIL-SPEC == */

  const milspec = {
    id: 'milspec', name: 'MIL-SPEC', accent: '#8fd8ff',
    tagline: 'Targeting-pod footage. Everything the aircraft knows, on screen, always.',
    notes: [
      ['Claims', 'Everything. Class, range, bearing, track number, health, and a leader line to a data block. If the aircraft knows it, it is on the glass.'],
      ['Heat', 'A numeric percentage in the bottom strip next to rounds remaining. Precise and completely unreadable mid-burst — the honest weakness of this system.'],
      ['Cost to the image', 'Highest of the four. Two opaque strips eat the top and bottom of the sector, which on a 360-tall phone is about a fifth of the picture gone.'],
      ['Reads as', 'Real footage, convincingly. Also the most intimidating to a new player, and the hardest to touch — everything is small.']
    ],
    grade(g, cv, w, h, t) {
      g.save(); g.setTransform(1, 0, 0, 1, 0, 0);
      // Cooler and flatter than the amber build: pod footage is grey, not warm.
      g.globalCompositeOperation = 'screen';
      g.fillStyle = 'rgba(16,26,34,0.5)'; g.fillRect(0, 0, w, h);
      g.restore();
    },
    hud(g, w, h, t, V, M) {
      const C = '#8fd8ff', WH = '#eef6fb', D = 'rgba(143,216,255,';
      const TOP = 34, BOT = 40;

      // Data strips.
      box(g, 0, 0, w, TOP, 'rgba(6,10,14,.88)', null);
      g.strokeStyle = D + '0.3)'; g.lineWidth = 1;
      g.beginPath(); g.moveTo(0, TOP); g.lineTo(w, TOP); g.stroke();
      box(g, 0, h - BOT, w, BOT, 'rgba(6,10,14,.88)', null);
      g.beginPath(); g.moveTo(0, h - BOT); g.lineTo(w, h - BOT); g.stroke();

      const clock = new Date(Date.UTC(2026, 8, 17, 22, 14, Math.floor(t) % 60));
      const hhmmss = clock.toISOString().substr(11, 8);
      const f9 = '700 9px ' + MONO;
      txt(g, 'VANGUARD 01', 10, 14, f9, WH);
      txt(g, 'FLIR-4B  WHOT  ' + M.zooms[M.zoomIdx].toFixed(2) + 'X', 10, 27, f9, D + '0.8)');
      txt(g, hhmmss + 'Z', w / 2, 14, '700 11px ' + MONO, WH, 'center');
      txt(g, 'MSN ' + String(M.sorties).padStart(3, '0') + '   PHASE ' + M.phase + '/' + M.phases + '   ' + M.label,
        w / 2, 27, f9, D + '0.8)', 'center');
      txt(g, 'SLANT 4210M', w - 10, 14, f9, WH, 'right');
      txt(g, 'LSR STBY   ALT 21400', w - 10, 27, f9, D + '0.8)', 'right');

      // Bottom strip: station, rounds, heat, integrity.
      const names = [['25MM', '1840'], ['40MM', '212'], ['105MM', '18']];
      let bx = 10;
      names.forEach((n, i) => {
        const on = i === M.weapon, lk = !M.stations[i];
        g.save(); g.globalAlpha = lk ? 0.35 : 1;
        if (on) box(g, bx - 4, h - BOT + 6, 92, 28, D + '0.14)', C);
        txt(g, n[0], bx, h - BOT + 19, '700 11px ' + MONO, on ? WH : D + '0.7)');
        txt(g, lk ? 'NOT FITTED' : n[1] + ' RDS', bx, h - BOT + 31, '700 8px ' + MONO, D + '0.6)');
        g.restore();
        bx += 96;
      });
      const heat = M.heat[M.weapon];
      txt(g, 'BRL ' + (heat * 100).toFixed(0).padStart(3) + '%', bx + 8, h - BOT + 19, '700 11px ' + MONO,
        heat > 0.72 ? '#ff6a4a' : WH);
      box(g, bx + 8, h - BOT + 25, 74, 6, D + '0.12)', D + '0.4)');
      g.fillStyle = heat > 0.72 ? '#ff6a4a' : C;
      g.fillRect(bx + 9, h - BOT + 26, 72 * heat, 4);

      txt(g, 'ANVIL', w - 168, h - BOT + 19, '700 9px ' + MONO, D + '0.7)');
      box(g, w - 124, h - BOT + 11, 110, 9, D + '0.12)', D + '0.45)');
      g.fillStyle = M.integrity < 30 ? '#ff6a4a' : C;
      g.fillRect(w - 123, h - BOT + 12, 108 * M.integrity / 100, 7);
      txt(g, M.integrity + '%  ·  ' + M.hostilesLeft + ' TRK', w - 14, h - BOT + 32, '700 8px ' + MONO, D + '0.7)', 'right');

      // Tracks. Numbered, classed, ranged, with leader lines to a block —
      // the density is the point and also the problem.
      // NATO-ish class codes rather than a truncated kind name. The first cut
      // printed "GHOS", which is not a classification, it is a bug with a
      // straight face.
      const CODE = { ghost: 'INF', technical: 'VEH', phalanx: 'HVY', jammer: 'EWS' };
      V.tgts.forEach((e, i) => {
        if (e.y < TOP + 14 || e.y > h - BOT - 14) return;
        g.strokeStyle = e.kind === 'phalanx' ? '#ffd166' : C;
        g.lineWidth = 1.2;
        g.strokeRect(e.x - e.r, e.y - e.r, e.r * 2, e.r * 2);
        // Blocks flip to the other side of the track rather than run off the
        // glass. Dense is the point; truncated is just broken.
        const flip = e.x + e.r + 92 > w;
        const lx = flip ? e.x - e.r - 14 : e.x + e.r + 14;
        const ly = Math.max(TOP + 16, e.y - e.r - 6);
        const al = flip ? 'right' : 'left';
        g.beginPath();
        g.moveTo(e.x + (flip ? -e.r : e.r), e.y - e.r);
        g.lineTo(lx + (flip ? 4 : -4), ly + 2); g.stroke();
        txt(g, 'T' + String(i + 41).padStart(3, '0') + ' ' + CODE[e.kind],
          lx, ly, '700 8px ' + MONO, WH, al);
        txt(g, (380 + i * 37) + 'M  ' + (94 + i * 11) + '\u00B0', lx, ly + 9,
          '700 7.5px ' + MONO, D + '0.65)', al);
      });

      for (const m of V.marks) {
        g.strokeStyle = '#9dff9d'; g.lineWidth = 1.4;
        g.strokeRect(m.x - 11, m.y - 11, 22, 22);
        g.beginPath(); g.arc(m.x, m.y, 3, 0, 7); g.stroke();
        if (m.lead) txt(g, 'ANVIL 6', m.x + 15, m.y + 3, '700 8px ' + MONO, '#9dff9d');
      }

      const ib = V.inbound;
      g.strokeStyle = '#ffd166'; g.lineWidth = 1.2;
      g.strokeRect(ib.x - 26, ib.y - 26, 52, 52);
      txt(g, 'TOF ' + ib.t.toFixed(1), ib.x + 30, ib.y, '700 8px ' + MONO, '#ffd166');

      // Precision cross with a range ladder.
      const cx = w / 2 + M.stickR.dx * Math.min(w, h) * 0.38;
      const cy = (TOP + h - BOT) / 2 + M.stickR.dy * Math.min(w, h) * 0.32;
      g.strokeStyle = WH; g.lineWidth = 1.2;
      g.beginPath();
      g.moveTo(cx - 40, cy); g.lineTo(cx - 6, cy); g.moveTo(cx + 6, cy); g.lineTo(cx + 40, cy);
      g.moveTo(cx, cy - 40); g.lineTo(cx, cy - 6); g.moveTo(cx, cy + 6); g.lineTo(cx, cy + 40);
      g.stroke();
      for (let i = -2; i <= 2; i++) {
        if (!i) continue;
        g.beginPath(); g.moveTo(cx + i * 14, cy - 4); g.lineTo(cx + i * 14, cy + 4); g.stroke();
      }
      txt(g, 'CCIP', cx + 46, cy - 42, '700 8px ' + MONO, D + '0.8)');

      // Sticks, drawn as square gates. Small, because everything here is.
      for (const [s, px] of [[M.stickL, 74], [M.stickR, w - 74]]) {
        const py = h - BOT - 56;
        g.strokeStyle = D + '0.4)'; g.lineWidth = 1.2;
        g.strokeRect(px - 44, py - 44, 88, 88);
        g.beginPath(); g.moveTo(px - 44, py); g.lineTo(px + 44, py);
        g.moveTo(px, py - 44); g.lineTo(px, py + 44); g.stroke();
        g.fillStyle = C;
        g.fillRect(px + s.dx * 40 - 5, py + s.dy * 40 - 5, 10, 10);
      }
    }
  };

  /* ====================================================== TACTICAL SLATE == */

  const slate = {
    id: 'slate', name: 'TACTICAL SLATE', accent: '#ff9d3c',
    tagline: 'A game interface, not simulated hardware. Panels, chips, big numbers.',
    notes: [
      ['Claims', 'Classification, but summarised rather than enumerated — hostiles become colour-coded chips by threat type instead of individually labelled tracks.'],
      ['Heat', 'A thick bar directly above the weapon chips, in the bottom-centre where both thumbs and the eye already are. The easiest of the four to read mid-burst.'],
      ['Cost to the image', 'Moderate. Panels are opaque but few and pushed into corners, so the middle of the sector stays completely clear.'],
      ['Reads as', 'A modern free-to-play game. The most legible and the most conventional; also the only one that does not feel like looking through an aircraft.']
    ],
    grade(g, cv, w, h, t) {
      g.save(); g.setTransform(1, 0, 0, 1, 0, 0);
      g.globalCompositeOperation = 'screen';
      g.fillStyle = 'rgba(18,22,34,0.45)'; g.fillRect(0, 0, w, h);
      g.globalCompositeOperation = 'source-over';
      g.fillStyle = 'rgba(4,6,12,0.28)'; g.fillRect(0, 0, w, h);   // sink the image back
      g.restore();
    },
    hud(g, w, h, t, V, M) {
      const O = '#ff9d3c', RED = '#ff5a5a', VIO = '#c08cff', GRN = '#68e39b';
      const PANEL = 'rgba(14,17,24,.88)', LINE = 'rgba(255,255,255,.10)';
      const chip = k => k === 'phalanx' ? RED : k === 'jammer' ? VIO : k === 'technical' ? '#ffd166' : O;

      // Threat chips. No brackets — a pill above the contact, coloured by what
      // it is. Reads at a glance; tells you less precisely where it is.
      for (const e of V.tgts) {
        if (e.kind === 'ghost' && !e.hot) continue;
        const col = chip(e.kind);
        const label = e.kind === 'phalanx' ? 'HEAVY' : e.kind === 'jammer' ? 'EW'
          : e.kind === 'technical' ? 'FAST' : 'INF';
        g.font = '700 9px ' + SANS;
        const tw = g.measureText(label).width + 14;
        box(g, e.x - tw / 2, e.y - e.r - 20, tw, 15, PANEL, col, 7);
        txt(g, label, e.x, e.y - e.r - 9, '700 9px ' + SANS, col, 'center');
        g.strokeStyle = col; g.lineWidth = 1.5;
        g.beginPath(); g.arc(e.x, e.y, e.r * 0.8, -0.6, 0.6 + Math.PI * e.hp * 1.6); g.stroke();
      }

      for (const m of V.marks) {
        g.fillStyle = GRN;
        g.beginPath();
        g.moveTo(m.x, m.y - 11); g.lineTo(m.x + 9, m.y + 7); g.lineTo(m.x - 9, m.y + 7);
        g.closePath(); g.fill();
      }

      const ib = V.inbound;
      ring(g, ib.x, ib.y, 30, 'rgba(255,214,102,.85)', 2, [6, 6]);
      box(g, ib.x - 22, ib.y - 46, 44, 18, PANEL, '#ffd166', 9);
      txt(g, ib.t.toFixed(1) + 's', ib.x, ib.y - 33, '700 10px ' + SANS, '#ffd166', 'center');

      // Convoy card, top-left. A named unit with a health bar is the single
      // most conventional thing in this design and also the clearest.
      box(g, 12, 12, 216, 56, PANEL, LINE, 10);
      box(g, 22, 22, 36, 36, 'rgba(104,227,155,.14)', GRN, 8);
      txt(g, '▲', 40, 46, '700 16px ' + SANS, GRN, 'center');
      txt(g, 'ANVIL', 68, 33, '700 13px ' + SANS, '#fff');
      txt(g, M.integrity + '%', 218, 33, '700 13px ' + SANS, M.integrity < 30 ? RED : GRN, 'right');
      box(g, 68, 40, 150, 8, 'rgba(255,255,255,.10)', null, 4);
      g.fillStyle = M.integrity < 30 ? RED : GRN;
      if (g.roundRect) { g.beginPath(); g.roundRect(68, 40, 150 * M.integrity / 100, 8, 4); g.fill(); }
      else g.fillRect(68, 40, 150 * M.integrity / 100, 8);
      txt(g, 'PHASE ' + M.phase + ' OF ' + M.phases + '  ·  ' + M.hostilesLeft + ' HOSTILE',
        68, 60, '600 9px ' + SANS, 'rgba(255,255,255,.55)');

      // Objective pill, top-centre.
      g.font = '700 11px ' + SANS;
      const lw = g.measureText(M.label).width + 28;
      box(g, w / 2 - lw / 2, 14, lw, 26, PANEL, LINE, 13);
      txt(g, M.label, w / 2, 31, '700 11px ' + SANS, '#fff', 'center');

      // Zoom as a pill stack, top-right.
      M.zooms.forEach((z, i) => {
        const on = i === M.zoomIdx, y = 14 + i * 30;
        box(g, w - 76, y, 62, 26, on ? 'rgba(255,157,60,.22)' : PANEL, on ? O : LINE, 13);
        txt(g, z.toFixed(2) + 'x', w - 45, y + 17, '700 10px ' + SANS, on ? O : 'rgba(255,255,255,.6)', 'center');
      });

      // Bottom centre: heat bar directly over the weapon chips.
      const cw = 78, gap = 8, names = ['25', '40', '105'];
      const tot = names.length * (cw + gap) - gap;
      const bx0 = w / 2 - tot / 2;
      const heat = M.heat[M.weapon];
      box(g, bx0, h - 76, tot, 9, 'rgba(255,255,255,.10)', null, 5);
      g.fillStyle = heat > 0.72 ? RED : O;
      if (g.roundRect) { g.beginPath(); g.roundRect(bx0, h - 76, tot * heat, 9, 5); g.fill(); }
      else g.fillRect(bx0, h - 76, tot * heat, 9);
      txt(g, 'HEAT', bx0 - 10, h - 68, '700 9px ' + SANS, 'rgba(255,255,255,.5)', 'right');

      names.forEach((n, i) => {
        const on = i === M.weapon, lk = !M.stations[i], x = bx0 + i * (cw + gap);
        box(g, x, h - 60, cw, 46, on ? 'rgba(255,157,60,.20)' : PANEL, on ? O : LINE, 10);
        g.save(); g.globalAlpha = lk ? 0.35 : 1;
        txt(g, n, x + cw / 2, h - 34, '800 19px ' + SANS, on ? O : '#fff', 'center');
        txt(g, lk ? 'LOCKED' : 'mm', x + cw / 2, h - 21, '600 9px ' + SANS, 'rgba(255,255,255,.5)', 'center');
        g.restore();
      });

      // Round fire button, bottom-right, plus soft stick pads.
      box(g, w - 96, h - 96, 76, 76, 'rgba(255,157,60,.20)', O, 38);
      txt(g, 'FIRE', w - 58, h - 54, '800 12px ' + SANS, O, 'center');

      for (const [s, px] of [[M.stickL, 84], [M.stickR, w - 190]]) {
        const py = h - 84;
        g.fillStyle = 'rgba(255,255,255,.06)';
        g.beginPath(); g.arc(px, py, 52, 0, 7); g.fill();
        g.fillStyle = 'rgba(255,255,255,.16)';
        g.beginPath(); g.arc(px + s.dx * 46, py + s.dy * 46, 20, 0, 7); g.fill();
        ring(g, px + s.dx * 46, py + s.dy * 46, 20, 'rgba(255,255,255,.5)', 1.5);
      }

      // Reticle: a soft ring with a dot. Nothing spins.
      const cx = w / 2 + M.stickR.dx * Math.min(w, h) * 0.38;
      const cy = h / 2 + M.stickR.dy * Math.min(w, h) * 0.34;
      ring(g, cx, cy, 20, 'rgba(255,255,255,.85)', 2);
      ring(g, cx, cy, 30, 'rgba(255,157,60,.5)', 1.5, [4, 8]);
      g.fillStyle = O;
      g.beginPath(); g.arc(cx, cy, 3, 0, 7); g.fill();
    }
  };

  return { list: [vanguard, nvg, milspec, slate] };
})();
