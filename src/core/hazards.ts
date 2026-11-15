// Evaluarea AUTOMATĂ a problemelor de pe drum, fără verificare manuală obligatorie.
// Nu e un al doilea detector: pornește de la zonele din rideRoughness (aceeași triere a evenimentelor — manevrarea
// telefonului și bicicleta oprită sunt excluse —, aceeași grupare după incertitudinea GPS) și le dă un nivel de încredere.
//
// Niveluri (documentate în docs/DETECTIE-AUTOMATA.md):
//  - „weak”      doar șocuri slabe, o singură trecere → rămâne în Dev, nu e o problemă publică și nu schimbă rutarea;
//  - „possible”  POSIBILĂ problemă: șocuri în ≥ 2 treceri separate sau cel puțin un șoc puternic (≥ 2× pragurile de
//                detecție). Încredere redusă: poate fi o groapă, un capac, o bordură sau o frânare;
//  - „likely”    PROBABILĂ: evenimente cu context bun (viteză în banda RVI, GPS ≤ 10 m, fără ambiguitate
//                carosabil/trotuar) în ≥ 2 treceri SEPARATE. La viteză mică nu se ajunge niciodată aici;
//  - „confirmed” confirmată manual în Dev (Confirmă problemă), cu tipul ales;
//  - „rejected”  respinsă manual (Nu este o problemă): nu se publică și nu schimbă rutarea.
// Pragurile sunt cele existente din VibrationConfig (shock_strong_factor, speed_min, measured_max_acc), nu valori noi.
import { DEFAULT_CONFIG, type VibrationConfig } from './config';
import { haversine } from './geo';
import type { Graph } from './graph';
import { PRIVACY_RADIUS_M, publishFilter, rideEnds } from './publish';
import { clusterPoints, rideRoughness, type RoughZone } from './roughness';
import { median } from './stats';
import type { ProcessedRide } from './types';

export type HazardLevel = 'possible' | 'likely' | 'confirmed';
export type HazardType = 'groapa' | 'denivelare' | 'obstacol';
export const HAZARD_TYPES: HazardType[] = ['groapa', 'denivelare', 'obstacol'];

/** Ce se publică pentru o problemă: doar câmpurile folosite de aplicația pentru bicicliști (hartă și rutare). */
export interface PublicHazard {
  lat: number;
  lon: number;
  /** raza aproximativă (m): întinderea zonei + incertitudinea GPS */
  r: number;
  level: HazardLevel;
  /** doar pentru problemele confirmate manual */
  type?: HazardType;
  /** muchiile grafului pe care stă zona (rutarea penalizează aceste muchii, o singură dată) */
  edges: number[];
  /** ziua ultimei detectări (AAAA-LL-ZZ, fără oră) */
  date: string;
}

export type HazardStatus = HazardLevel | 'weak' | 'rejected';

export interface HazardDetail {
  rides: number;
  passes: number;
  events: number;
  strong: number;
  /** evenimente cu context bun (viteză în bandă, GPS bun, fără ambiguitate) */
  good: number;
  /** viteza mediană a evenimentelor sub banda RVI: interpretarea e mai nesigură */
  slow: boolean;
  speed_p50: number | null;
  rough_ratio: number | null;
  why: string[];
  /** ID-urile detectărilor (pentru verificarea manuală): „<ride_id>:<shock_id>” */
  members: string[];
  /** ID-ul celui mai puternic eveniment (pentru verificarea pe tură) */
  strongest: string;
  street: string | null;
  /** nivelul automat, înainte de decizia manuală */
  auto: HazardLevel | 'weak';
  decision: 'confirmed' | 'rejected' | 'unsure' | null;
  /** de ce nu intră în stratul public (gol = eligibil) */
  excluded: string | null;
}

export interface Hazard extends Omit<PublicHazard, 'level'> {
  id: string;
  level: HazardStatus;
  origin: 'public' | 'local';
  /** doar în Dev, pentru problemele din turele locale */
  detail?: HazardDetail;
}

