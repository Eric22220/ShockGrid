// Alternativele de rută pentru ecranul Traseu și verdictul onest despre confort.
import type { ComfortClass, ComfortLayer } from './aggregate';
import type { Graph } from './graph';
import { hazardsOnRoute, type Hazard, type HazardMode } from './hazards';
import { PROFILES, Router, penaltyOf, routeStats, type ProfileKey, type RouteOptions, type RouteResult, type RouteStats } from './route';

/** variantele afișate: profilurile de confort și alternativa care ocolește problemele detectate */
export type OptionKey = ProfileKey | 'avoid';

export interface RouteOptionView {
  key: OptionKey;
  r: RouteResult;
  s: RouteStats;
  /** procentul de metri A+B din metrii cunoscuți (null dacă nu există metri cunoscuți) */
  knownGoodPct: number | null;
  knownByClass: Record<ComfortClass, number>;
  problems: { zones: number; reports: number };
  /** problemele de pe drum (toate cele active) pe care le atinge ruta */
  hazards: Hazard[];
  /** doar la „avoid”: problemele de pe ruta cea mai scurtă evitate de această variantă */
  avoided?: Hazard[];
}

/** Verdictul despre confort. Reguli (fără excepții):
 * - o rută cu < MIN_COVERAGE_PCT% din lungime măsurată are confort NECUNOSCUT;
 * - nu spunem niciodată că o rută e „mai confortabilă”, „optimă” sau „la fel de confortabilă” decât dacă
 *   ambele rute comparate sunt măsurate suficient și diferența măsurată e reală. */
export type Verdict =
  | { kind: 'nodata'; text: string } // nicio măsurătoare pe nicio variantă
  | { kind: 'insufficient'; text: string } // câteva măsurători, prea puține pentru o comparație
  | { kind: 'partial'; text: string } // cea mai scurtă e necunoscută, o alternativă e măsurată: informăm, nu recomandăm
  | { kind: 'same'; text: string } // cea mai scurtă e măsurată suficient și nu am găsit o alternativă măsurată mai bună
  | { kind: 'better'; text: string; best: OptionKey }; // ambele măsurate suficient, alternativa are mai puține vibrații măsurate

/** procentul minim din lungimea rutei care trebuie măsurat ca să vorbim despre confortul ei */
export const MIN_COVERAGE_PCT = 50;
/** diferențe minime ca o alternativă să fie numită „cu mai puține vibrații” */
const MIN_DE_GAIN_M = 10;
const MIN_GOOD_GAIN_PCT = 10;

/** procent afișabil: o valoare între 0 și 1 nu devine „0%” */
export const fmtPct = (p: number) => (p > 0 && p < 1 ? 'sub 1%' : `${Math.round(p)}%`);
export const isCovered = (o: RouteOptionView) => o.s.length > 0 && o.s.measured_pct >= MIN_COVERAGE_PCT;
/** cea mai mare parte a metrilor „măsurați” are doar încredere redusă (o trecere, puține ferestre, GPS slab/ambiguu) */
export const mostlyLowConfidence = (o: RouteOptionView) => o.s.measured_m > 0 && o.s.low_m / o.s.measured_m > 0.5;
const LOW_NOTE = ' Atenție: cele mai multe măsurători de aici au încredere redusă (o singură trecere sau GPS ambiguu); repetă traseul pentru un rezultat sigur.';

/** Eticheta de dovezi pentru o rută: verde DOAR pentru o rută recomandată pe baza măsurătorilor. */
export function routeEvidence(o: RouteOptionView, recommended: boolean): { tone: 'warn' | 'neutral' | 'comfort'; text: string } {
  if (o.s.measured_m <= 0) return { tone: 'warn', text: 'Confort necunoscut · nemăsurat' };
  if (!isCovered(o)) return { tone: 'warn', text: `Confort necunoscut · măsurat ${fmtPct(o.s.measured_pct)}` };
  const good = o.knownGoodPct !== null ? ` · ${Math.round(o.knownGoodPct)}% confortabil` : '';
  const low = mostlyLowConfidence(o) ? ' · încredere redusă' : '';
  return { tone: recommended ? 'comfort' : 'neutral', text: `Măsurat ${fmtPct(o.s.measured_pct)}${low}${good}` };
}

