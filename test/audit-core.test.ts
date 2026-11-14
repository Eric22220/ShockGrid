// Audit independent al nucleului: cazuri-limită unde testele existente treceau deși producția putea greși.
// Toate datele sunt SINTETICE: aceste teste verifică logica, NU validează științific indicele (asta cere ture reale).
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { strToU8, zipSync } from 'fflate';
import { aggregate, type RideContribution } from '../src/core/aggregate';
import { DEFAULT_CONFIG } from '../src/core/config';
import { GpsTrack } from '../src/core/gpstrack';
import { Graph, type GraphJson } from '../src/core/graph';
import { parseRideFile } from '../src/core/io';
import { matchFixes } from '../src/core/mapmatch';
import { processRide } from '../src/core/process';
import { DEFAULT_ROUTE_OPTIONS, Router, mainComponent } from '../src/core/route';
import type { GpsFix, Shock } from '../src/core/types';
import { computeSignal, detectShocks } from '../src/core/vibration';
import { makeGraph, syntheticRide } from './helpers';

const LAT = 45.75, LON = 21.22;
const dLat = (m: number) => m / 111195, dLon = (m: number) => m / 77600;

describe('audit map-matching: cale paralelă de alt tip în raza erorii GPS', () => {
  // carosabil și pistă paralelă la 7 m (separarea mediană reală în Timișoara: ~7 m)
  const g = makeGraph(
    [[LAT, LON], [LAT + dLat(400), LON], [LAT, LON + dLon(7)], [LAT + dLat(400), LON + dLon(7)]],
    [{ f: 0, t: 1, kind: 'carosabil' }, { f: 2, t: 3, kind: 'pista', highway: 'cycleway' }],
  );
  // biciclistul e pe pistă (x = 7 m); GPS-ul îl arată deplasat lateral spre carosabil
  const fixes = (shownX: number, acc = 5): GpsFix[] => Array.from({ length: 40 }, (_, i) => ({ t: i * 1000, lat: LAT + dLat(20 + i * 5), lon: LON + dLon(shownX), acc, alt: null, speed: 5, heading: 0, speedAcc: null }));

  it('eroare laterală de 6 m (acc raportat 5 m): fixurile NU sunt atribuite carosabilului fără semnul de ambiguitate', () => {
    const m = matchFixes(fixes(1), g, DEFAULT_CONFIG, null); // arătat la 1 m de axul carosabilului, 6 m de pistă
    expect(m.matched).toBe(40);
    const sureWrong = [...m.edge].filter((e, i) => e === 0 && !m.amb[i]).length;
    expect(sureWrong).toBe(0); // cu pragul vechi max(3, acc/2): 40 din 40
  });
  it('aceeași eroare, cu suprafața declarată „pistă”: toate fixurile ajung pe pistă', () => {
    const m = matchFixes(fixes(1), g, DEFAULT_CONFIG, 'pista');
    expect([...m.edge].every((e) => e === 1)).toBe(true); // cu pragul vechi: toate pe carosabil, deși era declarată pista
    expect(m.amb.reduce((a, b) => a + b, 0)).toBe(0);
  });
  it('o trecere ambiguă nu poate face muchia MEASURED, oricâte ferestre are', () => {
    const windows: RideContribution['windows'] = [];
    for (let p = 0; p < 3; p++) for (let k = 0; k < 10; k++) windows.push({ edge: 0, rms: 1, speed: 5, acc: 5, valid: true, amb: p === 0 && k === 0, pass: p });
    const layer = aggregate({ rides: [{ ride_id: 'r', source: 'sensorlogger', processing_version: 'x', date: 0, windows, shocks: [], included_in_layer: true }], version: 1 });
    expect(layer.edges.get(0)!.status).toBe('LOW_CONFIDENCE');
    expect(layer.edges.get(0)!.reasons.join(' ')).toMatch(/ambiguitate/);
  });
  it('fără nicio cale paralelă de alt tip: potrivire sigură, neafectată de prag', () => {
    const g1 = makeGraph([[LAT, LON], [LAT + dLat(400), LON]], [{ f: 0, t: 1, kind: 'carosabil' }]);
    const m = matchFixes(fixes(4), g1, DEFAULT_CONFIG, null);
    expect(m.matched).toBe(40);
    expect(m.amb.reduce((a, b) => a + b, 0)).toBe(0);
  });
});

