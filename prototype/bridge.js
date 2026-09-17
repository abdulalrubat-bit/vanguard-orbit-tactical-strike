/* The bridge.
 *
 * One question, answered by playing it: does dropping from a turn-based grid
 * into a real-time gunship sortie and coming back out feel like ONE game?
 *
 * Neither game is modified. Modern Frontline and Vanguard Orbit each run in
 * their own same-origin iframe, keeping their own global scope, and this file
 * — living in the parent — reaches into both. That is not a shortcut around
 * doing it properly; it is the smallest possible stand-in for the module
 * boundary a real merge would need, and the reason it is needed is concrete:
 *
 *   The two games share 21 top-level names. Among them setZoom, resize,
 *   finish, ctx, zoom, tile and road. Concatenating these files into one
 *   scope does not "mostly work" — it silently breaks both.
 *
 * So the merge is not a copy-paste job at any scale, and this prototype is
 * shaped the way the real thing has to be shaped: two worlds, one bridge.
 *
 * WHAT IS REAL HERE
 *   - The tile you pick, its terrain and the enemy units standing on it.
 *   - The sector you fly over, generated from that tile.
 *   - The hostiles, derived one-for-one from those units.
 *   - The deaths, written back to the grid. Frontline's own checkWin runs.
 *   - The credits, spent from Frontline's own economy.
 *
 * WHAT IS FAKED
 *   - Reading `let`/`const` across the frame boundary goes through eval,
 *     because top-level lexical bindings are not window properties. A real
 *     merge exports them instead. Every such read is marked `X(` below.
 *   - Terrain steers the roster and the seed, not the sector generator's
 *     shape. Sector.generate takes a seed and nothing else today.
 */
'use strict';

