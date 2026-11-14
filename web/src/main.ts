import './styles.css';
import { loadAll } from './data';
import { app } from './app';
import { state, onChange, emit } from './state';
import { initPlanner, renderPlanner, plannerMap } from './ui/planner';
import { initTablet, draw as drawTablet } from './ui/tablet';
import { startDemo } from './ui/demo';
import { openSources } from './ui/sources';
import { $, openModal, esc } from './ui/dom';
import type { AreaId } from './core/geo';

let view: 'planner' | 'tablet' = 'planner';
export function setView(v: 'planner' | 'tablet') {
  view = v; $('#plannerView').hidden = v !== 'planner'; $('#tabletView').hidden = v !== 'tablet';
  $('#plannerView').style.display = v === 'planner' ? 'flex' : 'none'; $('#tabletView').style.display = v === 'tablet' ? 'grid' : 'none';
  document.querySelectorAll<HTMLButtonElement>('#viewSel button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.view === v)));
  if (v === 'planner') setTimeout(() => plannerMap().invalidateSize(), 50); else setTimeout(drawTablet, 30);
}

function syncArea() { document.querySelectorAll<HTMLButtonElement>('#areaSel button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.area === state.area))); }

async function boot() {
  $('#panel').innerHTML = '<div class="note">Loading evidence bundles…</div>';
  try { app.b = await loadAll(); } catch (e) { $('#panel').innerHTML = `<div class="badbox">Could not load data bundles: ${esc(e)}</div>`; return; }
  initPlanner(); initTablet();
  onChange((_s, why) => { syncArea(); renderPlanner(why); if (view === 'tablet') drawTablet(); });
  document.querySelectorAll<HTMLButtonElement>('#areaSel button').forEach((b) => b.onclick = () => { state.area = b.dataset.area as AreaId; emit('area'); });
  document.querySelectorAll<HTMLButtonElement>('#viewSel button').forEach((b) => b.onclick = () => setView(b.dataset.view as any));
  $('#demoBtn').onclick = () => openModal(`<h2>Guided demos</h2><p>Step-by-step walkthroughs. You can go back, restart or exit at any time.</p>
     <div class="row"><button class="primary" id="dN">Nili Patera: changed ground on the route</button><button id="dJ">Jezero Crater: science walk</button></div>`);
  document.addEventListener('click', (e) => { const t = e.target as HTMLElement; if (t.id === 'dN' || t.id === 'dJ') { $('#modal').hidden = true; startDemo(t.id === 'dN' ? 'nili' : 'jezero'); } });
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
  btn.onclick = () => { hidden = !hidden; apply(); if (view !== 'planner') setView('planner'); };
  apply();
}

function netState() {
  const el = $('#netState');
  const upd = () => { const off = !navigator.onLine; el.textContent = off ? 'OFFLINE · cached data' : navigator.serviceWorker?.controller ? '✓ Works offline' : 'Online'; el.classList.toggle('off', off); };
  window.addEventListener('online', upd); window.addEventListener('offline', upd);
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('./sw.js').then(() => navigator.serviceWorker.ready).then(upd).catch(() => upd());
    navigator.serviceWorker.addEventListener('controllerchange', upd);
  }
  upd();
}

boot();
