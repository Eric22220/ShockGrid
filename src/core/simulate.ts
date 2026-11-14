// SIMULARE: cum răspunde motorul de rutare la diferențe de confort CUNOSCUTE, pe străzile reale, cu un strat inventat.
// Stratul simulat trăiește doar în memorie, are propriul Router (cache separat) și nu atinge niciodată turele,
// stratul public sau IndexedDB. Nu e o măsurătoare și nu se afișează fără eticheta „SIMULARE”.
import { aggregate, classOf, type ComfortLayer, type EdgeAgg } from './aggregate';
import { DEFAULT_THRESHOLDS } from './config';
import type { Graph } from './graph';
import { DEFAULT_ROUTE_OPTIONS, Router, type RouteResult } from './route';
import { planRoutes, type PlanResult } from './routeplan';

export type SimScenario = 'none' | 'short_rough' | 'both';
export const SIM_RMS = { rough: 4.5, smooth: 0.7 } as const;

function simEdge(g: Graph, e: number, rms: number): EdgeAgg {
  return {
    edge_id: e, rms_median: rms, class: classOf(rms, DEFAULT_THRESHOLDS), n_windows: 6, n_windows_total: 6, n_passes: 2, n_rides: 2,
    speed_median: 4.5, gps_acc_median: 5, status: 'MEASURED', reasons: [], surface_kind: g.kind[e] ?? null, ambiguous_ratio: 0,
    last_seen: null, sources: [], speed_p10: 4, speed_p90: 5, origin: [], explore: null,
  };
}

export interface Simulation { layer: ComfortLayer; plan: PlanResult; shortest: RouteResult; alt: RouteResult | null; rough: number[]; smooth: number[] }

/** Scenariile: fără date; doar cea mai scurtă rută „măsurată” (denivelată); ambele rute „măsurate” (scurtă denivelată, ocol neted). */
export function simulate(g: Graph, src: number, dst: number, scenario: SimScenario): Simulation | null {
  const router = new Router(g); // cache separat: versiunile simulate nu se amestecă cu stratul real
  const shortest = router.route(src, dst, null, { ...DEFAULT_ROUTE_OPTIONS, w_c: 0 });
  if (!shortest.found) return null;
  const base = aggregate({ rides: [], fixedThresholds: DEFAULT_THRESHOLDS });
  const rough = shortest.edges.map((x) => x.edge);
  const l1: ComfortLayer = { ...base, version: -101, thresholds_source: 'SIMULARE', edges: new Map(rough.map((e) => [e, simEdge(g, e, SIM_RMS.rough)])) };
  const altR = router.route(src, dst, l1, { ...DEFAULT_ROUTE_OPTIONS, w_c: 3 });
  const smooth = altR.found ? altR.edges.map((x) => x.edge).filter((e) => !l1.edges.has(e)) : [];
  const l2: ComfortLayer = { ...l1, version: -102, edges: new Map([...l1.edges, ...smooth.map((e) => [e, simEdge(g, e, SIM_RMS.smooth)] as const)]) };
  const layer = scenario === 'none' ? { ...base, version: -100, thresholds_source: 'SIMULARE' } : scenario === 'short_rough' ? l1 : l2;
  const plan = planRoutes(g, layer, router, src, dst, DEFAULT_ROUTE_OPTIONS);
  return { layer, plan, shortest, alt: altR.found ? altR : null, rough: scenario === 'none' ? [] : rough, smooth: scenario === 'both' ? smooth : [] };
}
