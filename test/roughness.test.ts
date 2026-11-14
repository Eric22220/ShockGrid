// Rugozitate continuă vs. șocuri izolate vs. încredere: tronsoane pe stradă, triajul evenimentelor, zone, fără dublă penalizare.
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { aggregate, buildSnapshot, segmentEdge, toContribution, type Thresholds } from '../src/core/aggregate';
import { DEFAULT_CONFIG } from '../src/core/config';
import { Graph, type GraphJson } from '../src/core/graph';
import { parseRideFile } from '../src/core/io';
import { processRide } from '../src/core/process';
import { classifyEvent, clusterPoints, rideRoughness } from '../src/core/roughness';
import { DEFAULT_ROUTE_OPTIONS, Router } from '../src/core/route';
import { tiltAround } from '../src/core/vibration';
import type { ProcessedRide, Shock } from '../src/core/types';
import { hasFile, makeGraph, pathAlong, readBytes, syntheticRide } from './helpers';

const LAT = 45.75, LON = 21.22;
const dLon = (m: number) => m / 77600;
const L = 900;
const N = [0, 300, 600, 900].map((m) => [LAT, LON + dLon(m)] as [number, number]);
const g = makeGraph(N, [{ f: 0, t: 1, highway: 'residential' }, { f: 1, t: 2, highway: 'residential' }, { f: 2, t: 3, highway: 'residential' }]);
const TH: Thresholds = [1.0, 1.6, 2.4, 3.6];
const SPEED = 4.5;

interface Opts { back?: boolean; vib?: number; rough?: [number, number, number][]; spikes?: { x: number; amp: number; gyro?: number; tilt?: number; pass?: 0 | 1 }[]; speed?: number; key: string }
/** tură pe strada dreaptă (dus sau dus-întors), cu rugozitate pe intervale de poziție și vârfuri la poziții date */
function ride(o: Opts): ProcessedRide {
  const v = o.speed ?? SPEED;
  const pts = o.back ? [N[0], N[3], N[0]] : [N[0], N[3]];
  const { path, seconds } = pathAlong(pts, v, 0.5, 7);
  const xAt = (s: number) => { const d = s * v; return d <= L ? d : 2 * L - d; };
  const spikeT = (o.spikes ?? []).map((sp) => ({ ...sp, s: sp.pass === 1 ? (2 * L - sp.x) / v : sp.x / v }));
  const raw = syntheticRide({
    seconds: Math.floor(seconds), fs: 100, vibAmp: o.vib ?? 0.8, speed: v, path, acc: 5,
    gyroDeg: (t) => { for (const sp of spikeT) if (sp.gyro && Math.abs(t - sp.s) < 0.3) return sp.gyro; return 5; },
  });
  raw.meta.ride_key = o.key;
  const m = raw.motion;
  for (let i = 0; i < m.t.length; i++) {
    const s = (m.t[i] - m.t[0]) / 1000;
    const x = xAt(s);
    const f = (o.rough ?? []).find(([a, b]) => x >= a && x < b)?.[2] ?? 1;
    if (f !== 1) m.z[i] = 9.81 + (m.z[i] - 9.81) * f;
  }
  for (const sp of spikeT) {
    const i0 = Math.round(sp.s * 100);
    for (let k = 0; k < 3 && i0 + k < m.z.length; k++) m.z[i0 + k] += sp.amp;
    if (sp.tilt) {
      // telefonul se rotește în suport cu `tilt` grade după vârf (în jurul axei x)
      const a = (sp.tilt * Math.PI) / 180;
      for (let i = i0 + 50; i < m.z.length; i++) { const y = m.y[i], z = m.z[i]; m.y[i] = y * Math.cos(a) - z * Math.sin(a); m.z[i] = y * Math.sin(a) + z * Math.cos(a); }
    }
  }
  return processRide(raw, { graph: g });
}
const layerOf = (rides: ProcessedRide[]) => aggregate({ rides: rides.map((r) => toContribution(r)), fixedThresholds: TH, surfaceKindOf: (e) => g.kind[e], lengthOf: (e) => g.length[e] });
const shown = (r: ProcessedRide, e: number) => (layerOf([r]).edges.get(e)!.segments ?? []).filter((s) => s.cat !== 'none');

