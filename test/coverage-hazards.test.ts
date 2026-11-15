// Acoperire GPS completă, detecția automată a problemelor, rutarea care le ocolește, publicarea și resetul demo-ului.
// Datele de aici sunt SINTETICE (generate în test), cu excepția blocului final „tura reală”, care rulează doar local
// (SG_REAL_RIDE='rides/<fișier>.zip') și nu e publicat nicăieri.
import 'fake-indexeddb/auto';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { aggregate, toContribution, type Snapshot } from '../src/core/aggregate';
import { DEFAULT_THRESHOLDS } from '../src/core/config';
import { haversine } from '../src/core/geo';
import { Graph, type GraphJson } from '../src/core/graph';
import { assessHazards, fromPublic, hazardEdgePenalty, HAZARD_PENALTY_M, publicHazards, type Hazard } from '../src/core/hazards';
import { parseRideFile } from '../src/core/io';
import { processRide } from '../src/core/process';
import { publicationId, validatePublicDataset } from '../src/core/publication';
import { auditLayer, buildPublicLayer, coverageReport, resetLayer } from '../src/core/publiclayer';
import { PRIVACY_RADIUS_M, rideEnds } from '../src/core/publish';
import { DEFAULT_ROUTE_OPTIONS, Router, penaltyOf } from '../src/core/route';
import { planRoutes } from '../src/core/routeplan';
import type { GpsFix, ProcessedRide, RawRide } from '../src/core/types';
import * as idb from '../src/storage/idb';
import * as store from '../src/state/store';
import { hasFile, makeGraph, readBytes } from './helpers';

// ---------------- generator SINTETIC ----------------
const LAT = 45.75, LON = 21.22;
const dLon = (m: number) => m / 77600, dLat = (m: number) => m / 111195;
/** stradă dreaptă de 4 km, 8 segmente de 500 m */
const STREET = Array.from({ length: 9 }, (_, i) => [LAT, LON + dLon(i * 500)] as [number, number]);
const gStreet = makeGraph(STREET, STREET.slice(1).map((_, i) => ({ f: i, t: i + 1, highway: 'residential' })));

interface SynthOpts {
  key: string;
  /** lungimea parcursă pe stradă (m), dus-întors */
  len: number;
  speed: number;
  /** amplitudinea RMS a vibrației verticale în funcție de poziția pe stradă (m) */
  amp?: (d: number) => number;
  /** șocuri (poziție pe stradă, m); `once` = doar la dus */
  shocks?: { at: number; once?: boolean; peak?: number }[];
  /** manevrarea telefonului: rotație mare + vârf, la dus */
  handling?: number[];
  acc?: number;
}
/** Tură SINTETICĂ dus-întors pe STREET: vibrație dependentă de poziție, șocuri la poziții fixe, GPS 1 Hz. */
function synthRide(o: SynthOpts): RawRide {
  const fs = 100, L = o.len, total = 2 * L, secs = total / o.speed;
  const amp = o.amp ?? (() => 0.35);
  const fwd = (s: number) => { const d = s * o.speed; return d <= L ? d : total - d; };
  const at = (d: number): [number, number] => [LAT, LON + dLon(d)];
  const t0 = 1_800_000_000_000;
  const pulses: { t: number; a: number }[] = [];
  for (const sh of o.shocks ?? []) {
    pulses.push({ t: sh.at / o.speed, a: sh.peak ?? 30 });
    if (!sh.once) pulses.push({ t: (total - sh.at) / o.speed, a: sh.peak ?? 30 });
  }
  const handT = (o.handling ?? []).map((d) => d / o.speed);
  for (const t of handT) pulses.push({ t, a: 30 });
  const n = Math.floor(secs * fs);
  const T = new Float64Array(n), X = new Float32Array(n), Y = new Float32Array(n), Z = new Float32Array(n), G = new Float32Array(n);
  let st = 7;
  const rnd = () => ((st = (st * 16807) % 2147483647) / 2147483647 - 0.5) * 2;
  for (let i = 0; i < n; i++) {
    const s = i / fs;
    let v = amp(fwd(s)) * Math.SQRT2 * Math.sin(2 * Math.PI * 12 * s) + 0.05 * rnd();
    for (const p of pulses) if (s >= p.t && s < p.t + 0.03) v += p.a * Math.sin((Math.PI * (s - p.t)) / 0.03);
    T[i] = t0 + s * 1000; Z[i] = 9.81 + v;
    G[i] = handT.some((t) => Math.abs(s - t) < 0.5) ? 420 : 5;
  }
  const gps: GpsFix[] = [];
  for (let k = 0; k <= secs; k++) {
    const d = fwd(k);
    const [lat, lon] = at(d);
    gps.push({ t: t0 + k * 1000, lat: lat + dLat(0.3 * Math.sin(k)), lon, acc: o.acc ?? 5, alt: null, speed: o.speed, heading: k * o.speed <= L ? 90 : 270, speedAcc: null });
  }
  return {
    meta: { source: 'shockgrid', ride_key: `SINTETIC:${o.key}`, start_ms: t0, stop_ms: T[n - 1], orientation_aware: true, warnings: [], extra: {} },
    motion: { t: T, x: X, y: Y, z: Z, withGravity: true },
    gyro: { t: T, mag: G },
    gps, events: [],
  };
}
const nearHazards = (hs: Hazard[], d: number, r = 30) => hs.filter((h) => haversine(h.lat, h.lon, LAT, LON + dLon(d)) < r);

