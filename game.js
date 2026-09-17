/* Vanguard Orbit: Tactical Strike — sector one.
 *
 * A loitering gunship over a city block, and a convoy of friendlies driving
 * through it. The convoy is both the objective and the health bar: it advances
 * when the road ahead is clear, it stops when it is not, and if it is gone the
 * mission is gone. Nothing else in the game is scored.
 *
 * Three rules this file keeps:
 *
 *   1. State lives in `S`. The HUD is written FROM state and never read back.
 *      The DOM is an output device here, not a variable.
 *
 *   2. The camera is one transform, declared once. Every screen-to-world
 *      question in the game — where the crosshair is pointing, whether a
 *      hostile is worth drawing a bracket around, where a shell lands — goes
 *      through `toWorld`/`toScreen` and nowhere else. The version of this that
 *      inlined the maths in four places had the crosshair and the shells
 *      disagreeing by half a pixel per zoom step, which is invisible at 1x and
 *      a miss at 3x.
 *
 *   3. The world layer only ever draws greys. Amber belongs to the aircraft's
 *      own interface and never touches the sensor image. That separation is
 *      the look, and it is one `if` away from being mud.
 */
'use strict';

/* ================================================================ tuning === */

const WEAPONS = [
  /* 25mm rotary. The default, and the only hitscan weapon: at this altitude a
   * 25mm round's flight time is short enough that leading a walking man is not
   * a skill, it is an annoyance. Its cost is heat — held down it locks out in
   * a little over five seconds, and the lockout is long. Burst discipline is
   * the whole of its skill ceiling. */
  {
    id: 'm25', name: '25MM ROTARY', abbr: '25', key: '1',
    rof: 11, dmg: 9, splash: 0, splashDmg: 0, tof: 0, spread: 2.4,
    heat: 0.058, cool: 0.34, spool: 0.5, lockCool: 0.36,
    shake: 0.8, sfx: 'gat'
  },
  /* 40mm autocannon. The answer to anything in a group and the only thing
   * that reliably cooks a technical's engine block. Real flight time, so it
   * has to be led — which is exactly the tax for the splash. */
  {
    id: 'm40', name: '40MM AUTOCANNON', abbr: '40', key: '2',
    rof: 2.6, dmg: 34, splash: 58, splashDmg: 30, tof: 0.34, spread: 7,
    heat: 0.15, cool: 0.28, spool: 0, lockCool: 0.30,
    shake: 3.2, sfx: 'auto'
  },
  /* 105mm. Fifteen hundred milliseconds of flight and a blast radius that
   * covers a courtyard. It is the only answer to a Phalanx and it will be
   * somewhere else when you need it, which is the point of giving it a timer
   * the player can watch falling. */
  {
    id: 'm105', name: '105MM HOWITZER', abbr: '105', key: '3',
    rof: 0.3, dmg: 150, splash: 150, splashDmg: 115, tof: 1.5, spread: 15,
    heat: 0.5, cool: 0.24, spool: 0, lockCool: 0.25,
    shake: 12, sfx: 'how'
  }
];

const ZOOMS = [1.0, 1.75, 3.0];

/* Eight phase lines, eight fights. The counts ramp, but the SHAPE of each
 * wave is what escalates: wave 1 is a target, wave 4 takes a weapon away,
 * wave 6 takes two away at once, and wave 8 is all four problems at the same
 * time on a convoy that has already been chewed on for six minutes. */
const WAVES = [
  { label: 'PROBE',         ghost: 5 },
  { label: 'ROAD CONTACT',  ghost: 7,  technical: 1 },
  { label: 'ELECTRONIC WARFARE', ghost: 6, jammer: 1, technical: 1 },
  { label: 'HARDENED PUSH', ghost: 8,  phalanx: 1 },
  { label: 'RAPID RESPONSE', ghost: 7, technical: 3 },
  { label: 'COMBINED ARMS', ghost: 9,  jammer: 2, phalanx: 1 },
  { label: 'BREAKTHROUGH',  ghost: 10, technical: 3, phalanx: 2 },
  { label: 'LAST STAND',    ghost: 12, jammer: 2, technical: 4, phalanx: 3 }
];

const CONVOY_HP = 100;
const CONVOY_SPEED = 46;          // world px/s while advancing
const TRIGGER_R = 0.45;           // right-stick deflection that spools the gun
const STICK_R = 62;               // CSS px, the ring the thumb works inside

/* ================================================================= state === */

const S = {
  phase: 'boot',
  t: 0, dt: 0,
  sector: null,
  cam: { x: 0, y: 0, z: 1, zi: 0, zt: 1, panX: 0, panY: 0, toX: null, toY: null },
  cross: { x: 0, y: 0 },          // CSS px, screen space
  weapon: 0,
  heat: [0, 0, 0], locked: [false, false, false],
  spool: 0, nextShot: [0, 0, 0],
  firing: false, manual: false,
  hostiles: [], rounds: [], fx: [], tracers: [],
  convoy: null,
  wave: 0, waveActive: false, waveT: 0, queue: [], pending: 0,
  jam: 0, jammed: false,
  shake: 0,
  score: 0, kills: 0, shots: 0, hits: 0, elapsed: 0,
  quality: 1, frameAcc: 0, frameN: 0,
  flow: null, flowAt: 0,
  best: null
};

let W = 0, H = 0, DPR = 1;
let world, wg, hud, hg;

/* ================================================================ camera === */

// Half the visible world, in world units. Every clamp in the file is written
// against these two rather than against the screen size, because at 3x the
// screen is a third of the world it was at 1x and the clamp has to follow.
const halfW = () => W / (2 * S.cam.z);
const halfH = () => H / (2 * S.cam.z);

function clampCam() {
  const hw = halfW(), hh = halfH();
  S.cam.x = hw * 2 >= SECTOR_W ? SECTOR_W / 2 : Math.max(hw, Math.min(SECTOR_W - hw, S.cam.x));
  S.cam.y = hh * 2 >= SECTOR_H ? SECTOR_H / 2 : Math.max(hh, Math.min(SECTOR_H - hh, S.cam.y));
}

const toScreenX = wx => (wx - S.cam.x) * S.cam.z + W / 2;
const toScreenY = wy => (wy - S.cam.y) * S.cam.z + H / 2;
const toWorldX = sx => (sx - W / 2) / S.cam.z + S.cam.x;
const toWorldY = sy => (sy - H / 2) / S.cam.z + S.cam.y;
const onScreen = (wx, wy, m) => {
  const x = toScreenX(wx), y = toScreenY(wy);
  return x > -m && x < W + m && y > -m && y < H + m;
};

/* ================================================================= setup === */

function resize() {
  DPR = Math.min(2, window.devicePixelRatio || 1);
  W = window.innerWidth; H = window.innerHeight;
  for (const c of [world, hud]) {
    c.width = Math.round(W * DPR); c.height = Math.round(H * DPR);
    c.style.width = W + 'px'; c.style.height = H + 'px';
  }
  wg.setTransform(DPR, 0, 0, DPR, 0, 0);
  hg.setTransform(DPR, 0, 0, DPR, 0, 0);
  wg.imageSmoothingEnabled = true;
  Thermal.init(W * DPR, H * DPR, DPR);
  if (S.cross.x === 0) { S.cross.x = W / 2; S.cross.y = H / 2; }
  Sticks.layout();
  clampCam();
}

/* ============================================================== the route === */

// The control points are turned into a dense polyline once. The convoy walks
// it by arc length, which is the only way a vehicle takes a corner at a
// constant speed instead of accelerating through it.
function densify(pts, step) {
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const d = Math.hypot(b.x - a.x, b.y - a.y), n = Math.max(1, Math.round(d / step));
    for (let k = 0; k < n; k++) out.push({ x: a.x + (b.x - a.x) * k / n, y: a.y + (b.y - a.y) * k / n });
  }
  out.push(pts[pts.length - 1]);
  let acc = 0;
  out[0].d = 0;
  for (let i = 1; i < out.length; i++) {
    acc += Math.hypot(out[i].x - out[i - 1].x, out[i].y - out[i - 1].y);
    out[i].d = acc;
  }
  out.total = acc;
  return out;
}

function atDist(line, d) {
  d = Math.max(0, Math.min(line.total, d));
  let lo = 0, hi = line.length - 1;
  while (lo < hi - 1) { const m = (lo + hi) >> 1; if (line[m].d <= d) lo = m; else hi = m; }
  const a = line[lo], b = line[hi], seg = (b.d - a.d) || 1, t = (d - a.d) / seg;
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, a: Math.atan2(b.y - a.y, b.x - a.x) };
}

/* ============================================================ flow field === */

/* Breadth-first distance field from the convoy over the walkability grid, and
 * hostiles walk down its gradient. Eighty by fifty is four thousand cells —
 * cheap enough to rebuild twice a second, which is what keeps infantry from
 * queueing up against a wall the convoy drove past ten seconds ago.
 *
 * A* per hostile was the first version. It was correct, and it cost more than
 * every other system in the game put together once a wave passed twenty. */
