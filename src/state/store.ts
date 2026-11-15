// Starea aplicației: graful, snapshotul, turele locale și stratul de confort derivat (8.6).
import { useSyncExternalStore } from 'react';
import {
  aggregate, diffLayers, inSnapshot, toContribution,
  type ComfortLayer, type LayerDiff, type Snapshot, type Thresholds,
} from '../core/aggregate';
import { DEFAULT_CONFIG, type VibrationConfig } from '../core/config';
import { Graph, type GraphJson } from '../core/graph';
import { assessHazards, type HazardMode } from '../core/hazards';
import { haversine } from '../core/geo';
import { ImportError } from '../core/io';
import { assignOffsets } from '../core/mapmatch';
import { matchProcessed } from '../core/process';
import {
  DEFAULT_ROUTE_OPTIONS, PROFILES, Router, mainComponent, routeStats,
  type ProfileKey, type RouteOptions, type RouteResult, type RouteStats,
} from '../core/route';
import type { DeclaredSurface, ProcessedRide } from '../core/types';
import * as idb from '../storage/idb';
import { IS_DEV_APP, LIVE_BASE } from '../appkind';
import { parseSnapshot, snapshotVersion } from '../core/publication';
import { deleteRoute, finishRoute, HISTORY_KEY, recoverRoutes, startRoute, type RouteEntry } from '../services/history';
import { processInWorker } from '../worker/client';
import type { Place } from '../services/geocode';
import { createReport, shockKey, type ReviewAnswer, type ShockReview } from '../services/reports';
import type { Shock } from '../core/types';
import type { RideInterval } from '../core/corridor';

export interface Settings {
  cfg: VibrationConfig;
  fixedThresholds: Thresholds | null;
  developer: boolean;
  route: RouteOptions;
  profile: ProfileKey;
  showReview: boolean;
  showZones: boolean;
  /** stilul hărții de fundal: auto = estompată în modul întunecat */
  mapStyle: 'auto' | 'light' | 'dark';
  /** „Contribuie cu măsurători în timpul navigării”: pornit explicit de utilizator */
  contribute: boolean;
  /** aplicația pentru bicicliști: arată și datele incerte / parcurse încet (controlul straturilor; implicit nu) */
  showUncertain: boolean;
  /** experimental: alternativa „Ocolește problemele” ține cont și de problemele posibile (neconfirmate) */
  avoidUncertain: boolean;
}

export interface ImportReport {
  ride_id: string;
  diff: LayerDiff;
  layer_version_before: number;
  layer_version_after: number;
  route: { status: 'none' | 'same' | 'changed'; text: string } ;
}

export interface RoutePair {
  shortest: { r: RouteResult; s: RouteStats } | null;
  chosen: { r: RouteResult; s: RouteStats } | null;
  layerVersion: number;
  error?: string;
}

export interface Plan {
  origin: Place | null;
  dest: Place | null;
}

export interface AppState {
  reports: idb.LocalReport[];
  reviews: Record<string, ShockReview>;
  recent: Place[];
  /** rutele pornite din aplicație (doar pe acest telefon) */
  routeHistory: RouteEntry[];
  plan: Plan;
  graph: Graph | null;
  graphStatus: 'loading' | 'ready' | 'missing' | 'error';
  snapshot: Snapshot | null;
  snapshotStatus: 'loading' | 'ready' | 'missing';
  /** ultima verificare reușită a stratului publicat (ms) */
  snapshotCheckedAt: number | null;
  rides: idb.StoredRide[];
  layer: ComfortLayer;
  lastImport: ImportReport | null;
  ab: { a: [number, number] | null; b: [number, number] | null };
  settings: Settings;
  rejected: string[];
  ready: boolean;
  evalResults: unknown | null;
}

const BASE = import.meta.env.BASE_URL;

const defaultSettings: Settings = {
  cfg: DEFAULT_CONFIG,
  fixedThresholds: null,
  developer: false,
  route: DEFAULT_ROUTE_OPTIONS,
  profile: 'balanced',
  showReview: false,
  showZones: true,
  mapStyle: 'auto',
  contribute: false,
  showUncertain: false,
  avoidUncertain: false,
};

/** ce probleme folosește alternativa „Ocolește problemele” */
export const hazardModeOf = (s: Settings): HazardMode => (s.avoidUncertain ? 'all' : 'confident');

