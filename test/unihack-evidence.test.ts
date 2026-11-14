// Dovezi, explorare la viteză redusă, confidențialitatea stratului public, comparații pe stradă și SIMULARE.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { aggregate, buildSnapshot, inSnapshot, snapshotRideCount, toContribution } from '../src/core/aggregate';
import { DEFAULT_CONFIG } from '../src/core/config';
import { compareByBand, fmtOffset, parseOffset, parallelInfra, streetsOfRide, windowsInInterval } from '../src/core/corridor';
import { Graph, type GraphJson } from '../src/core/graph';
import { parseRideFile } from '../src/core/io';
import { processRide } from '../src/core/process';
import { PRIVACY_RADIUS_M, publicKey, publishFilter } from '../src/core/publish';
import { isExploratory, rideQuality } from '../src/core/quality';
import { DEFAULT_ROUTE_OPTIONS, Router, mainComponent, penaltyOf } from '../src/core/route';
import { planRoutes } from '../src/core/routeplan';
import { simulate } from '../src/core/simulate';
import type { ProcessedRide, VibWindow } from '../src/core/types';
import { hasFile, makeGraph, pathAlong, readBytes, syntheticRide } from './helpers';

const LAT = 45.75, LON = 21.22;
const dLon = (m: number) => m / 77600;
// stradă dreaptă de 2,4 km în 8 muchii de 300 m (destul ca tăierea capetelor și raza să lase ceva la mijloc)
const N = Array.from({ length: 9 }, (_, i) => [LAT, LON + dLon(300 * i)] as [number, number]);
const g = makeGraph(N, Array.from({ length: 8 }, (_, i) => ({ f: i, t: i + 1, highway: 'residential' })));

function rideAt(speed: number, seconds: number, vib = 1.2, seed = 3): ProcessedRide {
  const { path } = pathAlong([N[0], N[8]], speed, 1, seed);
  const raw = syntheticRide({ seconds, fs: 100, vibAmp: vib, speed, path, acc: 5 });
  raw.meta.ride_key = `test-${speed}-${seed}`;
  raw.meta.device = 'Telefonul lui Test';
  return processRide(raw, { graph: g });
}

describe('tură lentă: explorare, fără RVI, fără clase, fără efect asupra rutelor', () => {
  const slow = rideAt(1.0, 1250);
  it('categoria LOW_SPEED_EXPLORATORY; nicio fereastră validă, ferestre explorabile numărate', () => {
    const q = rideQuality(slow);
    expect(q.category).toBe('LOW_SPEED_EXPLORATORY');
    expect(q.windows.valid).toBe(0);
    expect(q.windows.exploratory).toBeGreaterThan(300);
    expect(q.notes.join(' ')).toMatch(/nu intră în RVI/);
    expect(slow.windows.filter((w) => w.valid)).toHaveLength(0);
  });
  it('stratul: muchiile rămân UNKNOWN, fără clasă; explorarea apare separat', () => {
    const layer = aggregate({ rides: [toContribution(slow)], surfaceKindOf: (e) => g.kind[e] });
    const edges = [...layer.edges.values()];
    expect(edges.length).toBeGreaterThan(0);
    for (const e of edges) { expect(e.status).toBe('UNKNOWN'); expect(e.class).toBeNull(); }
    const ex = edges.filter((e) => e.explore);
    expect(ex.length).toBeGreaterThan(3);
    expect(ex[0].explore!.speed_p50).toBeGreaterThan(0.8);
    expect(ex[0].explore!.speed_p50).toBeLessThan(1.3);
    expect(ex[0].explore!.bands.map((b) => b.id)).toContain('e2');
    expect(ex[0].origin).toEqual(['local']);
  });
  it('rutarea tratează muchiile explorate ca necunoscute, iar verdictul rămâne „confort necunoscut”', () => {
    const layer = aggregate({ rides: [toContribution(slow)], surfaceKindOf: (e) => g.kind[e] });
    for (let e = 0; e < g.nEdges; e++) expect(penaltyOf(g, layer, e, DEFAULT_ROUTE_OPTIONS).cat).toBe('unknown');
    const plan = planRoutes(g, layer, new Router(g), 1, 7, DEFAULT_ROUTE_OPTIONS);
    expect(plan.verdict.kind).toBe('nodata');
  });
  it('o tură la viteză normală e RVI_OK și primește clase; explorarea nu se amestecă', () => {
    const fast = rideAt(4.5, 560, 1.2, 5);
    const q = rideQuality(fast);
    expect(q.category).toBe('RVI_OK');
    expect(fast.windows.some((w) => isExploratory(w))).toBe(false);
    const layer = aggregate({ rides: [toContribution(fast), toContribution(slow)], surfaceKindOf: (e) => g.kind[e] });
    const mid = layer.edges.get(3)!;
    expect(mid.status).not.toBe('UNKNOWN');
    expect(mid.n_windows).toBeGreaterThan(10);
    expect(mid.explore).not.toBeNull(); // dovezile lente rămân vizibile, separat
    expect(mid.speed_p10!).toBeGreaterThan(3.5);
  });
});

