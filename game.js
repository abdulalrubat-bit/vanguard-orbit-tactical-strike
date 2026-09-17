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

// Filled from the career at the start of every sortie: GEN-2 OPTICS adds a
// wide detent to find the fight with and a narrow one to identify from.
let ZOOMS = [1.0, 1.75, 3.0];

/* Wave archetypes. A sortie is built by walking this list, so a wave's SHAPE
 * escalates rather than only its head count — and an archetype is only
 * available once the career has unlocked every hostile in it. At the bottom of
 * the ladder that leaves the first two, which is correct: a probationary
 * operator's whole problem is finding men in capes.
 *
 * This is where authored campaign sectors will eventually override the
 * generated ones. See CAMPAIGN below. */
const ARCHETYPES = [
  { label: 'PROBE',              ghost: 5 },
  { label: 'DISMOUNTED SWEEP',   ghost: 8 },
  { label: 'ROAD CONTACT',       ghost: 6,  technical: 1 },
  { label: 'RAPID RESPONSE',     ghost: 6,  technical: 3 },
  { label: 'ELECTRONIC WARFARE', ghost: 6,  jammer: 1, technical: 1 },
  { label: 'HARDENED PUSH',      ghost: 7,  phalanx: 1 },
  { label: 'COMBINED ARMS',      ghost: 8,  jammer: 2, phalanx: 1 },
  { label: 'BREAKTHROUGH',       ghost: 9,  technical: 3, phalanx: 2 },
  { label: 'LAST STAND',         ghost: 11, jammer: 2, technical: 4, phalanx: 3 }
];

/* Authored sectors go here, and the day they do they become the campaign
 * spine: `nextSortie` hands out CAMPAIGN[n] while one exists for this sortie
 * number and falls through to a generated sector afterwards. The career
 * underneath does not care which it got — the ladder, the payouts and the
 * roster gating all read the same plan object either way, which is the whole
 * reason this hook is two lines and not a rewrite. */
const CAMPAIGN = [];

function buildWaves(plan) {
  const avail = ARCHETYPES.filter(a =>
    Object.keys(a).every(k => k === 'label' || plan.roster.indexOf(k) >= 0));
  const out = [];
  for (let i = 0; i < plan.waves; i++) {
    const src = avail[Math.min(avail.length - 1, Math.floor(i / plan.waves * avail.length))];
    // Head count ramps across the sortie on top of the rank's own density, so
    // the last phase line is always the hard one whatever tier it is flown at.
    const ramp = plan.density * (0.78 + 0.46 * (i / Math.max(1, plan.waves - 1)));
    const w = { label: src.label };
    for (const k in src) if (k !== 'label') w[k] = Math.max(1, Math.round(src[k] * ramp));
    out.push(w);
  }
  return out;
}

function nextSortie() {
  const st = Career.state(), tier = Career.rankIndex();
  const plan = Career.sortie(tier);
  if (st.sorties < CAMPAIGN.length) return Object.assign(plan, CAMPAIGN[st.sorties]);
  plan.seed = (20260917 + st.sorties * 7919 + Math.floor(Math.random() * 1e6)) | 0;
  return plan;
}

/* The three stations with the career's modifiers folded in, rebuilt once per
 * sortie. Every consumer reads S.wfx rather than WEAPONS, because the
 * alternative — asking `Career.has('he40')` inside the splash maths — is how
 * two rungs quietly cancel each other out and nobody notices for a month. */
function effectiveWeapons(m) {
  return WEAPONS.map((w, i) => {
    const e = Object.assign({}, w);
    e.spread *= m.spread;
    e.heat *= m.heatPerShot;
    e.cool *= m.coolRate;
    if (i === 0) { e.rof *= m.rof25; e.spool *= m.spool25; e.heat *= m.heat25; }
    if (i === 1) { e.splash *= m.splash40; e.splashDmg *= m.splashDmg40; }
    if (i === 2) { e.splash *= m.splash105; }
    return e;
  });
}

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
  mod: null, wfx: null, plan: null, waves: null,
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
  measureChrome();
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
    // No hit-test exclusions any more. Under the amber build the zoom rail was
    // painted on the HUD canvas and had to claim a slice of the right edge
    // before the sticks saw the touch — which put it in a permanent
    // territorial dispute with the aiming thumb. The slate build makes zoom a
    // DOM button, and a DOM button above the input surface never leaks a
    // pointer event down into a stick at all.
    const s = (x < W * 0.5) ? L : R;
    if (s.id !== null) return;
    s.id = id; s.ox = x; s.oy = y; s.x = x; s.y = y; s.on = true; norm(s);
  }
  function move(id, x, y) {
    for (const s of [L, R]) if (s.id === id) { s.x = x; s.y = y; norm(s); }
  }
  function up(id) {
    for (const s of [L, R]) if (s.id === id) { s.id = null; s.on = false; s.dx = s.dy = 0; }
  }

  return {
    L, R, layout, down, move, up,
    rest: () => ({ x: restX, y: restY })
  };
})();

function setZoom(i) {
  i = Math.max(0, Math.min(ZOOMS.length - 1, i));
  if (i === S.cam.zi) return;
  S.cam.zi = i; S.cam.zt = ZOOMS[i];
  UI.zoom(i);
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
  // A station that has not been requisitioned is not a station. Saying so out
  // loud is the point: the player should learn what is on the shelf from the
  // moment they first want it, not from the requisition screen.
  if (S.mod && !S.mod.stations[i]) {
    UI.flash(WEAPONS[i].name + ' — STATION NOT FITTED');
    Audio.overheat();
    return;
  }
  S.weapon = i; S.spool = 0;
  UI.weapon(i);
  UI.flash(WEAPONS[i].name + ' SELECTED');
}

/* ============================================================== mission === */