/** Cât din lungimea unei mulțimi de muchii e măsurat (MEASURED sau LOW_CONFIDENCE). */
function coverage(g: Graph, layer: ComfortLayer | null, edges: number[], o: RouteOptions): { length: number; measured: number } {
  let length = 0, measured = 0;
  for (const e of edges) {
    const L = g.length[e];
    length += L;
    const c = penaltyOf(g, layer, e, o).cat;
    if (c === 'measured' || c === 'low') measured += L;
  }
  return { length, measured };
}

/** Porțiunile care DIFERĂ între două rute trebuie măsurate fiecare ≥ MIN_COVERAGE_PCT. Partea comună nu spune
 * nimic despre care rută e mai bună: fără această regulă, un ocol complet nemăsurat era „recomandat” doar pentru
 * că restul rutei (comun cu cea mai scurtă) era măsurat, iar rutarea preferă necunoscutul în locul claselor C–E. */
export function differenceCovered(g: Graph, layer: ComfortLayer | null, alt: RouteResult, shortest: RouteResult, o: RouteOptions): boolean {
  const inShort = new Set(shortest.edges.map((e) => e.edge)), inAlt = new Set(alt.edges.map((e) => e.edge));
  const detour = coverage(g, layer, alt.edges.map((e) => e.edge).filter((e) => !inShort.has(e)), o);
  const avoided = coverage(g, layer, shortest.edges.map((e) => e.edge).filter((e) => !inAlt.has(e)), o);
  const ok = (c: { length: number; measured: number }) => c.length > 0 && (100 * c.measured) / c.length >= MIN_COVERAGE_PCT;
  return ok(detour) && ok(avoided);
}

function isBetter(a: RouteOptionView, s: RouteOptionView): boolean {
  if (a.s.de_measured_m > s.s.de_measured_m) return false;
  const de = s.s.de_measured_m - a.s.de_measured_m;
  const good = (a.knownGoodPct ?? 0) - (s.knownGoodPct ?? 0);
  return de >= MIN_DE_GAIN_M || good >= MIN_GOOD_GAIN_PCT;
}

export interface PlanResult { options: RouteOptionView[]; verdict: Verdict; error?: string; /** textul despre problemele detectate (gol = fără probleme pe rute) */ hazardText?: string }

/** Limitele alternativei „Ocolește problemele”: fără ocoluri absurde (configurabile, documentate). */
export const AVOID_MAX_EXTRA_RATIO = 0.5; // cel mult +50% din lungime…
export const AVOID_MAX_EXTRA_M = 1000; // …și cel mult +1 km
/** geometrie cu adevărat diferită: cel puțin atâția metri (și 10% din rută) care nu sunt pe ruta cea mai scurtă */
export const AVOID_MIN_DIFF_M = 30;

export interface PointLike { lat: number; lon: number }

function sameEdges(a: RouteResult, b: RouteResult) {
  return a.edges.length === b.edges.length && a.edges.every((e, i) => e.edge === b.edges[i].edge);
}

export function problemsNear(g: Graph, r: RouteResult, pts: PointLike[], radius = 15): number {
  if (!pts.length) return 0;
  const set = new Set(r.edges.map((e) => e.edge));
  return pts.filter((p) => g.query(p.lat, p.lon, radius).some((c) => set.has(c.edge))).length;
}