describe('audit șocuri: fără „denivelări” când bicicleta stă pe loc', () => {
  const impulse = (r: ReturnType<typeof syntheticRide>, at: number) => {
    const t0 = r.motion.t[0];
    for (let i = 0; i < r.motion.t.length; i++) { const d = (r.motion.t[i] - t0) / 1000 - at; if (d >= 0 && d < 0.05) r.motion.z[i] += 15 * Math.sin((2 * Math.PI * d) / 0.05); }
  };
  it('lovituri în telefon la viteză GPS 0 (semafor, atingerea ecranului): nicio denivelare candidată', () => {
    const r = syntheticRide({ seconds: 60, fs: 100, vibAmp: 0.4 });
    // mers 30 s, apoi oprit 30 s; trei lovituri cât stă pe loc
    for (const f of r.gps) if (f.t - r.gps[0].t > 30000) f.speed = 0;
    for (const at of [40, 47, 54]) impulse(r, at);
    const shocks = detectShocks(r, computeSignal(r, DEFAULT_CONFIG), DEFAULT_CONFIG, new GpsTrack(r.gps));
    expect(shocks.length).toBe(0); // înainte: 3 „posibile denivelări” la verificarea de după tură
  });
  it('aceeași lovitură în mers rămâne detectată', () => {
    const r = syntheticRide({ seconds: 60, fs: 100, vibAmp: 0.4 });
    impulse(r, 40);
    const shocks = detectShocks(r, computeSignal(r, DEFAULT_CONFIG), DEFAULT_CONFIG, new GpsTrack(r.gps));
    expect(shocks.length).toBe(1);
    expect(shocks[0].needs_review).toBe(false);
  });
  it('viteză necunoscută (fără GPS): șocul se păstrează, dar marcat pentru verificare', () => {
    const r = syntheticRide({ seconds: 60, fs: 100, vibAmp: 0.4, speed: null });
    impulse(r, 40);
    const shocks = detectShocks(r, computeSignal(r, DEFAULT_CONFIG), DEFAULT_CONFIG, new GpsTrack(r.gps));
    expect(shocks.length).toBe(1);
    expect(shocks[0].flags).toContain('speed_unknown');
    expect(shocks[0].needs_review).toBe(true);
  });
});

describe('audit unități: același drum exportat de iPhone (g) și de Android (m/s²) dă același indice', () => {
  // Sensor Logger: iOS scrie AccelerometerUncalibrated în g, Android scrie TotalAcceleration în m/s²
  function slZip(platform: 'ios' | 'android'): Uint8Array {
    const G = 9.80665, fs = 100, seconds = 40, T0 = 1_800_000_000_000n;
    const k = platform === 'ios' ? 1 / G : 1;
    const acc = ['time,seconds_elapsed,z,y,x'];
    for (let i = 0; i < seconds * fs; i++) {
      const s = i / fs;
      const a = G + 1.5 * Math.SQRT2 * Math.sin(2 * Math.PI * 12 * s); // 1,5 m/s² RMS la 12 Hz
      acc.push(`${T0 * 1000000n + BigInt(i) * 10000000n},${s},${(a * k).toFixed(6)},0,0`);
    }
    const loc = ['time,seconds_elapsed,latitude,longitude,speed,bearing,horizontalAccuracy'];
    for (let s = 0; s <= seconds; s++) loc.push(`${(T0 + BigInt(s * 1000)) * 1000000n},${s},${(LAT + dLat(s * 5)).toFixed(7)},${LON},5,0,5`);
    return zipSync({
      [platform === 'ios' ? 'AccelerometerUncalibrated.csv' : 'TotalAcceleration.csv']: strToU8(acc.join('\n')),
      'Location.csv': strToU8(loc.join('\n')),
      'Metadata.csv': strToU8(`version,device name,recording epoch time,platform,device id\n3,T,${T0},${platform},id-${platform}\n`),
    });
  }
  it('RMS-ul ferestrelor valide: ~1,5 m/s² în ambele cazuri (eroare < 3%)', () => {
    const med = (p: ReturnType<typeof processRide>) => { const v = p.windows.filter((w) => w.valid).map((w) => w.rms).sort((a, b) => a - b); return v[Math.floor(v.length / 2)]; };
    const ios = processRide(parseRideFile('i.zip', slZip('ios')));
    const and = processRide(parseRideFile('a.zip', slZip('android')));
    expect(ios.meta.unit_detected).toBe('g');
    expect(and.meta.unit_detected).toBe('m/s2');
    expect(ios.windows.filter((w) => w.valid).length).toBeGreaterThan(25);
    expect(med(ios)).toBeGreaterThan(1.5 * 0.97);
    expect(med(ios)).toBeLessThan(1.5 * 1.03);
    expect(Math.abs(med(ios) - med(and)) / med(and)).toBeLessThan(0.01);
    expect(ios.summary.gravity_median!).toBeCloseTo(9.81, 1);
  });
});