let state: AppState = {
  reports: [],
  reviews: {},
  recent: [],
  routeHistory: [],
  plan: { origin: null, dest: null },
  graph: null,
  graphStatus: 'loading',
  snapshot: null,
  snapshotStatus: 'loading',
  snapshotCheckedAt: null,
  rides: [],
  layer: aggregate({ rides: [], version: 0 }),
  lastImport: null,
  ab: { a: null, b: null },
  settings: defaultSettings,
  rejected: [],
  ready: false,
  evalResults: null,
};
const listeners = new Set<() => void>();
function set(patch: Partial<AppState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}
export function getState() { return state; }
export function useApp<T>(sel: (s: AppState) => T): T {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => sel(state));
}

let router: Router | null = null;
let compCache: Uint8Array | null = null;
export function getRouter() {
  if (!router && state.graph) router = new Router(state.graph);
  return router;
}

function buildLayer(rides: idb.StoredRide[], version: number, s: AppState = state): ComfortLayer {
  const g = s.graph;
  const layer = aggregate({
    snapshot: s.snapshot,
    rides: rides.map((r) => toContribution(r.processed, r.included)),
    cfg: s.settings.cfg,
    surfaceKindOf: g ? (e) => g.kind[e] ?? null : undefined,
    rejected: new Set(s.rejected),
    confirmed: new Set(Object.entries(s.reviews).filter(([, r]) => r.answer === 'yes').map(([k]) => k)),
    fixedThresholds: s.settings.fixedThresholds,
    version,
    lengthOf: g ? (e) => g.length[e] : undefined,
  });
  // problemele din turele locale (Dev), evaluate automat; deciziile manuale le confirmă sau le resping. Și turele deja
  // publicate se evaluează local (verificarea rămâne posibilă); o problemă publicată din același loc e înlocuită de cea
  // locală, ca să nu apară de două ori pe hartă sau în rutare.
  // Doar în Dev: aplicația pentru bicicliști arată exclusiv problemele PUBLICATE (turele vechi rămase în baza ei locală,
  // din perioada dinaintea separării, nu creează probleme pe harta sau în rutele bicicliștilor).
  const local = IS_DEV_APP ? rides.filter((r) => r.included).map((r) => r.processed) : [];
  if (local.length) {
    const mine = assessHazards(local, { cfg: s.settings.cfg, graph: g, decisionOf: (k) => s.reviews[k] });
    const dup = (h: { lat: number; lon: number; r: number }) => mine.some((m) => haversine(m.lat, m.lon, h.lat, h.lon) <= Math.max(m.r, h.r, s.settings.cfg.zone_link_min_m));
    layer.hazards = [...layer.hazards.filter((h) => !dup(h)), ...mine];
  }
  return layer;
}

function recompute(rides = state.rides) {
  const layer = buildLayer(rides, state.layer.version + 1);
  set({ rides, layer });
  return layer;
}

export const lengthOf = (e: number) => state.graph?.length[e] ?? 0;

/** doar pentru teste: graful fără fetch */
export function _testSetGraph(g: Graph | null) { set({ graph: g, graphStatus: g ? 'ready' : 'missing' }); router = null; compCache = null; }

// ---------------- inițializare ----------------
let snapshotWatch = false;
/** de unde citim stratul publicat: aplicația pentru bicicliști din propriul site; Dev din site-ul LIVE al bicicliștilor
 * (copia din build-ul Dev poate fi mai veche), cu revenire la propria copie */
const SNAPSHOT_URLS = IS_DEV_APP ? [`${LIVE_BASE}data/comfort-layer.json`, `${BASE}data/comfort-layer.json`] : [`${BASE}data/comfort-layer.json`];

/**
 * Citește stratul publicat (revalidare HTTP; service worker-ul ține ultima versiune pentru offline). Un răspuns
 * stricat sau lipsă NU șterge stratul deja încărcat. Întoarce true dacă s-a încărcat o versiune nouă.
 */