let fast: ProcessedRide, slow: ProcessedRide, rough: ProcessedRide;
beforeAll(() => {
  // rapid (18 km/h), 3 km dus-întors: șoc la 2200 m în ambele treceri, unul singur la 1700 m, manevrare la 2600 m
  fast = processRide(synthRide({ key: 'rapid', len: 3000, speed: 5, shocks: [{ at: 2200 }, { at: 1700, once: true }], handling: [2600] }), { graph: gStreet });
  // lent (3,6 km/h), 1 km dus-întors, cu șocuri repetate la 700 m
  slow = processRide(synthRide({ key: 'lent', len: 1000, speed: 1, shocks: [{ at: 700 }] }), { graph: gStreet });
  // BUN → DENIVELAT → BUN: vibrație mare doar pe 1200–1260 m
  rough = processRide(synthRide({ key: 'denivelat', len: 3000, speed: 5, amp: (d) => (d >= 1200 && d < 1260 ? 3.0 : 0.35) }), { graph: gStreet });
});

describe('P0-1. acoperirea GPS completă', () => {
  it('1. o tură predominant lentă rămâne vizibilă în Dev (traseu complet + străzi parcurse)', () => {
    expect(slow.windows.filter((w) => w.valid)).toHaveLength(0); // nimic în banda RVI
    expect(slow.track.length).toBe(slow.gps.length); // traseul complet, la orice viteză
    const c = coverageReport([slow], gStreet, null);
    expect(c.gps_m).toBeGreaterThan(1900);
    expect(c.traversed_m).toBeGreaterThan(900); // ~1 km de stradă parcursă
    expect(c.classified_m).toBe(0);
    expect(c.unrated_m).toBe(c.traversed_m);
  });
  it('2. explorarea lentă NU devine verde: „Parcurs, neevaluat”, iar rutarea o tratează ca necunoscută', () => {
    const layer = aggregate({ rides: [toContribution(slow)], lengthOf: (e) => gStreet.length[e], fixedThresholds: DEFAULT_THRESHOLDS, version: 1 });
    const edges = [...layer.edges.values()];
    expect(edges.length).toBeGreaterThan(0);
    for (const e of edges) {
      expect(e.class).toBeNull();
      expect(e.rough).toBeNull();
      for (const s of e.segments ?? []) expect(['explore', 'insufficient', 'none']).toContain(s.cat);
      const p = penaltyOf(gStreet, layer, e.edge_id, DEFAULT_ROUTE_OPTIONS);
      expect(p.cat).toBe('unknown');
      expect(p.p).toBeGreaterThan(0); // necunoscutul nu e niciodată „neted”
    }
    // publicat (cu explorarea), dar fără culoare
    const pub = buildPublicLayer([slow], gStreet, { exploratory: true, shocks: 'none', hazards: 'all' });
    expect(pub.manifest.counts.measured + pub.manifest.counts.low_confidence).toBe(0);
    expect(pub.manifest.counts.explored).toBeGreaterThan(0);
  });
  it('3. un eveniment puternic de manevrare a telefonului nu face drumul roșu și nu devine problemă', () => {
    expect(nearHazards(assessHazards([fast], { graph: gStreet }), 2600)).toHaveLength(0);
    const layer = aggregate({ rides: [toContribution(fast)], lengthOf: (e) => gStreet.length[e], fixedThresholds: DEFAULT_THRESHOLDS, version: 1 });
    const e5 = layer.edges.get(5)!; // 2500–3000 m
    const segAt = e5.segments!.find((s) => s.from_m <= 100 && s.to_m > 100)!;
    expect(segAt.cat).not.toBe('red');
  });
});

