// Generarea și auditul stratului public, folosite și de scripturi (npm run build-layer / audit-layer) și de ShockGrid Dev.
// O singură implementare: aceleași tăieri de confidențialitate, aceleași praguri, aceleași verificări.
import { aggregate, buildSnapshot, toContribution, type Snapshot, type Thresholds } from './aggregate';
import { DEFAULT_CONFIG, type VibrationConfig } from './config';
import { comfortGeoJSON, zoneRows, zonesGeoJSON } from './export';
import { haversine } from './geo';
import { assessHazards, publicHazards, type Decision, type Hazard } from './hazards';
import type { Graph } from './graph';
import { PRIVACY_RADIUS_M } from './publish';
import { publicationId, type PublicationManifest } from './publication';
import { percentileSorted } from './stats';
import type { ProcessedRide } from './types';

/** pragurile = percentilele 20/40/60/80 ale ferestrelor valide ale echipei (calibrare relativă) [EXPERIMENTAL] */
export function teamThresholds(rides: ProcessedRide[]): { thresholds: Thresholds | null; source: string } {
  const all = rides.flatMap((r) => r.windows.filter((w) => w.valid).map((w) => w.rms)).sort((a, b) => a - b);
  const thresholds: Thresholds | null = all.length >= 30 ? ([20, 40, 60, 80].map((q) => Math.round(percentileSorted(all, q) * 1000) / 1000) as Thresholds) : null;
  const source = thresholds ? `percentilele 20/40/60/80 din ${all.length} ferestre valide (${rides.length} ${rides.length === 1 ? 'tură' : 'ture'}); clase relative, necalibrate absolut` : 'implicite (prea puține ferestre)';
  return { thresholds, source };
}

export interface PublicLayerOptions {
  exploratory: boolean;
  /** format vechi: detectări individuale. Ignorat când `hazards` e dat (formatul nou publică doar problemele agregate). */
  shocks: 'none' | 'clean' | 'all';
  /** problemele de pe drum: toate cele active (posibile, probabile, confirmate), doar cele confirmate sau niciuna */
  hazards?: 'all' | 'confirmed' | 'none';
  /** deciziile manuale din Dev (Confirmă / Nu este o problemă / Nu sunt sigur), pe ID-ul detectării */
  decisionOf?: (memberId: string) => Decision | undefined;
  radius_m?: number; note?: string; cfg?: VibrationConfig;
}
export type PublicFileName = 'comfort-layer.json' | 'comfort-layer.geojson' | 'shock-zones.json' | 'shock-zones.geojson' | 'publication.json';
export interface PublicLayerFiles { snap: Snapshot; manifest: PublicationManifest; files: Record<PublicFileName, string>; /** toate problemele evaluate (inclusiv excluse / respinse), pentru Dev */ hazards: Hazard[] }

export function buildPublicLayer(rides: ProcessedRide[], graph: Graph, o: PublicLayerOptions): PublicLayerFiles {
  const cfg = o.cfg ?? DEFAULT_CONFIG;
  const { thresholds, source } = teamThresholds(rides);
  // doar platformele, niciodată numele dispozitivului (Sensor Logger salvează numele dat de utilizator telefonului)
  const platforms = [...new Set(rides.map((r) => r.meta.platform).filter(Boolean))].join(', ');
  const note = o.note ?? `${rides.length} ${rides.length === 1 ? 'tură' : 'ture'}${platforms ? ` (${platforms})` : ''}`;
  const all = o.hazards ? assessHazards(rides, { cfg, graph, decisionOf: o.decisionOf }) : [];
  const snap = buildSnapshot(rides, cfg, note, thresholds, source, {
    exploratory: o.exploratory, shocks: o.hazards ? 'none' : o.shocks, rules: { trim_m: cfg.publish_trim_m, radius_m: o.radius_m ?? PRIVACY_RADIUS_M }, geometry: (e) => graph.geometry(e),
    ...(o.hazards ? { hazards: publicHazards(all, o.hazards) } : {}),
  });
  // versiunea = amprenta conținutului; toate fișierele o poartă, ca o combinație de versiuni să fie detectabilă
  const pid = publicationId(snap);
  snap.meta.publication_id = pid;
  return { snap, ...publicFiles(snap, graph, cfg), hazards: all };
}

