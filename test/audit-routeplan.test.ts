// Audit independent: recomandarea de confort când acoperirea e incompletă pe porțiunea care DIFERĂ între rute.
// Rutele au de obicei o parte comună lungă; acoperirea calculată pe toată ruta poate masca un ocol nemăsurat.
import { describe, expect, it } from 'vitest';
import { aggregate, type RideContribution } from '../src/core/aggregate';
import { DEFAULT_ROUTE_OPTIONS, Router } from '../src/core/route';
import { planRoutes, routeEvidence } from '../src/core/routeplan';
import { makeGraph } from './helpers';

const LAT = 45.75, LON = 21.22;
const dLat = (m: number) => m / 111195, dLon = (m: number) => m / 77600;
const th: [number, number, number, number] = [1, 1.6, 2.4, 3.6];

function contrib(id: string, edges: number[], rms: number, opts: { passes?: number; perPass?: number } = {}): RideContribution {
  const windows: RideContribution['windows'] = [];
  for (const e of edges) for (let p = 0; p < (opts.passes ?? 2); p++) for (let k = 0; k < (opts.perPass ?? 4); k++) windows.push({ edge: e, rms, speed: 5, acc: 5, valid: true, amb: false, pass: p });
  return { ride_id: id, source: 'sensorlogger', processing_version: 'x', date: 0, windows, shocks: [], included_in_layer: true };
}

// A(0) ══ 900 m comun ══ M(1) ── X: 100 m direct ── B(2)
//                         └── D(3) ──┘  ocol de ~160 m
const g = makeGraph(
  [[LAT, LON], [LAT, LON + dLon(900)], [LAT, LON + dLon(1000)], [LAT + dLat(60), LON + dLon(950)]],
  [{ f: 0, t: 1 }, { f: 1, t: 2 }, { f: 1, t: 3 }, { f: 3, t: 2 }],
);
const plan = (layer: ReturnType<typeof aggregate>) => planRoutes(g, layer, new Router(g), 0, 2, DEFAULT_ROUTE_OPTIONS);

describe('audit: ocolul nemăsurat nu poate fi „recomandat”', () => {
  it('partea comună măsurată + segment direct măsurat E + ocol NEMĂSURAT → fără recomandare', () => {
    // 900 m comuni netezi (A) + 100 m direcți foarte denivelați (E); ocolul nu a fost parcurs niciodată
    const layer = aggregate({ rides: [contrib('r1', [0], 0.5), contrib('r2', [1], 6)], fixedThresholds: th, version: 1 });
    const r = plan(layer);
    // premisa: rutarea „de confort” chiar ocolește pe străzile necunoscute (P_necunoscut < P_E)
    const courier = new Router(g).route(0, 2, layer, { ...DEFAULT_ROUTE_OPTIONS, w_c: 3 });
    expect(courier.edges.map((e) => e.edge)).toEqual([0, 2, 3]);
    // ...dar nu avem nicio măsurătoare pe ocol, deci nu putem spune că are mai puține vibrații
    expect(r.verdict.kind).not.toBe('better');
    expect(r.options.map((o) => o.key)).toEqual(['shortest']);
    for (const o of r.options) expect(routeEvidence(o, false).tone).not.toBe('comfort');
  });

  it('același caz, ocolul măsurat neted pe ambele muchii → recomandare, cu diferența reală', () => {
    const layer = aggregate({ rides: [contrib('r1', [0], 0.5), contrib('r2', [1], 6), contrib('r3', [2, 3], 0.5)], fixedThresholds: th, version: 2 });
    const r = plan(layer);
    expect(r.verdict.kind).toBe('better');
    expect(r.options[1].r.edges.map((e) => e.edge)).toEqual([0, 2, 3]);
    expect(r.verdict.text).toMatch(/cu \d+ m mai puțin pe segmente măsurate ca denivelate/);
  });

  it('ocol măsurat doar pe o mică parte (sub 50% din ocol) → fără recomandare', () => {
    // muchia 2 (M→D) are ~78 m, muchia 3 (D→B) ~78 m: măsurăm doar un ciot scurt adăugat pe ocol
    const g2 = makeGraph(
      [[LAT, LON], [LAT, LON + dLon(900)], [LAT, LON + dLon(1000)], [LAT + dLat(60), LON + dLon(950)], [LAT + dLat(12), LON + dLon(910)]],
      [{ f: 0, t: 1 }, { f: 1, t: 2 }, { f: 1, t: 4 }, { f: 4, t: 3 }, { f: 3, t: 2 }],
    );
    // doar primii ~15 m ai ocolului (muchia 2) sunt măsurați
    const layer = aggregate({ rides: [contrib('r1', [0], 0.5), contrib('r2', [1], 6), contrib('r3', [2], 0.5)], fixedThresholds: th, version: 3 });
    const r = planRoutes(g2, layer, new Router(g2), 0, 2, DEFAULT_ROUTE_OPTIONS);
    expect(r.verdict.kind).not.toBe('better');
  });

  it('încrederea redusă e spusă explicit: o singură trecere nu apare ca „măsurat” fără calificare', () => {
    // ambele rute parcurse o singură dată → toate muchiile LOW_CONFIDENCE
    const one = { passes: 1 };
    const layer = aggregate({ rides: [contrib('r1', [0], 0.5, one), contrib('r2', [1], 6, one), contrib('r3', [2, 3], 0.5, one)], fixedThresholds: th, version: 4 });
    expect([...layer.edges.values()].every((e) => e.status === 'LOW_CONFIDENCE')).toBe(true);
    const r = plan(layer);
    expect(r.options[0].s.low_m).toBeCloseTo(r.options[0].s.measured_m, 6);
    // verdictul și eticheta trebuie să spună că datele au încredere redusă
    expect(r.verdict.text).toMatch(/încredere redusă/);
    expect(routeEvidence(r.options[0], false).text).toMatch(/încredere redusă/);
  });
});