describe('stratul public: confidențialitate', () => {
  const r1 = rideAt(4.5, 560, 1.2, 7);
  const r2 = rideAt(4.5, 560, 1.4, 9);
  const snap = buildSnapshot([r1, r2], DEFAULT_CONFIG, '2 ture (test)', null, 'test', { geometry: (e) => g.geometry(e) });
  const text = JSON.stringify(snap);
  it('fără ID-uri de tură, chei de tură, nume de dispozitiv sau timpi epoch', () => {
    expect(snap.meta.ride_ids).toBeUndefined();
    expect(snap.meta.ride_keys).toHaveLength(2);
    for (const r of [r1, r2]) {
      expect(text).not.toContain(r.ride_id);
      expect(text).not.toContain(r.meta.ride_key);
      expect(text).not.toContain(publicKey(r.ride_id).slice(1) + ':');
    }
    expect(text).not.toContain('Telefonul lui Test');
    expect(text).not.toMatch(/\b1[6-9]\d{11}\b/);
    expect(snapshotRideCount(snap)).toBe(2);
  });
  it('nimic la mai puțin de PRIVACY_RADIUS_M de capete (nici ferestre, nici geometria muchiilor)', () => {
    for (const r of [r1, r2]) {
      const keep = publishFilter(r);
      const ends = [r.gps[0], r.gps[r.gps.length - 1]];
      for (const e of snap.edges) for (const [la, lo] of g.geometry(e.edge_id)) for (const f of ends) {
        const d = Math.hypot((la - f.lat) * 111195, (lo - f.lon) * 77600);
        expect(d).toBeGreaterThanOrEqual(PRIVACY_RADIUS_M - 1);
      }
      expect(keep(r.summary.distance_m / 2, LAT, LON + dLon(1200))).toBe(true);
      expect(keep(r.summary.distance_m / 2, r.gps[0].lat, r.gps[0].lon)).toBe(false);
    }
    expect(snap.edges.length).toBeGreaterThan(0);
  });
  it('o tură locală deja publicată nu se numără de două ori (cheie publică)', () => {
    const withLocal = aggregate({ snapshot: snap, rides: [toContribution(r1)] });
    const onlySnap = aggregate({ snapshot: snap, rides: [] });
    expect(inSnapshot(snap, r1.ride_id)).toBe(true);
    expect(inSnapshot(snap, 'r-altceva')).toBe(false);
    for (const [k, e] of onlySnap.edges) expect(withLocal.edges.get(k)!.n_passes).toBe(e.n_passes);
  });
  it('explorarea și șocurile „de verificat” nu se publică implicit', () => {
    const slow = rideAt(1.0, 1250, 1.2, 11);
    const def = buildSnapshot([slow], DEFAULT_CONFIG, 't', null, 't');
    expect(def.edges.every((e) => !e.slow_rms)).toBe(true);
    expect(def.shocks.every((s) => !s.needs_review)).toBe(true);
    const ex = buildSnapshot([slow], DEFAULT_CONFIG, 't', null, 't', { exploratory: true, shocks: 'none' });
    expect(ex.meta.includes_exploratory).toBe(true);
    expect(ex.edges.some((e) => (e.slow_rms?.length ?? 0) >= 5)).toBe(true);
    expect(ex.shocks).toHaveLength(0);
  });
  it('două telefoane care încarcă același strat public văd exact aceleași segmente', () => {
    const copy = JSON.parse(text);
    const a = aggregate({ snapshot: snap, rides: [], surfaceKindOf: (e) => g.kind[e] });
    const b = aggregate({ snapshot: copy, rides: [], surfaceKindOf: (e) => g.kind[e] });
    expect([...b.edges.entries()]).toEqual([...a.edges.entries()]);
    expect(b.thresholds).toEqual(a.thresholds);
    expect([...a.edges.values()].every((e) => e.origin.join() === 'public')).toBe(true);
  });
});