function buildFlow(tx, ty) {
  const L = S.sector, GWx = Sector.GW, GHx = Sector.GH, C = Sector.CELL;
  const n = GWx * GHx;
  const dist = new Int32Array(n).fill(-1);
  const sx = Math.max(0, Math.min(GWx - 1, tx / C | 0));
  const sy = Math.max(0, Math.min(GHx - 1, ty / C | 0));
  const q = new Int32Array(n);
  let head = 0, tail = 0;
  const start = sy * GWx + sx;
  dist[start] = 0; q[tail++] = start;
  while (head < tail) {
    const cur = q[head++], cd = dist[cur];
    const cx = cur % GWx, cy = (cur / GWx) | 0;
    for (let k = 0; k < 4; k++) {
      const nx = cx + (k === 0 ? 1 : k === 1 ? -1 : 0);
      const ny = cy + (k === 2 ? 1 : k === 3 ? -1 : 0);
      if (nx < 0 || ny < 0 || nx >= GWx || ny >= GHx) continue;
      const ni = ny * GWx + nx;
      if (dist[ni] !== -1 || L.walk[ni]) continue;
      dist[ni] = cd + 1; q[tail++] = ni;
    }
  }
  return dist;
}

// The gradient, as a unit vector. Falls back to straight-line steering when
// the hostile is standing somewhere the field never reached — inside a
// building it spawned against, most often — so it walks out rather than stalls.
function flowDir(x, y, tx, ty) {
  const f = S.flow, GWx = Sector.GW, GHx = Sector.GH, C = Sector.CELL;
  const cx = Math.max(0, Math.min(GWx - 1, x / C | 0));
  const cy = Math.max(0, Math.min(GHx - 1, y / C | 0));
  const here = f[cy * GWx + cx];
  let bx = 0, by = 0, best = here < 0 ? Infinity : here;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if (!dx && !dy) continue;
    const nx = cx + dx, ny = cy + dy;
    if (nx < 0 || ny < 0 || nx >= GWx || ny >= GHx) continue;
    const d = f[ny * GWx + nx];
    if (d >= 0 && d < best) { best = d; bx = dx; by = dy; }
  }
  if (!bx && !by) {
    const ax = tx - x, ay = ty - y, m = Math.hypot(ax, ay) || 1;
    return { x: ax / m, y: ay / m };
  }
  const m = Math.hypot(bx, by);
  return { x: bx / m, y: by / m };
}

/* ================================================================= input === */

/* Two dynamic sticks, one per half of the screen. Dynamic because a fixed pad
 * on a phone is a pad the thumb has to find, and finding it costs the second
 * the technical needed. Wherever the thumb lands is the centre.
 *
 * The right stick is positional, not velocity: its deflection IS the
 * crosshair's offset from the centre of the window. Beyond TRIGGER_R the gun
 * spools. That coupling is the control scheme — you cannot commit to a
 * direction without also committing to firing in it, so the left stick's job
 * of putting the target near the middle stops being optional. */
const Sticks = (() => {
  const L = { id: null, ox: 0, oy: 0, x: 0, y: 0, dx: 0, dy: 0, on: false };
  const R = { id: null, ox: 0, oy: 0, x: 0, y: 0, dx: 0, dy: 0, on: false };
  let restX = 0, restY = 0;

  function layout() { restX = W * 0.5; restY = H * 0.5; }

  function norm(s) {
    let dx = s.x - s.ox, dy = s.y - s.oy;
    const m = Math.hypot(dx, dy);
    if (m > STICK_R) { dx = dx / m * STICK_R; dy = dy / m * STICK_R; }
    s.dx = dx / STICK_R; s.dy = dy / STICK_R;
  }

  function down(id, x, y) {
    // The zoom rail owns the right edge; it is checked before the sticks so a
    // thumb reaching for it does not instead deflect the gun at the sky.
    if (Rail.hit(x, y)) { Rail.down(id, y); return; }
    const s = (x < W * 0.5) ? L : R;
    if (s.id !== null) return;
    s.id = id; s.ox = x; s.oy = y; s.x = x; s.y = y; s.on = true; norm(s);
  }
  function move(id, x, y) {
    if (Rail.move(id, y)) return;
    for (const s of [L, R]) if (s.id === id) { s.x = x; s.y = y; norm(s); }
  }
  function up(id) {
    Rail.up(id);
    for (const s of [L, R]) if (s.id === id) { s.id = null; s.on = false; s.dx = s.dy = 0; }
  }

  return {
    L, R, layout, down, move, up,
    rest: () => ({ x: restX, y: restY })
  };
})();

/* The optical zoom rail: a vertical AR slider pinned to the right edge with
 * three detents. It snaps, because a continuous zoom on a touchscreen is a
 * zoom the player can never return to a known magnification. */
const Rail = (() => {
  let id = null;
  // Sits high on the right edge, and it has to. Slung down the middle of that
  // edge it ran straight into the heat gauge wrapped around the aim stick's
  // resting ring on any screen under about 420 tall — and the rail wins ties,
  // so reaching for the gun on a phone changed the magnification instead.
  const geo = () => ({ x: W - 30, y0: H * 0.20, y1: H * 0.46 });
  function hit(x, y) { const g = geo(); return x > g.x - 26 && y > g.y0 - 22 && y < g.y1 + 22; }
  function pick(y) {
    const g = geo(), t = (y - g.y0) / (g.y1 - g.y0);
    setZoom(Math.max(0, Math.min(2, Math.round((1 - t) * 2))));
  }
  return {
    hit, geo,
    down(i, y) { id = i; pick(y); },
    move(i, y) { if (id !== i) return false; pick(y); return true; },
    up(i) { if (id === i) id = null; }
  };
})();

function setZoom(i) {
  if (i === S.cam.zi) return;
  S.cam.zi = i; S.cam.zt = ZOOMS[i];
  UI.flash('OPTICAL ' + ZOOMS[i].toFixed(2) + 'X');
}
function cycleZoom() { setZoom((S.cam.zi + 1) % ZOOMS.length); }

function recenter() {
  if (!S.convoy) return;
  const p = atDist(S.sector.line, S.convoy.d);
  S.cam.toX = p.x; S.cam.toY = p.y;
  UI.flash('SLEWING TO CALLSIGN ANVIL');
}

function bindInput() {
  const surf = document.getElementById('surface');
  const pt = e => { const r = surf.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };

  surf.addEventListener('pointerdown', e => {
    if (S.phase !== 'play') return;
    // Capture keeps a thumb that slides off the element still reporting moves.
    // It is also allowed to throw — a pointer that ended between the browser
    // queueing this event and us handling it has no id to capture any more —
    // and an unguarded throw here takes the whole handler with it, which is a
    // stick that silently never engages and a zoom rail that never responds.
    try { surf.setPointerCapture(e.pointerId); } catch (err) {}
    const p = pt(e);
    if (e.pointerType === 'mouse') { S.manual = true; S.cross.x = p.x; S.cross.y = p.y; }
    else Sticks.down(e.pointerId, p.x, p.y);
  });
  surf.addEventListener('pointermove', e => {
    const p = pt(e);
    if (e.pointerType === 'mouse') { S.cross.x = p.x; S.cross.y = p.y; return; }
    if (S.phase !== 'play') return;
    Sticks.move(e.pointerId, p.x, p.y);
  });
  const end = e => {
    if (e.pointerType === 'mouse') { S.manual = false; return; }
    Sticks.up(e.pointerId);
  };
  surf.addEventListener('pointerup', end);
  surf.addEventListener('pointercancel', end);
  surf.addEventListener('contextmenu', e => e.preventDefault());

  surf.addEventListener('wheel', e => {
    e.preventDefault();
    if (S.phase !== 'play') return;
    setZoom(Math.max(0, Math.min(2, S.cam.zi + (e.deltaY < 0 ? 1 : -1))));
  }, { passive: false });

  // Double-tap anywhere on the sensor image cycles magnification, which is the
  // one control that has to work when both thumbs are already busy.
  let lastTap = 0;
  surf.addEventListener('pointerup', e => {
    if (e.pointerType === 'mouse' || S.phase !== 'play') return;
    const now = performance.now();
    if (now - lastTap < 280) { cycleZoom(); lastTap = 0; } else lastTap = now;
  });

  const keys = {};
  addEventListener('keydown', e => {
    keys[e.code] = true;
    if (S.phase !== 'play') return;
    if (e.code === 'Digit1') selectWeapon(0);
    if (e.code === 'Digit2') selectWeapon(1);
    if (e.code === 'Digit3') selectWeapon(2);
    if (e.code === 'KeyQ') cycleZoom();
    if (e.code === 'KeyR') recenter();
    if (e.code === 'Escape') UI.togglePause();
  });
  addEventListener('keyup', e => { keys[e.code] = false; });
  S.keys = keys;
}

