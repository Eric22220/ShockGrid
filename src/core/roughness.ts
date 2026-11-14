// Din evenimente brute în zone cu vibrații accentuate. Trei dimensiuni separate:
//  A. rugozitatea continuă (RMS pe ferestre) — rămâne în agregare și rutare, nu aici;
//  B. evenimentele izolate (șocuri) — triate aici: artefact de manevrare, oprit, slab, puternic;
//  C. încrederea — viteză, GPS, ambiguitate, treceri independente.
// Nimic nu se șterge: toate evenimentele brute rămân în diagnostic, cu motivul clasificării.
import { DEFAULT_CONFIG, type VibrationConfig } from './config';
import { haversine } from './geo';
import type { Graph } from './graph';
import { EXPLORE_BANDS, isExploratory } from './quality';
import { median, percentileSorted } from './stats';
import type { ProcessedRide, Shock, VibWindow } from './types';

export type EventKind = 'handling' | 'stationary' | 'strong' | 'weak';
export const EVENT_KIND_LABEL: Record<EventKind, string> = {
  handling: 'probabil manevrarea telefonului',
  stationary: 'bicicleta stătea pe loc',
  strong: 'șoc puternic',
  weak: 'șoc slab',
};

export interface EventEvidence {
  shock: Shock;
  kind: EventKind;
  /** de ce are această clasă */
  why: string[];
  /** motive de încredere redusă (context sau poziție); gol = context bun */
  low: string[];
  /** indexul zonei din rezultat; -1 = nu face parte dintr-o zonă */
  zone: number;
  /** eveniment slab, singur: rămâne neverificat în diagnostic, nu formează zonă */
  isolated: boolean;
}

/** Clasificarea unui eveniment din dovezile lui (fără a-l șterge). Pragurile vin din VibrationConfig. */
export function classifyEvent(s: Shock, w: VibWindow | null, cfg: VibrationConfig = DEFAULT_CONFIG): Omit<EventEvidence, 'zone' | 'isolated'> {
  const why: string[] = [];
  const low: string[] = [];
  let kind: EventKind;
  const gyro = s.gyro_max ?? null, tilt = s.tilt ?? null;
  const rot = (gyro !== null && gyro > cfg.gyro_max) || s.flags.includes('gyro');
  const moved = (tilt !== null && tilt > cfg.mount_shift_deg) || s.flags.includes('mount_shift');
  if (rot || moved) {
    kind = 'handling';
    if (rot) why.push(`rotație ${gyro !== null ? Math.round(gyro) + ' °/s' : 'mare'} (prag ${cfg.gyro_max} °/s)`);
    if (moved) why.push(`orientarea telefonului s-a schimbat${tilt !== null ? ` cu ${Math.round(tilt)}°` : ''} (prag ${cfg.mount_shift_deg}°)`);
  } else if (s.speed !== null && s.speed < cfg.shock_min_speed) {
    kind = 'stationary';
    why.push(`viteză ${s.speed.toFixed(1)} m/s (sub ${cfg.shock_min_speed} m/s)`);
  } else {
    const f = cfg.shock_strong_factor;
    const strong = s.z >= f * cfg.shock_z && s.peak >= f * cfg.shock_abs;
    kind = strong ? 'strong' : 'weak';
    why.push(strong ? `vârf ${s.peak.toFixed(1)} m/s² și ${s.z.toFixed(0)}× abaterea locală (≥ ${f}× pragurile)` : `vârf ${s.peak.toFixed(1)} m/s², ${s.z.toFixed(0)}× abaterea locală (sub ${f}× pragurile)`);
  }
  if (s.speed === null) low.push('viteză necunoscută');
  else if (s.speed < cfg.speed_min) low.push(`viteză mică (${Math.round(s.speed * 3.6)} km/h)`);
  else if (s.speed > cfg.speed_max) low.push('viteză mare');
  const acc = w?.acc ?? null;
  if (!s.located) low.push('fără poziție');
  else if (acc !== null && acc > cfg.measured_max_acc) low.push(`GPS slab (±${Math.round(acc)} m)`);
  if (w?.amb) low.push('cale paralelă la fel de aproape');
  if (s.flags.includes('gap')) low.push('gol în date');
  return { shock: s, kind, why, low };
}

/** Grupare: două puncte sunt legate dacă distanța ≤ max(linkMin, √(r1² + r2²)); legătură simplă (componente conexe).
 * Distanța ține cont de incertitudinea GPS a ambelor puncte: nu separăm ce GPS-ul nu poate separa. */
