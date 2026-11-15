import './styles.css';
import { loadAll } from './data';
import { app } from './app';
import { state, onChange, emit } from './state';
import { initPlanner, renderPlanner, plannerMap } from './ui/planner';
import { initTablet, draw as drawTablet } from './ui/tablet';
import { startDemo } from './ui/demo';
import { openSources } from './ui/sources';
import { initGlobe, showGlobe } from './ui/globe';
import { $, openModal, esc } from './ui/dom';
import type { AreaId } from './core/geo';

type View = 'planner' | 'tablet' | 'globe';
let view: View = 'planner';
export function setView(v: View) {
  view = v;
  for (const [id, disp] of [['plannerView', 'flex'], ['tabletView', 'grid'], ['globeView', 'block']] as const) {
    const on = id === `${v}View`; $(`#${id}`).hidden = !on; $(`#${id}`).style.display = on ? disp : 'none';
  }
  document.querySelectorAll<HTMLButtonElement>('#viewSel button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.view === v)));
  $('#panelBtn').hidden = v !== 'planner';
  showGlobe(v === 'globe');
  if (v === 'planner') setTimeout(() => plannerMap().invalidateSize(), 50); else if (v === 'tablet') setTimeout(drawTablet, 30);
}
(window as any).__setView = setView;

function syncArea() { document.querySelectorAll<HTMLButtonElement>('#areaSel button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.area === state.area))); }

async function boot() {
  $('#panel').innerHTML = '<div class="note">Loading evidence bundles…</div>';
  try { app.b = await loadAll(); } catch (e) { $('#panel').innerHTML = `<div class="badbox">Could not load data bundles: ${esc(e)}</div>`; return; }
  initPlanner(); initTablet(); initGlobe();
  onChange((_s, why) => { syncArea(); renderPlanner(why); if (view === 'tablet') drawTablet(); });
  document.querySelectorAll<HTMLButtonElement>('#areaSel button').forEach((b) => b.onclick = () => { state.area = b.dataset.area as AreaId; emit('area'); });
  document.querySelectorAll<HTMLButtonElement>('#viewSel button').forEach((b) => b.onclick = () => setView(b.dataset.view as any));
  $('#demoBtn').onclick = () => openModal(`<h2>Guided demos</h2><p>Short walkthroughs in plain language. Press Next to move on; you can go back or exit at any time.</p>
     <div class="demoChoices">
       <button class="primary" id="dT">🌍 Tour of Mars<small>Spin the globe and visit famous places, then measure the distance between our two sites. About 2 minutes.</small></button>
       <button id="dN">🏜 Nili Patera: the ground moved<small>Two photos taken months apart show moving sand. See how MarsDelta warns a walking astronaut.</small></button>
       <button id="dJ">🪨 Jezero Crater: a science walk<small>Plan a walk to real rover stops, check oxygen and weather, and handle crew problems.</small></button>
     </div>`);
  document.addEventListener('click', (e) => { const t = (e.target as HTMLElement).closest('button'); if (t && (t.id === 'dN' || t.id === 'dJ' || t.id === 'dT')) { $('#modal').hidden = true; startDemo(t.id === 'dN' ? 'nili' : t.id === 'dJ' ? 'jezero' : 'tour'); } });
  $('#sourcesBtn').onclick = () => openSources();
  panelToggle();
  syncArea(); setView('planner'); renderPlanner('area');
  netState();
}

function panelToggle() {
  const btn = $('#panelBtn'); let hidden = false;
  try { hidden = localStorage.getItem('marsdelta.panelHidden') === '1'; } catch { /* storage unavailable */ }
  const apply = () => {
    $('#plannerView').classList.toggle('noPanel', hidden);
    btn.textContent = hidden ? 'Show panel' : 'Hide panel'; btn.setAttribute('aria-pressed', String(hidden));
    try { localStorage.setItem('marsdelta.panelHidden', hidden ? '1' : '0'); } catch { /* ignore */ }
    setTimeout(() => plannerMap().invalidateSize(), 60);
  };
  btn.onclick = () => { hidden = !hidden; apply(); };
  apply();
}

function netState() {
  const el = $('#netState');
  const upd = () => { const off = !navigator.onLine; el.textContent = off ? 'OFFLINE · cached data' : navigator.serviceWorker?.controller ? '✓ Works offline' : 'Online'; el.classList.toggle('off', off); };
  window.addEventListener('online', upd); window.addEventListener('offline', upd);
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    // When a newer version is deployed, the new service worker takes over and the page reloads once onto it.
    const hadController = !!navigator.serviceWorker.controller;
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      upd();
      if (hadController && !reloaded) { reloaded = true; location.reload(); }
    });
    navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' })
      .then((reg) => { reg.update().catch(() => {}); return navigator.serviceWorker.ready; }).then(upd).catch(() => upd());
  }
  upd();
}

boot();