function startMission(seed, plan) {
  S.plan = plan || nextSortie();
  if (seed === undefined || seed === null) seed = S.plan.seed;
  S.mod = Career.mods();
  S.wfx = effectiveWeapons(S.mod);
  S.waves = buildWaves(S.plan);
  ZOOMS = S.mod.zooms.slice();
  Hostiles.setGain(S.mod.ghostLum);

  S.sector = Sector.generate(seed);
  S.sector.line = densify(S.sector.route, 18);
  const total = S.sector.line.total;

  // Phase lines, spread evenly however many waves this rank flies. The last
  // one deliberately lands well short of the exit, so the run out to
  // extraction is a lap of honour rather than a coin flip.
  const n = S.waves.length;
  S.lineD = [];
  for (let i = 0; i < n; i++) S.lineD.push(total * (0.05 + 0.81 * (i / Math.max(1, n - 1))));

  S.convoy = {
    d: 0, hp: CONVOY_HP, halted: false, hurt: 0,
    units: [{ off: 0, cool: 0 }, { off: -52, cool: .4 }, { off: -104, cool: .8 }]
  };
  S.hostiles.length = 0; S.rounds.length = 0; S.fx.length = 0; S.tracers.length = 0;
  S.wave = 0; S.waveActive = false; S.queue.length = 0; S.pending = 0;
  S.heat = [0, 0, 0]; S.locked = [false, false, false]; S.nextShot = [0, 0, 0];
  S.jam = 0; S.jammed = false; S.shake = 0; S.spool = 0;
  S.score = 0; S.kills = 0; S.shots = 0; S.hits = 0; S.elapsed = 0;
  // Always open on the 25mm: it is the only station that is always fitted,
  // and a sortie that starts on a gun you sold back is a sortie that starts
  // with a dead trigger.
  S.weapon = 0; S.t = 0; S.trk = 40;

  const p = atDist(S.sector.line, 0);
  S.cam.x = p.x + 150; S.cam.y = p.y; S.cam.zi = 0; S.cam.z = S.cam.zt = 1;
  S.cam.toX = S.cam.toY = null;
  clampCam();
  S.flow = buildFlow(p.x, p.y); S.flowAt = 0;
  S.cross.x = W / 2; S.cross.y = H / 2;
  S.phase = 'play';
  document.body.classList.add('playing');
  UI.stations(S.mod.stations);
  UI.weapon(0);
  UI.buildZoom();
  measureChrome();
  UI.flash('VANGUARD ON STATION — SECTOR ' +
    (Math.abs(seed) % 97).toString().padStart(2, '0') + '  //  ' + Career.rank().n);
}

/* --------------------------------------------------------------- waves --- */