function selectWeapon(i) {
  if (i === S.weapon) return;
  S.weapon = i; S.spool = 0;
  UI.weapon(i);
  UI.flash(WEAPONS[i].name + ' SELECTED');
}

/* ============================================================== mission === */

function startMission(seed) {
  S.sector = Sector.generate(seed);
  S.sector.line = densify(S.sector.route, 18);
  const total = S.sector.line.total;

  // Phase lines. The last wave deliberately lands well short of the exit, so
  // the run out to extraction is a lap of honour rather than a coin flip.
  S.lineD = [0.05, 0.17, 0.29, 0.40, 0.51, 0.63, 0.75, 0.86].map(f => total * f);

  S.convoy = {
    d: 0, hp: CONVOY_HP, halted: false, hurt: 0,
    units: [{ off: 0, cool: 0 }, { off: -52, cool: .4 }, { off: -104, cool: .8 }]
  };
  S.hostiles.length = 0; S.rounds.length = 0; S.fx.length = 0; S.tracers.length = 0;
  S.wave = 0; S.waveActive = false; S.queue.length = 0; S.pending = 0;
  S.heat = [0, 0, 0]; S.locked = [false, false, false]; S.nextShot = [0, 0, 0];
  S.jam = 0; S.jammed = false; S.shake = 0; S.spool = 0;
  S.score = 0; S.kills = 0; S.shots = 0; S.hits = 0; S.elapsed = 0;
  S.weapon = 0; S.t = 0;

  const p = atDist(S.sector.line, 0);
  S.cam.x = p.x + 150; S.cam.y = p.y; S.cam.zi = 0; S.cam.z = S.cam.zt = 1;
  S.cam.toX = S.cam.toY = null;
  clampCam();
  S.flow = buildFlow(p.x, p.y); S.flowAt = 0;
  S.cross.x = W / 2; S.cross.y = H / 2;
  S.phase = 'play';
  document.body.classList.add('playing');
  UI.weapon(0);
  UI.flash('VANGUARD ON STATION — SECTOR ' + (seed % 97).toString().padStart(2, '0'));
}

/* --------------------------------------------------------------- waves --- */

function beginWave(i) {
  const w = WAVES[i];
  S.waveActive = true; S.waveT = 0; S.queue.length = 0;
  let at = 0;
  const push = (kind, n, gap) => {
    for (let k = 0; k < n; k++) { S.queue.push({ kind, at }); at += gap; }
  };
  // Order matters. Jammers arrive first so the player meets the restriction
  // before the thing the restriction makes hard; technicals arrive last so
  // they catch a player who has already committed the gun to something slow.
  if (w.jammer) push('jammer', w.jammer, 1.8);
  if (w.ghost) push('ghost', w.ghost, 0.62);
  if (w.phalanx) push('phalanx', w.phalanx, 2.6);
  if (w.technical) push('technical', w.technical, 2.0);
  S.queue.sort((a, b) => a.at - b.at);
  S.pending = S.queue.length;
  UI.wave(i + 1, w.label);
  UI.flash('CONTACT — ' + w.label);
  Audio.ping();
}

// Rejection sampling for somewhere a hostile can plausibly have come from:
// out of the player's current window if possible, on walkable ground, and far
// enough from the convoy that it has to cross open street to get there.
function spawnPoint(kind) {
  const c = atDist(S.sector.line, S.convoy.d);
  const road = kind === 'technical';
  for (let i = 0; i < 220; i++) {
    const a = Math.random() * Math.PI * 2;
    const d = road ? 780 + Math.random() * 460 : 520 + Math.random() * 370;
    const x = c.x + Math.cos(a) * d, y = c.y + Math.sin(a) * d;
    if (x < 40 || y < 40 || x > SECTOR_W - 40 || y > SECTOR_H - 40) continue;
    if (S.sector.inBuilding(x, y)) continue;
    if (road && !nearRoad(x, y, 30)) continue;
    if (!road && onScreen(x, y, -80) && i < 140) continue;   // prefer off-window
    return { x, y };
  }
  return { x: c.x + 800, y: c.y };
}

function nearRoad(x, y, tol) {
  const L = S.sector, h = L.ROAD_W / 2 + tol;
  for (const v of L.vx) if (Math.abs(x - v) < h) return true;
  for (const u of L.hy) if (Math.abs(y - u) < h) return true;
  return false;
}

function spawn(kind) {
  const k = Hostiles.KINDS[kind], p = spawnPoint(kind);
  S.hostiles.push({
    kind, x: p.x, y: p.y, hp: k.hp, max: k.hp, face: 0,
    flare: 0, cool: Math.random() * k.cadence, vx: 0, vy: 0, tag: 0, hitT: 0
  });
}

/* ------------------------------------------------------------- hostiles --- */

function updateHostiles(dt) {
  const conv = atDist(S.sector.line, S.convoy.d);
  const H2 = S.hostiles;

  if (S.t - S.flowAt > 0.5) { S.flow = buildFlow(conv.x, conv.y); S.flowAt = S.t; }

  for (let i = H2.length - 1; i >= 0; i--) {
    const e = H2[i], k = Hostiles.KINDS[e.kind];
    e.flare = Math.max(0, e.flare - dt / (k.burst || 1));
    e.hitT = Math.max(0, e.hitT - dt * 4);

    const dx = conv.x - e.x, dy = conv.y - e.y, dist = Math.hypot(dx, dy);

    // Contact. A hostile that physically reaches the convoy spends itself on
    // it: infantry get one grenade in, a technical goes in engine-first.
    if (dist < 46) {
      hurtConvoy(k.contact);
      if (e.kind === 'technical') cookoff(e, true);
      boom(e.x, e.y, 34, 0.7);
      H2.splice(i, 1);
      continue;
    }

    const wantRange = k.range * 0.86;
    const canSee = k.range > 0 && dist < k.range && !S.sector.blocked(e.x, e.y, conv.x, conv.y);

    if (!canSee || dist > wantRange) {
      const f = flowDir(e.x, e.y, conv.x, conv.y);
      // Separation. Without it a wave arrives as one hostile wearing eleven
      // hats, and a single 25mm burst is worth eleven kills.
      let sx = 0, sy = 0;
      for (const o of H2) {
        if (o === e) continue;
        const ox = e.x - o.x, oy = e.y - o.y, od = Math.hypot(ox, oy);
        const want = (k.r + Hostiles.KINDS[o.kind].r) * 1.15;
        if (od > 0.01 && od < want) { sx += ox / od * (1 - od / want); sy += oy / od * (1 - od / want); }
      }
      const mx = f.x + sx * 1.6, my = f.y + sy * 1.6;
      const m = Math.hypot(mx, my) || 1;
      const sp = k.speed * dt;
      const nx = e.x + mx / m * sp, ny = e.y + my / m * sp;
      if (!S.sector.inBuilding(nx, ny)) { e.x = nx; e.y = ny; }
      else if (!S.sector.inBuilding(nx, e.y)) e.x = nx;
      else if (!S.sector.inBuilding(e.x, ny)) e.y = ny;
      e.face = Math.atan2(my, mx);
    } else {
      e.face = Math.atan2(dy, dx);
      e.cool -= dt;
      if (e.cool <= 0 && k.dmg > 0) {
        e.cool = k.cadence * (0.8 + Math.random() * 0.4);
        e.flare = 1;
        hurtConvoy(k.dmg);
        S.tracers.push({ x: e.x, y: e.y, tx: conv.x, ty: conv.y, t: 0.11 });
      }
    }

    // Tagging. A Ghost is only tagged while its signature is up or while the
    // crosshair is close enough to be a deliberate look — which is exactly the
    // fight the cape is supposed to create.
    const cw = { x: toWorldX(S.cross.x), y: toWorldY(S.cross.y) };
    const look = Math.hypot(e.x - cw.x, e.y - cw.y);
    const seen = e.kind === 'ghost' ? (e.flare > 0.12 || look < 190) : true;
    e.tag = seen && onScreen(e.x, e.y, 60) ? Math.min(1, e.tag + dt * 6) : Math.max(0, e.tag - dt * 3);
  }
}

/* --------------------------------------------------------------- convoy --- */

function hurtConvoy(n) {
  if (n <= 0) return;
  S.convoy.hp = Math.max(0, S.convoy.hp - n);
  S.convoy.hurt = Math.min(1, S.convoy.hurt + n * 0.06);
  UI.integrity(S.convoy.hp);
  if (S.convoy.hp <= 0) finish(false);
}