describe('P0-2. evaluarea automată', () => {
  it('4. șocurile credibile repetate devin problemă fără verificare manuală; unul singur rămâne „posibil”', () => {
    const hs = assessHazards([fast], { graph: gStreet });
    const rep = nearHazards(hs, 2200);
    expect(rep).toHaveLength(1);
    expect(rep[0].level).toBe('likely'); // 2 treceri, viteză în bandă, GPS bun
    expect(rep[0].detail!.decision).toBeNull();
    expect(rep[0].edges).toContain(4);
    const once = nearHazards(hs, 1700);
    expect(once).toHaveLength(1);
    expect(once[0].level).toBe('possible'); // un șoc puternic izolat: poate fi orice, nu o groapă verificată
    // la viteză mică: niciodată „probabilă” fără confirmare
    const sl = nearHazards(assessHazards([slow], { graph: gStreet }), 700);
    expect(sl).toHaveLength(1);
    expect(sl[0].level).toBe('possible');
    expect(sl[0].detail!.slow).toBe(true);
  });
  it('5. BUN → DENIVELAT → BUN: tronsonul denivelat e local, porțiunile netede rămân netede', () => {
    const layer = aggregate({ rides: [toContribution(rough)], lengthOf: (e) => gStreet.length[e], fixedThresholds: DEFAULT_THRESHOLDS, version: 1 });
    const e2 = layer.edges.get(2)!; // 1000–1500 m
    const segs = e2.segments!.filter((s) => s.cat !== 'none');
    expect(segs[0].cat).toBe('green');
    expect(segs[segs.length - 1].cat).toBe('green');
    const bad = segs.filter((s) => s.cat === 'red' || s.cat === 'yellow');
    expect(bad.length).toBeGreaterThan(0);
    const badLen = bad.reduce((a, s) => a + s.to_m - s.from_m, 0);
    expect(badLen).toBeLessThan(150); // nu toată strada
    expect(Math.min(...bad.map((s) => s.from_m))).toBeGreaterThan(150);
    for (const id of [0, 1, 3, 4]) expect(layer.edges.get(id)!.rough).toBe('green');
  });
  it('decizia manuală: confirmarea crește încrederea (cu tip), respingerea o scoate', () => {
    const id = nearHazards(assessHazards([slow], { graph: gStreet }), 700)[0].detail!.members;
    const yes = assessHazards([slow], { graph: gStreet, decisionOf: (k) => (id.includes(k) ? { answer: 'yes', type: 'groapa' } : undefined) });
    expect(nearHazards(yes, 700)[0]).toMatchObject({ level: 'confirmed', type: 'groapa' });
    const no = assessHazards([slow], { graph: gStreet, decisionOf: (k) => (id.includes(k) ? { answer: 'no' } : undefined) });
    expect(nearHazards(no, 700)[0].level).toBe('rejected');
    const unsure = assessHazards([slow], { graph: gStreet, decisionOf: (k) => (id.includes(k) ? { answer: 'unsure' } : undefined) });
    expect(nearHazards(unsure, 700)[0].level).toBe('possible');
  });
});

