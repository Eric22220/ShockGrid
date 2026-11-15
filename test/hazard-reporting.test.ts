// Raportare în 2 atingeri, monitorizare live sigură, confirmări după tură (fără a deranja ciclistul în mers).
// Testele folosesc dependențe simulate: NU înlocuiesc testul pe un iPhone sau Samsung real.
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { monitorHealth } from '../src/capture/health';
import { Recorder, classifySources, type MotionLike, type RecorderDeps } from '../src/capture/recorder';
import { navProgress } from '../src/core/navprogress';
import { processRide } from '../src/core/process';
import { rideRoughness } from '../src/core/roughness';
import type { ProcessedRide } from '../src/core/types';
import { FIX_MAX_ACC_M, FIX_MAX_AGE_MS, FIX_WAIT_MS, MAX_PROMPTS, pendingPrompts, placement, promptTiming, QUICK_TYPES, quickReducer, zoneForReview, type QState } from '../src/services/hazard';
import { LocationTracker, type GeoLike } from '../src/services/location';
import { reportVisibility, shockKey } from '../src/services/reports';
import * as idb from '../src/storage/idb';
import * as store from '../src/state/store';
import { makeGraph, pathAlong, syntheticRide } from './helpers';

const NOW = 1_800_000_000_000;
const fresh = { lat: 45.75, lon: 21.22, acc: 6, t: NOW - 2000 };

describe('1–2. raportare manuală', () => {
  it('GPS proaspăt și precis: „Raportează” + „Groapă” = două atingeri, raport salvat local, neverificat', () => {
    let st: QState = { s: 'closed' };
    st = quickReducer(st, { a: 'fab' }); // atingerea 1
    expect(st.s).toBe('open');
    st = quickReducer(st, { a: 'type', type: 'groapa', fix: fresh, now: NOW, status: 'active' }); // atingerea 2
    expect(st.s).toBe('saved');
    if (st.s !== 'saved') return;
    const r = st.report;
    expect([r.lat, r.lon, r.acc, r.created_at, r.type, r.source]).toEqual([45.75, 21.22, 6, NOW, 'groapa', 'manual']);
    expect(r.verification).toBe('unverified');
    expect(r.status).toBe('local');
    expect(r.description).toBe('');
    expect(r.photo).toBeNull();
    expect(reportVisibility(r)).toBe('device');
    expect(QUICK_TYPES.map((q) => q.label)).toEqual(['Groapă', 'Denivelare', 'Obstacol', 'Capac de canal', 'Șine / rost', 'Altă problemă']);
  });
  it('GPS imprecis: nu salvează pe o poziție greșită, cere alegerea locului pe hartă', () => {
    const st = quickReducer({ s: 'open' }, { a: 'type', type: 'groapa', fix: { ...fresh, acc: FIX_MAX_ACC_M + 15 }, now: NOW, status: 'active' });
    expect(st).toMatchObject({ s: 'pick', reason: 'inaccurate' });
    expect(placement({ ...fresh, acc: null }, NOW).ok).toBe(false);
  });
  it('GPS vechi sau încă absent: așteaptă un fix proaspăt; dacă nu vine, alegerea pe hartă', () => {
    const old = { ...fresh, t: NOW - FIX_MAX_AGE_MS - 1000 };
    let st = quickReducer({ s: 'open' }, { a: 'type', type: 'denivelare', fix: old, now: NOW, status: 'active' });
    expect(st.s).toBe('waiting');
    // vine un fix bun: se salvează fără altă atingere
    const saved = quickReducer(st, { a: 'fix', fix: { ...fresh, t: NOW + 1500 }, now: NOW + 2000, status: 'active' });
    expect(saved.s).toBe('saved');
    // nu vine nimic: după FIX_WAIT_MS, alegerea pe hartă
    st = quickReducer(st, { a: 'fix', fix: old, now: NOW + FIX_WAIT_MS, status: 'active' });
    expect(st).toMatchObject({ s: 'pick', reason: 'stale', type: 'denivelare' });
    expect(quickReducer({ s: 'open' }, { a: 'type', type: 'groapa', fix: null, now: NOW, status: 'locating' }).s).toBe('waiting');
  });
  it('9a. locația refuzată: explicat, alegerea pe hartă imediat', () => {
    const st = quickReducer({ s: 'open' }, { a: 'type', type: 'groapa', fix: fresh, now: NOW, status: 'denied' });
    expect(st).toMatchObject({ s: 'pick', reason: 'denied' });
  });
});