function updateConvoy(dt) {
  const c = S.convoy;
  c.hurt = Math.max(0, c.hurt - dt * 0.8);
  const total = S.sector.line.total;

  // The convoy holds at a phase line until the wave that greeted it is gone.
  // That is what makes this an overwatch game rather than an escort: the
  // player is not keeping up with anything, the player is buying permission
  // for the next two hundred metres.
  if (!S.waveActive && S.wave < WAVES.length && c.d >= S.lineD[S.wave]) {
    beginWave(S.wave);
  }
  c.halted = S.waveActive;
  if (!c.halted) {
    c.d = Math.min(total, c.d + CONVOY_SPEED * dt);
    if (c.d >= total) { finish(true); return; }
  }

  // Suppressive fire from the ground element. Deliberately weak: tuned any
  // higher and tools/sim.mjs showed the convoy clearing the whole first wave
  // by itself, which turns the tutorial wave into a cutscene. It kills a stray
  // Ghost that walked into the headlights and nothing else.
  for (const u of c.units) {
    u.cool -= dt;
    if (u.cool > 0) continue;
    const p = atDist(S.sector.line, Math.max(0, c.d + u.off));
    let best = null, bd = 160;
    for (const e of S.hostiles) {
      const d = Math.hypot(e.x - p.x, e.y - p.y);
      if (d < bd && !S.sector.blocked(p.x, p.y, e.x, e.y)) { bd = d; best = e; }
    }
    if (best) {
      u.cool = 1.35;
      S.tracers.push({ x: p.x, y: p.y, tx: best.x, ty: best.y, t: 0.09, friendly: true });
      hit(best, 8, Math.atan2(best.y - p.y, best.x - p.x), false, 'ally');
    } else u.cool = 0.4;
  }
}

/* -------------------------------------------------------------- gunnery --- */

function fireControl(dt) {
  const wi = S.weapon, w = WEAPONS[wi];

  // Cooling runs on every barrel, not just the selected one, which is what
  // makes switching weapons a real option rather than a menu.
  for (let i = 0; i < WEAPONS.length; i++) {
    if (i === wi && S.firing) continue;
    S.heat[i] = Math.max(0, S.heat[i] - WEAPONS[i].cool * dt);
    if (S.locked[i] && S.heat[i] < WEAPONS[i].lockCool) {
      S.locked[i] = false;
      if (i === wi) UI.flash('BARREL CLEAR');
    }
  }

  const defl = Math.hypot(Sticks.R.dx, Sticks.R.dy);
  if (Sticks.R.on) {
    // Positional aim: the stick's deflection is the crosshair's offset from
    // the centre of the window, squared slightly so small moves stay fine.
    const reach = Math.min(W, H) * 0.40;
    const e = Math.pow(Math.min(1, defl), 1.35) * reach;
    const a = Math.atan2(Sticks.R.dy, Sticks.R.dx);
    S.cross.x = W / 2 + Math.cos(a) * e;
    S.cross.y = H / 2 + Math.sin(a) * e;
  }

  const autoOK = defl > TRIGGER_R && !S.jammed;
  const want = !S.locked[wi] && (S.manual || autoOK);
  S.firing = want;

  if (want) {
    if (w.spool) S.spool = Math.min(1, S.spool + dt / w.spool);
  } else {
    S.spool = Math.max(0, S.spool - dt * 2.4);
  }

  if (!want) return;
  const rate = w.rof * (w.spool ? (0.38 + 0.62 * S.spool) : 1);
  S.nextShot[wi] -= dt;
  if (S.nextShot[wi] > 0) return;
  S.nextShot[wi] = 1 / rate;
  shoot(wi);
}

function shoot(wi) {
  const w = WEAPONS[wi];
  S.shots++;
  S.heat[wi] = Math.min(1, S.heat[wi] + w.heat);
  if (S.heat[wi] >= 1) {
    S.locked[wi] = true; S.firing = false; S.spool = 0;
    UI.flash('!! ' + w.abbr + 'MM OVERHEAT — BARREL LOCKED');
    Audio.overheat();
  }
  S.shake = Math.min(18, S.shake + w.shake * 0.35);
  Audio.fire(w.sfx);

  const sp = w.spread * (0.6 + 0.4 * (1 - S.spool));
  const tx = toWorldX(S.cross.x) + (Math.random() - 0.5) * sp * 2;
  const ty = toWorldY(S.cross.y) + (Math.random() - 0.5) * sp * 2;

  if (w.tof === 0) { land(wi, tx, ty); return; }
  // Shells get a flight time and an altitude, and the altitude is what the
  // scale of the inbound marker is tweening — it is a round falling, not a
  // dot shrinking.
  S.rounds.push({ w: wi, x: tx, y: ty, t: 0, tof: w.tof });
}

function land(wi, x, y) {
  const w = WEAPONS[wi];

  // A round that arrives on a roof stops at the roof. The hostiles are in the
  // street; the buildings are not cover they can hide inside, they are cover
  // the player has to shoot around.
  if (S.sector.inBuilding(x, y)) {
    S.fx.push({ k: 'spark', x, y, t: 0.22, r: 7 });
    if (w.splash) boom(x, y, w.splash * 0.55, 0.5);
    return;
  }

  const ang = Math.atan2(y - toWorldY(H / 2), x - toWorldX(W / 2));
  let any = false;

  if (!w.splash) {
    // Direct fire. Nearest hostile whose body the round actually passed
    // through — no aim assist, at 3x the player does not need it and at 1x
    // giving it would make the Ghost's cape pointless.
    let best = null, bd = 1e9;
    for (const e of S.hostiles) {
      const d = Math.hypot(e.x - x, e.y - y);
      if (d < Hostiles.KINDS[e.kind].r + 3 && d < bd) { bd = d; best = e; }
    }
    if (best) any = hit(best, w.dmg, ang, true, 'direct');
    S.fx.push({ k: 'spark', x, y, t: 0.18, r: best ? 9 : 6 });
  } else {
    // Splash. Geometric circle overlap with a linear falloff, and a direct
    // hit inside the fuze radius stacks on top of it.
    boom(x, y, w.splash, 1);
    for (const e of S.hostiles) {
      const d = Math.hypot(e.x - x, e.y - y);
      if (d > w.splash + Hostiles.KINDS[e.kind].r) continue;
      const fall = 1 - Math.min(1, d / (w.splash + Hostiles.KINDS[e.kind].r));
      let dmg = w.splashDmg * (0.35 + 0.65 * fall);
      let direct = false;
      if (d < Hostiles.KINDS[e.kind].r + 8) { dmg += w.dmg; direct = true; }
      // Splash is never shielded: the drum stops a 25mm round, it does not
      // stop overpressure arriving from above and behind it at once.
      if (hit(e, dmg, ang, false, direct ? 'directHE' : 'splash')) any = true;
    }
  }
  if (any) S.hits++;
}

function hit(e, dmg, ang, checkShield, source) {
  if (checkShield && Hostiles.shielded(e, ang)) {
    // Silent apart from a spark, deliberately. The player is supposed to
    // notice that nothing is happening, not be told.
    S.fx.push({ k: 'ric', x: e.x + Math.cos(e.face) * 16, y: e.y + Math.sin(e.face) * 16, t: 0.2 });
    e.hitT = 0.4;
    return false;
  }
  e.hp -= dmg; e.hitT = 1;
  if (e.hp > 0) return true;
  kill(e, source);
  return true;
}

function kill(e, source) {
  const i = S.hostiles.indexOf(e);
  if (i < 0) return;
  S.hostiles.splice(i, 1);
  const k = Hostiles.KINDS[e.kind];
  S.kills++;
  S.score += k.score;
  if (e.kind === 'technical') cookoff(e, source === 'directHE');
  else boom(e.x, e.y, 20 + k.r, 0.55);
  if (e.kind === 'jammer') UI.flash('JAMMER DOWN — AUTO TRIGGER RESTORED');
}

/* A technical is a fuel tank with a gun on it. Killed by anything, it burns;
 * killed by an explosive round landing on the block, the tank goes, and the
 * radius is wide enough that a column of them is a single target. */
function cookoff(e, catastrophic) {
  const k = Hostiles.KINDS.technical;
  const r = catastrophic ? k.cookoffR : k.cookoffR * 0.5;
  const d = catastrophic ? k.cookoff : k.cookoff * 0.35;
  boom(e.x, e.y, r, catastrophic ? 1.5 : 0.8);
  S.shake = Math.min(20, S.shake + (catastrophic ? 10 : 4));
  Audio.boom(catastrophic);
  for (const o of S.hostiles.slice()) {
    const dd = Math.hypot(o.x - e.x, o.y - e.y);
    if (dd > r) continue;
    hit(o, d * (1 - dd / r), 0, false, 'splash');
  }
  if (Math.hypot(e.x - atDist(S.sector.line, S.convoy.d).x,
                 e.y - atDist(S.sector.line, S.convoy.d).y) < r) hurtConvoy(catastrophic ? 4 : 1);
}