/** Setul de golire a hărții publice (Reset demonstrație → harta publică): gol, marcat explicit `reset`. */
export function resetLayer(graph: Graph, cfg: VibrationConfig = DEFAULT_CONFIG): PublicLayerFiles {
  const snap: Snapshot = {
    meta: { processing_version: cfg.processing_version, generated_at: new Date().toISOString(), thresholds: null, thresholds_source: 'harta publică golită intenționat', device_note: '', ride_keys: [], n_rides: 0, includes_exploratory: false, attribution: '© OpenStreetMap contributors', license: 'ODbL-1.0', reset: true },
    edges: [], shocks: [], hazards: [],
  };
  snap.meta.publication_id = publicationId(snap);
  return { snap, ...publicFiles(snap, graph, cfg), hazards: [] };
}

/** fișierele publice derivate dintr-un snapshot cu ID (folosit și pentru seturi construite altfel, de ex. testul sintetic) */
export function publicFiles(snap: Snapshot, graph: Graph, cfg: VibrationConfig = DEFAULT_CONFIG): { manifest: PublicationManifest; files: PublicLayerFiles['files'] } {
  const pid = snap.meta.publication_id ?? publicationId(snap);
  const layer = aggregate({ snapshot: snap, rides: [], surfaceKindOf: (e) => graph.kind[e] ?? null, version: 1, lengthOf: (e) => graph.length[e] });
  const edges = [...layer.edges.values()];
  const meters = (f: (e: (typeof edges)[number]) => boolean) => Math.round(edges.filter(f).reduce((a, e) => a + graph.length[e.edge_id], 0));
  const comfort = comfortGeoJSON(layer, graph) as { properties?: Record<string, unknown> };
  comfort.properties = { ...(comfort.properties ?? {}), publication_id: pid };
  const zones = zonesGeoJSON(layer) as { properties?: Record<string, unknown> };
  zones.properties = { ...(zones.properties ?? {}), publication_id: pid };
  const manifest: PublicationManifest = {
    publication_id: pid,
    generated_at: snap.meta.generated_at,
    processing_version: snap.meta.processing_version,
    files: ['comfort-layer.json', 'comfort-layer.geojson', 'shock-zones.json', 'shock-zones.geojson', 'publication.json'],
    counts: {
      segments: snap.edges.length,
      measured: edges.filter((e) => e.status === 'MEASURED').length,
      low_confidence: edges.filter((e) => e.status === 'LOW_CONFIDENCE').length,
      explored: edges.filter((e) => e.status === 'UNKNOWN' && !!e.explore).length,
      // șocurile publicate sunt candidate detectate automat, niciodată „gropi confirmate”
      // formatul nou: problemele agregate (posibile/probabile = detectate automat, neconfirmate); vechi: zonele de șocuri
      hazards_unverified: snap.hazards ? snap.hazards.filter((h) => h.level !== 'confirmed').length : layer.zones.filter((z) => z.status !== 'REJECTED').length,
      hazards_verified: snap.hazards ? snap.hazards.filter((h) => h.level === 'confirmed').length : 0,
      ...(snap.hazards ? { hazards_possible: snap.hazards.filter((h) => h.level === 'possible').length, hazards_likely: snap.hazards.filter((h) => h.level === 'likely').length } : {}),
      meters: meters(() => true),
      ...(snap.meta.reset ? { reset: true } : {}),
    },
    note: snap.meta.device_note,
  };
  return {
    manifest,
    files: {
      'comfort-layer.json': JSON.stringify(snap),
      'comfort-layer.geojson': JSON.stringify(comfort),
      'shock-zones.json': JSON.stringify({ meta: { license: 'ODbL-1.0', attribution: '© OpenStreetMap contributors', processing_version: cfg.processing_version, publication_id: pid }, zones: zoneRows(layer) }),
      'shock-zones.geojson': JSON.stringify(zones),
      'publication.json': JSON.stringify(manifest, null, 1),
    },
  };
}

