import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { $, esc } from './dom';
import { url } from '../data';
import { state, emit } from '../state';

/** Mars mean radius (IAU), km. Distances are along the surface of this sphere and ignore terrain. */
export const MARS_MEAN_R_KM = 3389.5;

export function greatCircleKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const r = Math.PI / 180, dLat = (lat2 - lat1) * r, dLon = (lon2 - lon1) * r;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2;
  return 2 * MARS_MEAN_R_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}
export function initialBearing(lat1: number, lon1: number, lat2: number, lon2: number) {
  const r = Math.PI / 180; const y = Math.sin((lon2 - lon1) * r) * Math.cos(lat2 * r);
  const x = Math.cos(lat1 * r) * Math.sin(lat2 * r) - Math.sin(lat1 * r) * Math.cos(lat2 * r) * Math.cos((lon2 - lon1) * r);
  return (Math.atan2(y, x) / r + 360) % 360;
}

/** Well-known features for orientation (IAU names, planetocentric, east-positive). */
const PLACES: { name: string; lat: number; lon: number; area?: 'jezero' | 'nili' }[] = [
  { name: 'Jezero Crater', lat: 18.45, lon: 77.41, area: 'jezero' },
  { name: 'Nili Patera', lat: 8.78, lon: 67.32, area: 'nili' },
  { name: 'Olympus Mons', lat: 18.65, lon: -133.8 },
  { name: 'Valles Marineris', lat: -13.9, lon: -59.2 },
  { name: 'Hellas Planitia', lat: -42.4, lon: 70.5 },
  { name: 'Gale Crater', lat: -5.4, lon: 137.8 },
  { name: 'Elysium Mons', lat: 25.0, lon: 147.2 },
];

const R = 1;
function vec(lat: number, lon: number, r = R) {
  const la = lat * Math.PI / 180, ph = (lon + 180) * Math.PI / 180;
  return new THREE.Vector3(-Math.cos(ph) * Math.cos(la) * r, Math.sin(la) * r, Math.sin(ph) * Math.cos(la) * r);
}
const fmt = (lat: number, lon: number) => `${Math.abs(lat).toFixed(2)}° ${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lon).toFixed(2)}° ${lon >= 0 ? 'E' : 'W'}`;

let renderer: THREE.WebGLRenderer | null = null;
let scene: THREE.Scene, camera: THREE.PerspectiveCamera, controls: OrbitControls, globe: THREE.Mesh;
let markers: THREE.Group, arc: THREE.Line | null = null;
const picks: { lat: number; lon: number }[] = [];
let labelEls: HTMLElement[] = [];
let raf = 0;
let fly: { from: THREE.Vector3; to: THREE.Vector3; t0: number; dur: number } | null = null;
let hl: THREE.Group | null = null; let hlLabel: HTMLElement | null = null; let hlPos: THREE.Vector3 | null = null;
let pending: (() => void) | null = null;

/** Smoothly turn the globe so (lat, lon) faces the viewer. alt = camera distance in globe radii. */
export function flyTo(lat: number, lon: number, alt = 2.4, dur = 1600) {
  if (!renderer) { pending = () => flyTo(lat, lon, alt, dur); return; }
  fly = { from: camera.position.clone(), to: vec(lat, lon, alt), t0: performance.now(), dur };
}
/** Pulsing ring + caption at a place. */
export function highlight(lat: number, lon: number, label: string, radiusDeg = 4) {
  if (!renderer) { pending = () => highlight(lat, lon, label, radiusDeg); return; }
  clearHighlight();
  hl = new THREE.Group();
  const n = vec(lat, lon).normalize(); const ringR = Math.sin(radiusDeg * Math.PI / 180);
  const ring = new THREE.Mesh(new THREE.RingGeometry(ringR * 0.86, ringR, 64), new THREE.MeshBasicMaterial({ color: 0xffc94d, transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthTest: false }));
  ring.position.copy(n.clone().multiplyScalar(R * Math.cos(radiusDeg * Math.PI / 180) + 0.004)); ring.lookAt(n.clone().multiplyScalar(5)); hl.add(ring);
  scene.add(hl); hlPos = vec(lat, lon, R * 1.01);
  hlLabel = document.createElement('div'); hlLabel.className = 'gHl'; hlLabel.textContent = label; $('#globeLabels').appendChild(hlLabel);
}
export function clearHighlight() { if (hl) scene.remove(hl); hl = null; hlLabel?.remove(); hlLabel = null; hlPos = null; }
export function clearPoints() { picks.length = 0; if (renderer) { drawPicks(); card(); } }