// ---- tură sintetică pe o stradă dreaptă, cu vârfuri ----
const LAT = 45.75, LON = 21.22;
const dLon = (m: number) => m / 77600;
const N = [0, 300, 600, 900].map((m) => [LAT, LON + dLon(m)] as [number, number]);
const g = makeGraph(N, [{ f: 0, t: 1, highway: 'residential' }, { f: 1, t: 2, highway: 'residential' }, { f: 2, t: 3, highway: 'residential' }]);
function rideWith(key: string, spikes: { x: number; amp: number; gyro?: number }[], speed = 4.5): ProcessedRide {
  const { path, seconds } = pathAlong([N[0], N[3]], speed, 0.5, 7);
  const at = spikes.map((sp) => ({ ...sp, s: sp.x / speed }));
  const raw = syntheticRide({
    seconds: Math.floor(seconds), fs: 100, vibAmp: 0.8, speed, path, acc: 5,
    gyroDeg: (t) => { for (const sp of at) if (sp.gyro && Math.abs(t - sp.s) < 0.3) return sp.gyro; return 5; },
  });
  raw.meta.ride_key = key;
  for (const sp of at) { const i0 = Math.round(sp.s * 100); for (let k = 0; k < 3; k++) raw.motion.z[i0 + k] += sp.amp; }
  return processRide(raw, { graph: g });
}

describe('3–7. șocuri candidate și confirmarea după tură', () => {
  it('3. un singur șoc puternic nu devine automat groapă confirmată: o întrebare, niciun raport', () => {
    const p = rideWith('one-strong', [{ x: 450, amp: 30 }]);
    const rr = rideRoughness(p);
    expect(rr.counts.strong).toBe(1);
    const q = pendingPrompts(p.ride_id, rr, {});
    expect(q).toHaveLength(1);
    expect(q[0].n_strong).toBe(1);
    // nimic nu a creat un raport sau o confirmare
    expect(rr.zones.every((z) => z.priority !== 'high' || z.passes >= 2 || z.n_strong > 0)).toBe(true);
  });
  it('4. mai multe vârfuri ale aceluiași obstacol = o singură întrebare (nu una pe vârf)', () => {
    const p = rideWith('cluster', [{ x: 440, amp: 30 }, { x: 444, amp: 9 }, { x: 449, amp: 9 }]);
    const rr = rideRoughness(p);
    expect(rr.counts.raw).toBeGreaterThanOrEqual(2);
    expect(pendingPrompts(p.ride_id, rr, {})).toHaveLength(1);
  });
  it('5. manevrarea telefonului (rotație mare) nu produce întrebări', () => {
    const p = rideWith('handling', [{ x: 300, amp: 30, gyro: 600 }]);
    const rr = rideRoughness(p);
    expect(rr.counts.handling).toBe(1);
    expect(pendingPrompts(p.ride_id, rr, {})).toHaveLength(0);
  });
  it('6–7. niciodată în timpul turei; după tură apar întrebările, „Mai târziu” le păstrează, răspunsul le închide', () => {
    expect(promptTiming({ rideActive: true })).toBe('defer');
    expect(promptTiming({ rideActive: false })).toBe('now');
    const p = rideWith('two', [{ x: 150, amp: 30 }, { x: 700, amp: 30 }]);
    const rr = rideRoughness(p);
    const all = pendingPrompts(p.ride_id, rr, {});
    expect(all).toHaveLength(2);
    expect(pendingPrompts(p.ride_id, rr, {}, [all[0].id])).toEqual([all[1]]); // „Mai târziu” → următoarea
    expect(pendingPrompts(p.ride_id, rr, {})).toHaveLength(2); // amânarea nu răspunde în locul utilizatorului
    const reviews = Object.fromEntries(all[0].events.map((e) => [shockKey(p.ride_id, e.shock.id), { answer: 'no' as const, at: NOW }]));
    expect(pendingPrompts(p.ride_id, rr, reviews)).toEqual([all[1]]);
    expect(MAX_PROMPTS).toBeLessThanOrEqual(5);
  });
});

async function freshDb() {
  await idb._resetDb();
  await new Promise<void>((res) => { const r = indexedDB.deleteDatabase('shockgrid'); r.onsuccess = () => res(); r.onerror = () => res(); r.onblocked = () => res(); });
}

describe('8. respins ≠ raport', () => {
  beforeEach(freshDb);
  it('„Nu” nu creează raport și șterge un „Da” anterior; un „Da” = un singur raport pentru toată zona', async () => {
    const p = rideWith('rev', [{ x: 440, amp: 30 }, { x: 445, amp: 9 }]);
    const z = pendingPrompts(p.ride_id, rideRoughness(p), {})[0];
    await store.reviewZone(p.ride_id, zoneForReview(z), 'yes', 'groapa');
    expect(store.getState().reports).toHaveLength(1);
    expect(store.getState().reports[0]).toMatchObject({ source: 'shock', type: 'groapa', verification: 'unverified' });
    await store.reviewZone(p.ride_id, zoneForReview(z), 'no');
    expect(store.getState().reports).toHaveLength(0);
    expect(z.events.every((e) => store.getState().rejected.includes(shockKey(p.ride_id, e.shock.id)))).toBe(true);
    expect((await idb.listReports())).toHaveLength(0);
  });
});

