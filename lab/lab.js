/* UI lab — the shell.
 *
 * Holds the device frame at TRUE pixel size and scales the whole thing to fit
 * the window with a CSS transform, rather than resizing the canvases to
 * whatever space is going. That matters more than it sounds: a 62px stick ring
 * judged at 0.7 scale is a 43px stick ring, and half the point of this page is
 * telling whether a control is big enough for a thumb.
 */
'use strict';

const Lab = (() => {

  const SIZES = [
    { id: 'phone', name: 'PHONE', w: 740, h: 360 },
    { id: 'tablet', name: 'TABLET', w: 1024, h: 560 },
    { id: 'desktop', name: 'DESKTOP', w: 1280, h: 680 }
  ];

  let theme = Themes.list[0], size = SIZES[0], screen = 'combat';
  let world, wg, hud, hg, t0 = 0;

  /* The requisition shelf, mocked in three states, because a list where
   * everything is affordable tells you nothing about how the design handles
   * the two states a player actually spends most of their time looking at. */
  const RUNGS = [
    ['owned', 'FLIR-5 SENSOR HEAD', 'FITTED',
     'Ghost capes stop working quite so well. Their signature sits higher and the tag reticle reaches further.'],
    ['can', '40MM AUTOCANNON STATION', '1800 REQ',
     'A second gun. Explosive, moderate cadence, real flight time — the answer to anything standing in a group.'],
    ['', 'GEN-2 OPTICS', '2200 REQ',
     'Two more detents on the zoom rail: 0.70x to find the fight, 4.50x to be sure what is in it.'],
    ['lock', '40MM HE FILLING', 'NEEDS 40MM AUTOCANNON STATION',
     'A wider, meaner burst on the 40mm. Turns a hit near a group into a hit on a group.']
  ];

  function menuHTML(M) {
    return '<div class="mock">' +
      '<div class="title">VANGUARD ORBIT</div>' +
      '<div class="sub">TACTICAL STRIKE · SECTOR LIBERATION</div>' +
      '<div class="rankRow"><span>' + M.rank + '</span><span>' + M.req + ' REQ</span></div>' +
      '<div class="track"><i></i></div>' +
      '<div class="to">' + (M.nextAt - M.lifetime) + ' TO ' + M.nextRank +
        '  ·  SORTIES ' + M.sorties + '</div>' +
      RUNGS.map(r =>
        '<div class="rung ' + r[0] + '"><span class="rn">' + r[1] + '</span>' +
        '<span class="rc">' + r[2] + '</span><span class="rb">' + r[3] + '</span></div>').join('') +
      '<div class="btns"><button>GO ON STATION</button>' +
      '<button>REQUISITION</button><button>AUDIO ON</button></div>' +
      '</div>';
  }

  /* ---------------------------------------------------------------- ui --- */

  function chrome() {
    const tabs = document.getElementById('tabs');
    Themes.list.forEach((th, i) => {
      const b = document.createElement('button');
      b.className = 'tab';
      b.innerHTML = '<i style="background:' + th.accent + '"></i>' + th.name;
      b.onclick = () => setTheme(th);
      b.dataset.id = th.id;
      tabs.appendChild(b);
    });
    const sz = document.getElementById('sizes');
    SIZES.forEach(s => {
      const b = document.createElement('button');
      b.textContent = s.name; b.dataset.id = s.id;
      b.onclick = () => setSize(s);
      sz.appendChild(b);
    });
    const sc = document.getElementById('screens');
    [['combat', 'COMBAT'], ['hub', 'HUB']].forEach(([id, n]) => {
      const b = document.createElement('button');
      b.textContent = n; b.dataset.id = id;
      b.onclick = () => setScreen(id);
      sc.appendChild(b);
    });
  }

  function mark() {
    for (const b of document.querySelectorAll('#tabs button'))
      b.classList.toggle('on', b.dataset.id === theme.id);
    for (const b of document.querySelectorAll('#sizes button'))
      b.classList.toggle('on', b.dataset.id === size.id);
    for (const b of document.querySelectorAll('#screens button'))
      b.classList.toggle('on', b.dataset.id === screen);
  }

  function setTheme(th) {
    theme = th;
    document.getElementById('frame').dataset.theme = th.id;
    document.getElementById('nName').textContent = th.name;
    document.getElementById('nTag').textContent = th.tagline;
    document.getElementById('notes').innerHTML = th.notes.map(n =>
      '<div class="note"><b>' + n[0] + '</b><span>' + n[1] + '</span></div>').join('');
    mark();
  }

  function setSize(s) { size = s; layout(); mark(); }

  function setScreen(id) {
    screen = id;
    const ml = document.getElementById('menuLayer');
    ml.classList.toggle('show', id === 'hub');
    ml.innerHTML = id === 'hub' ? menuHTML(Scene.MOCK) : '';
    mark();
  }

  /* Fit the frame to the stage by scaling, never by resizing. Capped at 1 so a
   * phone frame on a big monitor is shown at life size rather than blown up
   * into a lie about how big the controls are. */
  function layout() {
    const f = document.getElementById('frame');
    f.style.width = size.w + 'px';
    f.style.height = size.h + 'px';
    const stage = document.getElementById('stage');
    const pad = 36;
    const k = Math.min(1,
      (stage.clientWidth - pad) / size.w,
      (stage.clientHeight - pad) / size.h);
    document.getElementById('frameWrap').style.transform = 'scale(' + k + ')';

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    for (const c of [world, hud]) {
      c.width = Math.round(size.w * dpr); c.height = Math.round(size.h * dpr);
      c.style.width = size.w + 'px'; c.style.height = size.h + 'px';
    }
    Thermal.init(world.width, world.height, dpr);
  }

  function frame(now) {
    requestAnimationFrame(frame);
    // Never negative: see the note in thermal.js about rAF timestamps.
    const t = Math.max(0, (now - t0) / 1000);
    Scene.frame(wg, world, size.w, size.h, t, theme);

    const dpr = hud.width / size.w;
    hg.setTransform(1, 0, 0, 1, 0, 0);
    hg.clearRect(0, 0, hud.width, hud.height);
    hg.setTransform(dpr, 0, 0, dpr, 0, 0);
    // The HUD is hidden behind the hub screen rather than skipped, so flipping
    // between the two screens costs nothing and stays instant.
    if (screen === 'combat') theme.hud(hg, size.w, size.h, t, Scene.view(), Scene.MOCK);
  }

  function boot() {
    world = document.getElementById('world'); wg = world.getContext('2d');
    hud = document.getElementById('hud'); hg = hud.getContext('2d');
    chrome();
    Scene.build();
    setTheme(Themes.list[0]);
    setScreen('combat');
    layout();
    addEventListener('resize', layout);
    addEventListener('keydown', e => {
      const n = '1234'.indexOf(e.key);
      if (n >= 0 && Themes.list[n]) setTheme(Themes.list[n]);
      if (e.code === 'Space') { e.preventDefault(); setScreen(screen === 'hub' ? 'combat' : 'hub'); }
      if (e.code === 'KeyD') setSize(SIZES[(SIZES.indexOf(size) + 1) % SIZES.length]);
    });
    t0 = performance.now();
    requestAnimationFrame(frame);
  }

  return { boot };
})();

if (document.readyState === 'loading') addEventListener('DOMContentLoaded', Lab.boot);
else Lab.boot();