function boom(x, y, r, power) {
  S.fx.push({ k: 'boom', x, y, r, t: 0, life: 0.45 + power * 0.25, power });
  S.fx.push({ k: 'scar', x, y, r: r * 0.7, t: 0, life: 26 });
  const n = Math.min(16, 4 + power * 9 | 0);
  for (let i = 0; i < n; i++) {
    const a = Math.random() * 7, sp = 40 + Math.random() * 150 * power;
    S.fx.push({ k: 'deb', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, t: 0, life: 0.5 + Math.random() * 0.6 });
  }
}

/* ---------------------------------------------------------------- misc --- */

function updateRounds(dt) {
  for (let i = S.rounds.length - 1; i >= 0; i--) {
    const r = S.rounds[i];
    r.t += dt;
    if (r.t >= r.tof) { land(r.w, r.x, r.y); S.rounds.splice(i, 1); }
  }
  for (let i = S.tracers.length - 1; i >= 0; i--) {
    S.tracers[i].t -= dt;
    if (S.tracers[i].t <= 0) S.tracers.splice(i, 1);
  }
  for (let i = S.fx.length - 1; i >= 0; i--) {
    const f = S.fx[i];
    f.t += dt;
    if (f.k === 'deb') { f.x += f.vx * dt; f.y += f.vy * dt; f.vx *= 0.94; f.vy *= 0.94; }
    if (f.t >= (f.life || f.t + 1)) S.fx.splice(i, 1);
  }
  // Long-lived scorch marks are the only unbounded list here, so it is capped
  // rather than trusted.
  if (S.fx.length > 320) S.fx.splice(0, S.fx.length - 320);
}

function updateJamming(dt) {
  let worst = 0;
  for (const e of S.hostiles) {
    if (e.kind !== 'jammer') continue;
    const d = Math.hypot(e.x - S.cam.x, e.y - S.cam.y);
    const k = Hostiles.KINDS.jammer;
    if (d < k.jam) worst = Math.max(worst, 1 - d / k.jam);
  }
  const target = Math.min(1, worst * 1.5);
  S.jam += (target - S.jam) * Math.min(1, dt * 3.5);
  const was = S.jammed;
  S.jammed = S.jam > 0.30;
  if (S.jammed && !was) UI.flash('!! EW INTERFERENCE — AUTO TRIGGER OFFLINE');
  UI.jam(S.jammed);
}

function updateWave(dt) {
  if (!S.waveActive) return;
  S.waveT += dt;
  while (S.queue.length && S.queue[0].at <= S.waveT) {
    spawn(S.queue.shift().kind);
    S.pending--;
  }
  if (!S.queue.length && S.hostiles.length === 0) {
    S.waveActive = false;
    S.wave++;
    const bonus = 120 + S.wave * 40;
    S.score += bonus;
    UI.flash('SECTOR CLEAR — ANVIL ADVANCING  +' + bonus);
    Audio.clear();
    UI.wave(S.wave, S.wave < WAVES.length ? 'MOVING' : 'EXFIL');
  }
}

function updateCamera(dt) {
  // Macro pan. The left stick moves the window in SCREEN pixels per second and
  // is divided by the zoom, so a given thumb deflection always slides the
  // picture at the same apparent speed regardless of magnification. Panning
  // three times as fast at 3x was the single worst thing about the first cut.
  const k = S.keys || {};
  let lx = Sticks.L.dx, ly = Sticks.L.dy;
  if (k.KeyA || k.ArrowLeft) lx -= 1;
  if (k.KeyD || k.ArrowRight) lx += 1;
  if (k.KeyW || k.ArrowUp) ly -= 1;
  if (k.KeyS || k.ArrowDown) ly += 1;
  const PAN = 620;
  if (lx || ly) {
    S.cam.toX = S.cam.toY = null;
    S.cam.x += lx * PAN * dt / S.cam.z;
    S.cam.y += ly * PAN * dt / S.cam.z;
  }
  if (S.cam.toX !== null) {
    S.cam.x += (S.cam.toX - S.cam.x) * Math.min(1, dt * 4.5);
    S.cam.y += (S.cam.toY - S.cam.y) * Math.min(1, dt * 4.5);
    if (Math.hypot(S.cam.toX - S.cam.x, S.cam.toY - S.cam.y) < 3) S.cam.toX = S.cam.toY = null;
  }
  S.cam.z += (S.cam.zt - S.cam.z) * Math.min(1, dt * 6);
  S.shake = Math.max(0, S.shake - dt * 26);
  clampCam();
}

function finish(won) {
  if (S.phase !== 'play') return;
  S.phase = 'over';
  document.body.classList.remove('playing');
  S.firing = false;
  S.jam = 0; S.jammed = false; UI.jam(false);
  UI.result(won);
}

/* ================================================================ render === */

const AMBER = '#ffb01e', AMBER_D = '#b4740c', AMBER_F = 'rgba(255,176,30,';

function drawWorld() {
  const g = wg;
  g.setTransform(DPR, 0, 0, DPR, 0, 0);
  g.fillStyle = '#05070a'; g.fillRect(0, 0, W, H);

  const sh = S.shake;
  const ox = sh ? (Math.random() - 0.5) * sh : 0;
  const oy = sh ? (Math.random() - 0.5) * sh : 0;

  g.save();
  g.translate(W / 2 + ox, H / 2 + oy);
  g.scale(S.cam.z, S.cam.z);
  g.translate(-S.cam.x, -S.cam.y);

  // One blit for the whole sector. The canvas clips it, and a clipped blit of
  // a cached bitmap is the cheapest thing a 2D context does.
  g.drawImage(S.sector.terrain, 0, 0);

  // Scorch first: it is ground, and everything else stands on it.
  for (const f of S.fx) {
    if (f.k !== 'scar') continue;
    const a = 1 - f.t / f.life;
    g.fillStyle = 'rgba(0,0,0,' + (0.5 * a) + ')';
    g.beginPath(); g.ellipse(f.x, f.y, f.r, f.r * 0.82, 0, 0, 7); g.fill();
    if (f.t < 6) {                                  // still giving heat back
      const h = (1 - f.t / 6) * 0.30;
      Hostiles.halo(g, f.x, f.y, f.r * 0.9, h);
    }
  }

  drawConvoy(g);

  for (const t of S.tracers) {
    g.strokeStyle = 'rgba(255,255,255,' + (t.friendly ? 0.85 : 0.6) + ')';
    g.lineWidth = t.friendly ? 1.6 : 1.2;
    g.beginPath(); g.moveTo(t.x, t.y); g.lineTo(t.tx, t.ty); g.stroke();
  }

  for (const e of S.hostiles) {
    if (!onScreen(e.x, e.y, 80)) continue;
    Hostiles.KINDS[e.kind].draw(g, e, S.t);
    if (e.hitT > 0) Hostiles.halo(g, e.x, e.y, 16 + e.hitT * 10, e.hitT * 0.5);
  }

  for (const f of S.fx) {
    if (f.k === 'scar') continue;
    if (f.k === 'boom') {
      const p = f.t / f.life, r = f.r * (0.25 + p * 0.95);
      g.save(); g.globalCompositeOperation = 'lighter';
      Hostiles.halo(g, f.x, f.y, r * 1.2, (1 - p) * 0.85 * Math.min(1, f.power));
      g.strokeStyle = 'rgba(255,255,255,' + ((1 - p) * 0.7) + ')';
      g.lineWidth = 2 + f.power;
      g.beginPath(); g.arc(f.x, f.y, r, 0, 7); g.stroke();
      g.restore();
    } else if (f.k === 'deb') {
      const a = 1 - f.t / f.life;
      g.fillStyle = 'rgba(255,255,255,' + (a * 0.9) + ')';
      g.fillRect(f.x - 1, f.y - 1, 2.4, 2.4);
    } else if (f.k === 'spark') {
      const a = 1 - f.t / 0.2;
      if (a > 0) { g.save(); g.globalCompositeOperation = 'lighter'; Hostiles.halo(g, f.x, f.y, f.r * 2.4, a * 0.7); g.restore(); }
    } else if (f.k === 'ric') {
      const a = 1 - f.t / 0.2;
      g.strokeStyle = 'rgba(255,255,255,' + a + ')'; g.lineWidth = 1.4;
      g.beginPath(); g.moveTo(f.x, f.y); g.lineTo(f.x + 6, f.y - 5); g.stroke();
    }
  }

  // Shells in flight. The round is drawn ABOVE where it will land and pulled
  // down onto the mark as its altitude bleeds off, with its shadow closing the
  // gap — the two meeting is the impact.
  for (const r of S.rounds) {
    const p = r.t / r.tof, alt = (1 - p) * 90;
    g.fillStyle = 'rgba(0,0,0,.45)';
    g.beginPath(); g.ellipse(r.x, r.y, 5 - p * 2, 3 - p, 0, 0, 7); g.fill();
    const size = 2 + (1 - p) * 5;
    g.save(); g.globalCompositeOperation = 'lighter';
    Hostiles.halo(g, r.x, r.y - alt, size * 4, 0.5);
    g.fillStyle = '#fff';
    g.beginPath(); g.arc(r.x, r.y - alt, size, 0, 7); g.fill();
    g.restore();
  }

  g.restore();

  Thermal.pass(wg, world, world.width, world.height, S.t, S.jam, S.quality);
}