describe('analiza pe stradă', () => {
  const mk = (rms: number, i: number, speed = 1.2): VibWindow => ({ t0: i * 1000, t1: i * 1000 + 2000, lat: LAT, lon: LON, r: 5, acc: 5, speed, rms, vdv: 0, p95: rms, gyro: 1, fs: 100, valid: false, reason: 'speed_low', dist: i, edge: 0, amb: false, pass: 0 });
  const noisy = (base: number, n: number, seed: number) => Array.from({ length: n }, (_, i) => mk(base * (0.8 + 0.4 * (((i * 7919 + seed * 104729) % 1000) / 1000)), i));
  it('diferență consistentă în aceeași bandă → „higher”, cu interval de încredere peste 1', () => {
    const c = compareByBand(noisy(1.5, 120, 1), noisy(1.0, 120, 2)).find((r) => r.band === 'e2')!;
    expect(c.verdict).toBe('higher');
    expect(c.ci![0]).toBeGreaterThan(1);
    expect(c.ratio!).toBeCloseTo(1.5, 1);
  });
  it('aceeași distribuție → „undetermined”; prea puține ferestre → „insufficient”; benzi diferite nu se amestecă', () => {
    expect(compareByBand(noisy(1.0, 120, 3), noisy(1.0, 120, 4)).find((r) => r.band === 'e2')!.verdict).toBe('undetermined');
    expect(compareByBand(noisy(1.5, 10, 1), noisy(1.0, 120, 2)).find((r) => r.band === 'e2')!.verdict).toBe('insufficient');
    const fastA = noisy(3, 60, 5).map((w) => ({ ...w, speed: 2.0 }));
    const res = compareByBand(fastA, noisy(1.0, 60, 6));
    expect(res.find((r) => r.band === 'e2')!.verdict).toBe('insufficient');
    expect(res.find((r) => r.band === 'e3')!.verdict).toBe('insufficient');
  });
  it('timpi mm:ss pentru filmare', () => {
    expect(parseOffset('6:55')).toBe(415);
    expect(parseOffset('1:02:03')).toBe(3723);
    expect(parseOffset('754')).toBe(754);
    expect(parseOffset('6:5x')).toBeNull();
    expect(fmtOffset(415)).toBe('6:55');
    expect(fmtOffset(3723)).toBe('1:02:03');
  });
  it('fără căi paralele în OSM, latura nu se poate stabili; cu trotuar separat, e semnalat', () => {
    expect(parallelInfra(g, [3]).kinds).toEqual([]);
    const off = 8 / 111195;
    const g2 = makeGraph([[LAT, LON], [LAT, LON + dLon(300)], [LAT + off, LON], [LAT + off, LON + dLon(300)]], [{ f: 0, t: 1, highway: 'residential' }, { f: 2, t: 3, highway: 'footway', kind: 'trotuar' }]);
    expect(parallelInfra(g2, [0]).kinds).toEqual(['trotuar']);
  });
  it('străzile turei și ferestrele dintr-un interval declarat', () => {
    const r = rideAt(1.0, 400, 1.2, 13);
    const s = streetsOfRide(r, makeGraphNamed());
    expect(s.length).toBeGreaterThanOrEqual(0);
    const ws = windowsInInterval(r, { id: 'a', t0_s: 100, t1_s: 160, label: 'x' });
    expect(ws.length).toBeGreaterThan(50);
    expect(ws.length).toBeLessThanOrEqual(59);
  });
});

function makeGraphNamed() { return g; }