// ---------------- rutare: „scară” A→B, cu o paralelă ----------------
function ladder(o: { parallelNorth?: number; parallelKind?: 'trotuar' } = {}) {
  const N = o.parallelNorth ?? 80;
  const nodes: [number, number][] = [[LAT, LON], [LAT, LON + dLon(300)], [LAT, LON + dLon(600)], [LAT + dLat(N), LON], [LAT + dLat(N), LON + dLon(600)]];
  const k = o.parallelKind;
  return makeGraph(nodes, [
    { f: 0, t: 1 }, { f: 1, t: 2 }, // drumul scurt A–M–B (600 m)
    { f: 0, t: 3, kind: k, highway: k ? 'footway' : 'residential' }, { f: 3, t: 4, kind: k, highway: k ? 'footway' : 'residential' }, { f: 4, t: 2, kind: k, highway: k ? 'footway' : 'residential' },
  ]);
}
const hz = (level: Hazard['level'], edges = [0]): Hazard => ({ id: `h${level}`, lat: LAT, lon: LON + dLon(150), r: 12, level, edges, date: '2026-11-15', origin: 'public' });
const layerWith = (hs: Hazard[], snapshot: Snapshot | null = null) => { const l = aggregate({ snapshot, rides: [], version: Math.random(), fixedThresholds: DEFAULT_THRESHOLDS }); l.hazards = hs; return l; };
const plan = (g: Graph, hs: Hazard[], mode: 'confident' | 'all' = 'confident') => planRoutes(g, layerWith(hs), new Router(g), 0, 2, DEFAULT_ROUTE_OPTIONS, { zones: [], reports: [] }, mode);