export function planRoutes(g: Graph, layer: ComfortLayer | null, router: Router, src: number, dst: number, base: RouteOptions, extra: { zones: PointLike[]; reports: PointLike[] } = { zones: [], reports: [] }, hazardMode: HazardMode = 'confident'): PlanResult {
  const hs = layer?.hazards ?? [];
  const keys: ProfileKey[] = ['shortest', 'balanced', 'courier'];
  const raw = keys.map((key) => ({ key, r: router.route(src, dst, layer, { ...base, w_c: PROFILES[key] }) }));
  if (!raw[0].r.found) return { options: [], verdict: { kind: 'nodata', text: '' }, error: 'Nu am găsit o rută pe bicicletă între aceste puncte (sens unic, trotuare sau zonă neconectată).' };
  const opts: RouteOptionView[] = raw.filter((x) => x.r.found).map(({ key, r }) => {
    const s = routeStats(g, layer, r, base);
    const known: Record<ComfortClass, number> = { A: 0, B: 0, C: 0, D: 0, E: 0 };
    for (const c of ['A', 'B', 'C', 'D', 'E'] as ComfortClass[]) known[c] = s.byClass.measured[c] + s.byClass.low[c];
    const kn = Object.values(known).reduce((a, b) => a + b, 0);
    const onRoute = hazardsOnRoute(hs, r.edges.map((e) => e.edge), 'all');
    return {
      key, r, s, knownByClass: known,
      knownGoodPct: kn > 0 ? (100 * (known.A + known.B)) / kn : null,
      problems: { zones: problemsNear(g, r, extra.zones) + onRoute.length, reports: problemsNear(g, r, extra.reports) },
      hazards: onRoute,
    } as RouteOptionView;
  });
  const shortest = opts[0];
  // alternative distincte (fără dubluri)
  const alts: RouteOptionView[] = [];
  for (const o of opts.slice(1)) if (!sameEdges(o.r, shortest.r) && !alts.some((v) => sameEdges(v.r, o.r))) alts.push(o);
  const coveredAlts = alts.filter(isCovered);
  let visible: RouteOptionView[] = [shortest];
  let verdict: Verdict;
  if (!isCovered(shortest)) {
    if (coveredAlts.length) {
      const a = coveredAlts[0];
      visible = [shortest, a];
      verdict = { kind: 'partial', text: `Cea mai scurtă rută e măsurată ${fmtPct(shortest.s.measured_pct)}, deci confortul ei e necunoscut. Alternativa (+${Math.round(a.s.length - shortest.s.length)} m) e măsurată ${fmtPct(a.s.measured_pct)}${a.knownGoodPct !== null ? `, ${Math.round(a.knownGoodPct)}% confortabil` : ''}. Nu le putem compara.` };
    } else if (opts.every((o) => o.s.measured_m <= 0)) {
      verdict = { kind: 'nodata', text: 'Confort necunoscut: nu avem măsurători pe această rută. Îți arătăm cea mai scurtă rută, fără optimizare după confort.' };
    } else {
      verdict = { kind: 'insufficient', text: `Confort necunoscut: doar ${fmtPct(shortest.s.measured_pct)} din rută e măsurat, prea puțin pentru a compara confortul. Îți arătăm cea mai scurtă rută.` };
    }
  } else {
    const better = coveredAlts.filter((a) => isBetter(a, shortest) && differenceCovered(g, layer, a.r, shortest.r, base));
    if (better.length) {
      const best = better.reduce((x, y) => (y.s.de_measured_m < x.s.de_measured_m || (y.s.de_measured_m === x.s.de_measured_m && y.s.length < x.s.length) ? y : x));
      visible = [shortest, best];
      const dl = Math.round(best.s.length - shortest.s.length);
      const dde = Math.round(shortest.s.de_measured_m - best.s.de_measured_m);
      const low = mostlyLowConfidence(best) || mostlyLowConfidence(shortest) ? LOW_NOTE : '';
      verdict = {
        kind: 'better', best: best.key,
        text: (dde >= MIN_DE_GAIN_M
          ? `${dl >= 0 ? '+' : ''}${dl} m față de cea mai scurtă, cu ${dde} m mai puțin pe segmente măsurate ca denivelate (D–E).`
          : `${dl >= 0 ? '+' : ''}${dl} m față de cea mai scurtă; ${Math.round(best.knownGoodPct ?? 0)}% confortabil (A–B) față de ${Math.round(shortest.knownGoodPct ?? 0)}% pe porțiunile măsurate.`) + low,
      };
    } else {
      verdict = { kind: 'same', text: `Nu am găsit o alternativă măsurată cu mai puține vibrații. Ruta e măsurată ${fmtPct(shortest.s.measured_pct)}${shortest.knownGoodPct !== null ? `, ${Math.round(shortest.knownGoodPct)}% confortabil (A–B)` : ''}.${mostlyLowConfidence(shortest) ? LOW_NOTE : ''}` };
    }
  }
  // ---- alternativa care ocolește problemele detectate (independentă de verdictul de confort) ----
  const avoid = avoidOption(g, layer, router, src, dst, base, shortest, hazardMode, extra);
  let hazardText: string | undefined;
  if (avoid.option && !visible.some((v) => sameEdges(v.r, avoid.option!.r))) visible = [...visible, avoid.option];
  else if (avoid.option) { const v = visible.find((x) => sameEdges(x.r, avoid.option!.r))!; v.avoided = avoid.option.avoided; }
  if (avoid.text) hazardText = avoid.text;
  return { options: visible, verdict, hazardText };
}

