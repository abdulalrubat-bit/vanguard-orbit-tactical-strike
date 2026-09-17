/* Balance harness.
 *
 *   node tools/sim.mjs            (needs playwright and a static server on 8899)
 *
 * Runs whole missions with the renderer switched off, stepping the same update
 * functions the real loop calls. Three policies bracket the design:
 *
 *   PASSIVE    nobody shoots. The convoy must die, and the convoy's own
 *              suppressive fire must not be able to clear a wave on its own —
 *              if it can, the wave is a cutscene. This is what caught the
 *              escort dealing 11 a shot at 200px and clearing wave one alone.
 *   ROOKIE     one gun, a reaction delay before a new target is engaged, and
 *              a third of its rounds thrown away. This is the floor a real
 *              first run should sit near.
 *   GUNNER     right weapon every time, no wasted rounds, heat respected.
 *
 * READ THE CEILING HONESTLY. GUNNER is omniscient: it always knows where every
 * Ghost is, and the camera is wherever it needs to be on the same frame. Those
 * two things are the actual difficulty of this game, and the harness cannot
 * model either. GUNNER finishing on full integrity therefore does NOT mean the
 * mission is too easy — it means a player who has already solved acquisition
 * wins cleanly, which is the correct ceiling. The number worth watching is the
 * gap between ROOKIE and PASSIVE.
 */
import { chromium } from 'playwright';

const URL = process.env.SIM_URL || 'http://127.0.0.1:8899/index.html';
const RUNS = +(process.env.SIM_RUNS || 8);
/* Which rungs a player plausibly owns at each rank. The ladder is climbed in
 * cost order, so this is just that order cut into seven slices — and it is the
 * only honest way to sim a career game, because simulating tier 6 with a
 * tier-0 aircraft measures nothing anybody will ever play. */
const KIT = [
  [],
  ['flir5', 'cooling'],
  ['flir5', 'cooling', 'gun40'],
  ['flir5', 'cooling', 'gun40', 'optics2', 'feed'],
  ['flir5', 'cooling', 'gun40', 'optics2', 'feed', 'he40', 'gun105'],
  ['flir5', 'cooling', 'gun40', 'optics2', 'feed', 'he40', 'gun105', 'stab', 'autotag'],
  ['flir5', 'cooling', 'gun40', 'optics2', 'feed', 'he40', 'gun105', 'stab', 'autotag',
   'prox105', 'anvil2', 'medevac']
];
const TIERS = (process.env.SIM_TIERS || '0,3,6').split(',').map(Number);
const EXE = process.env.CHROME || undefined;

const browser = await chromium.launch(EXE ? { executablePath: EXE, args: ['--no-sandbox'] } : {});
const page = await browser.newPage({ viewport: { width: 900, height: 480 } });
page.on('pageerror', e => { console.error('PAGE ERROR', e.message); process.exitCode = 1; });
await page.goto(URL, { waitUntil: 'load' });
await page.waitForTimeout(1400);