export function initGlobe() {
  const el = $('#globeView');
  el.innerHTML = `<div class="globeWrap"><canvas id="globeCanvas"></canvas><div id="globeLabels"></div>
    <div class="globeCard" id="globeCard"></div><div class="globeHint">Drag to turn · scroll or pinch to zoom · tap the surface to drop a point</div></div>`;
}

function setup() {
  const cv = $('#globeCanvas') as HTMLCanvasElement;
  try { renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true }); } catch {
    $('#globeCard').innerHTML = '<div class="badbox">3D view needs WebGL, which this browser does not provide.</div>'; return false;
  }
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  scene = new THREE.Scene(); scene.background = new THREE.Color('#05060a');
  camera = new THREE.PerspectiveCamera(40, 1, 0.01, 100);
  const start = vec(15, 72, 3.4); camera.position.copy(start);
  controls = new OrbitControls(camera, cv); controls.enableDamping = true; controls.enablePan = false; controls.minDistance = 1.25; controls.maxDistance = 6; controls.rotateSpeed = 0.5;
  const tex = new THREE.TextureLoader().load(url('globe/mars_viking_color_4k.jpg'));
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  globe = new THREE.Mesh(new THREE.SphereGeometry(R, 128, 64), new THREE.MeshStandardMaterial({ map: tex, roughness: 1, metalness: 0 }));
  scene.add(globe);
  scene.add(new THREE.AmbientLight(0xffffff, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 1.4); sun.position.set(3, 2, 4); camera.add(sun); scene.add(camera);
  markers = new THREE.Group(); scene.add(markers);
  // fixed place markers
  const lab = $('#globeLabels'); lab.innerHTML = '';
  labelEls = PLACES.map((p) => {
    const d = document.createElement(p.area ? 'button' : 'div'); d.className = `gLabel ${p.area ? 'area' : ''}`; d.textContent = p.name;
    if (p.area) (d as HTMLButtonElement).onclick = (e) => { e.stopPropagation(); state.area = p.area!; emit('area'); (window as any).__setView?.('planner'); };
    lab.appendChild(d);
    const dot = new THREE.Mesh(new THREE.SphereGeometry(p.area ? 0.006 : 0.004, 12, 8), new THREE.MeshBasicMaterial({ color: p.area ? 0xff8a3d : 0xffffff }));
    dot.position.copy(vec(p.lat, p.lon, R * 1.001)); scene.add(dot);
    return d;
  });
  // picking: a click that is not a drag
  let down: [number, number] | null = null;
  cv.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; });
  cv.addEventListener('pointerup', (e) => {
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 6) { down = null; return; }
    down = null; pickAt(e.clientX, e.clientY);
  });
  new ResizeObserver(resize).observe(cv.parentElement!); resize();
  return true;
}

function resize() {
  if (!renderer) return; const w = renderer.domElement.parentElement!.clientWidth, h = renderer.domElement.parentElement!.clientHeight;
  if (!w || !h) return; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
}

export function pickAt(clientX: number, clientY: number) {
  const r = renderer!.domElement.getBoundingClientRect();
  const ray = new THREE.Raycaster(); ray.setFromCamera(new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1), camera);
  const hit = ray.intersectObject(globe)[0]; if (!hit || !hit.uv) return;
  addPoint(hit.uv.y * 180 - 90, hit.uv.x * 360 - 180);
}

export function addPoint(lat: number, lon: number) {
  if (picks.length >= 2) picks.length = 0;
  picks.push({ lat, lon }); drawPicks(); card();
}

function drawPicks() {
  markers.clear(); if (arc) { scene.remove(arc); arc = null; }
  picks.forEach((p, i) => { const m = new THREE.Mesh(new THREE.SphereGeometry(0.008, 16, 10), new THREE.MeshBasicMaterial({ color: i ? 0x5ec8ff : 0x5fd38d })); m.position.copy(vec(p.lat, p.lon, R * 1.002)); markers.add(m); });
  if (picks.length === 2) {
    const a = vec(picks[0].lat, picks[0].lon).normalize(), b = vec(picks[1].lat, picks[1].lon).normalize();
    const ang = a.angleTo(b); const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 128; i++) { const t = i / 128; const s = Math.sin(ang) || 1; const v = a.clone().multiplyScalar(Math.sin((1 - t) * ang) / s).add(b.clone().multiplyScalar(Math.sin(t * ang) / s)); pts.push(v.normalize().multiplyScalar(R * (1.004 + 0.06 * Math.sin(Math.PI * t) * Math.min(1, ang)))); }
    arc = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xffc94d })); scene.add(arc);
  }
}