export const isActive = (h: { level: HazardStatus }): h is { level: HazardLevel } => h.level === 'possible' || h.level === 'likely' || h.level === 'confirmed';

export const HAZARD_LABEL: Record<HazardStatus, string> = {
  confirmed: 'Problemă confirmată',
  likely: 'Problemă probabilă',
  possible: 'Posibilă problemă',
  weak: 'Șocuri slabe (de urmărit)',
  rejected: 'Respinsă: nu e o problemă',
};

export interface Decision { answer: 'yes' | 'no' | 'unsure'; type?: string }

/** tipul public (3 categorii) din tipul ales la verificare */
export function publicType(t: string | undefined): HazardType | undefined {
  if (!t || t === 'nespecificat') return undefined;
  if (t === 'groapa') return 'groapa';
  if (t === 'obstacol' || t === 'alta') return 'obstacol';
  return 'denivelare';
}

const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

interface ZoneItem { p: ProcessedRide; z: RoughZone; members: string[]; lat: number; lon: number; r: number }

export interface AssessOptions {
  cfg?: VibrationConfig;
  graph?: Graph | null;
  decisionOf?: (memberId: string) => Decision | undefined;
}

/** Problemele detectate automat în ture (Dev). Determinist și independent de ordinea turelor. */
export function assessHazards(rides: ProcessedRide[], o: AssessOptions = {}): Hazard[] {
  const cfg = o.cfg ?? DEFAULT_CONFIG;
  const dec = o.decisionOf ?? (() => undefined);
  const items: ZoneItem[] = [];
  for (const p of [...rides].sort((a, b) => (a.ride_id < b.ride_id ? -1 : 1))) {
    for (const z of rideRoughness(p, cfg, o.graph ?? null).zones) {
      items.push({ p, z, members: z.events.map((e) => `${p.ride_id}:${e.shock.id}`), lat: z.lat, lon: z.lon, r: z.radius_m });
    }
  }
  // aceeași zonă văzută în ture diferite = treceri independente (aceeași regulă de legătură ca în tură)
  const cid = clusterPoints(items, cfg.zone_link_min_m);
  const groups = new Map<number, ZoneItem[]>();
  items.forEach((it, i) => { const g = groups.get(cid[i]) ?? []; g.push(it); groups.set(cid[i], g); });
  const keepOf = new Map<string, ReturnType<typeof publishFilter>>();
  const keep = (p: ProcessedRide) => { let k = keepOf.get(p.ride_id); if (!k) { k = publishFilter(p, cfg); keepOf.set(p.ride_id, k); } return k; };

  const out: Hazard[] = [];
  for (const g of groups.values()) {
    const events = g.flatMap((it) => it.z.events.map((e) => ({ e, p: it.p })));
    const members = g.flatMap((it) => it.members);
    const decisions = members.map(dec);
    const rejected = decisions.every((d) => d?.answer === 'no');
    const yes = decisions.find((d) => d?.answer === 'yes');
    const unsure = decisions.some((d) => d?.answer === 'unsure');
    const passes = g.reduce((a, it) => a + it.z.passes, 0);
    const strong = g.reduce((a, it) => a + it.z.n_strong, 0);
    const goodEv = events.filter(({ e }) => e.low.length === 0);
    const good = goodEv.length;
    // „repetat credibil” = evenimente cu context bun în ≥ 2 treceri SEPARATE (aceeași regulă de separare a trecerilor ca în
    // rideRoughness: ciclistul a parcurs mult mai mult decât zona între două evenimente), numărate pe fiecare tură
    const extent = Math.max(0, ...g.map((it) => it.z.extent_m));
    const away = Math.max(50, 3 * (extent + cfg.zone_link_min_m));
    let goodPasses = 0;
    for (const rid of new Set(goodEv.map((x) => x.p.ride_id))) {
      const ds = goodEv.filter((x) => x.p.ride_id === rid).map(({ e }) => e.shock).sort((a, b) => a.t - b.t);
      let n = ds.length ? 1 : 0;
      for (let i = 1; i < ds.length; i++) {
        const a = ds[i - 1], b = ds[i];
        if (a.dist !== undefined && b.dist !== undefined ? b.dist - a.dist > away : b.t - a.t > cfg.pass_gap_s * 1000) n++;
      }
      goodPasses += n;
    }
    const speeds = events.map(({ e }) => e.shock.speed).filter((s): s is number => s !== null);
    const sp = speeds.length ? median(speeds) : null;
    const slow = sp === null || sp < cfg.speed_min;
    const allLow = g.every((it) => it.z.priority === 'low');
    let auto: HazardLevel | 'weak';
    if (allLow && passes < 2) auto = 'weak';
    else if (goodPasses >= 2) auto = 'likely';
    else auto = 'possible';
    const level: HazardStatus = rejected ? 'rejected' : yes ? 'confirmed' : auto;
    const why: string[] = [];
    const nRides = new Set(g.map((x) => x.p.ride_id)).size;
    if (passes >= 2) why.push(`șocuri în ${passes} treceri separate${nRides > 1 ? ` (${nRides} ture)` : ''}`);
    if (strong) why.push(`${strong} ${strong === 1 ? 'șoc puternic' : 'șocuri puternice'} (≥ ${cfg.shock_strong_factor}× pragurile de detecție)`);
    why.push(`${events.length} evenimente, ${good} cu context bun${good ? ` (în ${goodPasses} ${goodPasses === 1 ? 'trecere' : 'treceri'})` : ''}`);
    if (slow) why.push(`viteză mică (~${sp === null ? '?' : Math.round(sp * 3.6)} km/h): încredere redusă, nu ajunge „probabilă” fără confirmare`);
    // poziția: media ponderată cu numărul de evenimente; raza: întinderea dintre zone + raza tipică
    const w = g.map((it) => it.z.events.length);
    const W = w.reduce((a, b) => a + b, 0);
    const lat = g.reduce((a, it, i) => a + it.lat * w[i], 0) / W;
    const lon = g.reduce((a, it, i) => a + it.lon * w[i], 0) / W;
    let spread = 0;
    for (const it of g) spread = Math.max(spread, haversine(lat, lon, it.lat, it.lon));
    const r = Math.round((spread + median(g.map((it) => it.r))) * 10) / 10;
    // muchiile: cele ale evenimentelor (cea mai frecventă prima); fără potrivire, cea mai apropiată stradă
    const cnt = new Map<number, number>();
    for (const { e } of events) if (e.shock.edge >= 0) cnt.set(e.shock.edge, (cnt.get(e.shock.edge) ?? 0) + 1);
    let edges = [...cnt.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]).map(([e]) => e);
    if (!edges.length && o.graph) { const c = o.graph.query(lat, lon, Math.max(15, r))[0]; if (c) edges = [c.edge]; }
    const strongestIt = g.reduce((a, b) => (b.z.peak_max > a.z.peak_max ? b : a));
    // confidențialitate: TOATE evenimentele trebuie să treacă filtrul turei lor, iar zona întreagă să fie în afara razei
    let excluded: string | null = null;
    for (const { e, p } of events) {
      const s = e.shock;
      if (!keep(p)(s.dist ?? -1, s.lat, s.lon)) { excluded = `în primii/ultimii ${cfg.publish_trim_m} m sau la < ${PRIVACY_RADIUS_M} m de capetele turei`; break; }
    }
    if (!excluded) for (const it of g) for (const f of rideEnds(it.p)) if (haversine(f.lat, f.lon, lat, lon) < PRIVACY_RADIUS_M + r) excluded = `zona (±${Math.round(r)} m) atinge raza de ${PRIVACY_RADIUS_M} m din jurul capetelor turei`;
    const ys = yes?.type;
    out.push({
      id: `h${Math.round(lat * 1e5)}_${Math.round(lon * 1e5)}`,
      lat, lon, r, level, origin: 'local',
      ...(level === 'confirmed' && publicType(ys) ? { type: publicType(ys) } : {}),
      edges, date: day(strongestIt.z.strongest.t),
      detail: {
        rides: new Set(g.map((x) => x.p.ride_id)).size, passes, events: events.length, strong, good, slow, speed_p50: sp,
        rough_ratio: g.find((x) => x.z.rough_ratio !== null)?.z.rough_ratio ?? null, why, members,
        strongest: `${strongestIt.p.ride_id}:${strongestIt.z.strongest.id}`, street: strongestIt.z.street,
        auto, decision: rejected ? 'rejected' : yes ? 'confirmed' : unsure ? 'unsure' : null, excluded,
      },
    });
  }
  const rank: Record<HazardStatus, number> = { confirmed: 0, likely: 1, possible: 2, weak: 3, rejected: 4 };
  return out.sort((a, b) => rank[a.level] - rank[b.level] || (b.detail?.passes ?? 0) - (a.detail?.passes ?? 0) || (b.detail?.strong ?? 0) - (a.detail?.strong ?? 0) || (a.id < b.id ? -1 : 1));
}

