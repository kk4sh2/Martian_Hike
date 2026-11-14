import { state, emit, log, resetArea } from '../state';
import { $, esc, closeModal } from './dom';
import { activePlan, app, resetCrew } from '../app';
import { openEvidence } from './evidence';
import { openPhoto } from './photo';
import { focusCrossing, crewScenario } from './planner';
import { setView } from '../main';
import { startWalk, stopTablet, setCompress } from './tablet';
import { flyTo, highlight, clearHighlight, addPoint, clearPoints } from './globe';

/** A step: a short title, a plain-language explanation, and what to look at on screen. */
interface Step { title: string; text: string; look?: string; run: () => void | Promise<void> }

const globeStop = (lat: number, lon: number, label: string, alt = 2.2, ring = 4) => () => {
  closeModal(); setView('globe'); clearPoints(); flyTo(lat, lon, alt); highlight(lat, lon, label, ring);
};

/** Tour of Mars on the 3D globe. Facts are standard published values. */
function tourSteps(): Step[] {
  return [
    { title: 'Welcome to Mars', text: 'Mars is about half the size of Earth (6,779 km across). Gravity is about 38% of Earth\'s, the air is more than 100 times thinner, and nights fall well below −70 °C. Anyone walking outside needs a pressurised suit, enough oxygen and battery to get home, and a shelter to return to.',
      look: 'Drag the globe to spin it. This tour turns it for you.', run: () => { closeModal(); setView('globe'); clearPoints(); clearHighlight(); flyTo(10, 20, 3.4); } },
    { title: 'Olympus Mons: the tallest volcano', text: 'The largest volcano in the solar system, about 22 km high (two and a half times Mount Everest) and as wide as a large country. It shows how big Mars\' landscapes are compared with a walking astronaut.',
      look: 'The <b>yellow ring</b> marks it.', run: globeStop(18.65, -133.8, 'Olympus Mons', 2.2, 6) },
    { title: 'Valles Marineris: a giant canyon', text: 'A canyon system about 4,000 km long and up to 7 km deep. On Earth it would stretch across the whole United States. Steep walls like these are exactly what a walking route must avoid.',
      look: 'The ring sits in the middle of the canyon.', run: globeStop(-13.9, -59.2, 'Valles Marineris', 2.3, 8) },
    { title: 'Jezero Crater: an ancient lake', text: 'Billions of years ago a river flowed into this crater and left a fan of layered rock (a delta). NASA\'s Perseverance rover has explored it since 2021. MarsDelta plans a science walk here using the rover\'s real photos and positions.',
      look: 'Jezero is one of the two sites you can plan in MarsDelta.', run: globeStop(18.45, 77.41, 'Jezero Crater', 1.7, 1.5) },
    { title: 'Nili Patera: dunes that move', text: 'A volcanic area with dark sand dunes. Two NASA photos taken 105 days apart in 2007 show the ripples on a dune moved. MarsDelta compares those photos and warns an astronaut if a planned walk crosses ground that changed.',
      look: 'MarsDelta\'s second site.', run: globeStop(8.78, 67.32, 'Nili Patera', 1.7, 1.5) },
    { title: 'How far apart are they?', text: 'The globe can measure the distance between any two places over the surface of Mars. Here it measures Jezero to Nili Patera. Far too far to walk: crews would need a rover.',
      look: 'The <b>green</b> and <b>blue</b> dots and the yellow line show the measurement; the number is in the box on the right.',
      run: () => { closeModal(); setView('globe'); clearHighlight(); clearPoints(); flyTo(13.5, 72.5, 1.9); addPoint(18.45, 77.41); addPoint(8.78, 67.32); } },
    { title: 'Gale Crater: Curiosity\'s home', text: 'NASA\'s Curiosity rover has worked here since 2012. Its weather station showed how cold and changeable a Martian day is. Over the year the weather changes with the seasons and with dust in the air.',
      look: 'Try it yourself after the tour: tap any two places to measure them.', run: globeStop(-5.4, 137.8, 'Gale Crater', 2.2, 3) },
    { title: 'Your turn', text: 'Tap Jezero Crater or Nili Patera on the globe to open that site in the planner, or start one of the other demos to see a walk planned step by step.',
      look: 'Press <b>Finish</b> to close the tour.', run: () => { setView('globe'); clearPoints(); clearHighlight(); flyTo(15, 72, 2.6); } },
  ];
}