// ---- înregistratorul cu senzori simulați ----
function multiGeo() {
  const ws = new Map<number, (p: GeolocationPosition) => void>();
  let next = 1;
  const geo: GeoLike = { watchPosition: (ok) => { ws.set(next, ok); return next++; }, clearWatch: (id) => { ws.delete(id); } };
  return { geo, ws, emit: (lat: number, lon: number, t: number) => ws.forEach((f) => f({ timestamp: t, coords: { latitude: lat, longitude: lon, accuracy: 5, speed: 5, heading: 90, altitude: null, altitudeAccuracy: null } } as unknown as GeolocationPosition)) };
}
function deps(clock: { t: number }, geo: GeoLike | null) {
  let motion: ((e: MotionLike) => void) | null = null;
  let vis: ((h: boolean) => void) | null = null;
  const d: RecorderDeps = {
    addMotion: (l) => { motion = l; }, removeMotion: () => { motion = null; }, geo,
    append: async () => {}, load: async () => [],
    requestWakeLock: async () => ({ release: async () => {}, addEventListener: () => {} }),
    onVisibility: (l) => { vis = l; return () => { vis = null; }; },
    now: () => clock.t, timeOrigin: NOW, setInterval: () => 1, clearInterval: () => {},
  };
  return { d, motion: (s: number) => motion?.({ timeStamp: s * 1000 + 0.001, interval: 10, accelerationIncludingGravity: { x: 0.1, y: 0.2, z: 9.81 + 0.5 * Math.sin(s * 70) }, acceleration: null, rotationRate: { alpha: 1, beta: 1, gamma: 1 } }), hide: (h: boolean) => vis?.(h), get listening() { return motion !== null; } };
}
const health = (r: Recorder) => monitorHealth(r.stats());

describe('9–11. starea senzorilor, fundal, navigare + măsurare', () => {
  it('9b. senzori de mișcare refuzați: „Doar traseul”, explicat; fără nimic: „Nu se măsoară nimic”', () => {
    expect(classifySources('none', 'ok')).toBe('gps_only');
    const base = { state: 'recording' as const, imu: 'none' as const, fs: 0, samples: 0, motionAge_s: null, hidden: false };
    expect(monitorHealth({ ...base, sources: 'gps_only', gps: 'ok' })).toMatchObject({ level: 'warn', text: 'Doar traseul' });
    expect(monitorHealth({ ...base, sources: 'none', gps: 'denied' }).level).toBe('off');
    expect(monitorHealth({ ...base, sources: 'none', gps: 'denied' }).detail).toContain('Locația e refuzată');
  });
  it('10. pagina ascunsă sau senzorii opriți: avertisment, nu „Se măsoară”', async () => {
    const clock = { t: NOW };
    const g1 = multiGeo();
    const f = deps(clock, g1.geo);
    const rec = new Recorder({}, f.d);
    await rec.begin();
    for (let i = 0; i < 300; i++) { clock.t = NOW + i * 10; f.motion(i / 100); if (i % 100 === 0) g1.emit(45.75, 21.22, clock.t); }
    expect(health(rec)).toMatchObject({ level: 'ok', text: 'Se măsoară' });
    f.hide(true);
    expect(health(rec)).toMatchObject({ level: 'off', text: 'Măsurare întreruptă' });
    f.hide(false);
    clock.t += 3000; // nicio mostră de 3 s (de ex. browserul a suspendat senzorii)
    expect(health(rec).level).toBe('off');
    expect(health(rec).text).toBe('Senzorii s-au oprit');
    expect(rec.stats().problems.join(' ')).toContain('ecranul a fost stins');
  });
  it('11. navigarea și înregistrarea merg împreună: ambele primesc GPS; oprirea turei nu oprește navigarea', async () => {
    const clock = { t: NOW };
    const g1 = multiGeo();
    const tracker = new LocationTracker(g1.geo);
    const release = tracker.acquire(); // navigarea
    const f = deps(clock, g1.geo);
    const rec = new Recorder({}, f.d);
    await rec.begin(); // măsurarea, pornită odată cu navigarea
    expect(g1.ws.size).toBe(2);
    const route: [number, number][] = [[45.75, 21.22], [45.75, 21.23]];
    g1.emit(45.75, 21.224, NOW + 1000);
    expect(rec.stats().fixes).toBe(1);
    expect(navProgress(route, tracker.get().fix!)!.rem).toBeGreaterThan(400);
    await rec.stop().catch(() => {}); // ZIP-ul are nevoie de IndexedDB; aici ne interesează doar ascultătorii
    expect(f.listening).toBe(false);
    expect(g1.ws.size).toBe(1); // watcher-ul navigării a rămas
    g1.emit(45.75, 21.228, NOW + 5000);
    expect(navProgress(route, tracker.get().fix!)!.rem).toBeLessThan(200);
    release();
    expect(g1.ws.size).toBe(0);
  });
});
