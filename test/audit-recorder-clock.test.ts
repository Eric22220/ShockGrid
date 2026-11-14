// Audit independent: ceasul evenimentelor de mișcare (event.timeStamp, bazat pe performance.now) NU avansează
// cât timp telefonul doarme (iOS Safari, Chrome pe Android), pe când GPS-ul e în timp epoch. Testele existente
// țineau cele două ceasuri perfect sincronizate, deci treceau deși în producție vibrațiile ajungeau pe alte străzi.
import { describe, expect, it } from 'vitest';
import { Recorder, type MotionLike, type RecorderDeps } from '../src/capture/recorder';
import { parseRideFile } from '../src/core/io';
import { processRide } from '../src/core/process';
import type { RecChunk } from '../src/storage/idb';

const T0 = 1_800_000_000_000;

function harness(timeOrigin: number) {
  const clock = { t: T0 };
  const chunks: RecChunk[] = [];
  let motionL: ((e: MotionLike) => void) | null = null;
  let gpsOk: ((p: GeolocationPosition) => void) | null = null;
  let tick: (() => void) | null = null;
  const deps: RecorderDeps = {
    addMotion: (l) => { motionL = l; },
    removeMotion: () => { motionL = null; },
    geo: { watchPosition: (ok) => { gpsOk = ok; return 1; }, clearWatch: () => {} },
    append: async (c) => { chunks.push({ ...c, id: chunks.length + 1 }); },
    load: async (s) => chunks.filter((c) => c.session === s),
    now: () => clock.t,
    timeOrigin,
    setInterval: (f) => { tick = f; return 1; },
    clearInterval: () => { tick = null; },
  };
  /** mers la 5 m/s spre nord: `perfMs` = ceasul monoton al paginii, `epochMs` = ceasul real */
  const ride = (seconds: number, perfStartMs: number, epochStartMs: number, distStartM: number, latencyMs = 0) => {
    for (let i = 0; i < seconds * 100; i++) {
      const s = i / 100;
      clock.t = epochStartMs + s * 1000 + latencyMs;
      motionL?.({ timeStamp: perfStartMs + s * 1000, interval: 10, accelerationIncludingGravity: { x: 0.1, y: 0.2, z: 9.81 + 0.6 * Math.sin(2 * Math.PI * 12 * s) }, acceleration: null, rotationRate: { alpha: 1, beta: 1, gamma: 1 } });
      if (i % 100 === 0) {
        gpsOk?.({ timestamp: clock.t, coords: { latitude: 45.75 + (distStartM + s * 5) / 111195, longitude: 21.22, accuracy: 5, speed: 5, heading: 0, altitude: null, altitudeAccuracy: null } } as unknown as GeolocationPosition);
        tick?.();
      }
    }
  };
  return { deps, clock, ride };
}

describe('audit: sincronizarea ceasului senzorilor cu timpul GPS', () => {
  it('pagina deschisă demult, telefonul a dormit 3 min înainte de tură: mostrele rămân în timp real', async () => {
    // performance.timeOrigin + performance.now() a rămas cu 180 s în urma ceasului real
    const h = harness(T0 - 600_000);
    const rec = new Recorder({}, h.deps);
    await rec.begin();
    h.ride(40, 600_000 - 180_000, T0, 0);
    const raw = parseRideFile('a.zip', await rec.stop());
    expect(raw.motion.t.length).toBeGreaterThan(3900);
    expect(Math.abs(raw.motion.t[0] - T0)).toBeLessThan(50);
    expect(Math.abs(raw.motion.t[raw.motion.t.length - 1] - raw.gps[raw.gps.length - 1].t)).toBeLessThan(1500);
    // fără corecție, toate ferestrele erau „no_gps” (sau, mai rău, potrivite pe poziția de acum 3 minute)
    const p = processRide(raw);
    expect(p.windows.filter((w) => w.valid).length).toBeGreaterThan(25);
  });

  it('telefonul doarme 60 s în timpul turei: mostrele de după trezire nu sunt puse cu 60 s (300 m) în urmă', async () => {
    const h = harness(T0);
    const rec = new Recorder({}, h.deps);
    await rec.begin();
    h.ride(20, 0, T0, 0); // 0–20 s, 0–100 m
    // 60 s de somn: ceasul real avansează, cel al paginii nu; biciclistul a mai parcurs 300 m
    h.ride(20, 20_000, T0 + 80_000, 400); // 80–100 s real, 400–500 m
    const raw = parseRideFile('b.zip', await rec.stop());
    const lastT = raw.motion.t[raw.motion.t.length - 1];
    expect(Math.abs(lastT - (T0 + 100_000))).toBeLessThan(100);
    expect(raw.events.map((e) => e.type)).toContain('clock_resync');
    const p = processRide(raw);
    // ferestrele valide de după trezire stau la poziția reală (≥ 400 m de start), nu la 100–200 m
    const after = p.windows.filter((w) => w.valid && w.t0 > T0 + 80_000);
    expect(after.length).toBeGreaterThan(10);
    for (const w of after) expect((w.lat! - 45.75) * 111195).toBeGreaterThan(395);
    // și nicio fereastră validă nu acoperă intervalul de somn
    expect(p.windows.some((w) => w.valid && w.t1 > T0 + 21_000 && w.t0 < T0 + 80_000)).toBe(false);
  });

  it('întârzierea obișnuită de livrare a evenimentelor (zeci de ms) nu mută mostrele', async () => {
    const h = harness(T0);
    const rec = new Recorder({}, h.deps);
    await rec.begin();
    h.ride(5, 0, T0, 0, 300); // primul lot livrat cu 300 ms întârziere (pagina ocupată la pornire)
    h.ride(10, 5000, T0 + 5000, 25, 5); // apoi livrare normală
    const raw = parseRideFile('c.zip', await rec.stop());
    const n = raw.motion.t.length;
    // după ce apare o livrare promptă, ceasul converge la cel real (eroare sub 20 ms), fără resincronizări
    expect(Math.abs(raw.motion.t[n - 1] - (T0 + 14_990))).toBeLessThan(20);
    expect(raw.events.map((e) => e.type)).not.toContain('clock_resync');
    expect(n).toBeGreaterThan(1450);
  });
});