function niliSteps(): Step[] {
  return [
    { title: 'Where we are', text: 'Nili Patera, a dune field on Mars. We imagine astronauts living in a habitat here and planning a short walk across the sand.',
      look: 'The globe flies to the site.', run: () => { resetArea('nili'); resetCrew('nili'); state.area = 'nili'; state.areas.nili.routeOption = 'crossing'; state.areas.nili.observationReceived = false; emit('demo'); globeStop(8.78, 67.32, 'Nili Patera', 1.7, 1.5)(); } },
    { title: 'The planned walk', text: 'This is what the astronaut\'s tablet shows: the orange line is the planned walk from the habitat to a rock outcrop and back. The picture underneath is a real NASA satellite photo from June 2007.',
      look: 'The <b>blue arrow</b> is the astronaut; the instruction at the top says where to go.', run: () => { clearHighlight(); setView('tablet'); } },
    { title: 'A new photo arrives', text: 'A second photo of the same spot arrives, taken 105 days later (October 2007). In this demo the arrival is pretend, but both photos are real.',
      look: 'Back on the planner map.', run: () => { state.areas.nili.observationReceived = true; log('event', 'Simulated event: repeat observation PSP_005684_1890 (2007-10-13) received.', true, 'nili'); setView('planner'); emit('demo'); } },
    { title: 'Comparing the two photos', text: `MarsDelta lines the two photos up on solid rock, which should not move, to within about ${app.b.nili.registration.heldout_rms_m.toFixed(2)} m. Then it looks for places where the ground looks different. It found ${app.b.nili.summary.candidate_regions} areas that changed.`,
      look: 'Coloured outlines on the map are the areas that changed.', run: () => { log('system', `Loaded precomputed change evidence (${app.b.nili.summary.candidate_regions} candidate regions).`, false, 'nili'); emit('demo'); } },
    { title: 'The walk crosses changed ground', text: 'Part of the walk goes through a changed area: the sand ripples there moved. A warning appears so the astronaut checks before going on.',
      look: 'The <b>pink segment</b> on the route and the warning banner at the top.', run: () => { focusCrossing(); emit('demo'); } },
    { title: 'See the change for yourself', text: 'The before and after photos flash back and forth ("Blink") so you can see the ripples shift. Try "Swipe" to slide between them. NASA published the same finding for this dune.',
      look: 'Watch the ripples inside the green outline.', run: async () => { const c = activePlan('nili')!.impact.crossings[0]; await openEvidence(c.regionId, c); } },
    { title: 'Decide what to do', text: 'The astronaut can carry on, look for a way around, or ask a scientist to check. Here MarsDelta looks for a way around and explains honestly why it can\'t offer one (there is no height map of this area), then the crossing is acknowledged.',
      look: 'The message under the three buttons.', run: async () => { const b = document.getElementById('evBypass') as HTMLButtonElement | null; b?.click(); const a = document.getElementById('evAck') as HTMLButtonElement | null; if (a && !a.disabled) a.click(); } },
    { title: 'Everything is recorded', text: 'The decision is saved in the mission log. The warning never secretly changes the chance of getting home safely; the crew decides.',
      look: 'The mission log at the bottom of the side panel.', run: () => { closeModal(); setView('planner'); const c = document.getElementById('cLog'); c?.classList.remove('collapsed'); c?.scrollIntoView({ behavior: 'smooth' }); } },
  ];
}