describe('P0-3. rutarea care ocolește problemele', () => {
  it('6. o problemă detectată automat influențează rutarea doar după regulile de încredere', () => {
    const g = ladder();
    expect(plan(g, [hz('likely')]).options.map((o) => o.key)).toContain('avoid'); // probabilă: implicit
    expect(plan(g, [hz('confirmed')]).options.map((o) => o.key)).toContain('avoid');
    const poss = plan(g, [hz('possible')]); // posibilă: doar în modul experimental
    expect(poss.options.map((o) => o.key)).not.toContain('avoid');
    expect(poss.hazardText).toMatch(/posibile probleme/);
    // posibilă = penalizare moderată (80 m): justifică un ocol mic (+40 m), nu unul de +160 m
    expect(plan(ladder({ parallelNorth: 20 }), [hz('possible')], 'all').options.map((o) => o.key)).toContain('avoid');
    expect(plan(g, [hz('possible')], 'all').options.map((o) => o.key)).not.toContain('avoid');
    expect(plan(g, [hz('weak')], 'all').options.map((o) => o.key)).not.toContain('avoid');
    // ruta cea mai scurtă nu e niciodată penalizată
    expect(plan(g, [hz('confirmed')]).options[0].r.edges.map((e) => e.edge)).toEqual([0, 1]);
  });
  it('7. o problemă respinsă manual nu mai influențează rutarea', () => {
    const g = ladder();
    const r = plan(g, [hz('rejected')], 'all');
    expect(r.options.map((o) => o.key)).not.toContain('avoid');
    expect(r.options[0].hazards).toHaveLength(0);
    expect(hazardEdgePenalty([hz('rejected')], 'all').size).toBe(0);
    // și pe date reale de tură: respingerea scoate penalizarea
    const members = nearHazards(assessHazards([fast], { graph: gStreet }), 2200)[0].detail!.members;
    const rej = assessHazards([fast], { graph: gStreet, decisionOf: (k) => (members.includes(k) ? { answer: 'no' } : undefined) });
    expect(hazardEdgePenalty(rej, 'all').get(4)).toBeUndefined();
    expect(publicHazards(rej).some((h) => haversine(h.lat, h.lon, LAT, LON + dLon(2200)) < 30)).toBe(false);
  });
  it('8. alternativa validă ocolește problema, cu geometrie cu adevărat diferită', () => {
    const r = plan(ladder(), [hz('likely')]);
    const s = r.options[0], a = r.options.find((o) => o.key === 'avoid')!;
    expect(s.hazards).toHaveLength(1);
    expect(a.avoided).toHaveLength(1);
    expect(a.hazards).toHaveLength(0);
    expect(a.r.edges.map((e) => e.edge)).toEqual([2, 3, 4]);
    expect(a.s.length - s.s.length).toBeGreaterThan(100);
    expect(a.r.edges.some((e) => e.edge === 0)).toBe(false);
  });
  it('9. fără o alternativă rezonabilă, ruta rămâne aceeași și interfața nu inventează o îmbunătățire', () => {
    const line = makeGraph([[LAT, LON], [LAT, LON + dLon(300)], [LAT, LON + dLon(600)]], [{ f: 0, t: 1 }, { f: 1, t: 2 }]);
    const r = plan(line, [hz('confirmed')]);
    expect(r.options).toHaveLength(1);
    expect(r.hazardText).toMatch(/nu există o variantă legală/);
    const far = plan(ladder({ parallelNorth: 2500 }), [hz('confirmed')]); // ocol de +5 km
    expect(far.options.map((o) => o.key)).not.toContain('avoid');
    expect(far.hazardText).toMatch(/ocol rezonabil|prea mare/);
    // aceeași vibrație nu se numără de două ori: pe o muchie măsurată E, problema nu adaugă peste clasa măsurată
    const snap: Snapshot = { meta: { processing_version: 'x', generated_at: '', thresholds: DEFAULT_THRESHOLDS, thresholds_source: '', device_note: '', attribution: '', license: '' }, edges: [{ edge_id: 0, rms: Array(8).fill(5), speed: Array(8).fill(5), acc: Array(8).fill(4), n_total: 8, n_amb: 0, n_passes: 2, n_rides: 2, last_seen: '2026-11-15', sources: ['shockgrid'] }], shocks: [] };
    const g = ladder();
    const l = layerWith([hz('likely')], snap);
    const c = new Router(g).costs(l, { ...DEFAULT_ROUTE_OPTIONS, w_c: 1, hazard_mode: 'confident' });
    expect(c[0]).toBeCloseTo(g.length[0] * (1 + 1.6), 6); // clasa E (1,6 × 300 m = 480 m) > penalizarea problemei (200 m)
    const c2 = new Router(g).costs(layerWith([hz('likely')]), { ...DEFAULT_ROUTE_OPTIONS, w_c: 0, hazard_mode: 'confident' });
    expect(c2[0]).toBeCloseTo(g.length[0] + HAZARD_PENALTY_M.likely, 6);
  });
  it('10. legalitatea pentru biciclete rămâne: nu ocolim pe trotuar', () => {
    const r = plan(ladder({ parallelKind: 'trotuar' }), [hz('confirmed')]);
    expect(r.options.map((o) => o.key)).not.toContain('avoid');
    for (const o of r.options) expect(o.r.edges.some((e) => e.edge >= 2)).toBe(false);
  });
});

