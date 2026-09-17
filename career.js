/* Vanguard Orbit — the career.
 *
 * What carries between sorties. A mission that ends and leaves nothing behind
 * is a score-attack arcade game; this file is the difference between that and
 * a reason to open the thing tomorrow.
 *
 * The ladder is built on one rule, borrowed from Warehouse Empire: capability
 * arrives in the order a real programme would field it, not in the order of a
 * damage spreadsheet. You do not buy "+10% damage". You get a better sensor,
 * then a second gun station, then a fuze for it. Each rung is a thing that
 * exists, and each one changes a decision rather than a number the player
 * never sees.
 *
 * The second rule is the one that makes the first rule playable:
 *
 *   THE THREAT ROSTER UNLOCKS IN STEP WITH THE LADDER.
 *
 * A Phalanx cannot be killed without splash, so a Phalanx may not appear
 * before the 40mm station is within reach. A jammer takes the automatic
 * trigger away, which means nothing until the player has come to rely on it.
 * Every hostile is introduced just after — or deliberately just before — the
 * tool that answers it. Ranking up is therefore not "the numbers got bigger";
 * it is a new problem arriving, and the means to solve it.
 *
 * Everything here lives in one localStorage key and nothing leaves the device.
 */
'use strict';

const Career = (() => {

  const KEY = 'vanguard.career';
  const SAVE_V = 1;

  /* ------------------------------------------------------------- ranks --- */

  // Gated on LIFETIME requisition, not the balance in hand, so that spending
  // never costs you a rank. A ladder that punishes you for climbing it is a
  // ladder players learn to hoard against.
  //
  // The top gate and the total cost of the ladder are the same number on
  // purpose: the last rung and the last promotion arrive together. Both were
  // doubled once tools/sim.mjs put mean sortie pay at about 1,800 REQ across
  // the tiers — at the first prices the entire ladder fell in twelve sorties,
  // which is under an hour to exhaust everything the game has to give.
  const RANKS = [
    { n: 'PROBATIONARY',      at: 0 },
    { n: 'OPERATOR',          at: 1800 },
    { n: 'SENIOR OPERATOR',   at: 4800 },
    { n: 'SECTION LEAD',      at: 10000 },
    { n: 'FLIGHT LEAD',       at: 18000 },
    { n: 'MISSION COMMANDER', at: 28000 },
    { n: 'VANGUARD ACTUAL',   at: 42000 }
  ];

  /* ------------------------------------------------------------ the ladder */

  /* `need` is a hard prerequisite and the only ordering this file enforces.
   * Cost does the rest of the pacing: a rung you could afford out of order is
   * a rung that was priced wrong, not a rung that needs another rule. */
  const RUNGS = [
    // Priced just under what a clean first sortie pays, so the very first
    // thing a player does after their first win is spend. A ladder whose
    // bottom rung is out of reach on sortie one is a ladder nobody has been
    // shown how to climb.
    { id: 'flir5', track: 'SENSOR', cost: 800, name: 'FLIR-5 SENSOR HEAD',
      blurb: 'Ghost capes stop working quite so well. Their signature sits higher and the tag reticle reaches further.' },

    { id: 'cooling', track: 'AIRFRAME', cost: 1200, name: 'BARREL LINERS',
      blurb: 'The 25mm takes longer to lock out and clears faster once it has. Longer bursts, same discipline.' },

    { id: 'gun40', track: 'ORDNANCE', cost: 1800, name: '40MM AUTOCANNON STATION',
      blurb: 'A second gun. Explosive, moderate cadence, real flight time — the answer to anything standing in a group.' },

    { id: 'optics2', track: 'SENSOR', cost: 2200, name: 'GEN-2 OPTICS',
      blurb: 'Two more detents on the zoom rail: 0.70x to find the fight, 4.50x to be sure what is in it.' },

    { id: 'feed', track: 'AIRFRAME', cost: 2600, name: 'HIGH-RATE FEED',
      blurb: 'The rotary cannon spools faster and turns faster. It also heats faster — the liners were not optional.' },

    { id: 'he40', track: 'ORDNANCE', cost: 3000, need: 'gun40', name: '40MM HE FILLING',
      blurb: 'A wider, meaner burst on the 40mm. Turns a hit near a group into a hit on a group.' },

    { id: 'gun105', track: 'ORDNANCE', cost: 4000, name: '105MM HOWITZER STATION',
      blurb: 'The third station. Fifteen hundred milliseconds of flight and a radius that covers a courtyard. The only clean answer to a Phalanx.' },

    { id: 'stab', track: 'AIRFRAME', cost: 4400, name: 'AUGMENTED STABILISATION',
      blurb: 'Dispersion down on every station. What you put the crosshair on is what the round arrives at.' },

    { id: 'autotag', track: 'SENSOR', cost: 4800, name: 'TRACK MEMORY',
      blurb: 'A tag survives three seconds after the sensor loses it. A Ghost that stops firing no longer stops existing.' },

    { id: 'prox105', track: 'ORDNANCE', cost: 5200, need: 'gun105', name: '105MM PROXIMITY FUZE',
      blurb: 'The howitzer functions above the deck instead of in it. Noticeably wider effect, and it stops burying itself in soft ground.' },

    { id: 'anvil2', track: 'SUPPORT', cost: 5600, name: 'ANVIL WEAPONS UPGRADE',
      blurb: 'The ground element shoots back harder and further. It still cannot save itself from a wave.' },

    { id: 'medevac', track: 'SUPPORT', cost: 6000, name: 'FIELD MEDICAL TEAM',
      blurb: 'ANVIL recovers integrity slowly while it is moving between phase lines. Nothing recovers under contact.' }
  ];

  const TRACKS = ['SENSOR', 'ORDNANCE', 'AIRFRAME', 'SUPPORT'];

  /* ------------------------------------------------------------- state --- */

  let S2 = null;

  function blank() {
    return { v: SAVE_V, req: 0, lifetime: 0, owned: {}, sorties: 0, bestScore: 0, bestReq: 0 };
  }

  function load() {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY) || 'null');
      // A save from a version this build does not understand is discarded
      // rather than guessed at. Guessing is how a player ends up owning a gun
      // station that no longer exists and cannot select any weapon at all.
      S2 = (raw && raw.v === SAVE_V) ? Object.assign(blank(), raw) : blank();
      if (!S2.owned || typeof S2.owned !== 'object') S2.owned = {};
    } catch (e) { S2 = blank(); }
    return S2;
  }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(S2)); } catch (e) {}
  }

  const state = () => S2 || load();
  const has = id => !!state().owned[id];
  const rankIndex = () => {
    const l = state().lifetime;
    let i = 0;
    for (let k = 0; k < RANKS.length; k++) if (l >= RANKS[k].at) i = k;
    return i;
  };
  const rank = () => RANKS[rankIndex()];
  const nextRank = () => RANKS[rankIndex() + 1] || null;

  function canBuy(r) {
    if (has(r.id)) return false;
    if (r.need && !has(r.need)) return false;
    return state().req >= r.cost;
  }
  function locked(r) { return !!(r.need && !has(r.need)); }

  function buy(id) {
    const r = RUNGS.find(x => x.id === id);
    if (!r || !canBuy(r)) return false;
    S2.req -= r.cost; S2.owned[id] = 1; save();
    return true;
  }

  function award(req) {
    S2.req += req; S2.lifetime += req; S2.sorties++;
    if (req > S2.bestReq) S2.bestReq = req;
    save();
  }

  function recordScore(n) { if (n > state().bestScore) { S2.bestScore = n; save(); } }

  /* --------------------------------------------------------- modifiers --- */

  /* One object, rebuilt whenever the ladder changes, read everywhere. The
   * alternative — `Career.has('cooling') ? x : y` scattered through the fire
   * control — is how two rungs end up silently cancelling each other out. */
  function mods() {
    const m = {
      ghostLum: has('flir5') ? 16 : 0,
      tagRadius: has('flir5') ? 290 : 190,
      tagHold: has('autotag') ? 3.0 : 0,
      zooms: has('optics2') ? [0.70, 1.0, 1.75, 3.0, 4.5] : [1.0, 1.75, 3.0],
      heatPerShot: has('cooling') ? 0.74 : 1,
      coolRate: has('cooling') ? 1.35 : 1,
      rof25: has('feed') ? 1.28 : 1,
      spool25: has('feed') ? 0.68 : 1,
      heat25: has('feed') ? 1.18 : 1,          // the feed's own cost, paid in heat
      spread: has('stab') ? 0.55 : 1,
      splash40: has('he40') ? 1.34 : 1,
      splashDmg40: has('he40') ? 1.30 : 1,
      splash105: has('prox105') ? 1.28 : 1,
      convoyDmg: has('anvil2') ? 1.9 : 1,
      convoyRange: has('anvil2') ? 1.45 : 1,
      regen: has('medevac') ? 1.6 : 0          // integrity per second, moving only
    };
    // Station ownership. The 25mm is the aircraft's own gun and is never a
    // rung — a sortie with no weapon at all is not a sortie.
    m.stations = [true, has('gun40'), has('gun105')];
    return m;
  }

  /* ------------------------------------------------------------- tiers --- */

  /* Which hostiles this rank is allowed to meet. Read it top to bottom: it is
   * the design document for the whole difficulty curve, and it is four lines.
   *
   * The Phalanx sits at tier 3 and the 40mm station costs 900 — which a player
   * reaches around tier 2. That gap is deliberate. You meet the drum for the
   * first time with a gun that can just about handle it and a better answer
   * already on the shelf. */
  function roster(tier) {
    const r = ['ghost'];
    if (tier >= 1) r.push('technical');
    if (tier >= 2) r.push('jammer');
    if (tier >= 3) r.push('phalanx');
    return r;
  }

  // Sortie shape. Six phase lines at the bottom, ten at the top; hostile
  // health creeps rather than leaps, because the interesting escalation is
  // the roster and not the bullet sponge.
  function sortie(tier) {
    return {
      tier,
      waves: Math.min(10, 6 + tier),
      hp: 1 + tier * 0.09,
      density: 1 + tier * 0.13,
      pay: 1 + tier * 0.16,
      roster: roster(tier)
    };
  }

  return {
    RANKS, RUNGS, TRACKS,
    load, save, state, has, buy, award, canBuy, locked, recordScore,
    rank, rankIndex, nextRank, mods, sortie,
    reset() { S2 = blank(); save(); }
  };
})();