export async function refreshSnapshot(fetcher: typeof fetch = fetch): Promise<boolean> {
  for (const url of SNAPSHOT_URLS) {
    try {
      const r = await fetcher(url, { cache: 'no-cache' });
      if (!r.ok || !(r.headers.get('content-type') ?? '').includes('json')) continue;
      const snap = parseSnapshot(await r.json());
      if (!snap) continue;
      const changed = snapshotVersion(snap) !== snapshotVersion(state.snapshot);
      if (changed) { set({ snapshot: snap, snapshotStatus: 'ready', snapshotCheckedAt: Date.now() }); recompute(); }
      else set({ snapshotStatus: 'ready', snapshotCheckedAt: Date.now() });
      return changed;
    } catch { /* încercăm următoarea sursă; fără rețea păstrăm ce avem */ }
  }
  if (!state.snapshot) set({ snapshotStatus: 'missing' });
  return false;
}

export async function init() {
  const saved = await idb.kvGet<Partial<Settings>>('settings');
  const rejected = (await idb.kvGet<string[]>('rejected')) ?? [];
  const ab = (await idb.kvGet<AppState['ab']>('ab')) ?? { a: null, b: null };
  const settings: Settings = { ...defaultSettings, ...(saved ?? {}), cfg: { ...DEFAULT_CONFIG, ...(saved?.cfg ?? {}), processing_version: DEFAULT_CONFIG.processing_version }, route: routeOpts(saved?.route) };
  const rides = (await idb.listRides()).map((r) => ({ ...r, file: null }));
  const reviews = (await idb.kvGet<Record<string, ShockReview>>('shock-reviews')) ?? {};
  const recent = (await idb.kvGet<Place[]>('recent-places')) ?? [];
  // o navigare rămasă activă la închiderea aplicației devine „întreruptă” (nu „terminată”)
  const rawHistory = await idb.kvGet<unknown>(HISTORY_KEY);
  const routeHistory = recoverRoutes(rawHistory);
  if (JSON.stringify(routeHistory) !== JSON.stringify(rawHistory ?? [])) await idb.kvSet(HISTORY_KEY, routeHistory).catch(() => {});
  const plan = (await idb.kvGet<Plan>('plan')) ?? { origin: null, dest: null };
  set({ settings, rejected, ab, rides, reviews, recent, routeHistory, plan, reports: await idb.listReports() });
  recompute(rides);
  set({ ready: true });

  const okJson = (r: Response) => (r.ok && (r.headers.get('content-type') ?? '').includes('json') ? r.json() : null);
  const snapP = refreshSnapshot();
  if (typeof document !== 'undefined' && !snapshotWatch) {
    // la revenirea în aplicație: există o versiune nouă a stratului publicat?
    snapshotWatch = true;
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void refreshSnapshot(); });
  }
  fetch(`${BASE}data/eval-latest.json`, { cache: 'no-cache' }).then(okJson).then((e) => set({ evalResults: e })).catch(() => {});
  const graphP = fetch(`${BASE}data/graph-timisoara.json`)
    .then(async (r) => {
      if (!r.ok || !(r.headers.get('content-type') ?? '').includes('json')) { set({ graphStatus: 'missing' }); return; }
      const j = (await r.json()) as GraphJson;
      set({ graph: new Graph(j), graphStatus: 'ready' });
      router = null;
      compCache = null;
    })
    .catch((e) => { console.warn(e); set({ graphStatus: 'error' }); });
  await Promise.all([snapP, graphP]);
  // turele procesate fără graf se potrivesc acum pe hartă
  if (state.graph) {
    let changed = false;
    for (const r of state.rides) {
      // ture potrivite înainte de sg-1.2.0: poziția ferestrelor pe muchie (pentru tronsoane), fără reprocesare
      if (r.processed.match.graph_available && r.processed.windows.some((w) => w.edge >= 0 && w.off === undefined)) {
        assignOffsets(r.processed.windows, state.graph);
        const full = await idb.getRide(r.ride_id);
        if (full) await idb.putRide({ ...full, processed: r.processed });
        changed = true;
      }
    }
    for (const r of state.rides)
      if (!r.processed.match.graph_available) {
        matchProcessed(r.processed, state.graph, state.settings.cfg);
        const full = await idb.getRide(r.ride_id);
        if (full) await idb.putRide({ ...full, processed: r.processed });
        changed = true;
      }
    if (changed) recompute([...state.rides]);
  }
  recompute();
}

// ---------------- rutare ----------------
/** opțiunile de rutare salvate, fără chei vechi (ex. „allowSidewalks”, eliminată: trotuarele nu sunt niciodată permise) */
export function routeOpts(saved?: Partial<RouteOptions> | null): RouteOptions {
  const o = { ...DEFAULT_ROUTE_OPTIONS };
  if (saved && typeof saved.p_unknown === 'number') o.p_unknown = saved.p_unknown;
  if (saved && typeof saved.w_c === 'number') o.w_c = saved.w_c;
  if (saved && typeof saved.useOsmSurface === 'boolean') o.useOsmSurface = saved.useOsmSurface;
  return o;
}