describe('audit rutare: șocurile nu intră a doua oară în cost', () => {
  it('aceleași ferestre cu și fără șocuri → costuri identice pe toate muchiile', () => {
    const g = makeGraph([[LAT, LON], [LAT, LON + dLon(500)], [LAT, LON + dLon(1000)]], [{ f: 0, t: 1 }, { f: 1, t: 2 }]);
    const windows: RideContribution['windows'] = [];
    for (const e of [0, 1]) for (let p = 0; p < 2; p++) for (let k = 0; k < 5; k++) windows.push({ edge: e, rms: e ? 4 : 1, speed: 5, acc: 5, valid: true, amb: false, pass: p });
    const shock = (i: number): Shock => ({ id: `s${i}`, t: i * 1000, peak: 20, z: 12, double_hit: true, speed: 5, lat: LAT, lon: LON + dLon(700 + i), r: 6, flags: [], located: true, needs_review: false, edge: 1, pass: i % 2, snippet: { dt: 20, v: [] } });
    const base = { ride_id: 'r', source: 'sensorlogger' as const, processing_version: 'x', date: 0, windows, included_in_layer: true };
    const th: [number, number, number, number] = [1.2, 1.6, 2.4, 3.6];
    const a = aggregate({ rides: [{ ...base, shocks: [] }], fixedThresholds: th, version: 1 });
    const b = aggregate({ rides: [{ ...base, shocks: [0, 1, 2, 3].map(shock) }], fixedThresholds: th, version: 2 });
    expect(b.zones.length).toBeGreaterThan(0);
    const rt = new Router(g);
    for (const w_c of [0, 1, 3]) expect([...rt.costs(b, { ...DEFAULT_ROUTE_OPTIONS, w_c })]).toEqual([...rt.costs(a, { ...DEFAULT_ROUTE_OPTIONS, w_c })]);
  });
});

const GRAPH = 'public/data/graph-timisoara.json';
describe.skipIf(!existsSync(GRAPH))('audit graf real: sensurile unice', () => {
  it('300 de rute aleatorii nu parcurg nicio muchie împotriva sensului unic pentru biciclete', () => {
    const g = new Graph(JSON.parse(readFileSync(GRAPH, 'utf8')) as GraphJson);
    const rt = new Router(g);
    const comp = mainComponent(g);
    const nodes: number[] = [];
    for (let n = 0; n < g.nNodes; n++) if (comp[n]) nodes.push(n);
    let seed = 99; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    let found = 0, onewayEdges = 0;
    for (let i = 0; i < 300; i++) {
      const a = nodes[Math.floor(rnd() * nodes.length)], b = nodes[Math.floor(rnd() * nodes.length)];
      const r = rt.route(a, b, null, { ...DEFAULT_ROUTE_OPTIONS, w_c: i % 2 ? 3 : 0 });
      if (!r.found) continue;
      found++;
      let at = a;
      for (const { edge, forward } of r.edges) {
        expect(forward ? g.from[edge] : g.to[edge]).toBe(at); // ruta e continuă
        if (g.oneway[edge] !== 0) { onewayEdges++; expect(g.oneway[edge]).toBe(forward ? 1 : -1); }
        at = forward ? g.to[edge] : g.from[edge];
      }
      expect(at).toBe(b);
    }
    expect(found).toBeGreaterThan(250);
    expect(onewayEdges).toBeGreaterThan(100); // testul chiar atinge sensuri unice
  });
});
