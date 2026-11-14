import type { AreaId, XY } from './core/geo';
import type { Bundles } from './data';
import type { EvaluatedPlan } from './plan';
import { evaluate, optionsFor } from './plan';
import { state } from './state';
import { newCrew, type CrewState, type Anchor } from './core/crew';

/** Process-wide app context shared by all views. */
export const app = {
  b: null as unknown as Bundles,
  plans: {} as Record<string, EvaluatedPlan>,
  crew: {} as Record<AreaId, CrewState>,
  walk: { jezero: 0, nili: 0 } as Record<AreaId, number>, // metres along active route walked by suit A (tablet sim)
};

export const ANCHORS: Record<AreaId, Anchor[]> = {
  jezero: [
    { id: 'HAB', label: 'Habitat mast (simulated)', xy: [230, 20] },
    { id: 'ROV', label: 'Pressurised rover (simulated)', xy: [110, -90] },
    { id: 'RLY', label: 'Relay mast (simulated)', xy: [-60, 260] },
  ],
  nili: [
    { id: 'HAB', label: 'Habitat mast (simulated)', xy: [120, -200] },
    { id: 'ROV', label: 'Pressurised rover (simulated)', xy: [-120, -210] },
    { id: 'RLY', label: 'Relay mast (simulated)', xy: [60, 215] },
  ],
};

export function crewFor(area: AreaId): CrewState {
  if (!app.crew[area]) {
    const hab = area === 'jezero' ? [230, 20] as XY : [120, -200] as XY;
    app.crew[area] = newCrew(ANCHORS[area], hab, area === 'jezero' ? 11 : 23);
  }
  return app.crew[area];
}
export function resetCrew(area: AreaId) { delete app.crew[area]; app.walk[area] = 0; return crewFor(area); }

export function evaluateArea(area: AreaId) {
  const a = state.areas[area];
  const out: EvaluatedPlan[] = [];
  for (const o of optionsFor(area)) {
    const p = evaluate(app.b, area, o, a.stops, state.assumptions, state.trials, state.seed);
    app.plans[`${area}:${o.id}`] = p; out.push(p);
  }
  return out;
}
export function activePlan(area: AreaId = state.area): EvaluatedPlan | undefined {
  const id = state.areas[area].routeOption;
  return app.plans[`${area}:${id}`] ?? evaluateArea(area).find((p) => p.option.id === id);
}