export function snapNode(lat: number, lon: number): number {
  const g = state.graph;
  if (!g) return -1;
  if (!compCache) compCache = mainComponent(g);
  const comp = compCache;
  return g.nearestNode(lat, lon, (n) => comp[n] === 1, 600);
}

export function computeRoutes(layer: ComfortLayer = state.layer, profile: ProfileKey = state.settings.profile): RoutePair {
  const g = state.graph;
  const { a, b } = state.ab;
  if (!g || !a || !b) return { shortest: null, chosen: null, layerVersion: layer.version };
  const rt = getRouter()!;
  const src = snapNode(a[0], a[1]), dst = snapNode(b[0], b[1]);
  if (src < 0 || dst < 0) return { shortest: null, chosen: null, layerVersion: layer.version, error: 'Punctul ales e prea departe de rețeaua rutabilă.' };
  const base = state.settings.route;
  const oS = { ...base, w_c: 0 };
  const oC = { ...base, w_c: PROFILES[profile] };
  const rs = rt.route(src, dst, layer, oS);
  const rc = rt.route(src, dst, layer, oC);
  if (!rs.found) return { shortest: null, chosen: null, layerVersion: layer.version, error: 'Nu există rută legală pe bicicletă între A și B (sens unic, trotuare sau căi interzise bicicletelor).' };
  return {
    shortest: { r: rs, s: routeStats(g, layer, rs, oC) },
    chosen: rc.found ? { r: rc, s: routeStats(g, layer, rc, oC) } : null,
    layerVersion: layer.version,
  };
}

export async function setAB(ab: AppState['ab']) {
  set({ ab });
  await idb.kvSet('ab', ab).catch(() => {});
}

// ---------------- setări ----------------
export async function updateSettings(patch: Partial<Settings>) {
  const settings = { ...state.settings, ...patch };
  set({ settings });
  if (patch.cfg || patch.fixedThresholds !== undefined) recompute();
  await idb.kvSet('settings', settings).catch(() => {});
}

// ---------------- import / ștergere (8.6) ----------------
function sameRoute(x: RouteResult | undefined, y: RouteResult | undefined) {
  if (!x || !y) return x === y;
  return x.edges.length === y.edges.length && x.edges.every((e, i) => e.edge === y.edges[i].edge);
}

function routeChangeText(before: RoutePair, after: RoutePair, diff: LayerDiff): ImportReport['route'] {
  if (!state.ab.a || !state.ab.b || !after.chosen) return { status: 'none', text: 'Nu e aleasă o pereche A–B pe ecranul Rută.' };
  if (!sameRoute(before.chosen?.r, after.chosen.r)) return { status: 'changed', text: 'Ruta recomandată între A și B s-a schimbat după import.' };
  const onRoutes = new Set([...(before.chosen?.r.edges ?? []), ...after.chosen.r.edges, ...(after.shortest?.r.edges ?? [])].map((e) => e.edge));
  const touchedOnRoute = diff.touched_edges.some((e) => onRoutes.has(e));
  return {
    status: 'same',
    text: touchedOnRoute
      ? 'Ruta recomandată a rămas aceeași: segmentele atinse sunt pe rută, dar diferența de cost nu schimbă alegerea.'
      : 'Ruta recomandată a rămas aceeași: segmentele noi nu sunt pe rutele dintre A și B.',
  };
}

export class DuplicateRideError extends ImportError {
  constructor(msg: string, readonly rideId: string | null) { super(msg); }
}

export async function importFile(file: File, declared: DeclaredSurface, onProgress?: (stage: string, frac: number) => void): Promise<{ ride: ProcessedRide; report: ImportReport }> {
  const bytes = await file.arrayBuffer();
  return importBytes(file.name, bytes, declared, onProgress);
}