/** Problemele publicabile: active, fără excluderi de confidențialitate, cu câmpurile minime și poziții rotunjite. */
export function publicHazards(hs: Hazard[], mode: 'all' | 'confirmed' | 'none' = 'all'): PublicHazard[] {
  if (mode === 'none') return [];
  return hs
    .filter((h) => isActive(h) && h.origin === 'local' && !h.detail?.excluded && (mode === 'all' || h.level === 'confirmed'))
    .map((h) => ({ lat: Math.round(h.lat * 1e5) / 1e5, lon: Math.round(h.lon * 1e5) / 1e5, r: Math.round(h.r), level: h.level as HazardLevel, ...(h.type ? { type: h.type } : {}), edges: [...h.edges].sort((a, b) => a - b), date: h.date }))
    .sort((a, b) => a.lat - b.lat || a.lon - b.lon);
}

/** problemele din stratul publicat, în forma folosită de hartă și rutare */
export function fromPublic(ph: PublicHazard[] | undefined): Hazard[] {
  return (ph ?? []).map((h) => ({ ...h, id: `h${Math.round(h.lat * 1e5)}_${Math.round(h.lon * 1e5)}`, origin: 'public' as const }));
}

// ---------------- rutare ----------------
/** Ce probleme influențează alternativa „ocolește problemele”:
 *  - 'confident': confirmate + probabile (implicit);
 *  - 'all': și cele posibile (mod experimental, etichetat ca nesigur). */