const run = (seed, policy, tier, kit) => page.evaluate(({ seed, policy, tier, kit }) => {
  Career.reset();
  for (const id of kit) Career.state().owned[id] = 1;
  startMission(seed, Career.sortie(tier));
  // Stop the real loop touching anything: it only runs while phase is 'play',
  // and the steps below own that from here.
  const realPhase = S.phase;
  let t = 0;
  const dt = 1 / 30, LIMIT = 60 * 14;          // fourteen minutes of mission
  const W2 = innerWidth, H2 = innerHeight;

  // ROOKIE's state: what it is currently shooting at, and how long until it
  // notices something better.
  let lockTarget = null, lockT = 0;

  // Only ever reaches for a station the aircraft actually has fitted.
  const ok = i => S.mod.stations[i] && !S.locked[i];
  const pickWeapon = e => {
    if (e.kind === 'phalanx') { if (ok(2)) return 2; if (ok(1)) return 1; return 0; }
    if (e.kind === 'technical') { if (ok(1)) return 1; return 0; }
    if (ok(0)) return 0;
    return ok(1) ? 1 : 0;
  };

  while (S.phase === 'play' && t < LIMIT) {
    updateCamera(dt); updateConvoy(dt); updateWave(dt); updateHostiles(dt);
    updateJamming(dt);

    if (policy !== 'passive' && S.hostiles.length) {
      const conv = atDist(S.sector.line, S.convoy.d);
      let best = null, bd = Infinity;
      for (const e of S.hostiles) {
        // Threat order, not distance order: a technical eight hundred metres
        // out arrives before a Ghost two hundred metres out.
        const k = Hostiles.KINDS[e.kind];
        const d = Math.hypot(e.x - conv.x, e.y - conv.y) / (k.speed / 30);
        if (d < bd) { bd = d; best = e; }
      }
      if (policy === 'rookie') {
        // Reaction time, and a target it will not drop the moment something
        // scarier appears. This is most of what separates a first run from a
        // tenth one, and none of it is in the balance numbers.
        lockT -= dt;
        if (!lockTarget || S.hostiles.indexOf(lockTarget) < 0 || lockT <= 0) {
          if (lockTarget !== best) { lockTarget = best; lockT = 0.8; best = null; }
          else lockT = 0.8;
        }
        if (lockTarget && S.hostiles.indexOf(lockTarget) >= 0) best = lockTarget;
      }
      if (best) {
        const wi = policy === 'rookie' ? 0 : pickWeapon(best);
        S.weapon = wi;
        S.cam.x = best.x; S.cam.y = best.y; clampCam();
        const miss = policy === 'rookie' && Math.random() < 0.33 ? 26 : 0;
        S.cross.x = toScreenX(best.x) + (Math.random() - .5) * miss * 2;
        S.cross.y = toScreenY(best.y) + (Math.random() - .5) * miss * 2;
        S.manual = true;
      } else S.manual = false;
    } else {
      S.manual = false;
    }
    fireControl(dt);
    updateRounds(dt);
    S.t += dt; t += dt;
  }
  return {
    phase: S.phase, won: S.convoy.hp > 0 && S.convoy.d >= S.sector.line.total - 1,
    hp: +S.convoy.hp.toFixed(1), wave: S.wave, kills: S.kills, waves: S.waves.length,
    shots: S.shots, acc: S.shots ? +(S.hits / S.shots * 100).toFixed(1) : 0,
    mins: +(t / 60).toFixed(1), score: S.score,
    pay: UI.payout(S.convoy.hp > 0 && S.convoy.d >= S.sector.line.total - 1).total
  };
}, { seed, policy, tier, kit });

for (const tier of TIERS) {
  console.log('\n' + '#'.repeat(66));
  console.log('# TIER ' + tier + '  \u2014  ' + (KIT[tier].length ? KIT[tier].join(', ') : 'nothing fitted but the 25mm'));
  console.log('#'.repeat(66));
  for (const policy of ['passive', 'rookie', 'gunner']) {
    const all = [];
    for (let i = 0; i < RUNS; i++) all.push(await run(20260917 + i * 131, policy, tier, KIT[tier]));
    const won = all.filter(r => r.won).length;
    const mean = k => all.reduce((s, r) => s + r[k], 0) / all.length;
    console.log('  ' + policy.padEnd(8) +
      ' won ' + String(won + '/' + all.length).padEnd(6) +
      ' integrity ' + mean('hp').toFixed(1).padStart(5) +
      '   length ' + mean('mins').toFixed(1).padStart(4) + 'min' +
      '   kills ' + mean('kills').toFixed(0).padStart(3) +
      '   acc ' + mean('acc').toFixed(0).padStart(3) + '%' +
      '   pay ' + mean('pay').toFixed(0).padStart(5));
  }
}
await browser.close();