export async function importBytes(name: string, bytes: ArrayBuffer, declared: DeclaredSurface, onProgress?: (stage: string, frac: number) => void) {
  const p = await processInWorker(name, bytes, state.settings.cfg, declared, onProgress);
  if (state.rides.some((r) => r.ride_id === p.ride_id)) throw new DuplicateRideError('Tura e deja importată pe acest telefon; nu o adăugăm a doua oară, ca trecerile să nu se numere de două ori.', p.ride_id);
  if (inSnapshot(state.snapshot, p.ride_id)) throw new DuplicateRideError('Tura face deja parte din datele publicate de echipă; nu se importă din nou.', null);
  if (state.graph) { onProgress?.('potrivire pe hartă', 0.92); matchProcessed(p, state.graph, state.settings.cfg, declared); }
  const before = state.layer;
  const routeBefore = computeRoutes(before);
  const stored: idb.StoredRide = { ride_id: p.ride_id, processed: p, file_name: name, file: bytes, included: true, imported_at: Date.now() };
  await idb.putRide(stored);
  const after = recompute([...state.rides, { ...stored, file: null }]);
  const diff = diffLayers(before, after, lengthOf);
  const routeAfter = computeRoutes(after);
  const report: ImportReport = { ride_id: p.ride_id, diff, layer_version_before: before.version, layer_version_after: after.version, route: routeChangeText(routeBefore, routeAfter, diff) };
  set({ lastImport: report });
  onProgress?.('gata', 1);
  return { ride: p, report };
}

export async function removeRide(id: string) {
  await idb.deleteRide(id);
  recompute(state.rides.filter((r) => r.ride_id !== id));
}

export async function setIncluded(id: string, included: boolean) {
  const full = await idb.getRide(id);
  if (full) await idb.putRide({ ...full, included });
  recompute(state.rides.map((r) => (r.ride_id === id ? { ...r, included } : r)));
}

export async function setRideFields(id: string, patch: Partial<Pick<idb.StoredRide, 'perceived'>> & { label?: string }) {
  const full = await idb.getRide(id);
  if (!full) return;
  const processed = patch.label !== undefined ? { ...full.processed, meta: { ...full.processed.meta, label: patch.label } } : full.processed;
  const upd = { ...full, ...('perceived' in patch ? { perceived: patch.perceived } : {}), processed };
  await idb.putRide(upd);
  set({ rides: state.rides.map((r) => (r.ride_id === id ? { ...upd, file: null } : r)) });
}

/** intervalele declarate din filmare (doar local; nu schimbă măsurătorile) */
export async function setRideIntervals(id: string, intervals: RideInterval[]) {
  const full = await idb.getRide(id);
  if (!full) return;
  const upd = { ...full, intervals };
  await idb.putRide(upd);
  set({ rides: state.rides.map((r) => (r.ride_id === id ? { ...upd, file: null } : r)) });
}

export async function setDeclaredSurface(id: string, declared: DeclaredSurface) {
  const full = await idb.getRide(id);
  if (!full) return;
  if (state.graph) matchProcessed(full.processed, state.graph, state.settings.cfg, declared);
  else full.processed.meta.declared_surface = declared;
  await idb.putRide(full);
  recompute(state.rides.map((r) => (r.ride_id === id ? { ...full, file: null } : r)));
}

/** Reprocesare cu configurația curentă, din fișierul original */
export async function reprocessRide(id: string, onProgress?: (s: string, f: number) => void) {
  const full = await idb.getRide(id);
  if (!full?.file) throw new Error('Fișierul original nu e disponibil pentru reprocesare.');
  const p = await processInWorker(full.file_name, full.file, state.settings.cfg, full.processed.meta.declared_surface ?? null, onProgress);
  if (state.graph) matchProcessed(p, state.graph, state.settings.cfg);
  p.meta.label = full.processed.meta.label;
  const upd = { ...full, processed: p };
  await idb.putRide(upd);
  recompute(state.rides.map((r) => (r.ride_id === id ? { ...upd, file: null } : r)));
}

export async function getRideFile(id: string) {
  return (await idb.getRide(id))?.file ?? null;
}

export async function rejectZone(memberIds: string[], reject: boolean) {
  const s = new Set(state.rejected);
  memberIds.forEach((m) => (reject ? s.add(m) : s.delete(m)));
  const rejected = [...s];
  set({ rejected });
  await idb.kvSet('rejected', rejected).catch(() => {});
  recompute();
}

export async function wipeAll() {
  await idb.clearAll();
  set({ rides: [], rejected: [], lastImport: null, ab: { a: null, b: null }, settings: defaultSettings, reports: [], reviews: {}, recent: [], routeHistory: [], plan: { origin: null, dest: null } });
  recompute([]);
}

