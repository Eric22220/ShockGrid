// Analiza pe stradă (studiu de caz): ferestrele unei ture pe o stradă, comparate cu restul turei în aceeași bandă de viteză,
// intervale declarate din filmare (ex. „trotuarul de nord”) și limitele potrivirii pe străzi. Doar local, nimic publicat.
import { DEFAULT_CONFIG, type VibrationConfig } from './config';
import { axialDiff, haversine } from './geo';
import type { Graph } from './graph';
import { percentileSorted, rng } from './stats';
import { EXPLORE_BANDS, isExploratory } from './quality';
import type { ProcessedRide, Shock, VibWindow } from './types';

/** benzile în care comparăm: cele de explorare + banda RVI (ferestre valide) */
export function compareBands(cfg: VibrationConfig = DEFAULT_CONFIG) {
  return [...EXPLORE_BANDS.map((b) => ({ ...b, hi: Math.min(b.hi, cfg.speed_min), rvi: false })), { id: 'rvi', lo: cfg.speed_min, hi: cfg.speed_max, label: `${String(cfg.speed_min).replace('.', ',')}–${cfg.speed_max} m/s (RVI)`, rvi: true }];
}

/** ferestre utilizabile pentru comparație: valide (RVI) sau explorare la viteză redusă */
export const usable = (w: VibWindow, cfg: VibrationConfig = DEFAULT_CONFIG) => w.valid || isExploratory(w, cfg);

export interface StreetOfRide { name: string; edges: number[]; windows: number; length_m: number }

/** Străzile (după nume OSM) pe care tura are ferestre potrivite, cele mai parcurse primele. */
export function streetsOfRide(p: ProcessedRide, g: Graph): StreetOfRide[] {
  const by = new Map<string, { edges: Set<number>; windows: number }>();
  for (const w of p.windows) {
    if (w.edge < 0) continue;
    const name = g.name[w.edge];
    if (!name) continue;
    let s = by.get(name);
    if (!s) { s = { edges: new Set(), windows: 0 }; by.set(name, s); }
    s.edges.add(w.edge);
    s.windows++;
  }
  return [...by.entries()]
    .map(([name, s]) => {
      // toate muchiile cu acest nume din apropierea turei (inclusiv cele fără ferestre), pentru desen
      const edges = [...s.edges];
      return { name, edges, windows: s.windows, length_m: edges.reduce((a, e) => a + g.length[e], 0) };
    })
    .sort((a, b) => b.windows - a.windows);
}

export interface SampleStat { n: number; p50: number | null; p90: number | null; speed_p50: number | null }
export function sampleStat(ws: VibWindow[]): SampleStat {
  const r = ws.map((w) => w.rms).sort((a, b) => a - b);
  const v = ws.map((w) => w.speed ?? 0).sort((a, b) => a - b);
  return { n: r.length, p50: r.length ? percentileSorted(r, 50) : null, p90: r.length ? percentileSorted(r, 90) : null, speed_p50: v.length ? percentileSorted(v, 50) : null };
}

export type CompareVerdict = 'higher' | 'lower' | 'undetermined' | 'insufficient';
export interface BandComparison { band: string; label: string; rvi: boolean; a: SampleStat; b: SampleStat; ratio: number | null; ci: [number, number] | null; verdict: CompareVerdict }

/** minim de ferestre (≈ secunde) pe fiecare parte pentru o comparație */
export const MIN_COMPARE_N = 20;
/** ferestrele vecine se suprapun și sunt corelate: reeșantionăm blocuri de 10 ferestre consecutive */
const BLOCK = 10;

function medianOf(a: number[]) { const s = [...a].sort((x, y) => x - y); return percentileSorted(s, 50); }

/** Interval de încredere 90% pentru raportul medianelor (A/B), bootstrap pe blocuri, determinist. */
export function ratioCI(a: VibWindow[], b: VibWindow[], iters = 400, seed = 1): [number, number] | null {
  const blocks = (ws: VibWindow[]) => {
    const s = [...ws].sort((x, y) => x.t0 - y.t0);
    const out: number[][] = [];
    for (let i = 0; i < s.length; i += BLOCK) out.push(s.slice(i, i + BLOCK).map((w) => w.rms));
    return out;
  };
  const ba = blocks(a), bb = blocks(b);
  if (ba.length < 2 || bb.length < 2) return null;
  const r = rng(seed);
  const draw = (bl: number[][]) => { const out: number[] = []; for (let i = 0; i < bl.length; i++) out.push(...bl[Math.floor(r() * bl.length)]); return medianOf(out); };
  const ratios: number[] = [];
  for (let i = 0; i < iters; i++) { const mb = draw(bb); if (mb > 0) ratios.push(draw(ba) / mb); }
  if (ratios.length < iters / 2) return null;
  ratios.sort((x, y) => x - y);
  return [percentileSorted(ratios, 5), percentileSorted(ratios, 95)];
}