export function clusterPoints(pts: { lat: number; lon: number; r: number }[], linkMin: number): number[] {
  const n = pts.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const order = pts.map((_, i) => i).sort((a, b) => pts[a].lat - pts[b].lat);
  const maxR = Math.max(0, ...pts.map((p) => p.r));
  const maxLink = Math.max(linkMin, Math.SQRT2 * maxR);
  const dLat = maxLink / 111195;
  for (let x = 0; x < n; x++) {
    const i = order[x];
    for (let y = x + 1; y < n; y++) {
      const j = order[y];
      if (pts[j].lat - pts[i].lat > dLat) break;
      const link = Math.max(linkMin, Math.hypot(pts[i].r, pts[j].r));
      if (haversine(pts[i].lat, pts[i].lon, pts[j].lat, pts[j].lon) <= link) parent[find(i)] = find(j);
    }
  }
  const ids = new Map<number, number>();
  return pts.map((_, i) => { const root = find(i); if (!ids.has(root)) ids.set(root, ids.size); return ids.get(root)!; });
}

export type ZonePriority = 'high' | 'medium' | 'low';
export const PRIORITY_LABEL: Record<ZonePriority, string> = { high: 'Prioritate mare', medium: 'Prioritate medie', low: 'Prioritate mică' };

export interface RoughZone {
  id: string;
  events: EventEvidence[];
  lat: number;
  lon: number;
  /** întinderea aproximativă (m), fără incertitudinea GPS */
  extent_m: number;
  /** raza afișată: jumătate din întindere + incertitudinea GPS tipică */
  radius_m: number;
  passes: number;
  n_strong: number;
  peak_max: number;
  strongest: Shock;
  speed_p50: number | null;
  acc_p50: number | null;
  /** fracția evenimentelor cu context de încredere redusă */
  low_ratio: number;
  /** vibrația continuă din zonă față de restul turei, la aceeași viteză (mediana raporturilor); null = prea puține ferestre */
  rough_ratio: number | null;
  rough_n: number;
  street: string | null;
  priority: ZonePriority;
  why: string[];
}

export interface RideRoughness {
  events: EventEvidence[];
  zones: RoughZone[];
  counts: { raw: number; handling: number; stationary: number; isolated: number; unlocated: number; in_zones: number; zones: number; review: number; high: number; strong: number };
}

/** Numele străzii evenimentului sau, pe o alee fără nume, al celei mai apropiate străzi cu nume (≤ 40 m). */
function streetNear(g: Graph, s: Shock): string | null {
  if (s.edge >= 0 && g.name[s.edge]) return g.name[s.edge];
  if (s.lat === null || s.lon === null) return null;
  const c = g.query(s.lat, s.lon, 40).find((x) => !!g.name[x.edge]);
  return c ? `lângă ${g.name[c.edge]}` : null;
}

/** Banda de viteză a unei ferestre (pentru comparații „la aceeași viteză”). */
function bandKey(w: VibWindow, cfg: VibrationConfig): string | null {
  if (w.valid) return 'rvi';
  if (!isExploratory(w, cfg)) return null;
  const b = EXPLORE_BANDS.find((x) => w.speed! >= x.lo && w.speed! < Math.min(x.hi, cfg.speed_min));
  return b?.id ?? null;
}