// ---------------- rapoarte personale (doar pe dispozitiv) ----------------
export async function saveReport(r: idb.LocalReport) {
  await idb.putReport(r);
  set({ reports: [r, ...state.reports.filter((x) => x.id !== r.id)].sort((a, b) => b.created_at - a.created_at) });
}

export async function removeReport(id: string) {
  await idb.deleteReport(id);
  const reviews = Object.fromEntries(Object.entries(state.reviews).map(([k, v]) => [k, v.report_id === id ? { ...v, report_id: undefined } : v]));
  set({ reports: state.reports.filter((x) => x.id !== id), reviews });
  await idb.kvSet('shock-reviews', reviews).catch(() => {});
}

/** Răspunsul utilizatorului pentru o denivelare candidată: Da → raport local; Nu → detectarea e respinsă. */
export async function reviewShock(rideId: string, shock: Shock, answer: ReviewAnswer, type?: idb.ReportType) {
  const key = shockKey(rideId, shock.id);
  const prev = state.reviews[key];
  let report_id = prev?.report_id;
  if (answer === 'yes' && shock.lat !== null && shock.lon !== null) {
    const existing = report_id ? state.reports.find((r) => r.id === report_id) : undefined;
    const rep = existing
      ? { ...existing, type: type ?? existing.type, status: 'local' as const, updated_at: Date.now() }
      : createReport({ lat: shock.lat, lon: shock.lon, acc: shock.r, type: type ?? 'nespecificat', source: 'shock', shock_ref: key, now: shock.t });
    if (rep.type === 'nespecificat') rep.status = 'draft';
    await saveReport(rep);
    report_id = rep.id;
  } else if (answer !== 'yes' && report_id) {
    await idb.deleteReport(report_id);
    set({ reports: state.reports.filter((x) => x.id !== report_id) });
    report_id = undefined;
  }
  const reviews = { ...state.reviews, [key]: { answer, type: answer === 'yes' ? type : undefined, report_id, at: Date.now() } };
  set({ reviews });
  await idb.kvSet('shock-reviews', reviews).catch(() => {});
  const rej = new Set(state.rejected);
  if (answer === 'no') rej.add(key); else rej.delete(key);
  set({ rejected: [...rej] });
  await idb.kvSet('rejected', [...rej]).catch(() => {});
  recompute();
}

/** Răspunsul pentru o ZONĂ: se aplică tuturor evenimentelor din zonă. Da → un singur raport local, în centrul zonei
 * (raza = incertitudinea zonei); Nu → toate detectările zonei sunt respinse; Nu sunt sigur → rămân neverificate. */
export async function reviewZone(rideId: string, zone: { lat: number; lon: number; radius_m: number; members: Shock[]; strongest: Shock }, answer: ReviewAnswer, type?: idb.ReportType) {
  const keys = zone.members.map((m) => shockKey(rideId, m.id));
  let report_id = keys.map((k) => state.reviews[k]?.report_id).find((x): x is string => !!x);
  if (answer === 'yes') {
    const existing = report_id ? state.reports.find((r) => r.id === report_id) : undefined;
    const rep = existing
      ? { ...existing, type: type ?? existing.type, status: 'local' as const, updated_at: Date.now() }
      : createReport({ lat: zone.lat, lon: zone.lon, acc: Math.round(zone.radius_m), type: type ?? 'nespecificat', source: 'shock', shock_ref: shockKey(rideId, zone.strongest.id), now: zone.strongest.t });
    if (rep.type === 'nespecificat') rep.status = 'draft';
    await saveReport(rep);
    report_id = rep.id;
  } else if (report_id) {
    await idb.deleteReport(report_id);
    set({ reports: state.reports.filter((x) => x.id !== report_id) });
    report_id = undefined;
  }
  const at = Date.now();
  const reviews = { ...state.reviews };
  for (const k of keys) reviews[k] = { answer, type: answer === 'yes' ? type : undefined, report_id, at };
  set({ reviews });
  await idb.kvSet('shock-reviews', reviews).catch(() => {});
  const rej = new Set(state.rejected);
  for (const k of keys) { if (answer === 'no') rej.add(k); else rej.delete(k); }
  set({ rejected: [...rej] });
  await idb.kvSet('rejected', [...rej]).catch(() => {});
  recompute();
}