const Bridge = (() => {

  const $ = id => document.getElementById(id);
  const fl = $('fl'), vg = $('vg');
  let FW = null, VW = null;               // the two game windows
  let busy = false, strike = null;

  const STRIKE_COST = 40;
  const SORTIE_SECONDS = 60;

  /* Cross-frame read. A top-level `let units = []` is NOT window.units, but a
   * global eval inside that frame can see it, because global lexical bindings
   * live in the global environment record that global eval resolves against. */
  const X = (w, expr) => w.eval('(' + expr + ')');

  const fail = msg => {
    $('err').style.display = 'block';
    $('err').textContent = msg;
    console.error('[bridge]', msg);
  };

  /* ------------------------------------------------------- unit mapping --- */

  /* Each ground unit becomes one SIGNATURE hostile plus escorts. Signature
   * kinds are unique per unit type, which is what makes the result legible
   * both ways: kill a Phalanx up there and a tank dies down here, and the
   * player can see why without being told. */
  const MAP = {
    infantry:  { sig: 'ghost',     escort: { ghost: 2 }, label: 'INFANTRY' },
    recon:     { sig: 'technical', escort: {},           label: 'RECON' },
    tank:      { sig: 'phalanx',   escort: { ghost: 1 }, label: 'TANK' },
    artillery: { sig: 'jammer',    escort: { ghost: 2 }, label: 'ARTILLERY' }
  };

  /* Terrain decides what the fight is made of. It cannot yet decide what the
   * sector LOOKS like — Sector.generate takes a seed and nothing else — so
   * this is the honest half of the translation, and the other half is a TODO
   * the real version has to pay for. */
  const TERRAIN_FLAVOUR = {
    city:   { extra: { ghost: 4 }, note: 'BUILT-UP · heavy infantry presence' },
    forest: { extra: { ghost: 2 }, note: 'WOODED · dispersed' },
    hill:   { extra: {},           note: 'HIGH GROUND · open fields of fire' },
    road:   { extra: { technical: 1 }, note: 'ROAD · mobile response likely' },
    bridge: { extra: { technical: 1 }, note: 'CROSSING · canalised' },
    open:   { extra: {},           note: 'OPEN · little cover' }
  };

  /* ------------------------------------------------------------- start --- */

  function ready() {
    try {
      FW = fl.contentWindow; VW = vg.contentWindow;
      if (!FW.screenToWorld) return false;          // Frontline not up yet
      if (!VW.startMission) return false;           // Vanguard not up yet
    } catch (e) { return false; }
    return true;
  }

  function boot() {
    let tries = 0;
    const wait = setInterval(() => {
      if (ready()) { clearInterval(wait); attach(); }
      else if (++tries > 120) { clearInterval(wait); fail('One of the two games did not come up.'); }
    }, 100);
  }

  /* Inject the call button into Frontline's own button bar. Modifying another
   * frame's DOM is fine same-origin, and it keeps the affordance where the
   * player's thumb already is rather than floating it over the map. */
  function attach() {
    const bar = FW.document.getElementById('bottom');
    if (!bar) return fail('Frontline has no #bottom bar to attach to.');
    const b = FW.document.createElement('button');
    b.id = 'callVanguard';
    b.textContent = 'CALL VANGUARD';
    b.style.cssText = 'border-color:#ff9d3c;color:#ff9d3c;background:#2a1f12;font-weight:700';
    b.addEventListener('click', () => designate());
    bar.appendChild(b);

    // Vanguard sits on its menu until called. Nothing of it should be audible
    // or visible while the player is on the ground.
    try { VW.document.body.classList.remove('playing'); } catch (e) {}
    $('shAbort').addEventListener('click', () => endSortie('BROKEN OFF'));
    $('dbOk').addEventListener('click', () => { $('debrief').classList.remove('on'); });
  }

  /* --------------------------------------------------------- designate --- */

  let designating = false, tapHook = null;

  function designate() {
    if (busy || designating) return;
    const credits = X(FW, 'credits');
    if (credits < STRIKE_COST) {
      FW.showMessage('Need ' + STRIKE_COST + ' credits for a strike');
      return;
    }
    if (X(FW, 'phase') !== 'player') return;

    designating = true;
    document.body.classList.add('designating');
    $('designateHint').textContent = 'TAP ENEMY GROUND · ' + STRIKE_COST + ' CREDITS';

    // Capture phase, so Frontline's own pointerup never sees the tap that is
    // meant for us. Cancelling designation puts the map straight back.
    const cv = FW.document.querySelector('canvas');
    tapHook = e => {
      e.stopPropagation(); e.preventDefault();
      cv.removeEventListener('pointerup', tapHook, true);
      document.body.classList.remove('designating');
      designating = false;
      const pos = FW.screenToWorld(e.clientX, e.clientY);
      if (!FW.inBounds(pos.x, pos.y)) return;
      launch(pos.x, pos.y);
    };
    cv.addEventListener('pointerup', tapHook, true);
  }

  /* ------------------------------------------------------------ launch --- */

  function launch(tx, ty) {
    const terr = FW.terrain(tx, ty);
    // Everything hostile within one tile of the mark. A strike is an area
    // effect on the ground map before it is anything in the air.
    const marked = X(FW, `units.filter(u => u.hp > 0 && u.faction !== playerFaction
      && Math.abs(u.x - ${tx}) <= 1 && Math.abs(u.y - ${ty}) <= 1)
      .map(u => ({ id:u.id, type:u.type, hp:u.hp, maxHp:u.maxHp }))`);

    if (!marked.length) {
      FW.showMessage('No hostiles on that ground');
      return;
    }

    // Pay for it out of Frontline's own economy, so the strike competes with
    // reinforcements for the same credits. That tension is the whole reason
    // to share a currency.
    FW.eval(`credits -= ${STRIKE_COST}; updateUI();`);

    const roster = {};
    const add = (k, n) => { roster[k] = (roster[k] || 0) + n; };
    for (const u of marked) {
      const m = MAP[u.type];
      add(m.sig, 1);
      for (const k in m.escort) add(k, m.escort[k]);
    }
    const flav = TERRAIN_FLAVOUR[terr] || TERRAIN_FLAVOUR.open;
    for (const k in flav.extra) add(k, flav.extra[k]);

    strike = {
      tx, ty, terr, marked, roster,
      spawned: Object.assign({}, roster),
      t0: 0, deadline: 0, note: flav.note
    };

    wipeIn(tx, ty, flav.note, () => startSortie());
  }

  function wipeIn(tx, ty, note, then) {
    busy = true;
    $('wipeTitle').textContent = 'VANGUARD ON STATION';
    $('wipeSub').textContent = 'GRID ' + String(tx).padStart(2, '0') + '·'
      + String(ty).padStart(2, '0') + '  —  ' + note;
    $('wipe').classList.add('on');
    $('wipeBar').style.transform = 'scaleX(0)';
    requestAnimationFrame(() => { $('wipeBar').style.transform = 'scaleX(1)'; });
    setTimeout(then, 620);
  }

  /* ------------------------------------------------------------ sortie --- */

  function startSortie() {
    // A seed derived from the tile: the same ground always flies the same
    // sector, which is what makes the two maps feel like one place.
    const seed = (918273 + strike.tx * 7919 + strike.ty * 104729) | 0;
    const wave = Object.assign({ label: 'CLOSE AIR SUPPORT' }, strike.roster);

    try {
      VW.eval(`
        startMission(${seed}, { tier: 3, waves: 1, hp: 1, density: 1, pay: 1,
          roster: ['ghost','technical','jammer','phalanx'] });
        S.waves = [${JSON.stringify(wave)}];
        S.lineD = [S.sector.line.total * 0.06];
        S.mod.stations = [true, true, true];
        UI.stations(S.mod.stations);
      `);
    } catch (e) { return fail('Could not start the sortie: ' + e.message); }

    document.body.classList.add('sortie');
    $('wipe').classList.remove('on');
    strike.t0 = performance.now();
    strike.deadline = strike.t0 + SORTIE_SECONDS * 1000;
    tick();
  }

  let raf = 0;
  function tick() {
    if (!strike) return;
    const left = Math.max(0, (strike.deadline - performance.now()) / 1000);
    $('shClock').textContent = left.toFixed(1) + 's';
    $('shClock').classList.toggle('low', left < 12);

    let live = 0, queued = 0, hp = 100, over = false;
    try {
      live = X(VW, 'S.hostiles.length');
      queued = X(VW, 'S.queue.length');
      hp = X(VW, 'S.convoy.hp');
      over = X(VW, "S.phase") !== 'play';
    } catch (e) { /* mid-reload; try again next frame */ }

    const total = Object.values(strike.spawned).reduce((a, b) => a + b, 0);
    $('shKills').textContent = Math.max(0, total - live - queued) + ' / ' + total;

    if (left <= 0) return endSortie('TIME ON STATION EXPIRED');
    if (hp <= 0) return endSortie('OVERWATCH LOST — CONVOY DESTROYED');
    if (over) return endSortie('SECTOR CLEAR');
    if (!queued && !live && performance.now() - strike.t0 > 3000) return endSortie('SECTOR CLEAR');
    raf = requestAnimationFrame(tick);
  }

  /* ------------------------------------------------------------ return --- */

  function endSortie(why) {
    if (!strike) return;
    cancelAnimationFrame(raf);
    const s = strike; strike = null;

    // Count survivors by kind; everything else died.
    let remain = {};
    try {
      remain = X(VW, `(() => { const r = {};
        for (const e of S.hostiles) r[e.kind] = (r[e.kind]||0)+1;
        for (const q of S.queue) r[q.kind] = (r[q.kind]||0)+1;
        return r; })()`);
      VW.eval("S.phase = 'menu'; document.body.classList.remove('playing'); S.hostiles.length = 0;");
    } catch (e) {}

    const killed = {};
    for (const k in s.spawned) killed[k] = Math.max(0, s.spawned[k] - (remain[k] || 0));

    /* Write the deaths back. Signature kinds are unique per unit type, so a
     * dead Phalanx is a dead tank with no ambiguity; infantry take pooled
     * damage from ghosts because three of them stand in for one section. */
    const rows = [], destroyed = [];
    const bySig = { technical: 'recon', phalanx: 'tank', jammer: 'artillery' };
    for (const sig in bySig) {
      const type = bySig[sig];
      const pool = s.marked.filter(u => u.type === type);
      const n = Math.min(killed[sig] || 0, pool.length);
      for (let i = 0; i < n; i++) destroyed.push(pool[i].id);
      if (pool.length) rows.push([MAP[type].label, n + ' / ' + pool.length, n > 0]);
    }
    const inf = s.marked.filter(u => u.type === 'infantry');
    if (inf.length) {
      // Each ghost is worth a third of a section, rounded against the player
      // so a near-miss does not quietly become a kill.
      let dmg = Math.floor((killed.ghost || 0) * 3.4);
      let down = 0;
      for (const u of inf) {
        const take = Math.min(u.hp, dmg);
        dmg -= take;
        FW.eval(`(() => { const u = units.find(a => a.id === ${u.id}); if (u) u.hp -= ${take}; })()`);
        if (take >= u.hp) { destroyed.push(u.id); down++; }
        if (dmg <= 0) break;
      }
      rows.push(['INFANTRY', down + ' / ' + inf.length, down > 0]);
    }

    for (const id of destroyed) {
      FW.eval(`(() => { const u = units.find(a => a.id === ${id}); if (u) u.hp = 0; })()`);
    }
    FW.eval('units = units.filter(u => u.hp > 0); draw(); updateUI();');

    document.body.classList.remove('sortie');
    busy = false;

    $('dbTitle').textContent = why === 'SECTOR CLEAR' ? 'SECTOR CLEAR' : 'OFF STATION';
    $('dbSub').textContent = why + '  ·  grid ' + s.tx + '·' + s.ty + ', ' + s.terr;
    $('dbRows').innerHTML = rows.map(r =>
      '<div class="row' + (r[2] ? ' kill' : '') + '"><b>' + r[0] + ' DESTROYED</b><span>'
      + r[1] + '</span></div>').join('')
      + '<div class="row"><b>CREDITS REMAINING</b><span>' + X(FW, 'credits') + '</span></div>';
    $('debrief').classList.add('on');

    // Frontline decides whether that ended the mission, using its own rules.
    try { FW.eval('checkWin();'); } catch (e) {}
  }

  return { boot };
})();

addEventListener('load', Bridge.boot);