function jezeroSteps(): Step[] {
  return [
    { title: 'Where we are', text: 'Jezero Crater, an ancient lake bed where NASA\'s Perseverance rover is exploring. The question for this walk: how do the rock layers change as you walk towards the old river delta?',
      look: 'The globe flies to the site.', run: () => { resetArea('jezero'); resetCrew('jezero'); state.area = 'jezero'; emit('demo'); globeStop(18.45, 77.41, 'Jezero Crater', 1.7, 1.5)(); } },
    { title: 'Two ways to walk', text: 'From the habitat to two real places the rover stopped, then back home. "Direct" is quicker but steeper; "Gentle" avoids steep slopes. Both are calculated on a real height map of the ground.',
      look: 'The <b>orange</b> and <b>grey</b> lines on the map, and the Route table on the right.', run: () => { clearHighlight(); setView('planner'); document.getElementById('cRoutes')?.scrollIntoView({ behavior: 'smooth' }); } },
    { title: 'What the rover saw there', text: 'A real photo taken by Perseverance at one of the stops, so the astronaut knows what to expect when they arrive.',
      look: 'The camera icons on the map show where each photo was taken and which way it faced.', run: () => { const p = app.b.photos.find((q) => q.stop === 'delta_layers') ?? app.b.photos[0]; openPhoto(p.product_id); } },
    { title: 'Weather', text: app.b.medaDaily ? 'Real readings from the rover\'s weather station: daily low and high temperature, air pressure, sunrise and sunset. Missing days are shown as gaps, never guessed.' : 'No weather readings are loaded in this build, and the card says so rather than inventing numbers.',
      look: 'The Weather card on the right.', run: () => { closeModal(); document.getElementById('cWx')?.classList.remove('collapsed'); document.getElementById('cWx')?.scrollIntoView({ behavior: 'smooth' }); } },
    { title: 'Can we make it back?', text: 'MarsDelta runs the walk 500 times with small random problems (slower walking, obstacles) and counts how often the astronaut gets home with oxygen and battery to spare.',
      look: 'The big percentage. Try lowering the oxygen to see it drop.', run: () => { document.getElementById('cMC')?.scrollIntoView({ behavior: 'smooth' }); } },
    { title: 'Safety limits', text: 'The Survival check shows how much oxygen and battery would be left, the point where you should turn back if things go badly, how far the shelter is, and how long until sunset.',
      look: 'The Survival check card.', run: () => { const c = document.getElementById('cSurv'); c?.classList.remove('collapsed'); c?.scrollIntoView({ behavior: 'smooth' }); } },
    { title: 'Out on the walk', text: 'The tablet view starts the walk. Then two pretend problems happen: astronaut A leaves the tablet behind, and astronaut B\'s suit radio cuts out. The map keeps showing B\'s last known position and how old it is.',
      look: 'The crew list on the right of the tablet.', run: async () => {
        setView('tablet'); setCompress(60); startWalk();
        await new Promise((r) => setTimeout(r, 2500)); crewScenario('jezero', 'drop');
        await new Promise((r) => setTimeout(r, 2500)); crewScenario('jezero', 'cut'); } },
    { title: 'Back in contact', text: 'B\'s radio comes back and live updates resume. In an emergency, the red "Emergency return" button plans the way home. All crew events are pretend and are marked as simulated in the log.',
      look: 'SUIT-B2 changes from LAST KNOWN back to LIVE.', run: () => { crewScenario('jezero', 'restore'); } },
  ];
}

let steps: Step[] = []; let i = 0;
export function startDemo(which: 'nili' | 'jezero' | 'tour') {
  steps = which === 'nili' ? niliSteps() : which === 'jezero' ? jezeroSteps() : tourSteps(); i = 0; show(); steps[0].run();
}
function show() {
  const el = $('#demo'); el.hidden = false; const s = steps[i];
  el.innerHTML = `<div class="steps">${steps.map((_, k) => `<span class="${k <= i ? 'done' : ''}"></span>`).join('')}</div><h4>${esc(s.title)} <small>· step ${i + 1} of ${steps.length}</small></h4><p>${esc(s.text)}</p>${s.look ? `<div class="look">👀 ${s.look}</div>` : ''}
    <div class="row"><button id="dPrev" ${i === 0 ? 'disabled' : ''}>◀ Back</button><button id="dNext" class="primary">${i === steps.length - 1 ? 'Finish' : 'Next ▶'}</button><button id="dRestart">↺ Restart</button><button id="dClose" style="margin-left:auto">Exit demo</button></div>`;
  $('#dPrev').onclick = () => { i = Math.max(0, i - 1); show(); steps[i].run(); };
  $('#dNext').onclick = () => { if (i === steps.length - 1) { endDemo(); return; } i++; show(); steps[i].run(); };
  $('#dRestart').onclick = () => { stopTablet(); i = 0; show(); steps[0].run(); };
  $('#dClose').onclick = endDemo;
}
export function endDemo() { $('#demo').hidden = true; stopTablet(); clearHighlight(); }