/* The ground element. Three vehicles on one polyline, each a warm hull with a
 * hot block at the front — the same signature vocabulary the hostiles use,
 * because the sensor does not know whose side anyone is on. Telling them apart
 * is the HUD's job, and the HUD does it in amber. */
function drawConvoy(g) {
  const c = S.convoy;
  for (let i = c.units.length - 1; i >= 0; i--) {
    const u = c.units[i];
    const p = atDist(S.sector.line, Math.max(0, c.d + u.off));
    g.save(); g.translate(p.x, p.y); g.rotate(p.a);
    g.fillStyle = 'rgba(0,0,0,.5)'; g.fillRect(-17, -8, 38, 17);
    g.fillStyle = Hostiles.grey(78 + c.hurt * 60); g.fillRect(-19, -10, 38, 18);
    g.fillStyle = Hostiles.grey(52); g.fillRect(-13, -7, 14, 14);
    g.fillStyle = Hostiles.grey(96); g.fillRect(3, -6, 10, 12);
    g.fillStyle = Hostiles.grey(210); g.fillRect(13, -4, 7, 8);
    Hostiles.halo(g, 15, 0, 20, 0.30);
    g.restore();
  }
}

/* ------------------------------------------------------------------ HUD --- */

function drawHUD() {
  const g = hg;
  g.setTransform(DPR, 0, 0, DPR, 0, 0);
  g.clearRect(0, 0, W, H);

  // Under interference the whole AR layer skews and drops lines. It is drawn
  // once into its own canvas, so the glitch is a transform on the layer rather
  // than a special case inside twelve draw calls.
  const jitter = S.jammed ? (Math.random() - 0.5) * 6 * S.jam : 0;
  g.save();
  if (jitter) g.translate(jitter, 0);

  drawFriendlyMarks(g);
  drawTargetBrackets(g);
  drawInbound(g);
  drawReticle(g);
  drawSticks(g);
  drawRail(g);
  drawOrbitRing(g);

  g.restore();

  if (S.jammed && Math.random() < 0.5) {
    g.fillStyle = 'rgba(255,176,30,0.10)';
    const y = Math.random() * H;
    g.fillRect(0, y, W, 1 + Math.random() * 3);
  }
}

function drawFriendlyMarks(g) {
  const c = S.convoy;
  for (let i = 0; i < c.units.length; i++) {
    const p = atDist(S.sector.line, Math.max(0, c.d + c.units[i].off));
    const x = toScreenX(p.x), y = toScreenY(p.y);
    if (x < -40 || y < -40 || x > W + 40 || y > H + 40) continue;
    const r = 15 * Math.min(1.6, S.cam.z);
    g.strokeStyle = AMBER; g.lineWidth = 1.6;
    g.beginPath();
    g.moveTo(x, y - r); g.lineTo(x + r, y); g.lineTo(x, y + r); g.lineTo(x - r, y); g.closePath();
    g.stroke();
    if (i === 0) {
      g.fillStyle = AMBER;
      g.font = '700 10px ui-monospace,Menlo,Consolas,monospace';
      g.fillText('ANVIL', x + r + 5, y + 3);
    }
  }
  // Off-window arrow. Losing the convoy off the edge of the sensor is the
  // most common way a player gets lost, and one chevron fixes it.
  const lead = atDist(S.sector.line, c.d);
  const lx = toScreenX(lead.x), ly = toScreenY(lead.y);
  if (lx < 0 || ly < 0 || lx > W || ly > H) {
    const a = Math.atan2(ly - H / 2, lx - W / 2);
    const rr = Math.min(W, H) * 0.36;
    const ax = W / 2 + Math.cos(a) * rr, ay = H / 2 + Math.sin(a) * rr;
    g.save(); g.translate(ax, ay); g.rotate(a);
    g.fillStyle = AMBER;
    g.beginPath(); g.moveTo(13, 0); g.lineTo(-7, -8); g.lineTo(-7, 8); g.closePath(); g.fill();
    g.restore();
  }
}

/* Orange wireframe brackets with a scanline sweeping them, and an occasional
 * one-frame horizontal displacement. The glitch is not decoration: it is the
 * cue that a tag is a COMPUTED thing which can be wrong, and it gets stronger
 * under jamming for exactly that reason. */
function drawTargetBrackets(g) {
  g.font = '700 9px ui-monospace,Menlo,Consolas,monospace';
  for (const e of S.hostiles) {
    if (e.tag < 0.05) continue;
    const k = Hostiles.KINDS[e.kind];
    const x = toScreenX(e.x), y = toScreenY(e.y);
    const r = Math.max(13, (k.r + 6) * S.cam.z);
    const gl = (S.jammed && Math.random() < 0.25) ? (Math.random() - 0.5) * 10 : 0;
    g.save();
    g.globalAlpha = e.tag;
    g.translate(x + gl, y);
    g.strokeStyle = AMBER; g.lineWidth = 1.5;
    const c = r * 0.45;
    for (let q = 0; q < 4; q++) {
      const sx = q & 1 ? 1 : -1, sy = q & 2 ? 1 : -1;
      g.beginPath();
      g.moveTo(sx * r, sy * r - sy * c); g.lineTo(sx * r, sy * r);
      g.lineTo(sx * r - sx * c, sy * r);
      g.stroke();
    }
    // The sweep.
    const sweep = ((S.t * 0.9 + e.x * 0.01) % 1) * 2 - 1;
    g.strokeStyle = AMBER_F + '0.55)';
    g.lineWidth = 1;
    g.beginPath(); g.moveTo(-r, sweep * r); g.lineTo(r, sweep * r); g.stroke();

    // Health, as a bar under the box, only once it has been shot.
    if (e.hp < e.max) {
      g.fillStyle = 'rgba(0,0,0,.5)'; g.fillRect(-r, r + 4, r * 2, 3);
      g.fillStyle = AMBER; g.fillRect(-r, r + 4, r * 2 * (e.hp / e.max), 3);
    }
    if (S.cam.z > 1.4 || k.arc || e.kind === 'jammer') {
      g.fillStyle = AMBER;
      g.fillText(k.tag, -r, -r - 5);
    }
    g.restore();
  }
}

function drawInbound(g) {
  for (const r of S.rounds) {
    const x = toScreenX(r.x), y = toScreenY(r.y);
    const p = r.t / r.tof;
    const rad = 14 + (1 - p) * 46 * Math.min(1.5, S.cam.z);
    g.save();
    g.strokeStyle = AMBER_F + (0.35 + p * 0.5) + ')';
    g.lineWidth = 1.4;
    g.setLineDash([5, 5]); g.lineDashOffset = -S.t * 26;
    g.beginPath(); g.arc(x, y, rad, 0, 7); g.stroke();
    g.setLineDash([]);
    g.fillStyle = AMBER;
    g.font = '700 9px ui-monospace,Menlo,Consolas,monospace';
    g.fillText((r.tof - r.t).toFixed(1) + 'S', x + rad + 4, y - 3);
    g.restore();
  }
}

function drawReticle(g) {
  const x = S.cross.x, y = S.cross.y;
  const w = WEAPONS[S.weapon];
  const hot = S.locked[S.weapon];
  g.save();
  g.strokeStyle = hot ? '#ff3b2f' : AMBER;
  g.fillStyle = g.strokeStyle;
  g.lineWidth = 1.6;

  if (w.id === 'm25') {
    g.beginPath(); g.arc(x, y, 13, 0, 7); g.stroke();
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2 + (S.firing ? S.t * 7 : 0);
      g.beginPath();
      g.moveTo(x + Math.cos(a) * 17, y + Math.sin(a) * 17);
      g.lineTo(x + Math.cos(a) * 26, y + Math.sin(a) * 26);
      g.stroke();
    }
    g.fillRect(x - 1, y - 1, 2, 2);
  } else if (w.id === 'm40') {
    g.strokeRect(x - 15, y - 15, 30, 30);
    g.beginPath();
    g.moveTo(x - 26, y); g.lineTo(x - 17, y); g.moveTo(x + 17, y); g.lineTo(x + 26, y);
    g.moveTo(x, y - 26); g.lineTo(x, y - 17); g.moveTo(x, y + 17); g.lineTo(x, y + 26);
    g.stroke();
  } else {
    // The 105 shows the radius it will actually clear, in screen pixels at the
    // current magnification. Guessing a blast radius is not a skill.
    g.setLineDash([7, 6]); g.lineDashOffset = -S.t * 18;
    g.beginPath(); g.arc(x, y, w.splash * S.cam.z, 0, 7); g.stroke();
    g.setLineDash([]);
    g.beginPath(); g.arc(x, y, 9, 0, 7); g.stroke();
    g.beginPath(); g.moveTo(x - 20, y); g.lineTo(x + 20, y);
    g.moveTo(x, y - 20); g.lineTo(x, y + 20); g.stroke();
  }
  if (hot) {
    g.font = '700 10px ui-monospace,Menlo,Consolas,monospace';
    g.fillText('OVERHEAT', x + 30, y - 12);
  }
  g.restore();
}