function beginWave(i) {
  const w = S.waves[i];
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
  // Health creeps with rank rather than leaping. The interesting escalation is
  // which hostiles are allowed to turn up, not how many rounds each one eats.
  const hp = Math.round(k.hp * S.plan.hp);
  // A track number, assigned once and kept for life. It is pure instrument
  // flavour — nothing in the game reads it — but a contact you can name is a
  // contact you can hold in your head across a wave.
  S.trk = (S.trk || 40) + 1;
  S.hostiles.push({
    kind, trk: S.trk, x: p.x, y: p.y, hp, max: hp, face: 0,
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
    // fight the cape is supposed to create. The FLIR-5 head widens that look;
    // TRACK MEMORY holds the tag for a few seconds after the sensor drops it,
    // so a Ghost that stops firing stops being invisible rather than stopping
    // existing.
    const cw = { x: toWorldX(S.cross.x), y: toWorldY(S.cross.y) };
    const look = Math.hypot(e.x - cw.x, e.y - cw.y);
    const live = e.kind === 'ghost' ? (e.flare > 0.12 || look < S.mod.tagRadius) : true;
    if (live) e.tagT = S.mod.tagHold; else e.tagT = Math.max(0, (e.tagT || 0) - dt);
    const seen = live || e.tagT > 0;
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
  if (!S.waveActive && S.wave < S.waves.length && c.d >= S.lineD[S.wave]) {
    beginWave(S.wave);
  }
  c.halted = S.waveActive;
  if (!c.halted) {
    c.d = Math.min(total, c.d + CONVOY_SPEED * dt);
    // The medical team works between phase lines and never under contact. A
    // regen that ticks during a wave turns every fight into a stalemate the
    // player can wait out.
    if (S.mod.regen && c.hp < CONVOY_HP) {
      c.hp = Math.min(CONVOY_HP, c.hp + S.mod.regen * dt);
      UI.integrity(c.hp);
    }
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
    let best = null, bd = 160 * S.mod.convoyRange;
    for (const e of S.hostiles) {
      const d = Math.hypot(e.x - p.x, e.y - p.y);
      if (d < bd && !S.sector.blocked(p.x, p.y, e.x, e.y)) { bd = d; best = e; }
    }
    if (best) {
      u.cool = 1.35;
      S.tracers.push({ x: p.x, y: p.y, tx: best.x, ty: best.y, t: 0.09, friendly: true });
      hit(best, 8 * S.mod.convoyDmg, Math.atan2(best.y - p.y, best.x - p.x), false, 'ally');
    } else u.cool = 0.4;
  }
}

/* -------------------------------------------------------------- gunnery --- */

function fireControl(dt) {
  const wi = S.weapon, w = S.wfx[wi];

  // Cooling runs on every barrel, not just the selected one, which is what
  // makes switching weapons a real option rather than a menu.
  for (let i = 0; i < WEAPONS.length; i++) {
    if (i === wi && S.firing) continue;
    S.heat[i] = Math.max(0, S.heat[i] - S.wfx[i].cool * dt);
    if (S.locked[i] && S.heat[i] < S.wfx[i].lockCool) {
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
  const w = S.wfx[wi];
  S.shots++;
  S.heat[wi] = Math.min(1, S.heat[wi] + w.heat);
  if (S.heat[wi] >= 1) {
    S.locked[wi] = true; S.firing = false; S.spool = 0;
    UI.flash(w.abbr + 'MM OVERHEAT — BARREL LOCKED');
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
  const w = S.wfx[wi];

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
  if (S.jammed && !was) UI.flash('EW INTERFERENCE — AUTO TRIGGER OFFLINE');
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
    UI.wave(S.wave, S.wave < S.waves.length ? 'MOVING' : 'EXFIL');
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

  /* Slate sinks the sensor image back a step. Its panels are opaque and its
   * accents are saturated, so the picture underneath has to sit behind them
   * rather than compete — the amber build could skip this because a thin amber
   * stroke reads over anything.
   *
   * Both numbers are lower than the mockup's, and the reason is the Ghost.
   * Its whole mechanic is fifteen points of luminance above the dirt it is
   * crossing; a screen pass compresses that ratio and a black overlay scales
   * the difference down outright. At the mockup's 0.42/0.26 the gap shrank by
   * about a quarter, which is a prettier interface bought by making the
   * hardest thing in the game harder for no design reason at all.
   *
   * The lift came down again once the terrain grew real tonal structure: a
   * screen pass that big was hazing a picture that now has its own contrast,
   * and lifting the blacks less helps the Ghost twice over. */
  wg.save();
  wg.setTransform(1, 0, 0, 1, 0, 0);
  wg.globalCompositeOperation = 'screen';
  wg.fillStyle = 'rgba(18,22,34,0.18)'; wg.fillRect(0, 0, world.width, world.height);
  wg.globalCompositeOperation = 'source-over';
  wg.fillStyle = 'rgba(4,6,12,0.14)'; wg.fillRect(0, 0, world.width, world.height);
  wg.restore();
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

/* TACTICAL SLATE. Picked over three other systems in lab/ — see
 * lab/README.md for what each one argued and what each one cost.
 *
 * The split: anything that has to FOLLOW something in the world is drawn here
 * on canvas (threat chips, convoy marks, the reticle, inbound shells, the
 * sticks). Anything that lives at a fixed place is a DOM element, styled in
 * index.html, because DOM gives crisp text, real touch targets and a layout
 * engine that already knows about safe-area insets.
 *
 * That split is also what makes the collision fix below possible.
 */

const SANS = '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif';
const MONOF = 'ui-monospace,Menlo,Consolas,"DejaVu Sans Mono",monospace';

/* NATO-ish three-letter codes rather than plain language, borrowed from the
 * pod layout in lab/. Slightly less readable than FAST and HEAVY were, and
 * worth it twice over: they carry the right register, and a fixed three
 * characters means every chip on the screen is the same width, which the
 * label allocator below turns directly into fewer dropped labels. */
const THREAT = {
  ghost:     { label: 'INF', col: '#ff9d3c' },
  technical: { label: 'VEH', col: '#ffd166' },
  phalanx:   { label: 'HVY', col: '#ff5a5a' },
  jammer:    { label: 'EWS', col: '#c08cff' }
};
const PANEL = 'rgba(14,17,24,.90)';

/* ---------------------------------------------------- reserved zones --- */

/* The fix for the top-centre pile-up.
 *
 * Under the amber build a hostile high on the screen put its bracket and class
 * label straight through the phase label, the integrity bar and the inbound
 * countdown — because the furniture was at fixed coordinates and the brackets
 * were at world coordinates, and neither knew the other existed.
 *
 * Rather than hand-tuning margins for the one case that was noticed, the
 * chrome now MEASURES ITSELF. Every fixed panel reports its own rectangle, and
 * anything canvas-drawn that carries a label checks against that list before
 * it draws: the chip flips below its contact, and if that is blocked too it is
 * dropped and only the threat arc remains. It generalises for free to the
 * bottom bar, the fire button and the zoom list, and it cannot drift out of
 * date when a panel is restyled, because the panel is the source of truth.
 */
const CHROME_IDS = ['convoyCard', 'objPill', 'topRight', 'zoomList',
                    'bottomBar', 'btnTrigger', 'jamBadge'];
let RESERVED = [];

function measureChrome() {
  RESERVED = [];
  if (!document.body.classList.contains('playing')) return;
  for (const id of CHROME_IDS) {
    const el = document.getElementById(id);
    if (!el) continue;
    if (id === 'jamBadge' && !el.classList.contains('on')) continue;
    // Visibility is decided by the measured rectangle, NOT by offsetParent.
    // offsetParent is null for every position:fixed element by spec, and all
    // of this chrome is fixed — testing it skipped the entire list and the
    // reserved set came back empty, which looked exactly like a working
    // collision system right up until a chip landed on the objective pill.
    // A display:none element (the collapsed zoom stack) reports 0x0 and is
    // filtered by the size check below instead.
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    RESERVED.push({ x: r.left - 6, y: r.top - 6, w: r.width + 12, h: r.height + 12 });
  }
}

/* Labels placed so far THIS frame. Chrome is not the only thing a label can
 * land on — in a cluster it lands on the last label, which is how the convoy's
 * own ANVIL tag ended up underneath a hostile's chip. Cleared every frame and
 * filled in priority order: friendlies first, then inbound shells, then threat
 * chips, so the least important label is the one that has to move. */
let TAKEN = [];

const overlaps = (x, y, w, h, r) =>
  x < r.x + r.w && x + w > r.x && y < r.y + r.h && y + h > r.y;

function blockedByChrome(x, y, w, h) {
  if (x < 4 || y < 4 || x + w > W - 4 || y + h > H - 4) return true;
  for (const r of RESERVED) if (overlaps(x, y, w, h, r)) return true;
  for (const r of TAKEN) if (overlaps(x, y, w, h, r)) return true;
  return false;
}

/* Where a label can go, in order of preference: above the contact, below it,
 * then out to either side. Only when all four are covered is the label
 * dropped — and the threat arc still draws, so a contact is never invisible,
 * it just loses the word. Above-or-nothing dropped half the labels in a
 * cluttered corner; four candidates drops almost none.
 *
 * CLAIM, not place: a successful call records the rectangle in TAKEN so the
 * next label this frame has to route around it. That side effect is the whole
 * point, and it is in the name because a probe that calls this twice for the
 * same label gets a different answer the second time. */
function claimLabel(x, y, r, w, h) {
  const cands = [
    [x - w / 2, y - r - 20],          // above
    [x - w / 2, y + r + 6],           // below
    [x - r - 8 - w, y - h / 2],       // left
    [x + r + 8, y - h / 2]            // right
  ];
  for (const [cx, cy] of cands) if (!blockedByChrome(cx, cy, w, h)) {
    TAKEN.push({ x: cx - 2, y: cy - 2, w: w + 4, h: h + 4 });
    return { x: cx, y: cy };
  }
  return null;
}

function rrect(g, x, y, w, h, r, fill, stroke) {
  g.beginPath();
  if (g.roundRect) g.roundRect(x, y, w, h, r);
  else g.rect(x, y, w, h);
  if (fill) { g.fillStyle = fill; g.fill(); }
  if (stroke) { g.strokeStyle = stroke; g.lineWidth = 1.2; g.stroke(); }
}

/* ------------------------------------------------------------- the pass --- */

function drawHUD() {
  const g = hg;
  g.setTransform(DPR, 0, 0, DPR, 0, 0);
  g.clearRect(0, 0, W, H);

  // Interference nudges the world-tracking layer only. Slate is not simulated
  // hardware, so it does not pretend its own panels are being received over a
  // datalink — the jam badge says what is happening instead.
  TAKEN.length = 0;
  drawTelemetry(g);

  const jitter = S.jammed ? (Math.random() - 0.5) * 5 * S.jam : 0;
  g.save();
  if (jitter) g.translate(jitter, 0);
  // Priority order. A shell with nine hundred milliseconds left matters more
  // than knowing the thing under it is infantry, so inbound claims its space
  // before the chips do.
  drawFriendlyMarks(g);
  drawInbound(g);
  drawThreatChips(g);
  g.restore();

  drawReticle(g);
  drawSticks(g);

  UI.tick();
}

/* Corner telemetry — the one piece of pod furniture that made it across from
 * MIL-SPEC in lab/, and the only one. No panel behind it: a translucent line
 * of mono costs the sensor image almost nothing, where the pod layout's two
 * opaque strips cost a fifth of a phone screen and lost it the job.
 *
 * Drawn on the CANVAS, first, and deliberately NOT added to the reserved set.
 * As a DOM element it sat above the HUD layer, so it had to reserve its
 * rectangle to avoid dim text landing on top of an opaque chip — and that dead
 * zone under the zoom pill immediately started dropping labels that used to
 * flip. Here the priority falls out of the draw order instead: a threat chip
 * is painted after, over the top, and a contact is worth more than a timecode.
 *
 * Two of the three lines are real. RNG is the ground distance from ANVIL to
 * wherever the crosshair is looking, which is how far from the convoy you have
 * wandered — a thing you genuinely cannot read off the picture. */
function drawTelemetry(g) {
  const rx = W - 14, top = 62;
  const conv = atDist(S.sector.line, S.convoy.d);
  const rng = Math.hypot(toWorldX(S.cross.x) - conv.x, toWorldY(S.cross.y) - conv.y);
  const m = Math.floor(S.elapsed / 60), sec = Math.floor(S.elapsed % 60);
  const lines = [
    'FLIR-4B  WHOT',
    'MAG ' + ZOOMS[S.cam.zi].toFixed(2) + 'X',
    'RNG ' + String(Math.round(rng)).padStart(4, '0') + 'M',
    'T+' + String(m).padStart(2, '0') + ':' + String(sec).padStart(2, '0')
  ];
  g.save();
  g.font = '600 8.5px ' + MONOF;
  g.textAlign = 'right';
  g.shadowColor = 'rgba(0,0,0,.85)'; g.shadowBlur = 3; g.shadowOffsetY = 1;
  for (let i = 0; i < lines.length; i++) {
    g.fillStyle = i === 0 ? 'rgba(255,255,255,.34)' : 'rgba(255,255,255,.30)';
    g.fillText(lines[i], rx, top + i * 14);
  }
  g.restore();
  g.textAlign = 'left';
}

/* Green triangles, not diamonds: a filled shape survives being nine pixels
 * across on a busy street in a way an outline does not. */
function drawFriendlyMarks(g) {
  const c = S.convoy;
  g.font = '700 10px ' + SANS;
  for (let i = 0; i < c.units.length; i++) {
    const p = atDist(S.sector.line, Math.max(0, c.d + c.units[i].off));
    const x = toScreenX(p.x), y = toScreenY(p.y);
    if (x < -40 || y < -40 || x > W + 40 || y > H + 40) continue;
    const r = 10 * Math.min(1.5, S.cam.z);
    g.fillStyle = '#68e39b';
    g.beginPath();
    g.moveTo(x, y - r); g.lineTo(x + r * 0.82, y + r * 0.64);
    g.lineTo(x - r * 0.82, y + r * 0.64); g.closePath(); g.fill();
    if (i === 0) {
      const tw = g.measureText('ANVIL').width + 14;
      const at = claimLabel(x, y, r, tw, 15);
      if (at) {
        rrect(g, at.x, at.y, tw, 15, 7, PANEL, 'rgba(104,227,155,.8)');
        g.fillStyle = '#68e39b'; g.textAlign = 'center';
        g.fillText('ANVIL', at.x + tw / 2, at.y + 11); g.textAlign = 'left';
      }
    }
  }
  // Off-window chevron. Losing the convoy off the edge of the sensor is the
  // most common way a player gets lost, and one arrow fixes it.
  const lead = atDist(S.sector.line, c.d);
  const lx = toScreenX(lead.x), ly2 = toScreenY(lead.y);
  if (lx < 0 || ly2 < 0 || lx > W || ly2 > H) {
    const a = Math.atan2(ly2 - H / 2, lx - W / 2);
    const rr = Math.min(W, H) * 0.34;
    g.save();
    g.translate(W / 2 + Math.cos(a) * rr, H / 2 + Math.sin(a) * rr);
    g.rotate(a);
    g.fillStyle = '#68e39b';
    g.beginPath(); g.moveTo(14, 0); g.lineTo(-8, -9); g.lineTo(-8, 9); g.closePath(); g.fill();
    g.restore();
  }
}

/* A chip, not a bracket. Four brackets and a class name per contact is how the
 * amber build ended up with nine labelled boxes fighting over the same corner
 * of a phone screen; a colour-coded pill says what it is in a third of the ink
 * and reads at a glance, at the honest cost of saying it less precisely. */
function drawThreatChips(g) {
  // Detail scales with magnification. Wide open you get the class and nothing
  // else, because nine chips at 1.00x is already most of what the eye can take;
  // zoomed in you get the track number and the ground range from ANVIL, which
  // is the number that actually tells you how long you have. More glass, more
  // information, is how the real thing behaves too.
  const detail = S.cam.z >= 1.7;
  const conv = atDist(S.sector.line, S.convoy.d);
  for (const e of S.hostiles) {
    if (e.tag < 0.05) continue;
    const k = Hostiles.KINDS[e.kind], th = THREAT[e.kind];
    const x = toScreenX(e.x), y = toScreenY(e.y);
    const r = Math.max(12, (k.r + 5) * S.cam.z);
    g.save();
    g.globalAlpha = e.tag;
    // Acquisition has a shape: the mark settles onto the contact from just
    // outside it rather than switching on. e.tag already eases 0->1 over
    // about a sixth of a second, so the scale is free.
    if (e.tag < 0.999) {
      g.translate(x, y);
      g.scale(1 + (1 - e.tag) * 0.55, 1 + (1 - e.tag) * 0.55);
      g.translate(-x, -y);
    }

    // The arc is the health bar and the bracket at once: it opens clockwise
    // from the contact's left and shortens as the thing is chewed down.
    g.strokeStyle = th.col; g.lineWidth = 2;
    g.beginPath(); g.arc(x, y, r, -0.55, -0.55 + Math.PI * 1.75 * (e.hp / e.max)); g.stroke();
    if (e.hitT > 0) {
      g.strokeStyle = 'rgba(255,255,255,' + e.hitT + ')'; g.lineWidth = 2.5;
      g.beginPath(); g.arc(x, y, r + 3, 0, 7); g.stroke();
    }

    const head = detail ? ('T' + e.trk + ' ' + th.label) : th.label;
    g.font = '700 9px ' + MONOF;
    const tw = Math.max(38, g.measureText(head).width + 16);
    const hgt = detail ? 27 : 16;
    const at = claimLabel(x, y, r, tw, hgt);
    if (at) {
      rrect(g, at.x, at.y, tw, hgt, 8, PANEL, th.col);
      g.textAlign = 'center';
      g.fillStyle = th.col;
      g.fillText(head, at.x + tw / 2, at.y + 11.5);
      if (detail) {
        const rng = Math.round(Math.hypot(e.x - conv.x, e.y - conv.y));
        g.font = '600 7.5px ' + MONOF;
        g.fillStyle = 'rgba(255,255,255,.55)';
        g.fillText(String(rng).padStart(4, '0') + 'M', at.x + tw / 2, at.y + 22);
      }
      g.textAlign = 'left';
    }
    g.restore();
  }
}

function drawInbound(g) {
  g.font = '700 10px ' + SANS;
  for (const r of S.rounds) {
    const x = toScreenX(r.x), y = toScreenY(r.y);
    const p = r.t / r.tof;
    const rad = 16 + (1 - p) * 40 * Math.min(1.5, S.cam.z);
    g.save();
    g.strokeStyle = 'rgba(255,214,102,' + (0.45 + p * 0.5) + ')';
    g.lineWidth = 2;
    g.setLineDash([6, 6]); g.lineDashOffset = -S.t * 26;
    g.beginPath(); g.arc(x, y, rad, 0, 7); g.stroke();
    g.setLineDash([]);
    const label = (r.tof - r.t).toFixed(1) + 's';
    const tw = g.measureText(label).width + 16;
    const at = claimLabel(x, y, rad, tw, 17);
    if (at) {
      rrect(g, at.x, at.y, tw, 17, 8, PANEL, '#ffd166');
      g.fillStyle = '#ffd166'; g.textAlign = 'center';
      g.fillText(label, at.x + tw / 2, at.y + 12); g.textAlign = 'left';
    }
    g.restore();
  }
}

/* Soft ring and a dot. Nothing spins — the amber reticle's rotating spokes
 * were a firing indicator, and slate has a heat bar doing that job in a place
 * the eye can read without leaving the target. */
function drawReticle(g) {
  const x = S.cross.x, y = S.cross.y;
  const w = S.wfx[S.weapon];
  const hot = S.locked[S.weapon];
  const col = hot ? '#ff5a5a' : '#ff9d3c';
  g.save();

  if (w.splash) {
    // The 105 and the 40 show the radius they will actually clear, in screen
    // pixels at the current magnification. Guessing a blast radius is not a
    // skill worth asking for.
    g.strokeStyle = hot ? 'rgba(255,90,90,.4)' : 'rgba(255,157,60,.4)';
    g.lineWidth = 1.5;
    g.setLineDash([6, 8]); g.lineDashOffset = -S.t * 16;
    g.beginPath(); g.arc(x, y, w.splash * S.cam.z, 0, 7); g.stroke();
    g.setLineDash([]);
  }

  g.strokeStyle = 'rgba(255,255,255,.9)'; g.lineWidth = 2;
  g.beginPath(); g.arc(x, y, 19, 0, 7); g.stroke();
  g.strokeStyle = col; g.lineWidth = 1.5;
  g.setLineDash([4, 8]); g.lineDashOffset = S.t * 10;
  g.beginPath(); g.arc(x, y, 29, 0, 7); g.stroke();
  g.setLineDash([]);

  /* Precision cross and a mil ladder inside the ring — the pod reticle's one
   * genuinely useful idea. The soft ring says where you are pointing; the
   * ticks say how far off you are, which at 3.00x against a Ghost is the
   * difference between a burst and a wasted barrel. */
  g.strokeStyle = 'rgba(255,255,255,.75)'; g.lineWidth = 1.2;
  g.beginPath();
  g.moveTo(x - 17, y); g.lineTo(x - 7, y); g.moveTo(x + 7, y); g.lineTo(x + 17, y);
  g.moveTo(x, y - 17); g.lineTo(x, y - 7); g.moveTo(x, y + 7); g.lineTo(x, y + 17);
  g.stroke();
  if (S.cam.z >= 1.7) {
    g.strokeStyle = 'rgba(255,255,255,.45)';
    for (let i = 1; i <= 3; i++) {
      const d = 34 + i * 9;
      g.beginPath(); g.moveTo(x - d, y - 3); g.lineTo(x - d, y + 3);
      g.moveTo(x + d, y - 3); g.lineTo(x + d, y + 3); g.stroke();
    }
    g.font = '600 8px ' + MONOF;
    g.fillStyle = 'rgba(255,255,255,.5)'; g.textAlign = 'left';
    g.fillText(w.abbr + 'MM', x + 34, y - 24);
  }
  g.fillStyle = col;
  g.beginPath(); g.arc(x, y, 3, 0, 7); g.fill();

  if (hot) {
    g.font = '700 10px ' + SANS; g.textAlign = 'center';
    g.fillStyle = '#ff5a5a';
    g.fillText('OVERHEAT', x, y - 36); g.textAlign = 'left';
  }
  g.restore();
}

/* Translucent pads rather than rings. They carry no readout at all now — heat
 * moved to the bottom bar — so they can afford to be quiet, and a quiet
 * control is one less thing competing with the sensor image. */
function drawSticks(g) {
  const L = Sticks.L, R = Sticks.R;
  const lp = L.on ? { x: L.ox, y: L.oy } : { x: 96, y: H - 96 };
  const rp = R.on ? { x: R.ox, y: R.oy } : { x: W - 210, y: H - 96 };

  for (const [p, st, live] of [[lp, L, L.on], [rp, R, R.on]]) {
    g.save();
    g.globalAlpha = live ? 1 : 0.38;
    g.fillStyle = 'rgba(255,255,255,.06)';
    g.beginPath(); g.arc(p.x, p.y, STICK_R, 0, 7); g.fill();
    g.strokeStyle = 'rgba(255,255,255,.14)'; g.lineWidth = 1.5;
    g.beginPath(); g.arc(p.x, p.y, STICK_R, 0, 7); g.stroke();
    g.fillStyle = 'rgba(255,255,255,.16)';
    g.beginPath(); g.arc(p.x + st.dx * STICK_R, p.y + st.dy * STICK_R, 21, 0, 7); g.fill();
    g.strokeStyle = 'rgba(255,255,255,.55)'; g.lineWidth = 1.5;
    g.beginPath(); g.arc(p.x + st.dx * STICK_R, p.y + st.dy * STICK_R, 21, 0, 7); g.stroke();
    g.restore();
  }

  // The activation radius on the aim stick: the boundary between aiming and
  // firing has to be visible or the player learns it by accident.
  g.save();
  g.globalAlpha = R.on ? 0.9 : 0.3;
  g.strokeStyle = S.jammed ? '#ff5a5a' : 'rgba(255,157,60,.8)';
  g.lineWidth = 1.5;
  g.setLineDash([4, 5]);
  g.beginPath(); g.arc(rp.x, rp.y, STICK_R * TRIGGER_R, 0, 7); g.stroke();
  g.restore();
  g.setLineDash([]);
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

  // Only write to the DOM when the value actually changed. These are called
  // from the frame loop, and a text node rewritten sixty times a second is
  // sixty style recalculations nobody asked for.
  const setText = (el, v) => { if (el.textContent !== v) el.textContent = v; };

  function integrity(hp) {
    const pct = Math.max(0, hp) / CONVOY_HP;
    // scaleX, not width: the integrity bar moves on almost every frame of a
    // bad wave and a width change relayouts the whole convoy card each time.
    $('intBar').style.transform = 'scaleX(' + pct.toFixed(4) + ')';
    setText($('intVal'), Math.ceil(hp) + '%');
    $('convoyCard').classList.toggle('crit', pct < 0.3);
  }

  function wave(n, label) {
    const tot = S.waves ? S.waves.length : 8;
    setText($('waveN'), 'PHASE ' + Math.min(n, tot) + ' OF ' + tot);
    const el = $('waveL');
    if (el.textContent !== label) {
      el.textContent = label;
      // Restart the animation rather than resume it: without the reflow the
      // class is already present and the second change plays nothing.
      const pill = $('objPill');
      pill.classList.remove('change'); void pill.offsetWidth;
      pill.classList.add('change');
    }
    measureChrome();            // the objective pill just changed width
  }

  function weapon(i) {
    [...document.querySelectorAll('.wep')].forEach((b, k) => b.classList.toggle('on', k === i));
  }

  function jam(v) {
    const el = $('jamBadge');
    if (el.classList.contains('on') === v) return;
    el.classList.toggle('on', v);
    measureChrome();
  }

  /* The zoom control. One pill showing the current magnification, expanding
   * into the full stack on tap. A permanent stack of five detents — which
   * GEN-2 OPTICS buys — is two hundred pixels of the right edge, and the right
   * edge is where the aiming thumb lives. */
  function buildZoom() {
    const list = $('zoomList');
    list.innerHTML = '';
    ZOOMS.forEach((z, i) => {
      const b = document.createElement('button');
      b.textContent = z.toFixed(2) + '\u00D7';
      b.dataset.i = i;
      b.addEventListener('pointerdown', e => {
        e.preventDefault(); e.stopPropagation();
        Audio.wake(); setZoom(i); closeZoom();
      });
      list.appendChild(b);
    });
    zoom(S.cam.zi);
  }
  function zoom(i) {
    setText($('zoomBtn'), ZOOMS[i].toFixed(2) + '\u00D7');
    [...$('zoomList').children].forEach((b, k) => b.classList.toggle('on', k === i));
  }
  function toggleZoom() {
    $('zoomWrap').classList.toggle('open');
    measureChrome();
  }
  function closeZoom() {
    if (!$('zoomWrap').classList.contains('open')) return;
    $('zoomWrap').classList.remove('open');
    measureChrome();
  }

  /* Per-frame chrome. Heat and route are transforms on a composited layer, so
   * they are free to write every frame; the hostile count is text, so it is
   * guarded. */
  let lastHost = -1, pips = null;
  function tick() {
    const h = S.heat[S.weapon];
    $('heatFill').style.transform = 'scaleX(' + h.toFixed(3) + ')';
    const hw = $('heatWrap');
    hw.classList.toggle('hot', h > 0.72 && !S.locked[S.weapon]);
    hw.classList.toggle('locked', S.locked[S.weapon]);
    setText($('heatPct'), S.locked[S.weapon] ? 'LCK'
      : String(Math.round(h * 100)).padStart(2, '0') + '%');

    // Every barrel's heat, not just the one in hand.
    if (!pips) pips = [...document.querySelectorAll('.wep .pip>i')];
    for (let i = 0; i < pips.length; i++) {
      pips[i].style.transform = 'scaleX(' + S.heat[i].toFixed(3) + ')';
      pips[i].style.background = S.locked[i] ? '#ff5a5a' : '#ff9d3c';
    }

    $('routeFill').style.transform =
      'scaleX(' + (S.convoy.d / S.sector.line.total).toFixed(4) + ')';

    const n = S.hostiles.length + S.queue.length;
    if (n !== lastHost) {
      lastHost = n;
      setText($('hostN'), n ? String(n).padStart(2, '0') + ' TRK' : 'SECTOR CLEAR');
    }

  }

  /* What the sortie was worth. Integrity dominates on purpose — it is the
   * only term the mission was ever about, and a wasteful run that hands back a
   * convoy has to out-earn a surgical one that hands back a wreck. Losing
   * still pays: a career game that zeroes a bad night teaches players to quit
   * to the menu the moment a run goes wrong, which is the opposite of the
   * behaviour a ladder wants. */
  function payout(won) {
    const acc = S.shots ? S.hits / S.shots : 0;
    const parts = [
      ['CONVOY INTEGRITY', Math.round(S.convoy.hp * 3)],
      ['HOSTILES NEUTRALISED', S.kills * 5],
      ['PHASE LINES HELD', Math.min(S.wave, S.waves.length) * 35],
      ['EXTRACTION BONUS', won ? 200 : 0],
      ['EFFECTS ON TARGET', acc > 0.6 ? 70 : 0]
    ];
    const base = parts.reduce((a, b) => a + b[1], 0);
    return { parts, base, mult: S.plan.pay, total: Math.round(base * S.plan.pay) };
  }

  function stats() {
    const acc = S.shots ? (S.hits / S.shots * 100) : 0;
    const m = Math.floor(S.elapsed / 60), s = Math.floor(S.elapsed % 60);
    return [
      ['CONVOY INTEGRITY', Math.ceil(S.convoy.hp) + ' / ' + CONVOY_HP],
      ['PHASE LINES HELD', Math.min(S.wave, S.waves.length) + ' / ' + S.waves.length],
      ['HOSTILES NEUTRALISED', S.kills],
      ['ROUNDS EXPENDED', S.shots],
      ['EFFECTS ON TARGET', acc.toFixed(0) + '%'],
      ['TIME ON STATION', m + ':' + String(s).padStart(2, '0')],
      ['SCORE', S.score]
    ];
  }

  function result(won) {
    const pct = S.convoy.hp / CONVOY_HP;
    const stars = !won ? 0 : pct > 0.8 ? 3 : pct > 0.5 ? 2 : 1;
    S.score += Math.round(S.convoy.hp * 12) + (won ? 800 : 0);

    const pay = payout(won);
    const before = Career.rank().n;
    Career.award(pay.total);
    Career.recordScore(S.score);
    const after = Career.rank().n;

    $('resTitle').textContent = won ? 'ANVIL IS CLEAR' : 'ANVIL IS LOST';
    $('resTitle').className = won ? 'ok' : 'bad';
    $('resSub').textContent = won
      ? 'Ground element reached the extraction point.'
      : 'The ground element was destroyed in sector.';
    $('resStars').innerHTML = [0, 1, 2].map(i =>
      '<i class="' + (i < stars ? 'on' : '') + '">\u25C6</i>').join('');

    const rows = pay.parts.map(r =>
      '<div><b>' + r[0] + '</b><span>' + r[1] + '</span></div>').join('')
      + (pay.mult > 1.001
        ? '<div><b>TIER MULTIPLIER</b><span>\u00D7' + pay.mult.toFixed(2) + '</span></div>'
        : '')
      + '<div class="tot"><b>REQUISITION EARNED</b><span id="resTotal">0</span></div>';
    $('resStats').innerHTML = rows;
    rollTo($('resTotal'), pay.total, 850);

    // A promotion is the one thing on this screen worth interrupting for.
    $('resRank').textContent = (after !== before) ? 'PROMOTED \u2014 ' + after : after;
    $('resRank').classList.toggle('up', after !== before);
    paintRankBar($('resBar'));
    hub();
    $('result').classList.add('show');
  }

  /* A number that lands on its value instead of appearing at it. Eased, not
   * linear — a linear count-up reads as a progress bar, an eased one reads as
   * a total being tallied. */
  function rollTo(el, to, ms) {
    const t0 = performance.now();
    const step = now => {
      const k = Math.min(1, (now - t0) / ms);
      const e = 1 - Math.pow(1 - k, 3);
      el.textContent = Math.round(to * e);
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  /* --------------------------------------------------------- the hub ------ */

  function paintRankBar(el) {
    const st = Career.state(), r = Career.rank(), nx = Career.nextRank();
    const f = nx ? (st.lifetime - r.at) / (nx.at - r.at) : 1;
    el.style.width = (Math.max(0, Math.min(1, f)) * 100).toFixed(1) + '%';
  }

  function hub() {
    const st = Career.state();
    $('hubRank').textContent = Career.rank().n;
    $('hubReq').textContent = st.req + ' REQ';
    const nx = Career.nextRank();
    $('hubNext').textContent = nx ? (nx.at - st.lifetime) + ' TO ' + nx.n : 'TOP OF THE LADDER';
    paintRankBar($('hubBar'));
    $('hubMeta').textContent = 'SORTIES ' + st.sorties +
      (st.bestScore ? '   \u00B7   BEST ' + st.bestScore : '');
    // The requisition button is highlighted only when something on the shelf is
    // actually affordable, so it never nags at an empty wallet.
    const any = Career.RUNGS.some(r2 => Career.canBuy(r2));
    $('menuReq').classList.toggle('hot', any);
    $('resReq').classList.toggle('hot', any);
  }

  /* Stations that have not been requisitioned are shown, not hidden. A player
   * should be able to see the shape of the aircraft they are working towards
   * from the very first sortie. */
  function stations(on) {
    [...document.querySelectorAll('.wep')].forEach((b, i) =>
      b.classList.toggle('locked', !on[i]));
  }

  /* ------------------------------------------------------ requisition ----- */

  function paintReq() {
    const st = Career.state();
    $('reqBal').textContent = st.req + ' REQ';
    $('reqRank').textContent = Career.rank().n;
    $('reqList').innerHTML = Career.TRACKS.map(track => {
      const rows = Career.RUNGS.filter(r => r.track === track).map(r => {
        const owned = Career.has(r.id), lock = Career.locked(r), can = Career.canBuy(r);
        const cls = owned ? 'owned' : lock ? 'lock' : can ? 'can' : '';
        const tag = owned ? 'FITTED'
          : lock ? 'NEEDS ' + Career.RUNGS.find(x => x.id === r.need).name
          : r.cost + ' REQ';
        return '<button class="rung ' + cls + '" data-id="' + r.id + '"' +
          (can ? '' : ' disabled') + '>' +
          '<span class="rn">' + r.name + '</span>' +
          '<span class="rc">' + tag + '</span>' +
          '<span class="rb">' + r.blurb + '</span></button>';
      }).join('');
      return '<div class="trk"><h4>' + track + '</h4>' + rows + '</div>';
    }).join('');
    [...$('reqList').querySelectorAll('.rung')].forEach(b => {
      b.addEventListener('pointerdown', e => {
        e.preventDefault(); e.stopPropagation();
        Audio.wake();
        if (Career.buy(b.dataset.id)) { Audio.clear(); paintReq(); hub(); }
      });
    });
  }

  function openReq() { paintReq(); $('req').classList.add('show'); }
  function closeReq() { $('req').classList.remove('show'); }

  function togglePause() {
    if (S.phase !== 'play') return;
    paused = !paused;
    $('pause').classList.toggle('show', paused);
  }
  const isPaused = () => paused;

  return { flash, integrity, wave, weapon, jam, result, togglePause, isPaused, term,
           hub, stations, openReq, closeReq, payout, tick, zoom, buildZoom,
           toggleZoom, closeZoom, $ };
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
  Career.load();

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
      UI.hub();
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

  // One launcher for both entry points. The sortie itself is chosen by
  // nextSortie(), which is where the authored campaign will take over.
  const launch = () => {
    $('menu').classList.remove('show');
    $('result').classList.remove('show');
    $('req').classList.remove('show');
    startMission();
    UI.integrity(CONVOY_HP);
    UI.wave(1, 'MOVING TO PHASE LINE');
  };
  tap($('menuPlay'), launch);

  [...document.querySelectorAll('.wep')].forEach((b, i) => tap(b, () => selectWeapon(i)));
  tap($('btnRecenter'), recenter);
  tap($('zoomBtn'), () => UI.toggleZoom());
  // Any touch on the sensor image closes the zoom stack. An expanded menu that
  // needs a second deliberate tap to dismiss is an expanded menu sitting on
  // top of the fight.
  document.getElementById('surface').addEventListener('pointerdown', () => UI.closeZoom());
  tap($('btnPause'), () => UI.togglePause());
  tap($('btnResume'), () => UI.togglePause());
  tap($('btnAbort'), () => {
    UI.togglePause();
    S.phase = 'menu';
    document.body.classList.remove('playing');
    $('menu').classList.add('show');
  });
  tap($('resAgain'), launch);
  tap($('menuReq'), () => UI.openReq());
  tap($('resReq'), () => UI.openReq());
  tap($('reqClose'), () => UI.closeReq());
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
