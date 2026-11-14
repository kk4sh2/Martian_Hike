import { state, emit, log, resetArea } from '../state';
import { $, esc, closeModal } from './dom';
import { activePlan, app, resetCrew } from '../app';
import { openEvidence } from './evidence';
import { openPhoto } from './photo';
import { focusCrossing, crewScenario } from './planner';
import { setView } from '../main';
import { startWalk, stopTablet, setCompress } from './tablet';

interface Step { title: string; text: string; run: () => void | Promise<void> }

/** Guided walkthroughs driven by real application state (restartable). */
function niliSteps(): Step[] {
  return [
    { title: '1 · Planned Nili Patera route', text: 'The astronaut sees the planned walk (simulated) from the habitat to the north bedrock contact and back. The imagery under it is the June 2007 HiRISE observation.', run: () => {
      resetArea('nili'); resetCrew('nili'); state.area = 'nili'; state.areas.nili.routeOption = 'crossing'; state.areas.nili.observationReceived = false; emit('demo'); setView('tablet'); } },
    { title: '2 · New observation received (simulated event)', text: 'Simulated mission event: the October 13, 2007 HiRISE observation PSP_005684_1890 arrives. In reality it was acquired 105 days after the first.', run: () => {
      state.areas.nili.observationReceived = true; log('event', 'Simulated event: repeat observation PSP_005684_1890 (2007-10-13) received.', true, 'nili'); setView('planner'); emit('demo'); } },
    { title: '3 · Load the comparison', text: `MarsDelta loads its PRECOMPUTED comparison (pipeline v${app.b.nili.pipeline_version}, generated ${app.b.nili.generated.slice(0, 10)}): both HiRISE products registered on bedrock with ${app.b.nili.registration.heldout_rms_m.toFixed(2)} m held-out residual. It was not re-run in the browser.`, run: () => {
      log('system', `Loaded precomputed change evidence (${app.b.nili.summary.candidate_regions} candidate regions).`, false, 'nili'); emit('demo'); } },
    { title: '4 · Change region meets the route', text: 'A candidate change region appears and the intersecting route segment is highlighted in magenta. The banner says why the planner wants an inspection.', run: () => { focusCrossing(); emit('demo'); } },
    { title: '5 · Open the evidence', text: 'Open the notification: dates, coordinates, synchronized before/after with blink and swipe, the classification and why, NASA\'s published finding, source links and the displacement result.', run: async () => {
      const c = activePlan('nili')!.impact.crossings[0]; await openEvidence(c.regionId, c); } },
    { title: '6 · Decide', text: 'Acknowledge the crossing, or ask for a bypass. Here MarsDelta looks for one and explains why none can be offered: there is no terrain model for this crop.', run: async () => {
      const b = document.getElementById('evBypass') as HTMLButtonElement | null; b?.click(); const a = document.getElementById('evAck') as HTMLButtonElement | null; if (a && !a.disabled) a.click(); } },
    { title: '7 · Mission log', text: 'The decision is in the mission log with the finding retained. The success estimate is unchanged by the intersection itself.', run: () => {
      closeModal(); setView('planner'); const c = document.getElementById('cLog'); c?.classList.remove('collapsed'); c?.scrollIntoView({ behavior: 'smooth' }); } },
  ];
}

function jezeroSteps(): Step[] {
  return [
    { title: '1 · Jezero science walk', text: 'A separate walk at Jezero: habitat (simulated placement) to the delta-front base and a layered delta outcrop, both real Perseverance localizations, then back. Routes are computed on the USGS HiRISE DTM.', run: () => {
      resetArea('jezero'); resetCrew('jezero'); state.area = 'jezero'; emit('demo'); setView('planner'); } },
    { title: '2 · Two options, same endpoints', text: 'Compare Direct and Gentle: both include the return leg. The table names the leg that explains the difference.', run: () => { document.getElementById('cRoutes')?.scrollIntoView({ behavior: 'smooth' }); } },
    { title: '3 · Ground truth at the stop', text: 'Open a real Mastcam-Z frame tied to the stop by its mission record (site/drive), with camera position and derived viewing direction.', run: () => {
      const p = app.b.photos.find((q) => q.stop === 'delta_layers') ?? app.b.photos[0]; openPhoto(p.product_id); } },
    { title: '4 · Weather evidence', text: app.b.meda.status === 'available' ? 'Replay archived MEDA measurements for the sol; moving the pin changes the distance to the station.' : 'MEDA data is not packaged in this build, and the card says so instead of showing invented values. Regional dust context is shown separately.', run: () => {
      closeModal(); document.getElementById('cWx')?.classList.remove('collapsed'); document.getElementById('cWx')?.scrollIntoView({ behavior: 'smooth' }); } },
    { title: '5 · Resources', text: 'The seeded Monte Carlo reports how many simulated missions met the objective and reserve, and the main failure reason. Try lowering oxygen in the inputs.', run: () => { document.getElementById('cMC')?.scrollIntoView({ behavior: 'smooth' }); } },
    { title: '6 · Field view and crew', text: 'On the tablet the walk starts. Astronaut A leaves the tablet behind, and B\'s suit link drops then returns.', run: async () => {
      setView('tablet'); setCompress(60); startWalk();
      await new Promise((r) => setTimeout(r, 2500)); crewScenario('jezero', 'drop');
      await new Promise((r) => setTimeout(r, 2500)); crewScenario('jezero', 'cut'); } },
    { title: '7 · Link restored', text: 'B\'s link returns and live updates resume. The log records all crew events as simulated.', run: () => { crewScenario('jezero', 'restore'); } },
  ];
}

let steps: Step[] = []; let i = 0;
export function startDemo(which: 'nili' | 'jezero') {
  steps = which === 'nili' ? niliSteps() : jezeroSteps(); i = 0; show(); steps[0].run();
}
function show() {
  const el = $('#demo'); el.hidden = false; const s = steps[i];
  el.innerHTML = `<div class="steps">${steps.map((_, k) => `<span class="${k <= i ? 'done' : ''}"></span>`).join('')}</div><h4>${esc(s.title)}</h4><p>${esc(s.text)}</p>
    <div class="row"><button id="dPrev" ${i === 0 ? 'disabled' : ''}>◀ Back</button><button id="dNext" class="primary">${i === steps.length - 1 ? 'Finish' : 'Next ▶'}</button><button id="dRestart">↺ Restart</button><button id="dClose" style="margin-left:auto">Exit demo</button></div>`;
  $('#dPrev').onclick = () => { i = Math.max(0, i - 1); show(); steps[i].run(); };
  $('#dNext').onclick = () => { if (i === steps.length - 1) { endDemo(); return; } i++; show(); steps[i].run(); };
  $('#dRestart').onclick = () => { stopTablet(); i = 0; show(); steps[0].run(); };
  $('#dClose').onclick = endDemo;
}
export function endDemo() { $('#demo').hidden = true; stopTablet(); }