/* The right ring carries the heat gauge, because heat is a property of the
 * trigger and the trigger is that thumb. Segmented rather than continuous: a
 * smooth arc tells you how hot you are, and segments tell you how many more
 * bursts you have, which is the question actually being asked. */
function drawSticks(g) {
  const L = Sticks.L, R = Sticks.R;
  const lp = L.on ? { x: L.ox, y: L.oy } : { x: 108, y: H - 108 };
  const rp = R.on ? { x: R.ox, y: R.oy } : { x: W - 108, y: H - 108 };

  g.save();
  g.globalAlpha = L.on ? 0.95 : 0.35;
  ring(g, lp.x, lp.y, STICK_R, AMBER, 1.4);
  g.fillStyle = AMBER_F + '0.20)';
  g.beginPath(); g.arc(lp.x + L.dx * STICK_R, lp.y + L.dy * STICK_R, 19, 0, 7); g.fill();
  ring(g, lp.x + L.dx * STICK_R, lp.y + L.dy * STICK_R, 19, AMBER, 1.6);
  g.fillStyle = AMBER; g.font = '700 9px ui-monospace,Menlo,Consolas,monospace';
  g.textAlign = 'center'; g.fillText('PAN', lp.x, lp.y + STICK_R + 16); g.textAlign = 'left';
  g.restore();

  g.save();
  g.globalAlpha = R.on ? 0.95 : 0.38;
  ring(g, rp.x, rp.y, STICK_R, AMBER, 1.4);
  // Activation radius, so the boundary between aiming and firing is visible.
  g.setLineDash([3, 4]);
  ring(g, rp.x, rp.y, STICK_R * TRIGGER_R, S.jammed ? '#ff3b2f' : AMBER_D, 1.2);
  g.setLineDash([]);
  g.fillStyle = AMBER_F + '0.20)';
  g.beginPath(); g.arc(rp.x + R.dx * STICK_R, rp.y + R.dy * STICK_R, 19, 0, 7); g.fill();
  ring(g, rp.x + R.dx * STICK_R, rp.y + R.dy * STICK_R, 19, AMBER, 1.6);
  g.restore();

  // Heat, wrapped around the right ring: 18 segments, filling clockwise from
  // the top, going red and flashing on lockout.
  const heat = S.heat[S.weapon], locked = S.locked[S.weapon];
  const segs = 18, r0 = STICK_R + 9, r1 = STICK_R + 17;
  const flash = locked && (S.t * 7 | 0) % 2 === 0;
  for (let i = 0; i < segs; i++) {
    const a0 = -Math.PI / 2 + (i / segs) * Math.PI * 2 + 0.035;
    const a1 = -Math.PI / 2 + ((i + 1) / segs) * Math.PI * 2 - 0.035;
    const on = (i + 1) / segs <= heat + 1e-6;
    g.beginPath();
    g.arc(rp.x, rp.y, r0, a0, a1);
    g.arc(rp.x, rp.y, r1, a1, a0, true);
    g.closePath();
    g.fillStyle = on
      ? (locked ? (flash ? '#ff6a4a' : '#ff3b2f') : (i / segs > 0.72 ? '#ff7a2f' : AMBER))
      : 'rgba(255,176,30,0.13)';
    g.fill();
  }
}

function ring(g, x, y, r, col, lw) {
  g.strokeStyle = col; g.lineWidth = lw;
  g.beginPath(); g.arc(x, y, r, 0, 7); g.stroke();
}

function drawRail(g) {
  const geo = Rail.geo();
  g.save();
  g.strokeStyle = AMBER_F + '0.45)'; g.lineWidth = 1.4;
  g.beginPath(); g.moveTo(geo.x, geo.y0); g.lineTo(geo.x, geo.y1); g.stroke();
  g.font = '700 9px ui-monospace,Menlo,Consolas,monospace';
  g.textAlign = 'right';
  for (let i = 0; i < ZOOMS.length; i++) {
    const y = geo.y1 - (i / 2) * (geo.y1 - geo.y0);
    const on = i === S.cam.zi;
    g.strokeStyle = on ? AMBER : AMBER_F + '0.5)';
    g.lineWidth = on ? 2.4 : 1.2;
    g.beginPath(); g.moveTo(geo.x - (on ? 13 : 8), y); g.lineTo(geo.x + (on ? 13 : 8), y); g.stroke();
    g.fillStyle = on ? AMBER : AMBER_F + '0.45)';
    g.fillText(ZOOMS[i].toFixed(2) + 'X', geo.x - 17, y + 3);
  }
  g.textAlign = 'left';
  g.restore();
}

/* Orbital trajectory ring. It is telemetry, not decoration — the marker's
 * position is the aircraft's place in its loiter, and the outer arc is how far
 * along the route the convoy has come. Tucked hard into the corner above the
 * zoom rail: anywhere lower and it lands on the rail's top label. */
function drawOrbitRing(g) {
  const cx = W - 46, cy = 44, r = 20;
  g.save();
  g.strokeStyle = AMBER_F + '0.35)'; g.lineWidth = 1.2;
  g.beginPath(); g.ellipse(cx, cy, r, r * 0.42, 0, 0, 7); g.stroke();
  g.beginPath(); g.ellipse(cx, cy, r * 0.42, r, 0, 0, 7); g.stroke();
  const a = S.t * 0.42;
  const mx = cx + Math.cos(a) * r, my = cy + Math.sin(a) * r * 0.42;
  g.fillStyle = AMBER;
  g.beginPath(); g.arc(mx, my, 3.2, 0, 7); g.fill();
  const prog = S.convoy ? S.convoy.d / S.sector.line.total : 0;
  g.strokeStyle = AMBER; g.lineWidth = 2.4;
  g.beginPath(); g.arc(cx, cy, r + 7, -Math.PI / 2, -Math.PI / 2 + prog * Math.PI * 2); g.stroke();
  g.restore();
}

/* ================================================================= audio === */

/* Synthesised, not sampled. A 25mm burst is filtered noise with a fast decay
 * and a 105mm is the same noise an octave down with a sine under it — which is
 * both a fair description of the real thing and about nine hundred kilobytes
 * of audio files this game does not have to ship or cache. */
const Audio = (() => {
  let ctx = null, master = null, on = true, noise = null;

  function wake() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain(); master.gain.value = 0.5; master.connect(ctx.destination);
    const len = ctx.sampleRate * 1.2;
    noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  function burst(freq, q, dur, vol, type) {
    if (!on || !ctx) return;
    const s = ctx.createBufferSource(); s.buffer = noise;
    const f = ctx.createBiquadFilter(); f.type = type || 'bandpass';
    f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0008, ctx.currentTime + dur);
    s.connect(f); f.connect(g); g.connect(master);
    s.start(); s.stop(ctx.currentTime + dur + 0.02);
  }

  function tone(freq, dur, vol, type) {
    if (!on || !ctx) return;
    const o = ctx.createOscillator(); o.type = type || 'sine'; o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0008, ctx.currentTime + dur);
    o.connect(g); g.connect(master);
    o.start(); o.stop(ctx.currentTime + dur + 0.02);
  }

  return {
    wake,
    set(v) { on = v; try { localStorage.setItem('vanguard.sfx', v ? '1' : '0'); } catch (e) {} },
    get() { return on; },
    load() { try { on = localStorage.getItem('vanguard.sfx') !== '0'; } catch (e) {} return on; },
    fire(kind) {
      if (kind === 'gat') burst(1500, 1.1, 0.055, 0.22);
      else if (kind === 'auto') { burst(760, 0.9, 0.16, 0.34); tone(92, 0.17, 0.2, 'triangle'); }
      else { burst(240, 0.7, 0.5, 0.42, 'lowpass'); tone(48, 0.55, 0.4, 'sine'); }
    },
    boom(big) {
      burst(big ? 180 : 320, 0.6, big ? 0.75 : 0.4, big ? 0.5 : 0.3, 'lowpass');
      tone(big ? 38 : 60, big ? 0.8 : 0.4, big ? 0.45 : 0.25, 'sine');
    },
    overheat() { tone(220, 0.16, 0.22, 'square'); setTimeout(() => tone(160, 0.22, 0.2, 'square'), 120); },
    ping() { tone(880, 0.1, 0.16, 'square'); setTimeout(() => tone(1320, 0.14, 0.14, 'square'), 110); },
    clear() { tone(660, 0.12, 0.16, 'triangle'); setTimeout(() => tone(990, 0.22, 0.16, 'triangle'), 120); }
  };
})();

