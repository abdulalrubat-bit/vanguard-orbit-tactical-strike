#!/usr/bin/env python3
"""Regenerate sw.js with the current shell list and a content-derived version.

    python3 tools/stamp-sw.py

Run after ANY change to the shipped files. VERSION is a hash of the bytes
being shipped, so it cannot be forgotten the way a hand-edited cache key can —
and a forgotten bump strands an installed player on an old build with no way
to know it, on a device you cannot reach.
"""
import hashlib, os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, '..'))

# The whole shipped game. There is no assets/ directory to walk: this build
# loads no images, no fonts and no audio files — the sector, the hostiles, the
# icons and the gunfire are all generated at runtime or at build time.
files = ['index.html', 'sector.js', 'hostiles.js', 'thermal.js', 'game.js',
         'app.webmanifest', 'icon-192.png', 'icon-512.png', 'icon-mask-512.png']

h = hashlib.sha256()
for f in files:
    h.update(f.encode())
    with open(os.path.join(ROOT, f), 'rb') as fh:
        h.update(fh.read())
version = h.hexdigest()[:12]
shell = '\n'.join(f"  '{f}'," for f in files).rstrip(',')

TEMPLATE = '''/* Vanguard Orbit, offline.
 *
 * Cache-first over the whole shell: none of it changes between deploys, and
 * the point of installing a game is a game that opens with no signal.
 *
 * VERSION is a hash of the shipped bytes, stamped by tools/stamp-sw.py. Keyed
 * by hand it is a key someone forgets to bump, and a forgotten bump strands a
 * player on an old build with no way to know it.
 */
const VERSION = '%s';
const CACHE = 'vanguardorbit-' + VERSION;

const SHELL = [
  './',
%s
];

self.addEventListener('install', e => {
  // Take over at once rather than waiting for every tab to close. A game is
  // one tab, and the alternative is an update that lands whenever.
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)));
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    // Drop every older build's cache: two copies of the shell on a phone is
    // not free, and a stale one can never be served by accident.
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== location.origin) return;   // never touch remote
  e.respondWith((async () => {
    const hit = await caches.match(req, { ignoreSearch: true });
    if (hit) return hit;
    try {
      const res = await fetch(req);
      // Caching a 404 is how a half-succeeded deploy becomes permanent.
      if (res && res.ok && res.type === 'basic') {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy));
      }
      return res;
    } catch (err) {
      if (req.mode === 'navigate') {
        const shell = await caches.match('index.html', { ignoreSearch: true });
        if (shell) return shell;
      }
      throw err;
    }
  })());
});
''' % (version, shell)

with open(os.path.join(ROOT, 'sw.js'), 'w') as f:
    f.write(TEMPLATE)
print(f'sw.js stamped {version} — {len(files) + 1} shell entries')
