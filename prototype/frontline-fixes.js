/* Modern Frontline — the five missing functions.
 *
 * `screenToWorld`, `centerCameraOn`, `targetValue`, `bestObjectiveFor` and
 * `bestMoveToward` are called by www/index.html and defined nowhere in it.
 * Without them the game cannot be played at all: every tap on the map throws,
 * so no unit can be selected or moved, and ending a turn throws inside
 * enemyTurn, which leaves phase stuck on "enemy" and enemyBusy stuck true.
 *
 * Drop this file next to index.html and add ONE line at the very end of the
 * body, after the existing inline script:
 *
 *     <script src="frontline-fixes.js"></script>
 *
 * A later classic script can see the earlier script's top-level `let`/`const`
 * bindings — they live in the same global lexical environment — so these can
 * reach canvas, tile, cameraX, units, points and the rest without any change
 * to the original file.
 *
 * These are reconstructions written to the contracts the call sites imply,
 * not recovered originals. Judge them and replace them; do not inherit them.
 */
'use strict';

/* ---------------------------------------------------------------------
   PROTOTYPE FIXES, part two: the enemy AI.

   enemyTurn() calls bestObjectiveFor, bestMoveToward and targetValue. None
   of the three exists in the file, so ending your turn throws, `phase`
   stays "enemy" and `enemyBusy` stays true — which means the player can
   never act again. Together with the missing screenToWorld below, the game
   cannot currently be played at all.

   These are reconstructions written to the contracts the call sites imply,
   not recovered originals. They are deliberately simple and readable so
   they can be judged and replaced rather than inherited.
   --------------------------------------------------------------------- */

/* Higher is a better thing to shoot. Sorted descending at all four call
   sites. A kill is worth far more than chip damage, and artillery is worth
   removing early because it is the only unit that outranges everything. */
function targetValue(attacker, target){
  const dmg = (attacker.vs && attacker.vs[target.type]) || attacker.damage || 1;
  const kills = dmg >= target.hp ? 40 : 0;
  const soft  = target.type === 'artillery' ? 8 : target.type === 'recon' ? 4 : 0;
  return kills + dmg * 4 + soft - target.hp;
}

/* What this unit is walking towards: the nearest objective it does not
   already hold, and failing that the nearest enemy. Artillery hangs back
   one step behind, because walking a range-4 gun onto a control point is
   how it dies. */
function bestObjectiveFor(unit){
  const wanted = points.filter(p => p.owner !== unit.faction);
  const pool = wanted.length ? wanted : points;
  let best = null, bd = Infinity;
  for (const p of pool){
    const d = Math.abs(p.x - unit.x) + Math.abs(p.y - unit.y);
    if (d < bd){ bd = d; best = p; }
  }
  if (!best){
    const foes = units.filter(u => u.hp > 0 && u.faction !== unit.faction);
    if (!foes.length) return null;
    best = foes.reduce((a, b) => distance(unit, a) < distance(unit, b) ? a : b);
  }
  return best;
}

/* One step, not a path. The caller checks movementCost itself and loops, so
   this only has to answer "which neighbour gets me closer", breaking ties
   towards cheaper ground. Greedy and therefore capable of walking into a
   dead end — acceptable on a 24x24 map with this much open terrain, and the
   honest place to put A* later. */
function bestMoveToward(unit, goal){
  if (!goal) return null;
  const here = Math.abs(goal.x - unit.x) + Math.abs(goal.y - unit.y);
  const opts = [
    { x: unit.x + 1, y: unit.y }, { x: unit.x - 1, y: unit.y },
    { x: unit.x, y: unit.y + 1 }, { x: unit.x, y: unit.y - 1 }
  ].filter(p => inBounds(p.x, p.y) && !unitAt(p.x, p.y));
  let best = null, bd = here + 0.001;
  for (const p of opts){
    const score = Math.abs(goal.x - p.x) + Math.abs(goal.y - p.y)
                + movementCost(unit, p.x, p.y) * 0.1;
    if (score < bd){ bd = score; best = p; }
  }
  return best;
}

/* Put the selected unit in the middle of the window. */
function centerCameraOn(unit){
  const v = visibleTiles();
  cameraX = unit.x - v / 2 + 0.5;
  cameraY = unit.y - v / 2 + 0.5;
  clampCamera();
}

/* ---------------------------------------------------------------------
   PROTOTYPE FIX. This function is called on line ~883 and was defined
   nowhere in the file, so every tap on the map threw
   "screenToWorld is not defined" and no unit could ever be selected or
   moved. The game does not currently start.

   The inverse of draw()'s transform: draw() does
       ctx.translate(-cameraX*tile, -cameraY*tile)
   and fills each cell at (x*tile, y*tile), so a client point maps back by
   subtracting the canvas origin, dividing by the CSS-pixel tile size and
   adding the camera. `tile` is already in CSS pixels (size/VIEW_TILES*zoom
   where size is canvas.clientWidth), and getBoundingClientRect is in CSS
   pixels too, so no devicePixelRatio term belongs here.

   Added in this prototype copy only — the real fix belongs in the
   modern-frontline repository.
   --------------------------------------------------------------------- */
function screenToWorld(clientX, clientY){
  const r = canvas.getBoundingClientRect();
  return {
    x: Math.floor((clientX - r.left) / tile + cameraX),
    y: Math.floor((clientY - r.top)  / tile + cameraY)
  };
}