function card() {
  const c = $('#globeCard');
  const row = (i: number) => picks[i] ? `<dt><span class="gDot" style="background:${i ? '#5ec8ff' : '#5fd38d'}"></span>Point ${i ? 'B' : 'A'}</dt><dd>${fmt(picks[i].lat, picks[i].lon)}</dd>` : `<dt><span class="gDot" style="background:${i ? '#5ec8ff' : '#5fd38d'}"></span>Point ${i ? 'B' : 'A'}</dt><dd><small>tap the globe</small></dd>`;
  let res = '';
  if (picks.length === 2) {
    const [p, q] = picks; const km = greatCircleKm(p.lat, p.lon, q.lat, q.lon);
    res = `<div class="gDist"><small>Distance over the surface</small><b id="globeDist">${km >= 100 ? km.toFixed(0) : km.toFixed(1)} km</b><small>Heading from A: ${initialBearing(p.lat, p.lon, q.lat, q.lon).toFixed(0)}° · ${(km / (2 * Math.PI * MARS_MEAN_R_KM) * 100).toFixed(1)}% of the way around Mars</small></div>`;
  }
  c.innerHTML = `<h3>Measure distance</h3><dl class="kv">${row(0)}${row(1)}</dl>${res}
    <div class="row"><button id="globeClear">Clear points</button></div>
    <div class="note">Shortest path over a sphere of radius ${MARS_MEAN_R_KM.toLocaleString()} km (Mars mean radius); hills and craters are ignored. Image: Viking colour mosaic, NASA/USGS via NASA Mars Trek.</div>
    <div class="note">Tap <b style="color:var(--accent)">Jezero Crater</b> or <b style="color:var(--accent)">Nili Patera</b> to open that site in the planner.</div>`;
  $('#globeClear').onclick = () => { picks.length = 0; drawPicks(); card(); };
}

function loop() {
  raf = requestAnimationFrame(loop);
  if (fly) { const t = Math.min(1, (performance.now() - fly.t0) / fly.dur); const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
    const a = fly.from.clone().normalize(), b = fly.to.clone().normalize(); const ang = a.angleTo(b); const sn = Math.sin(ang) || 1;
    const dir = ang < 1e-4 ? b : a.multiplyScalar(Math.sin((1 - e) * ang) / sn).add(b.multiplyScalar(Math.sin(e * ang) / sn));
    camera.position.copy(dir.normalize().multiplyScalar(fly.from.length() + (fly.to.length() - fly.from.length()) * e)); camera.lookAt(0, 0, 0); if (t >= 1) fly = null; }
  if (hl) { const k = 1 + 0.12 * Math.sin(performance.now() / 300); hl.children[0].scale.setScalar(k); }
  controls.update(); renderer!.render(scene, camera);
  if (hlLabel && hlPos) { const r0 = renderer!.domElement.getBoundingClientRect(); const vis = hlPos.clone().normalize().dot(camera.position.clone().normalize()) > 0.1; hlLabel.style.display = vis ? '' : 'none'; const s0 = hlPos.clone().project(camera); hlLabel.style.left = `${(s0.x + 1) / 2 * r0.width}px`; hlLabel.style.top = `${(1 - s0.y) / 2 * r0.height}px`; }
  const r = renderer!.domElement.getBoundingClientRect(); const camDir = camera.position.clone().normalize();
  PLACES.forEach((p, i) => {
    const v = vec(p.lat, p.lon); const el = labelEls[i]; const vis = v.clone().normalize().dot(camDir) > 0.15 && !(hlLabel && hlLabel.textContent === p.name);
    if (!vis) { el.style.display = 'none'; return; }
    const s = v.clone().project(camera); el.style.display = ''; el.style.left = `${(s.x + 1) / 2 * r.width}px`; el.style.top = `${(1 - s.y) / 2 * r.height}px`;
  });
}

export function showGlobe(on: boolean) {
  if (on) { if (!renderer && !setup()) return; resize(); card(); cancelAnimationFrame(raf); loop(); if (pending) { const f = pending; pending = null; f(); } }
  else cancelAnimationFrame(raf);
}

export const globeTestHooks = { addPoint, picks, esc };