const GRAPH = 'public/data/graph-timisoara.json';
describe.skipIf(!hasFile(GRAPH))('SIMULARE pe străzile reale (strat inventat, etichetat)', () => {
  const real = new Graph(JSON.parse(readFileSync(GRAPH, 'utf8')) as GraphJson);
  const comp = mainComponent(real);
  const a = real.nearestNode(45.7468, 21.2312, (n) => comp[n] === 1, 600);
  const b = real.nearestNode(45.7536, 21.2253, (n) => comp[n] === 1, 600);
  it('fără date → nodata; doar ruta scurtă → same; ambele măsurate → better', () => {
    expect(simulate(real, a, b, 'none')!.plan.verdict.kind).toBe('nodata');
    expect(simulate(real, a, b, 'short_rough')!.plan.verdict.kind).toBe('same');
    const both = simulate(real, a, b, 'both')!;
    expect(both.plan.verdict.kind).toBe('better');
    expect(both.plan.verdict.text).toMatch(/față de cea mai scurtă/);
    expect(both.layer.version).toBeLessThan(0); // nu se poate confunda cu un strat real
  });
});

// Tura reală de 41 de minute (privată, doar local; în CI lipsește și testul e sărit).
// Numele fișierului NU apare în repo (conține adresa de plecare și ora): rulați cu
//   PowerShell: $env:SG_REAL_RIDE='rides/<fișier>.zip'; npx vitest run test/unihack-evidence.test.ts
const REAL = process.env.SG_REAL_RIDE ?? '';
describe.skipIf(!REAL || !hasFile(REAL) || !hasFile(GRAPH))('tura reală iPhone 14, 41 min (privată, locală)', () => {
  const real = new Graph(JSON.parse(readFileSync(GRAPH, 'utf8')) as GraphJson);
  const raw = parseRideFile('real.zip', readBytes(REAL));
  const p = processRide(raw, { graph: real });
  it('structura exportului iOS: Uncalibrated cu date, unitate g, ~100 Hz, fără goluri', () => {
    expect(raw.meta.platform).toBe('ios');
    expect(raw.meta.accel_file).toBe('AccelerometerUncalibrated.csv');
    expect(raw.meta.gyro_file).toBe('GyroscopeUncalibrated.csv');
    expect(raw.meta.unit_detected).toBe('g');
    expect(p.summary.n_motion).toBe(248006);
    expect(p.summary.n_fix).toBe(2479);
    expect(p.summary.fs_median).toBeGreaterThan(99.5);
    expect(p.summary.gaps_100ms).toBe(0);
  });
  it('calitate: tură lentă, explorator; RVI doar pe porțiunile ≥ 2,5 m/s', () => {
    const q = rideQuality(p);
    expect(q.category).toBe('LOW_SPEED_EXPLORATORY');
    expect(q.windows.valid).toBe(70);
    expect(q.windows.low_speed).toBe(2395);
    expect(q.windows.exploratory).toBeGreaterThan(1900);
    expect(p.windows.filter((w) => w.valid).every((w) => w.speed! >= 2.5)).toBe(true);
  });
  it('Strada Ion Vidu: potrivită pe axa străzii, fără trotuare separate în OSM (latura nu se poate stabili din GPS)', () => {
    const vidu = streetsOfRide(p, real).find((s) => /Vidu/.test(s.name));
    expect(vidu).toBeDefined();
    expect(vidu!.windows).toBeGreaterThan(500);
    expect(p.windows.filter((w) => w.valid && vidu!.edges.includes(w.edge))).toHaveLength(0);
  });
  it('stratul propus nu conține nimic identificabil al turei', () => {
    const snap = buildSnapshot([p], DEFAULT_CONFIG, '1 tură (ios)', null, 'test', { exploratory: true, geometry: (e) => real.geometry(e) });
    const text = JSON.stringify(snap);
    for (const x of [p.ride_id, raw.meta.ride_key, raw.meta.device, raw.meta.extra['device id'], raw.meta.recording_time].filter(Boolean) as string[]) expect(text).not.toContain(x);
    expect(text).not.toMatch(/\b1[6-9]\d{11}\b/);
  });
});