describe('A. rugozitate continuă pe tronsoane', () => {
  it('un șoc izolat slab nu înroșește strada; unul puternic afectează cel mult un tronson scurt', () => {
    const mild = ride({ key: 'mild', spikes: [{ x: 150, amp: 7 }] });
    const e0 = layerOf([mild]).edges.get(0)!;
    expect(e0.rough).toBe('green');
    // primul tronson poate fi „insuficient” (stabilizarea filtrelor la pornire); niciunul nu e galben sau roșu
    expect(shown(mild, 0).every((s) => s.cat === 'green' || s.cat === 'insufficient')).toBe(true);
    const strong = ride({ key: 'strong1', spikes: [{ x: 150, amp: 30 }] });
    const s0 = shown(strong, 0);
    expect(layerOf([strong]).edges.get(0)!.rough).toBe('green');
    const notGreen = s0.filter((s) => s.cat === 'yellow' || s.cat === 'red');
    expect(notGreen.reduce((a, s) => a + s.to_m - s.from_m, 0)).toBeLessThanOrEqual(40);
  });
  it('rugozitatea moderată susținută e recunoscută fără niciun vârf extrem', () => {
    const r = ride({ key: 'moderate', rough: [[300, 600, 2.5]] });
    expect(rideRoughness(r).counts.raw).toBe(0);
    expect(layerOf([r]).edges.get(1)!.rough).toBe('yellow');
    expect(layerOf([r]).edges.get(0)!.rough).toBe('green');
  });
  it('strada împărțită: bună 0–120 m, denivelată 120–220 m, bună 220–300 m (fără o notă uniformă)', () => {
    const r = ride({ key: 'partial', rough: [[420, 520, 4]] });
    const s = shown(r, 1);
    expect(s.length).toBeGreaterThanOrEqual(3);
    const red = s.filter((x) => x.cat === 'red');
    expect(red).toHaveLength(1);
    expect(red[0].from_m).toBeGreaterThanOrEqual(100);
    expect(red[0].to_m).toBeLessThanOrEqual(245);
    expect(s[0].cat).toBe('green');
    expect(s[s.length - 1].cat).toBe('green');
  });
  it('o porțiune netedă între două porțiuni denivelate nu e înghițită', () => {
    const r = ride({ key: 'two-rough', rough: [[330, 420, 4], [500, 590, 4]] });
    const cats = shown(r, 1).map((x) => x.cat);
    const firstRed = cats.indexOf('red'), lastRed = cats.lastIndexOf('red');
    expect(firstRed).toBeGreaterThanOrEqual(0);
    expect(cats.slice(firstRed, lastRed + 1)).toContain('green');
  });
  it('precizia GPS limitează tronsoanele: nu există tronsoane mai scurte decât permite GPS-ul', () => {
    const valid = Array.from({ length: 100 }, (_, i) => ({ off: i, rms: Math.floor(i / 5) % 2 ? 4 : 0.5, pk: 'a' }));
    const coarse = segmentEdge(100, valid, [], 20, TH, true);
    expect(coarse.every((s) => s.to_m - s.from_m >= 40 - 1e-6)).toBe(true);
    const fine = segmentEdge(100, valid, [], 4, TH, true);
    expect(fine.every((s) => s.to_m - s.from_m >= DEFAULT_CONFIG.seg_min_m - 1e-6)).toBe(true);
    expect(fine.length).toBeLessThanOrEqual(Math.round(100 / DEFAULT_CONFIG.seg_min_m));
  });
  it('datele lente rămân explorare: fără verde/galben/roșu', () => {
    const r = ride({ key: 'slow', speed: 1.0, rough: [[100, 200, 4]] });
    const layer = layerOf([r]);
    for (const e of layer.edges.values()) {
      expect(e.rough).toBeNull();
      expect((e.segments ?? []).every((s) => s.cat === 'explore' || s.cat === 'insufficient' || s.cat === 'none')).toBe(true);
    }
  });
  it('trecerile independente ridică încrederea tronsonului; aceeași tură de două ori nu dublează', () => {
    const r = ride({ key: 'twice', back: true });
    const segs = layerOf([r]).edges.get(1)!.segments!.filter((s) => s.cat !== 'none');
    expect(segs.some((s) => s.status === 'measured' && s.passes >= 2)).toBe(true);
    const once = layerOf([r]).edges.get(1)!;
    const dup = aggregate({ rides: [toContribution(r), toContribution(r)], fixedThresholds: TH, lengthOf: (e) => g.length[e] }).edges.get(1)!;
    expect(dup.n_passes).toBe(once.n_passes);
    expect(dup.segments).toEqual(once.segments);
  });
});

