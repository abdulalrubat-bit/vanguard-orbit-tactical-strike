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
const EXE = process.env.CHROME || undefined;

const browser = await chromium.launch(EXE ? { executablePath: EXE, args: ['--no-sandbox'] } : {});
const page = await browser.newPage({ viewport: { width: 900, height: 480 } });
page.on('pageerror', e => { console.error('PAGE ERROR', e.message); process.exitCode = 1; });
await page.goto(URL, { waitUntil: 'load' });
await page.waitForTimeout(1400);

const run = (seed, policy) => page.evaluate(({ seed, policy }) => {
  startMission(seed);
  // Stop the real loop touching anything: it only runs while phase is 'play',
  // and the steps below own that from here.
  const realPhase = S.phase;
  let t = 0;
  const dt = 1 / 30, LIMIT = 60 * 14;          // fourteen minutes of mission
  const W2 = innerWidth, H2 = innerHeight;

  // ROOKIE's state: what it is currently shooting at, and how long until it
  // notices something better.
  let lockTarget = null, lockT = 0;

  const pickWeapon = e => {
    if (e.kind === 'phalanx') return S.locked[2] ? 1 : 2;
    if (e.kind === 'technical') return S.locked[1] ? 0 : 1;
    return S.locked[0] ? 1 : 0;
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
    hp: +S.convoy.hp.toFixed(1), wave: S.wave, kills: S.kills,
    shots: S.shots, acc: S.shots ? +(S.hits / S.shots * 100).toFixed(1) : 0,
    mins: +(t / 60).toFixed(1), score: S.score
  };
}, { seed, policy });

const fmt = r => `wave ${String(r.wave).padStart(2)}  hp ${String(r.hp).padStart(5)}  ` +
  `kills ${String(r.kills).padStart(3)}  shots ${String(r.shots).padStart(5)}  ` +
  `acc ${String(r.acc).padStart(5)}%  ${String(r.mins).padStart(4)}min  ` +
  (r.won ? 'WON ' : 'LOST') + `  score ${r.score}`;

for (const policy of ['passive', 'rookie', 'gunner']) {
  console.log('\n== ' + policy.toUpperCase() + ' ' + '='.repeat(56));
  const all = [];
  for (let i = 0; i < RUNS; i++) {
    const r = await run(20260917 + i * 131, policy);
    all.push(r);
    console.log('  seed ' + (20260917 + i * 131) + '  ' + fmt(r));
  }
  const won = all.filter(r => r.won).length;
  const avgHp = (all.reduce((s, r) => s + r.hp, 0) / all.length).toFixed(1);
  const avgMin = (all.reduce((s, r) => s + r.mins, 0) / all.length).toFixed(1);
  console.log(`  -> won ${won}/${all.length}   mean integrity ${avgHp}   mean length ${avgMin}min`);
}
await browser.close();
