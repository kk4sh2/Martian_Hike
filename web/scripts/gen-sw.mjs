// Generates dist/sw.js with a precache list of every built file (app shell + evidence bundles).
import { readdirSync, statSync, writeFileSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createHash } from 'node:crypto';
const dist = new URL('../dist/', import.meta.url).pathname;
const files = [];
(function walk(d) { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (!p.endsWith('sw.js')) files.push(relative(dist, p)); } })(dist);
const h = createHash('sha256'); for (const f of files.sort()) h.update(f).update(readFileSync(join(dist, f)));
const version = h.digest('hex').slice(0, 12);
const list = ['./', ...files.map((f) => './' + f.split('\\').join('/'))];
writeFileSync(join(dist, 'sw.js'), `// MarsDelta offline cache, generated at build
const CACHE = 'marsdelta-${version}';
const PRECACHE = ${JSON.stringify(list)};
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((r) => r || fetch(e.request).then((resp) => { const cp = resp.clone(); if (resp.ok && new URL(e.request.url).origin === location.origin) caches.open(CACHE).then((c) => c.put(e.request, cp)); return resp; })));
});
`);
const bytes = files.reduce((s, f) => s + statSync(join(dist, f)).size, 0);
console.log(`sw.js: ${list.length} files precached, ${(bytes / 1e6).toFixed(1)} MB, cache ${version}`);