describe('B. șocuri izolate: triaj și zone', () => {
  it('vârfurile unui singur obstacol (roata față + spate) devin un singur eveniment și o singură zonă', () => {
    const r = ride({ key: 'wheel', spikes: [{ x: 150, amp: 25 }, { x: 151.05, amp: 22 }, { x: 153.5, amp: 20 }] });
    const rr = rideRoughness(r);
    expect(rr.counts.raw).toBeLessThanOrEqual(2);
    expect(rr.counts.zones).toBe(1);
  });
  it('două zone denivelate separate rămân distincte', () => {
    const r = ride({ key: 'two-zones', spikes: [{ x: 200, amp: 25 }, { x: 204, amp: 22 }, { x: 260, amp: 25 }, { x: 264, amp: 22 }] });
    const rr = rideRoughness(r);
    expect(rr.counts.zones).toBe(2);
  });
  it('lovituri cu bicicleta oprită nu devin zone', () => {
    const r = ride({ key: 'stopped', speed: 0.2, spikes: [{ x: 10, amp: 30 }] });
    expect(rideRoughness(r).counts.zones).toBe(0);
    const s: Shock = { id: 'x', t: 0, peak: 30, z: 40, double_hit: false, speed: 0.4, lat: LAT, lon: LON, r: 5, flags: [], located: true, needs_review: false, edge: 0, pass: 0, snippet: { dt: 20, v: [] } };
    expect(classifyEvent(s, null).kind).toBe('stationary');
  });
  it('rotația mare a telefonului: manevrare, nu zonă (nici pe hartă); rămâne în diagnostic', () => {
    const r = ride({ key: 'rot', spikes: [{ x: 300, amp: 30, gyro: 520 }] });
    const rr = rideRoughness(r);
    expect(rr.events.length).toBe(r.shocks.length);
    expect(rr.events.some((e) => e.kind === 'handling' && e.why.join(' ').includes('rotație'))).toBe(true);
    expect(rr.counts.zones).toBe(0);
    expect(layerOf([r]).zones).toHaveLength(0);
  });
  it('telefonul mutat în suport (orientare schimbată) e tratat ca manevrare', () => {
    const r = ride({ key: 'tilt', spikes: [{ x: 300, amp: 30, tilt: 40 }] });
    const ev = rideRoughness(r).events;
    expect(ev.length).toBeGreaterThan(0);
    expect(ev.every((e) => e.kind === 'handling')).toBe(true);
    const flat = ride({ key: 'flat', spikes: [{ x: 300, amp: 30 }] });
    expect(flat.shocks[0].tilt!).toBeLessThan(3);
    expect(tiltAround({ ...parseLike(flat) }, flat.shocks[0].t)).toBeNull(); // fără date brute: null, nu inventăm
  });
  it('trecerile repetate ridică prioritatea, fără a număra de două ori aceeași trecere', () => {
    const once = rideRoughness(ride({ key: 'rep1', spikes: [{ x: 450, amp: 7 }, { x: 454, amp: 7 }, { x: 457, amp: 7 }] }));
    expect(once.zones[0].passes).toBe(1);
    expect(once.zones[0].priority).toBe('low');
    const twice = rideRoughness(ride({ key: 'rep2', back: true, spikes: [{ x: 450, amp: 7 }, { x: 454, amp: 7, pass: 1 }] }));
    expect(twice.zones).toHaveLength(1);
    expect(twice.zones[0].passes).toBe(2);
    expect(twice.zones[0].priority).toBe('high');
  });
  it('gruparea respectă incertitudinea: puncte mai apropiate decât GPS-ul nu se separă', () => {
    const pts = [{ lat: LAT, lon: LON, r: 9 }, { lat: LAT, lon: LON + dLon(11), r: 9 }, { lat: LAT, lon: LON + dLon(40), r: 9 }];
    expect(clusterPoints(pts, 10)).toEqual([0, 0, 1]);
  });
});