/** Compară două mulțimi de ferestre, bandă cu bandă. „higher” = A are vibrații mai mari decât B la aceeași viteză. */
export function compareByBand(a: VibWindow[], b: VibWindow[], cfg: VibrationConfig = DEFAULT_CONFIG): BandComparison[] {
  return compareBands(cfg).map((band) => {
    const inBand = (w: VibWindow) => (band.rvi ? w.valid : isExploratory(w, cfg) && w.speed! >= band.lo && w.speed! < band.hi);
    const A = a.filter(inBand), B = b.filter(inBand);
    const sa = sampleStat(A), sb = sampleStat(B);
    if (sa.n < MIN_COMPARE_N || sb.n < MIN_COMPARE_N || !sb.p50) return { band: band.id, label: band.label, rvi: band.rvi, a: sa, b: sb, ratio: null, ci: null, verdict: 'insufficient' as const };
    const ratio = sa.p50! / sb.p50;
    const ci = ratioCI(A, B);
    const verdict: CompareVerdict = !ci ? 'undetermined' : ci[0] > 1 ? 'higher' : ci[1] < 1 ? 'lower' : 'undetermined';
    return { band: band.id, label: band.label, rvi: band.rvi, a: sa, b: sb, ratio, ci, verdict };
  });
}

/** Există pe stradă căi paralele de alt tip (trotuar/pistă/alee desenate separat în OSM) la ≤ 15 m?
 * Dacă nu, potrivirea pune toate vibrațiile pe axa străzii și nu poate deosebi trotuarul de carosabil. */
export function parallelInfra(g: Graph, edges: number[], r = 15): { kinds: string[]; edges: number[] } {
  const own = new Set(edges);
  const found = new Map<number, string>();
  for (const e of edges) {
    const geo = g.geometry(e);
    for (let i = 0; i < geo.length; i++) {
      const [lat, lon] = geo[i];
      const brg = i + 1 < geo.length ? bearing(geo[i], geo[i + 1]) : i > 0 ? bearing(geo[i - 1], geo[i]) : 0;
      for (const c of g.query(lat, lon, r)) {
        if (own.has(c.edge) || g.kind[c.edge] === g.kind[e]) continue;
        if (axialDiff(c.bearing, brg) > 25) continue;
        found.set(c.edge, g.kind[c.edge]);
      }
    }
  }
  return { kinds: [...new Set(found.values())].sort(), edges: [...found.keys()] };
}

function bearing(a: [number, number], b: [number, number]) {
  const y = (b[0] - a[0]) * 111195, x = (b[1] - a[1]) * 111195 * Math.cos((a[0] * Math.PI) / 180);
  return ((Math.atan2(x, y) * 180) / Math.PI + 360) % 360;
}

/** Interval declarat de echipă (din filmare sau din notițe), în secunde față de începutul turei. */
export interface RideInterval { id: string; t0_s: number; t1_s: number; label: string; surface?: 'carosabil' | 'pista' | 'trotuar' | 'traversare' | 'altul' }

export const rideStart = (p: ProcessedRide) => (p.windows.length ? Math.min(p.meta.start_ms, p.windows[0].t0) : p.meta.start_ms);
export function windowsInInterval(p: ProcessedRide, iv: RideInterval): VibWindow[] {
  const t0 = rideStart(p) + iv.t0_s * 1000, t1 = rideStart(p) + iv.t1_s * 1000;
  return p.windows.filter((w) => w.t0 >= t0 && w.t1 <= t1);
}
export function shocksInInterval(p: ProcessedRide, iv: RideInterval): Shock[] {
  const t0 = rideStart(p) + iv.t0_s * 1000, t1 = rideStart(p) + iv.t1_s * 1000;
  return p.shocks.filter((s) => s.t >= t0 && s.t <= t1);
}

/** „mm:ss” sau „h:mm:ss” față de începutul turei */
export function fmtOffset(s: number): string {
  const t = Math.max(0, Math.round(s));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), x = t % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`;
}
/** „12:34”, „1:02:03” sau „754” (secunde) → secunde; null dacă nu se poate citi */
export function parseOffset(str: string): number | null {
  const s = str.trim();
  if (!s) return null;
  const parts = s.split(':').map((x) => x.trim());
  if (parts.some((x) => !/^\d+$/.test(x)) || parts.length > 3) return null;
  return parts.reduce((a, x) => a * 60 + Number(x), 0);
}

/** Relativ în aceeași bandă de viteză, în această tură: tercila ferestrei (0 = jos, 1 = mediu, 2 = sus). Doar pentru desen. */
export function relativeTercile(p: ProcessedRide, cfg: VibrationConfig = DEFAULT_CONFIG): (w: VibWindow) => 0 | 1 | 2 | null {
  const bands = compareBands(cfg);
  const cuts = bands.map((band) => {
    const r = p.windows.filter((w) => (band.rvi ? w.valid : isExploratory(w, cfg) && w.speed! >= band.lo && w.speed! < band.hi)).map((w) => w.rms).sort((a, b) => a - b);
    return r.length >= 30 ? [percentileSorted(r, 100 / 3), percentileSorted(r, 200 / 3)] : null;
  });
  return (w) => {
    const i = bands.findIndex((band) => (band.rvi ? w.valid : isExploratory(w, cfg) && w.speed! >= band.lo && w.speed! < band.hi));
    if (i < 0 || !cuts[i]) return null;
    const [a, b] = cuts[i]!;
    return w.rms < a ? 0 : w.rms < b ? 1 : 2;
  };
}

/** distanța minimă (m) de la un punct la o mulțime de muchii */
export function distToEdges(g: Graph, edges: number[], lat: number, lon: number): number {
  let best = Infinity;
  for (const e of edges) for (const [a, b] of g.geometry(e)) best = Math.min(best, haversine(a, b, lat, lon));
  return best;
}