describe('P0-5. publicarea și aplicația pentru bicicliști', () => {
  let pub: ReturnType<typeof buildPublicLayer>;
  beforeAll(() => { pub = buildPublicLayer([fast], gStreet, { exploratory: true, shocks: 'clean', hazards: 'all' }); });
  it('11. toate înregistrările publicate trec validarea de confidențialitate și structură', () => {
    expect(validatePublicDataset(pub.snap)).toEqual([]);
    expect(pub.snap.shocks).toHaveLength(0); // formatul nou: fără detectări individuale
    expect(pub.snap.hazards!.length).toBeGreaterThan(0);
    for (const h of pub.snap.hazards!) expect(Object.keys(h).every((k) => ['lat', 'lon', 'r', 'level', 'type', 'edges', 'date'].includes(k))).toBe(true);
    const text = Object.values(pub.files).join('');
    expect(text).not.toMatch(/\b1[6-9]\d{11}\b/);
    expect(text).not.toContain(fast.ride_id);
    expect(auditLayer(pub.snap, text, [{ p: fast }], gStreet).ok).toBe(true);
    for (const h of pub.snap.hazards!) for (const f of rideEnds(fast)) expect(haversine(h.lat, h.lon, f.lat, f.lon)).toBeGreaterThanOrEqual(PRIVACY_RADIUS_M);
    expect(pub.manifest.counts.hazards_likely).toBe(1);
    // o problemă cu un câmp străin sau tip pe una neconfirmată e refuzată
    const bad = JSON.parse(JSON.stringify(pub.snap)) as Snapshot;
    (bad.hazards![0] as unknown as Record<string, unknown>).members = ['r1:s1'];
    bad.hazards!.push({ ...bad.hazards![0], level: 'possible', type: 'groapa' });
    bad.meta.publication_id = publicationId(bad);
    expect(validatePublicDataset(bad).join(' ')).toMatch(/câmp nepermis într-o problemă: members/);
    expect(validatePublicDataset(bad).join(' ')).toMatch(/tipul problemei/);
  });
  it('12–13. publicarea din Dev ajunge la aplicația de pe ALT telefon (fără import): segmente și probleme', async () => {
    const serve = (body: string) => (async () => new Response(body, { status: 200, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch;
    store._testSetGraph(gStreet);
    expect(await store.refreshSnapshot(serve(pub.files['comfort-layer.json']))).toBe(true);
    const s = store.getState();
    expect(s.rides).toHaveLength(0); // celălalt telefon nu are ture
    expect(s.snapshot!.meta.publication_id).toBe(pub.snap.meta.publication_id);
    expect(s.layer.edges.size).toBe(pub.snap.edges.length);
    expect(s.layer.hazards.map((h) => h.level).sort()).toEqual(pub.snap.hazards!.map((h) => h.level).sort());
    // rutarea pe acel telefon folosește problemele publicate
    expect(hazardEdgePenalty(s.layer.hazards, 'confident').get(4)).toBe(HAZARD_PENALTY_M.likely);
  });
  it('14. resetul datelor locale ale demo-ului nu șterge stratul deja publicat', async () => {
    await idb.putRide({ ride_id: fast.ride_id, processed: fast, file_name: 'SINTETIC.zip', file: null, included: true, imported_at: 1 });
    const hid = await store.historyStart({ origin: { id: 'me', name: 'Locația mea', detail: '', lat: 0, lon: 0, kind: 'mylocation', source: 'gps' }, originAt: null, dest: { id: 'u', name: 'UVT', detail: '', lat: LAT, lon: LON, kind: 'place', source: 'photon' }, distance_m: 100, minutes: 1 });
    const before = store.getState().snapshot!.meta.publication_id;
    const n = await store.resetLocalDemo();
    const s = store.getState();
    expect(n.rides).toBeGreaterThanOrEqual(0);
    expect(await idb.listRides()).toHaveLength(0);
    expect(s.snapshot!.meta.publication_id).toBe(before); // harta publică neatinsă
    expect(s.layer.edges.size).toBe(pub.snap.edges.length);
    expect(s.routeHistory.map((e) => e.id)).toContain(hid); // istoricul rutelor nu se șterge implicit
    expect((await idb.kvGet<{ id: string }[]>('route-history'))!.map((e) => e.id)).toContain(hid);
  });
  it('15. golirea intenționată a hărții publice o înlocuiește complet; versiunea veche nu mai e afișată', async () => {
    const reset = resetLayer(gStreet);
    expect(validatePublicDataset(reset.snap)).toEqual([]);
    expect(reset.manifest.counts.reset).toBe(true);
    // un set gol fără marcajul `reset` nu se poate publica din greșeală
    const accidental = JSON.parse(JSON.stringify(reset.snap)) as Snapshot;
    delete accidental.meta.reset;
    accidental.meta.publication_id = publicationId(accidental);
    expect(validatePublicDataset(accidental).join(' ')).toMatch(/gol/);
    const serve = (body: string) => (async () => new Response(body, { status: 200, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch;
    expect(await store.refreshSnapshot(serve(reset.files['comfort-layer.json']))).toBe(true);
    const s = store.getState();
    expect(s.snapshot!.meta.publication_id).toBe(reset.snap.meta.publication_id);
    expect(s.layer.edges.size).toBe(0);
    expect(s.layer.hazards).toHaveLength(0);
    // un răspuns stricat nu readuce versiunea veche și nici nu golește nimic
    expect(await store.refreshSnapshot(serve('{nu e json'))).toBe(false);
    expect(store.getState().snapshot!.meta.publication_id).toBe(reset.snap.meta.publication_id);
  });
  it('16. nicio înregistrare privată sau credențială în git sau în aplicația pentru bicicliști', () => {
    const files = execSync('git ls-files', { encoding: 'utf8' }).split('\n');
    expect(files.filter((f) => /^(rides|sample-data|eval\/private)\//.test(f) || /\.zip$/i.test(f))).toEqual([]);
    const src = ['src/core/hazards.ts', 'src/dev/DemoReset.tsx', 'src/dev/Hazards.tsx'].map((f) => readFileSync(f, 'utf8')).join('');
    for (const w of ['localStorage', 'sessionStorage', 'github_pat_', 'ghp_']) expect(src.replace(/placeholder="github_pat_…"/g, ''), w).not.toContain(w);
  });
});

// ---------------- tura reală (privată, doar local) ----------------
const REAL = process.env.SG_REAL_RIDE ?? '';
const GRAPH = 'public/data/graph-timisoara.json';
describe.skipIf(!REAL || !hasFile(REAL) || !hasFile(GRAPH))('tura reală (privată, locală): acoperire și probleme', () => {
  let g!: Graph, p!: ProcessedRide;
  beforeAll(() => {
    g = new Graph(JSON.parse(readFileSync(GRAPH, 'utf8')) as GraphJson);
    p = processRide(parseRideFile('real.zip', readBytes(REAL)), { graph: g });
  });
  it('traseul GPS complet e vizibil privat, mult peste cei 220 m clasificabili', () => {
    const c = coverageReport([p], g, null);
    expect(p.track.length).toBeGreaterThan(0.95 * p.gps.length);
    expect(c.gps_m).toBeGreaterThan(2000);
    expect(c.traversed_m).toBeGreaterThan(5 * c.classified_m);
    expect(c.traversed_m).toBeGreaterThan(1500);
  });
  it('lentul nu devine verde: culorile vin doar din ferestrele RVI valide', () => {
    const layer = aggregate({ rides: [toContribution(p)], lengthOf: (e) => g.length[e], version: 1 });
    for (const e of layer.edges.values()) {
      if (!e.n_windows) expect(e.rough).toBeNull();
      for (const s of e.segments ?? []) if (s.cat === 'green' || s.cat === 'yellow' || s.cat === 'red') expect(s.n).toBeGreaterThanOrEqual(3);
    }
  });
  it('probleme detectate automat fără nicio verificare manuală; la viteză mică doar „posibile”', () => {
    const hs = assessHazards([p], { graph: g });
    expect(hs.filter((h) => h.level === 'possible').length).toBeGreaterThan(5);
    expect(hs.filter((h) => h.level === 'likely')).toHaveLength(0);
    const pubH = publicHazards(hs);
    expect(pubH.length).toBeGreaterThan(0);
    for (const h of pubH) for (const f of rideEnds(p)) expect(haversine(h.lat, h.lon, f.lat, f.lon) - h.r).toBeGreaterThanOrEqual(PRIVACY_RADIUS_M);
  });
  it('stratul public propus trece validarea și auditul, cu traseul parcurs și problemele', () => {
    const L = buildPublicLayer([p], g, { exploratory: true, shocks: 'none', hazards: 'all' });
    expect(validatePublicDataset(L.snap)).toEqual([]);
    expect(auditLayer(L.snap, Object.values(L.files).join(''), [{ p }], g).ok).toBe(true);
    expect(L.manifest.counts.meters).toBeGreaterThan(1000);
    expect(L.manifest.counts.hazards_unverified).toBeGreaterThan(0);
    const layer = aggregate({ snapshot: L.snap, rides: [], version: 1, lengthOf: (e) => g.length[e] });
    expect(fromPublic(L.snap.hazards)).toHaveLength(layer.hazards.length);
  });
});
