/* Vanguard Orbit — the threat matrix.
 *
 * Four hostiles, and each one exists to take a different weapon away from the
 * player. That is the whole design rule for this file: a hostile that can be
 * answered by holding the right stick down is not a hostile, it is a delay.
 *
 *   Ghost      — you cannot SEE it until it shoots.
 *   Jammer     — you cannot rely on the automatic trigger.
 *   Phalanx    — you cannot kill it with the gun you have been using.
 *   Technical  — you cannot take your time.
 *
 * Every draw function works in greys and is written to survive 3x optical
 * zoom, because that is where the player will be when identification matters.
 * Nothing here is an image file. A thermal signature is a blob with a couple
 * of hot points, which is exactly what a canvas is good at.
 */
'use strict';

const Hostiles = (() => {

  const grey = v => 'rgb(' + (v | 0) + ',' + (v | 0) + ',' + (v | 0) + ')';

  /* Sensor gain, set from the career's ladder. It is added to the GHOST only,
   * and that is not a gameplay fudge — a better-cooled head resolves a
   * low-contrast signature that was previously sitting in the noise floor, and
   * does nothing whatsoever for a redlined engine block that was already
   * saturating the sensor. The one hostile built out of low contrast is the
   * one a new sensor head changes. */
  let GAIN = 0;
  const setGain = n => { GAIN = n || 0; };

  /* Heat halo. Used for anything that should read as *emitting* rather than
   * merely being warm — engine blocks, muzzle flash, broadcast arrays. Drawn
   * with 'lighter' so overlapping sources stack the way real bloom does. */
  function halo(g, x, y, r, a) {
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, 'rgba(255,255,255,' + a + ')');
    gr.addColorStop(0.45, 'rgba(255,255,255,' + a * 0.35 + ')');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    const old = g.globalCompositeOperation;
    g.globalCompositeOperation = 'lighter';
    g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
    g.globalCompositeOperation = old;
  }

  /* ---------------------------------------------------------------------- */

  const KINDS = {

    /* "Ghost" infantry. Thermal-dampening capes, so at rest they sit about
     * fifteen points of luminance above the dirt they are crossing — visible
     * if you are looking straight at them and invisible if you are not.
     *
     * The flare is the entire fight. Firing dumps the cape's advantage for
     * about a second and a half, and that window is when the player can see
     * where the squad actually is. Punishing the player for the window being
     * short would be unfair; the window is instead LONG and the squads are
     * numerous, so the cost of missing it is that another one gets a shot at
     * the convoy, not that you lose the target forever. */
    ghost: {
      name: 'GHOST INFANTRY', tag: 'FODDER',
      hp: 26, speed: 34, r: 8, contact: 6,
      dmg: 0.9, range: 300, cadence: 1.9, burst: 1.5,
      score: 10,
      draw(g, e, t) {
        const f = e.flare;                        // 0..1, 1 right after firing
        const body = 42 + GAIN + f * 172;
        g.save(); g.translate(e.x, e.y); g.rotate(e.face);
        if (f > 0.05) halo(g, 0, 0, 26 + f * 16, f * 0.5);
        // Cape first: a broad, cold, low-contrast smear that is most of the
        // silhouette and almost none of the signal.
        g.fillStyle = grey(30 + GAIN * 0.8 + f * 40);
        g.beginPath(); g.ellipse(-2, 0, 11, 8, 0, 0, 7); g.fill();
        g.fillStyle = grey(body);
        g.beginPath(); g.ellipse(0, 0, 6.5, 4.6, 0, 0, 7); g.fill();
        g.fillStyle = grey(body + 26);            // head, uncovered, always warmer
        g.beginPath(); g.arc(2.4, 0, 2.7, 0, 7); g.fill();
        if (f > 0.4) {                            // weapon, only while hot
          g.fillStyle = grey(200 + f * 55);
          g.fillRect(4, -1.1, 9, 2.2);
        }
        g.restore();
      }
    },

    /* Jammer technician. Never shoots. Its backpack array does the damage, by
     * taking the automatic trigger away — while any jammer is inside its own
     * broadcast radius of the crosshair, deflecting the right stick no longer
     * spools the gun and the player has to use the manual trigger.
     *
     * It is drawn hot and obvious on purpose. A support unit that is hard to
     * find as well as hard to ignore is two problems wearing one coat, and the
     * interesting problem is the second one: it is always escorted, so the
     * question is whether you can afford to stop shooting at the escort. */
    jammer: {
      name: 'JAMMER TECHNICIAN', tag: 'EW SUPPORT',
      hp: 44, speed: 28, r: 9, contact: 0,
      dmg: 0, range: 0, cadence: 0, burst: 0,
      jam: 620,                                    // world-px broadcast radius
      score: 60,
      draw(g, e, t) {
        const p = 0.6 + 0.4 * Math.sin(t * 6.2);
        g.save(); g.translate(e.x, e.y); g.rotate(e.face);
        halo(g, -3, 0, 22, 0.30 * p);
        g.fillStyle = grey(74);
        g.beginPath(); g.ellipse(0, 0, 7, 5, 0, 0, 7); g.fill();
        g.fillStyle = grey(96);
        g.beginPath(); g.arc(2.6, 0, 2.9, 0, 7); g.fill();
        g.fillStyle = grey(120 + p * 120);         // the array itself
        g.fillRect(-9, -4.5, 6, 9);
        g.strokeStyle = 'rgba(255,255,255,' + (0.25 + p * 0.4) + ')'; g.lineWidth = 1;
        for (let i = 1; i <= 2; i++) {             // broadcast rings
          g.beginPath(); g.arc(-6, 0, 9 + i * 7 + p * 5, 2.2, 4.1); g.stroke();
        }
        g.restore();
      }
    },

    /* Industrial Phalanx. Advances behind a concrete-filled cable spool drum.
     * The drum is a cold mass with a hostile hidden entirely inside its
     * thermal shadow, so a 25mm burst into the front arc does nothing at all —
     * `shielded()` below is the only place in the game where a direct hit is
     * discarded, and it is discarded silently apart from a spark, because the
     * player learning "that is not working" is the lesson.
     *
     * Splash ignores it. So does anything that arrives from behind. Both
     * answers are available from the first Phalanx the player ever meets. */
    phalanx: {
      name: 'INDUSTRIAL PHALANX', tag: 'SHIELDED HEAVY',
      hp: 190, speed: 19, r: 15, contact: 12,
      dmg: 2.6, range: 235, cadence: 2.4, burst: 1.2,
      arc: 1.25,                                   // half-angle of the shielded front
      score: 90,
      draw(g, e, t) {
        const f = e.flare;
        g.save(); g.translate(e.x, e.y); g.rotate(e.face);
        if (f > 0.05) halo(g, 6, 0, 22, f * 0.45);
        g.fillStyle = grey(66 + f * 90);           // the man
        g.beginPath(); g.ellipse(-6, 0, 7.5, 6, 0, 0, 7); g.fill();
        g.fillStyle = grey(86 + f * 90);
        g.beginPath(); g.arc(-3, 0, 3.2, 0, 7); g.fill();
        // The drum. Deliberately DARKER than the road it is being rolled
        // along, so the player reads a hole moving up the street.
        g.fillStyle = 'rgba(0,0,0,.55)';
        g.beginPath(); g.ellipse(9, 3, 15, 15, 0, 0, 7); g.fill();
        g.fillStyle = grey(22);
        g.beginPath(); g.arc(7, 0, 15, 0, 7); g.fill();
        g.strokeStyle = grey(50); g.lineWidth = 2.5;
        g.beginPath(); g.arc(7, 0, 15, 0, 7); g.stroke();
        g.strokeStyle = grey(38); g.lineWidth = 1.5;
        g.beginPath(); g.arc(7, 0, 8, 0, 7); g.stroke();
        g.restore();
      }
    },

    /* Over-clocked technical. Fast, fragile, and the only hostile that does
     * not path — it drives the road net, which means it arrives from a
     * direction the infantry never do and reaches the convoy in a quarter of
     * the time.
     *
     * The redlined block is a white point that survives being two pixels wide
     * at 1x, which is the point: this is the one hostile you are meant to spot
     * while zoomed out. A direct 40mm on the block cooks off the fuel and the
     * truck takes its neighbours with it. */
    technical: {
      name: 'OVER-CLOCKED TECHNICAL', tag: 'RAPID RESPONSE',
      hp: 62, speed: 108, r: 14, contact: 18,
      dmg: 3.4, range: 300, cadence: 1.5, burst: 0.9,
      cookoff: 130, cookoffR: 150,                 // secondary detonation
      score: 70,
      draw(g, e, t) {
        const f = e.flare;
        g.save(); g.translate(e.x, e.y); g.rotate(e.face);
        halo(g, 9, 0, 26, 0.42);                   // the engine, always
        g.fillStyle = 'rgba(0,0,0,.5)'; g.fillRect(-15, -7, 34, 15);
        g.fillStyle = grey(54); g.fillRect(-17, -9, 34, 16);
        g.fillStyle = grey(40); g.fillRect(-11, -6.5, 12, 13);   // tray
        g.fillStyle = grey(72); g.fillRect(-2, -6, 8, 12);       // cab
        g.fillStyle = grey(236); g.fillRect(7, -5, 9, 10);       // block, redlined
        g.fillStyle = grey(150); g.fillRect(16, -3.5, 3, 7);
        if (f > 0.3) { g.fillStyle = grey(240); g.fillRect(-4, -9.5, 4, 3); }
        g.restore();
      }
    }
  };

  /* Is this hit landing on the Phalanx's drum?
   * `ang` is the direction the round is travelling. A round travelling within
   * `arc` of the hostile's own facing is arriving head-on. Direct fire only —
   * splash never asks. */
  function shielded(e, ang) {
    const k = KINDS[e.kind];
    if (!k.arc) return false;
    let d = ang - (e.face + Math.PI);
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return Math.abs(d) < k.arc;
  }

  return { KINDS, shielded, halo, grey, setGain };
})();