/** Ruta cea mai scurtă care ocolește problemele (doar penalizarea problemelor, fără confort) — afișată doar dacă
 * evită efectiv cel puțin o problemă de pe ruta cea mai scurtă, are altă geometrie și ocolul e rezonabil. */
function avoidOption(g: Graph, layer: ComfortLayer | null, router: Router, src: number, dst: number, base: RouteOptions, shortest: RouteOptionView, mode: HazardMode, extra: { zones: PointLike[]; reports: PointLike[] }): { option: RouteOptionView | null; text?: string } {
  const hs = layer?.hazards ?? [];
  const onShort = hazardsOnRoute(hs, shortest.r.edges.map((e) => e.edge), mode);
  const anyOnShort = shortest.hazards.length;
  const uncertainOnly = mode === 'confident' && anyOnShort > 0 && onShort.length === 0;
  if (!onShort.length) return { option: null, text: uncertainOnly ? `Ruta trece prin ${anyOnShort} ${anyOnShort === 1 ? 'loc cu posibile probleme' : 'locuri cu posibile probleme'} (detectate automat, neconfirmate).` : undefined };
  const r = router.route(src, dst, layer, { ...base, w_c: 0, hazard_mode: mode });
  const no = (why: string) => ({ option: null, text: `Ruta trece prin ${onShort.length} ${onShort.length === 1 ? 'zonă cu probleme detectate' : 'zone cu probleme detectate'}; ${why}` });
  if (!r.found || sameEdges(r, shortest.r)) return no('nu există o variantă legală pe bicicletă care să le ocolească cu un ocol rezonabil.');
  const onAlt = hazardsOnRoute(hs, r.edges.map((e) => e.edge), mode);
  const avoided = onShort.filter((h) => !onAlt.includes(h));
  const inShort = new Set(shortest.r.edges.map((e) => e.edge));
  const diff = r.edges.reduce((a, e) => a + (inShort.has(e.edge) ? 0 : g.length[e.edge]), 0);
  const extraM = r.length - shortest.r.length;
  if (!avoided.length || onAlt.length >= onShort.length) return no('nicio variantă rezonabilă nu le evită.');
  if (extraM > AVOID_MAX_EXTRA_M || r.length > shortest.r.length * (1 + AVOID_MAX_EXTRA_RATIO)) return no(`ocolul ar fi prea mare (+${Math.round(extraM)} m).`);
  if (diff < Math.max(AVOID_MIN_DIFF_M, 0.1 * r.length)) return no('variantele diferă prea puțin ca să conteze.');
  const s = routeStats(g, layer, r, base);
  const known: Record<ComfortClass, number> = { A: 0, B: 0, C: 0, D: 0, E: 0 };
  for (const c of ['A', 'B', 'C', 'D', 'E'] as ComfortClass[]) known[c] = s.byClass.measured[c] + s.byClass.low[c];
  const kn = Object.values(known).reduce((a, b) => a + b, 0);
  const all = hazardsOnRoute(hs, r.edges.map((e) => e.edge), 'all');
  return {
    option: {
      key: 'avoid', r, s, knownByClass: known, knownGoodPct: kn > 0 ? (100 * (known.A + known.B)) / kn : null,
      problems: { zones: problemsNear(g, r, extra.zones) + all.length, reports: problemsNear(g, r, extra.reports) },
      hazards: all, avoided,
    },
  };
}