/* ==================================================================== UI === */

const UI = (() => {
  const $ = id => document.getElementById(id);
  let flashT = 0, paused = false, termLines = [];

  function term(line) {
    termLines.push(line);
    if (termLines.length > 7) termLines.shift();
    $('term').textContent = termLines.join('\n');
  }

  function flash(msg) {
    const el = $('flash');
    el.textContent = msg;
    el.classList.remove('go');
    void el.offsetWidth;                 // restart the animation, not resume it
    el.classList.add('go');
    term('> ' + msg);
  }

  function integrity(hp) {
    const pct = Math.max(0, hp) / CONVOY_HP;
    $('intBar').style.width = (pct * 100).toFixed(1) + '%';
    $('intVal').textContent = Math.ceil(hp).toString().padStart(3, '0');
    $('intWrap').classList.toggle('crit', pct < 0.3);
  }

  function wave(n, label) {
    $('waveN').textContent = 'PHASE ' + Math.min(n, WAVES.length) + '/' + WAVES.length;
    $('waveL').textContent = label;
  }

  function weapon(i) {
    [...document.querySelectorAll('.wep')].forEach((b, k) => b.classList.toggle('on', k === i));
  }

  function jam(v) { $('jamBadge').classList.toggle('on', v); }

  function stats() {
    const acc = S.shots ? (S.hits / S.shots * 100) : 0;
    const m = Math.floor(S.elapsed / 60), s = Math.floor(S.elapsed % 60);
    return [
      ['CONVOY INTEGRITY', Math.ceil(S.convoy.hp) + ' / ' + CONVOY_HP],
      ['PHASE LINES HELD', Math.min(S.wave, WAVES.length) + ' / ' + WAVES.length],
      ['HOSTILES NEUTRALISED', S.kills],
      ['ROUNDS EXPENDED', S.shots],
      ['EFFECTS ON TARGET', acc.toFixed(0) + '%'],
      ['TIME ON STATION', m + ':' + String(s).padStart(2, '0')],
      ['SCORE', S.score]
    ];
  }

  function result(won) {
    // Integrity is the grade, because integrity is the only thing the mission
    // was ever about. A perfect-accuracy run that hands back a wreck is worse
    // than a wasteful one that hands back a convoy.
    const pct = S.convoy.hp / CONVOY_HP;
    const stars = !won ? 0 : pct > 0.8 ? 3 : pct > 0.5 ? 2 : 1;
    S.score += Math.round(S.convoy.hp * 12) + (won ? 800 : 0);
    $('resTitle').textContent = won ? 'ANVIL IS CLEAR' : 'ANVIL IS LOST';
    $('resTitle').className = won ? 'ok' : 'bad';
    $('resSub').textContent = won
      ? 'Ground element reached the extraction point.'
      : 'The ground element was destroyed in sector.';
    $('resStars').innerHTML = [0, 1, 2].map(i =>
      '<i class="' + (i < stars ? 'on' : '') + '">◆</i>').join('');
    $('resStats').innerHTML = stats().map(r =>
      '<div><b>' + r[0] + '</b><span>' + r[1] + '</span></div>').join('');
    saveBest(stars);
    $('result').classList.add('show');
  }

  function saveBest(stars) {
    try {
      const prev = JSON.parse(localStorage.getItem('vanguard.best') || 'null');
      if (!prev || S.score > prev.score) {
        localStorage.setItem('vanguard.best', JSON.stringify({ score: S.score, stars }));
      }
    } catch (e) {}
    showBest();
  }

  function showBest() {
    let b = null;
    try { b = JSON.parse(localStorage.getItem('vanguard.best') || 'null'); } catch (e) {}
    $('menuBest').textContent = b ? 'BEST  ' + b.score : '';
  }

  function togglePause() {
    if (S.phase !== 'play') return;
    paused = !paused;
    $('pause').classList.toggle('show', paused);
  }
  const isPaused = () => paused;

  return { flash, integrity, wave, weapon, jam, result, togglePause, isPaused, term, showBest, $ };
})();

/* ================================================================== loop === */

let last = 0;

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000 || 0);
  last = now;

  if (S.phase === 'play' && !UI.isPaused()) {
    S.t += dt; S.dt = dt; S.elapsed += dt;
    updateCamera(dt);
    updateConvoy(dt);
    updateWave(dt);
    updateHostiles(dt);
    updateJamming(dt);
    fireControl(dt);
    updateRounds(dt);
  } else if (S.phase === 'play') {
    updateCamera(0);                     // keep the zoom lerp alive while paused
  }

  if (S.sector) { drawWorld(); drawHUD(); }

  // Auto-degrade. A phone that cannot hold the frame gets the grain and the
  // scanlines taken off it rather than a slideshow with nice grain.
  if (S.phase === 'play' && S.elapsed > 4) {
    S.frameAcc += dt; S.frameN++;
    if (S.frameN >= 150) {
      if (S.quality > 0 && (S.frameAcc / S.frameN) > 0.026) {
        S.quality = 0;
        UI.flash('SENSOR OVERLAY REDUCED — PERFORMANCE');
      }
      S.frameAcc = 0; S.frameN = 0;
    }
  }
}

/* ================================================================== boot === */

function boot() {
  world = document.getElementById('world'); wg = world.getContext('2d');
  hud = document.getElementById('hud'); hg = hud.getContext('2d');
  addEventListener('resize', resize);
  addEventListener('orientationchange', () => setTimeout(resize, 120));
  resize();
  bindInput();
  Audio.load();

  const lines = [
    'VANGUARD ORBIT // TACTICAL STRIKE',
    'SENSOR .......... FLIR-4B  ONLINE',
    'STABILISATION ... LOCKED',
    'FIRE CONTROL .... 25/40/105  READY',
    'DATALINK ........ ANVIL  ACQUIRED'
  ];
  let i = 0;
  const bar = UI.$('bootBar'), say = UI.$('bootSay');
  const step = () => {
    bar.style.width = ((i + 1) / lines.length * 100) + '%';
    say.textContent = lines[i];
    UI.term(lines[i]);
    if (++i < lines.length) setTimeout(step, 190);
    else setTimeout(() => {
      UI.$('boot').classList.add('out');
      UI.$('menu').classList.add('show');
      UI.showBest();
      S.phase = 'menu';
    }, 320);
  };
  step();

  wireButtons();
  requestAnimationFrame(frame);

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

function wireButtons() {
  const $ = UI.$;
  const tap = (el, fn) => {
    el.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); Audio.wake(); fn(e); });
  };

  tap($('menuPlay'), () => {
    $('menu').classList.remove('show');
    $('result').classList.remove('show');
    startMission(20260917 + Math.floor(Math.random() * 1000));
    UI.integrity(CONVOY_HP);
    UI.wave(1, 'MOVING TO PHASE LINE');
  });

  [...document.querySelectorAll('.wep')].forEach((b, i) => tap(b, () => selectWeapon(i)));
  tap($('btnRecenter'), recenter);
  tap($('btnPause'), () => UI.togglePause());
  tap($('btnResume'), () => UI.togglePause());
  tap($('btnAbort'), () => {
    UI.togglePause();
    S.phase = 'menu';
    document.body.classList.remove('playing');
    $('menu').classList.add('show');
  });
  tap($('resAgain'), () => {
    $('result').classList.remove('show');
    startMission(20260917 + Math.floor(Math.random() * 1000));
    UI.integrity(CONVOY_HP);
    UI.wave(1, 'MOVING TO PHASE LINE');
  });
  tap($('resMenu'), () => {
    $('result').classList.remove('show');
    $('menu').classList.add('show');
    S.phase = 'menu';
    document.body.classList.remove('playing');
  });

  // The manual trigger. It exists for the jammed case, and because a player
  // who wants to place one 105 precisely should not have to shove the aim
  // stick past the activation radius — which would move the crosshair — to
  // do it. A DOM button sits above the sensor surface, so it never leaks a
  // pointer event into the aim stick underneath.
  const trig = $('btnTrigger');
  const set = v => e => { e.preventDefault(); Audio.wake(); S.manual = v; trig.classList.toggle('on', v); };
  trig.addEventListener('pointerdown', set(true));
  trig.addEventListener('pointerup', set(false));
  trig.addEventListener('pointercancel', set(false));
  trig.addEventListener('pointerleave', set(false));

  const sfx = $('btnSfx');
  const paint = () => { sfx.textContent = Audio.get() ? 'AUDIO ON' : 'AUDIO OFF'; sfx.classList.toggle('off', !Audio.get()); };
  tap(sfx, () => { Audio.set(!Audio.get()); paint(); });
  paint();
}

if (document.readyState === 'loading') addEventListener('DOMContentLoaded', boot);
else boot();