/** Cât din traseu vedem, la fiecare pas (m). Separă: GPS → parcurs pe străzi → clasificat confort → public. */
export interface CoverageReport {
  /** distanța GPS a turelor (toate vitezele) */
  gps_m: number;
  /** pe străzi: tronsoanele cu ferestre potrivite (orice viteză de mers ≥ 0,5 m/s), privat, în Dev */
  traversed_m: number;
  /** cu culoare de confort (ferestre RVI valide, 2,5–9 m/s): verde/galben/roșu */
  classified_m: number;
  /** din care „măsurat sigur” (≥ 2 treceri, GPS bun, fără ambiguitate) */
  measured_m: number;
  /** parcurs, neevaluat: încet sau prea puține ferestre */
  unrated_m: number;
  /** în stratul public propus (după confidențialitate) */
  public_m: number;
  public_classified_m: number;
  /** eliminat de regulile de confidențialitate (capetele turei: primii/ultimii 200 m pe traseu și raza de 250 m) */
  excluded_m: number;
}

function coveredMeters(layer: ReturnType<typeof aggregate>, graph: Graph) {
  let all = 0, cls = 0, meas = 0;
  for (const e of layer.edges.values()) {
    if (e.segments) {
      for (const s of e.segments) {
        if (s.cat === 'none') continue;
        const L = s.to_m - s.from_m;
        all += L;
        if (s.cat === 'green' || s.cat === 'yellow' || s.cat === 'red') { cls += L; if (s.status === 'measured') meas += L; }
      }
    } else if (e.status !== 'UNKNOWN' || e.explore) {
      const L = graph.length[e.edge_id];
      all += L;
      if (e.status !== 'UNKNOWN') { cls += L; if (e.status === 'MEASURED') meas += L; }
    }
  }
  return { all, cls, meas };
}

export function coverageReport(rides: ProcessedRide[], graph: Graph, snap: Snapshot | null): CoverageReport {
  const local = aggregate({ rides: rides.map((r) => toContribution(r)), lengthOf: (e) => graph.length[e], version: 1 });
  const pub = snap ? aggregate({ snapshot: snap, rides: [], lengthOf: (e) => graph.length[e], version: 1 }) : null;
  const l = coveredMeters(local, graph), p = pub ? coveredMeters(pub, graph) : { all: 0, cls: 0, meas: 0 };
  const r = (x: number) => Math.round(x);
  return {
    gps_m: r(rides.reduce((a, x) => a + x.summary.distance_m, 0)),
    traversed_m: r(l.all), classified_m: r(l.cls), measured_m: r(l.meas), unrated_m: r(l.all - l.cls),
    public_m: r(p.all), public_classified_m: r(p.cls), excluded_m: r(Math.max(0, l.all - p.all)),
  };
}

export interface AuditRide { p: ProcessedRide; name?: string; file?: string }
export interface AuditCheck { ok: boolean; msg: string }
export interface AuditResult { checks: AuditCheck[]; summary: string[]; ok: boolean }