describe('C. fără dublă penalizare și separarea datelor', () => {
  it('șocurile, zonele și tronsoanele nu schimbă costul rutei (doar RVI pe muchie)', () => {
    const r = ride({ key: 'cost', rough: [[100, 200, 4]], spikes: [{ x: 150, amp: 30 }, { x: 160, amp: 25 }] });
    const c = toContribution(r);
    const withShocks = aggregate({ rides: [c], fixedThresholds: TH, lengthOf: (e) => g.length[e] });
    const noShocks = aggregate({ rides: [{ ...c, shocks: [] }], fixedThresholds: TH });
    expect(withShocks.zones.length).toBeGreaterThan(0);
    const a = new Router(g).costs({ ...withShocks, version: 1 }, DEFAULT_ROUTE_OPTIONS);
    const b = new Router(g).costs({ ...noShocks, version: 1 }, DEFAULT_ROUTE_OPTIONS);
    expect([...a]).toEqual([...b]);
  });
  it('stratul public păstrează tronsoanele fără ID-uri sau timpi; datele publice și locale rămân separate', () => {
    const r = ride({ key: 'pub', rough: [[330, 420, 4]] });
    const snap = buildSnapshot([r], DEFAULT_CONFIG, 't', TH, 't', { rules: { trim_m: 0, radius_m: 0 } });
    const text = JSON.stringify(snap);
    expect(text).not.toContain(r.ride_id);
    expect(text).not.toMatch(/\b1[6-9]\d{11}\b/);
    const e1 = snap.edges.find((e) => e.edge_id === 1)!;
    expect(e1.off!.length).toBe(e1.rms.length);
    const pub = aggregate({ snapshot: snap, rides: [], lengthOf: (e) => g.length[e] }).edges.get(1)!;
    expect(pub.origin).toEqual(['public']);
    expect(pub.segments!.some((s) => s.cat === 'red')).toBe(true);
    const local = ride({ key: 'local-other' });
    expect(aggregate({ snapshot: snap, rides: [toContribution(local)], lengthOf: (e) => g.length[e] }).edges.get(1)!.origin).toEqual(['local', 'public']);
  });
});

function parseLike(p: ProcessedRide) {
  // o tură procesată nu păstrează mișcarea brută: tiltAround pe un RawRide fără mostre întoarce null
  return { meta: p.meta, motion: { t: new Float64Array(0), x: new Float32Array(0), y: new Float32Array(0), z: new Float32Array(0), withGravity: true }, gyro: null, gps: [], events: [] };
}

// Tura reală (privată, doar local): SG_REAL_RIDE='rides/<fișier>.zip'
const REAL = process.env.SG_REAL_RIDE ?? '';
const GRAPH = 'public/data/graph-timisoara.json';
describe.skipIf(!REAL || !hasFile(REAL) || !hasFile(GRAPH))('tura reală: de la 184 de evenimente la zone', () => {
  let rr!: ReturnType<typeof rideRoughness>, real!: Graph;
  beforeAll(() => {
    real = new Graph(JSON.parse(readFileSync(GRAPH, 'utf8')) as GraphJson);
    rr = rideRoughness(processRide(parseRideFile('real.zip', readBytes(REAL)), { graph: real }), DEFAULT_CONFIG, real);
  });
  it('toate evenimentele brute rămân; volumul de verificat scade la zone', () => {
    const c = rr.counts;
    expect(c.raw).toBe(184);
    expect(rr.events).toHaveLength(184);
    expect(c.handling + c.stationary + c.isolated + c.unlocated + c.in_zones).toBe(184);
    expect(c.zones).toBeLessThan(60);
    expect(c.review).toBeLessThan(c.raw / 4);
  });
  it('Ion Vidu: zone repetate în cele două treceri, toate cu încredere redusă (viteză mică)', () => {
    const vidu = rr.events.filter((e) => e.shock.edge >= 0 && /Vidu/.test(real.name[e.shock.edge]));
    expect(vidu.length).toBe(38);
    expect(vidu.every((e) => e.low.length > 0)).toBe(true);
    const zones = rr.zones.filter((z) => z.street === 'Strada Ion Vidu');
    expect(zones.length).toBeGreaterThan(0);
    expect(zones.some((z) => z.passes >= 2)).toBe(true);
  });
});