/** Decizia manuală pentru o problemă detectată automat (Dev): se aplică tuturor detectărilor ei.
 * Confirmă → „confirmată” (cu tipul ales); Nu este o problemă → respinsă (nu se publică, nu schimbă rutarea);
 * Nu sunt sigur → rămâne la nivelul automat. Nu creează rapoarte personale. */
export async function reviewHazard(members: string[], answer: ReviewAnswer, type?: idb.ReportType) {
  const at = Date.now();
  const reviews = { ...state.reviews };
  for (const k of members) reviews[k] = { ...(reviews[k] ?? {}), answer, type: answer === 'yes' ? type : undefined, at };
  const rej = new Set(state.rejected);
  for (const k of members) { if (answer === 'no') rej.add(k); else rej.delete(k); }
  set({ reviews, rejected: [...rej] });
  await idb.kvSet('shock-reviews', reviews).catch(() => {});
  await idb.kvSet('rejected', [...rej]).catch(() => {});
  recompute();
}

/** Reset demonstrație, LOCAL: șterge din baza acestui site (ShockGrid Dev: „shockgrid-dev”) turele importate, analizele,
 * deciziile de verificare, rapoartele locale și starea demo-ului. NU atinge harta publică, aplicația pentru bicicliști
 * (baza „shockgrid”), alte telefoane sau fișierele ZIP originale. Setările rămân. */
export async function resetLocalDemo(): Promise<{ rides: number; reviews: number; reports: number }> {
  const counts = { rides: state.rides.length, reviews: Object.keys(state.reviews).length, reports: state.reports.length };
  // ștergere țintită (nu clearAll): setările, istoricul rutelor, destinațiile recente și o eventuală înregistrare în curs rămân
  for (const r of state.rides) await idb.deleteRide(r.ride_id);
  for (const r of await idb.listRides()) await idb.deleteRide(r.ride_id);
  for (const r of await idb.listReports()) await idb.deleteReport(r.id);
  const blank: Record<string, unknown> = { 'shock-reviews': {}, rejected: [], ab: { a: null, b: null }, plan: { origin: null, dest: null } };
  for (const [k, v] of Object.entries(blank)) await idb.kvSet(k, v).catch(() => {});
  await idb.kvDelete('zones-cache').catch(() => {});
  set({ rides: [], rejected: [], lastImport: null, ab: { a: null, b: null }, reports: [], reviews: {}, plan: { origin: null, dest: null } });
  recompute([]);
  return counts;
}

// ---------------- planificarea rutei ----------------
export async function setPlan(plan: Plan) {
  set({ plan, ab: { a: plan.origin ? [plan.origin.lat, plan.origin.lon] : null, b: plan.dest ? [plan.dest.lat, plan.dest.lon] : null } });
  await idb.kvSet('plan', { origin: plan.origin?.kind === 'mylocation' ? plan.origin : plan.origin, dest: plan.dest }).catch(() => {});
  await idb.kvSet('ab', state.ab).catch(() => {});
}

/** istoric local de destinații (max. 8), niciodată publicat */
export async function addRecent(p: Place) {
  if (p.kind === 'mylocation') return;
  const recent = [{ ...p, source: 'recent' as const }, ...state.recent.filter((x) => !(Math.abs(x.lat - p.lat) < 1e-5 && Math.abs(x.lon - p.lon) < 1e-5))].slice(0, 8);
  set({ recent });
  await idb.kvSet('recent-places', recent).catch(() => {});
}

export async function clearRecent() {
  set({ recent: [] });
  await idb.kvSet('recent-places', []).catch(() => {});
}

// ---------------- istoricul rutelor (doar local) ----------------
async function saveHistory(routeHistory: RouteEntry[]) {
  set({ routeHistory });
  await idb.kvSet(HISTORY_KEY, routeHistory).catch(() => {});
}
/** „Pornește”: întoarce ID-ul intrării active */
export async function historyStart(i: Parameters<typeof startRoute>[1]): Promise<string> {
  const { list, entry } = startRoute(state.routeHistory, i);
  await saveHistory(list);
  return entry.id;
}
export async function historyFinish(id: string, how: 'ended' | 'arrived') { await saveHistory(finishRoute(state.routeHistory, id, how)); }
export async function historyDelete(id: string) { await saveHistory(deleteRoute(state.routeHistory, id)); }
export async function historyClear() { await saveHistory([]); }