/** Auditul de confidențialitate al unui strat propus, ÎNAINTE de publicare. Nu afișează coordonate. */
export function auditLayer(snap: Snapshot, publicText: string, rides: AuditRide[], graph: Graph): AuditResult {
  const checks: AuditCheck[] = [];
  const summary: string[] = [];
  const check = (ok: boolean, msg: string) => checks.push({ ok, msg });
  check(!snap.meta.ride_ids?.length, 'fără ID-uri de tură în meta (doar chei de deduplicare)');
  rides.forEach((r, i) => {
    const m = r.p.meta;
    const secrets = [r.p.ride_id, m.ride_key, m.device, m.extra['device id'], m.extra['device name'], m.recording_time, r.name, r.file].filter((x): x is string => typeof x === 'string' && x.length >= 4);
    const leaked = secrets.filter((x) => publicText.includes(x));
    check(leaked.length === 0, `tura ${i + 1}: niciun ID, nume de fișier, nume de dispozitiv sau oră de înregistrare în fișierele publice${leaked.length ? ` (găsit: ${leaked.length})` : ''}`);
  });
  const epochs = (publicText.match(/\b1[6-9]\d{11}\b/g) ?? []).length;
  check(epochs === 0, `niciun timp epoch în ms (${epochs})`);
  check(!/"t"\s*:/.test(JSON.stringify(snap)), 'nicio cheie „t” (timp individual) în snapshot');
  const geo = snap.edges.map((e) => graph.geometry(e.edge_id));
  rides.forEach((r, i) => {
    const good = r.p.gps.filter((f) => f.acc === null || f.acc <= 50);
    if (!good.length) return;
    for (const [lbl, f] of [['început', good[0]], ['sfârșit', good[good.length - 1]]] as const) {
      let dE = Infinity, dS = Infinity;
      for (const g of geo) for (const [a, b] of g) dE = Math.min(dE, haversine(a, b, f.lat, f.lon));
      for (const s of snap.shocks) dS = Math.min(dS, haversine(s.lat, s.lon, f.lat, f.lon));
      for (const h of snap.hazards ?? []) dS = Math.min(dS, haversine(h.lat, h.lon, f.lat, f.lon) - h.r);
      const d = Math.min(dE, dS);
      check(d >= PRIVACY_RADIUS_M - 20, `tura ${i + 1}, ${lbl}: cel mai apropiat segment publicat la ${Number.isFinite(dE) ? Math.round(dE) : '—'} m, șoc la ${Number.isFinite(dS) ? Math.round(dS) : '—'} m (prag ${PRIVACY_RADIUS_M} m; vârfurile geometriei pot fi mai aproape decât ferestrele)`);
    }
  });
  const layer = aggregate({ snapshot: snap, rides: [], surfaceKindOf: (e) => graph.kind[e] ?? null, version: 1, lengthOf: (e) => graph.length[e] });
  const by: Record<string, { n: number; m: number }> = {};
  for (const e of layer.edges.values()) {
    const k = e.status === 'UNKNOWN' ? (e.explore ? 'EXPLORAT' : 'UNKNOWN') : e.status;
    by[k] ??= { n: 0, m: 0 };
    by[k].n++; by[k].m += graph.length[e.edge_id];
  }
  for (const [k, v] of Object.entries(by)) summary.push(`${k}: ${v.n} segmente, ${Math.round(v.m)} m`);
  const secs: Record<string, number> = {};
  for (const e of layer.edges.values()) for (const sg of e.segments ?? []) if (sg.cat !== 'none') { const k = `${sg.cat}${sg.status ? '/' + sg.status : ''}`; secs[k] = (secs[k] ?? 0) + (sg.to_m - sg.from_m); }
  summary.push(`tronsoane pe hartă (m): ${Object.entries(secs).map(([k, v]) => `${k} ${Math.round(v)}`).join(', ') || 'niciunul'}`);
  if (snap.hazards) summary.push(`probleme publicate: ${snap.hazards.length} (${(['confirmed', 'likely', 'possible'] as const).map((l) => `${l} ${snap.hazards!.filter((h) => h.level === l).length}`).join(', ')})`);
  summary.push(`zone cu șocuri: ${layer.zones.length} (${Object.entries(layer.zones.reduce((a: Record<string, number>, z) => ((a[z.status] = (a[z.status] ?? 0) + 1), a), {})).map(([k, v]) => `${k} ${v}`).join(', ') || '—'})`);
  const streets = new Map<string, number>();
  for (const e of snap.edges) { const n = graph.name[e.edge_id] || '(fără nume)'; streets.set(n, (streets.get(n) ?? 0) + graph.length[e.edge_id]); }
  summary.push(`străzi: ${[...streets.entries()].sort((a, b) => b[1] - a[1]).map(([n, m]) => `${n} (${Math.round(m)} m)`).join(', ') || '—'}`);
  // lanțuri continue: componente conexe ale segmentelor publicate (un lanț lung arată o bucată de traseu)
  const ids = new Set(snap.edges.map((e) => e.edge_id));
  const seen = new Set<number>();
  const chains: number[] = [];
  for (const e of ids) {
    if (seen.has(e)) continue;
    let len = 0;
    const st = [e];
    seen.add(e);
    while (st.length) {
      const x = st.pop()!;
      len += graph.length[x];
      for (const n of [graph.from[x], graph.to[x]]) for (const y of graph.edgesAt(n)) if (ids.has(y) && !seen.has(y)) { seen.add(y); st.push(y); }
    }
    chains.push(len);
  }
  chains.sort((a, b) => b - a);
  summary.push(`lanțuri continue de segmente: ${chains.length}; cel mai lung ${Math.round(chains[0] ?? 0)} m (un lanț lung arată o bucată de traseu)`);
  summary.push(`praguri clase: ${JSON.stringify(snap.meta.thresholds)} (${snap.meta.thresholds_source})`);
  return { checks, summary, ok: checks.every((c) => c.ok) };
}