/** Evenimentele turei triate și grupate în zone. Numărul de zone rezultă din date. */
export function rideRoughness(p: ProcessedRide, cfg: VibrationConfig = DEFAULT_CONFIG, graph?: Graph | null): RideRoughness {
  const W = p.windows;
  const winAt = (t: number) => {
    let lo = 0, hi = W.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (W[m].t1 <= t) lo = m + 1; else hi = m; }
    return lo < W.length && t >= W[lo].t0 ? W[lo] : null;
  };
  const events: EventEvidence[] = p.shocks.map((s) => ({ ...classifyEvent(s, winAt(s.t), cfg), zone: -1, isolated: false }));
  const cand = events.filter((e) => (e.kind === 'strong' || e.kind === 'weak') && e.shock.located && e.shock.lat !== null && e.shock.lon !== null);
  const cid = clusterPoints(cand.map((e) => ({ lat: e.shock.lat!, lon: e.shock.lon!, r: e.shock.r ?? 10 })), cfg.zone_link_min_m);
  const groups = new Map<number, EventEvidence[]>();
  cand.forEach((e, i) => { const g = groups.get(cid[i]) ?? []; g.push(e); groups.set(cid[i], g); });

  // vibrația continuă: raportul fiecărei ferestre la mediana benzii ei de viteză din tura întreagă
  const bandMed = new Map<string, number>();
  const byBand = new Map<string, number[]>();
  for (const w of W) { const k = bandKey(w, cfg); if (k) { const a = byBand.get(k) ?? []; a.push(w.rms); byBand.set(k, a); } }
  for (const [k, a] of byBand) if (a.length >= 20) bandMed.set(k, median(a));

  const zones: RoughZone[] = [];
  for (const g of groups.values()) {
    const nStrong = g.filter((e) => e.kind === 'strong').length;
    if (g.length < 2 && nStrong === 0) { g[0].isolated = true; continue; }
    g.sort((a, b) => a.shock.t - b.shock.t);
    const lat = g.reduce((a, e) => a + e.shock.lat!, 0) / g.length;
    const lon = g.reduce((a, e) => a + e.shock.lon!, 0) / g.length;
    let extent = 0;
    for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) extent = Math.max(extent, haversine(g[i].shock.lat!, g[i].shock.lon!, g[j].shock.lat!, g[j].shock.lon!));
    // treceri independente: între două evenimente din zonă, ciclistul a parcurs mult mai mult decât zona (a plecat și a revenit)
    const away = Math.max(50, 3 * (extent + cfg.zone_link_min_m));
    let passes = 1;
    for (let i = 1; i < g.length; i++) {
      const a = g[i - 1].shock, b = g[i].shock;
      const left = a.dist !== undefined && b.dist !== undefined ? b.dist - a.dist > away : b.t - a.t > cfg.pass_gap_s * 1000;
      if (left) passes++;
    }
    const strongest = g.reduce((a, b) => (b.shock.peak > a.shock.peak ? b : a)).shock;
    const rs = g.map((e) => e.shock.r ?? 10).sort((a, b) => a - b);
    const radius = extent / 2 + percentileSorted(rs, 50);
    const sp = g.map((e) => e.shock.speed).filter((v): v is number => v !== null).sort((a, b) => a - b);
    const ws = W.filter((w) => w.lat !== null && w.lon !== null && haversine(lat, lon, w.lat, w.lon) <= radius);
    const ratios = ws.map((w) => { const k = bandKey(w, cfg); const m = k ? bandMed.get(k) : undefined; return m ? w.rms / m : null; }).filter((x): x is number => x !== null);
    const accs = ws.map((w) => w.acc).filter((a): a is number => a !== null).sort((a, b) => a - b);
    const lowN = g.filter((e) => e.low.length > 0).length;
    const credibleStrong = g.some((e) => e.kind === 'strong' && e.low.length === 0);
    // mare: observat în treceri separate sau un șoc puternic credibil; medie: cel puțin un șoc puternic; mică: doar șocuri slabe
    const priority: ZonePriority = passes >= 2 || credibleStrong ? 'high' : nStrong >= 1 ? 'medium' : 'low';
    const why: string[] = [];
    if (passes >= 2) why.push(`evenimente în ${passes} treceri separate`);
    if (credibleStrong) why.push('șoc puternic la viteză normală, cu GPS bun');
    else if (nStrong) why.push(`${nStrong} ${nStrong === 1 ? 'șoc puternic' : 'șocuri puternice'} cu încredere redusă`);
    if (g.length >= 3) why.push(`${g.length} evenimente grupate`);
    if (lowN === g.length) why.push('toate cu context de încredere redusă');
    const street = graph ? streetNear(graph, strongest) : null;
    const zi = zones.length;
    g.forEach((e) => (e.zone = zi));
    zones.push({
      id: `${p.ride_id}:z${Math.round(strongest.t)}`,
      events: g, lat, lon, extent_m: extent, radius_m: radius, passes, n_strong: nStrong, peak_max: strongest.peak, strongest,
      speed_p50: sp.length ? percentileSorted(sp, 50) : null,
      acc_p50: accs.length ? percentileSorted(accs, 50) : null,
      low_ratio: lowN / g.length,
      rough_ratio: ratios.length >= 5 ? median(ratios) : null,
      rough_n: ratios.length,
      street, priority, why,
    });
  }
  const rank = { high: 0, medium: 1, low: 2 };
  const order = zones.map((z, i) => i).sort((a, b) => rank[zones[a].priority] - rank[zones[b].priority] || zones[b].passes - zones[a].passes || zones[b].n_strong - zones[a].n_strong || zones[b].peak_max - zones[a].peak_max);
  const remap = new Map(order.map((old, i) => [old, i]));
  const sorted = order.map((i) => zones[i]);
  for (const e of events) if (e.zone >= 0) e.zone = remap.get(e.zone)!;
  const counts = {
    raw: events.length,
    handling: events.filter((e) => e.kind === 'handling').length,
    stationary: events.filter((e) => e.kind === 'stationary').length,
    isolated: events.filter((e) => e.isolated).length,
    unlocated: events.filter((e) => (e.kind === 'strong' || e.kind === 'weak') && !(e.shock.located && e.shock.lat !== null)).length,
    in_zones: events.filter((e) => e.zone >= 0).length,
    zones: sorted.length,
    review: sorted.filter((z) => z.priority !== 'low').length,
    high: sorted.filter((z) => z.priority === 'high').length,
    strong: events.filter((e) => e.kind === 'strong').length,
  };
  return { events, zones: sorted, counts };
}