export type HazardMode = 'none' | 'confident' | 'all';
export const hazardCounts = (h: { level: HazardStatus }, mode: HazardMode) =>
  mode === 'all' ? isActive(h) : mode === 'confident' ? h.level === 'confirmed' || h.level === 'likely' : false;

/** Penalizarea rutei, în metri echivalenți, pentru trecerea printr-o problemă [EXPERIMENTAL, configurabil]:
 * cât ocol acceptăm ca s-o evităm. O singură dată pe problemă și muchie; nu se adună cu penalizarea clasei măsurate
 * a aceleiași muchii (se ia maximul), ca aceeași vibrație să nu fie numărată de două ori. */
export const HAZARD_PENALTY_M: Record<HazardLevel, number> = { confirmed: 300, likely: 200, possible: 80 };

/** penalizarea suplimentară pe muchii (metri), pentru modul ales */
export function hazardEdgePenalty(hs: Hazard[], mode: HazardMode, pen: Record<HazardLevel, number> = HAZARD_PENALTY_M): Map<number, number> {
  const m = new Map<number, number>();
  if (mode === 'none') return m;
  for (const h of hs) {
    if (!hazardCounts(h, mode)) continue;
    const p = pen[h.level as HazardLevel];
    for (const e of h.edges) m.set(e, Math.max(m.get(e) ?? 0, p)); // mai multe probleme pe aceeași muchie: cea mai gravă
  }
  return m;
}

/** problemele pe care le atinge o rută (după muchii) */
export function hazardsOnRoute(hs: Hazard[], edges: Iterable<number>, mode: HazardMode = 'all'): Hazard[] {
  const set = new Set(edges);
  return hs.filter((h) => hazardCounts(h, mode) && h.edges.some((e) => set.has(e)));
}
