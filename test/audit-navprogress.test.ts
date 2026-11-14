// Audit independent: „Ai ajuns” apărea oricând proiecția poziției cădea pe ultimii 30 m ai rutei, chiar la sute
// de metri de destinație (de ex. dincolo de capătul rutei) și indiferent de precizia GPS.
import { describe, expect, it } from 'vitest';
import { navProgress } from '../src/core/navprogress';

const LAT = 45.75, LON = 21.22;
const dLat = (m: number) => m / 111195, dLon = (m: number) => m / 77600;
// ruta: 500 m spre est, apoi 200 m spre nord (destinația în capătul nordic)
const route: [number, number][] = [[LAT, LON], [LAT, LON + dLon(500)], [LAT + dLat(200), LON + dLon(500)]];
const at = (north: number, east: number, acc: number | null = 5) => navProgress(route, { lat: LAT + dLat(north), lon: LON + dLon(east), acc })!;

describe('audit: detectarea sosirii la destinație', () => {
  it('la mijlocul rutei: distanța rămasă corectă, nesosit', () => {
    const p = at(0, 250);
    expect(p.rem).toBeGreaterThan(440);
    expect(p.rem).toBeLessThan(460);
    expect(p.arrived).toBe(false);
    expect(p.off).toBe(false);
  });
  it('la 10 m de destinație, GPS bun: sosit', () => {
    const p = at(190, 500, 6);
    expect(p.arrived).toBe(true);
    expect(p.uncertain).toBe(false);
  });
  it('la 300 m DINCOLO de destinație (proiecția cade pe capătul rutei): NU „Ai ajuns”', () => {
    const p = at(500, 500, 5);
    expect(p.rem).toBeLessThan(1); // exact situația care producea „Ai ajuns” + „Ești în afara rutei” simultan
    expect(p.off).toBe(true);
    expect(p.arrived).toBe(false);
    expect(p.uncertain).toBe(false);
  });
  it('lateral față de capătul rutei, la 150 m: nesosit', () => {
    expect(at(200, 650, 5).arrived).toBe(false);
  });
  it('aproape de destinație, dar precizie GPS de 80 m: nu confirmăm sosirea, o marcăm ca incertă', () => {
    const p = at(185, 500, 80);
    expect(p.arrived).toBe(false);
    expect(p.uncertain).toBe(true);
  });
  it('precizie necunoscută (null / NaN): nu confirmăm sosirea', () => {
    expect(at(195, 500, null).arrived).toBe(false);
    expect(at(195, 500, NaN).arrived).toBe(false);
  });
  it('la 35 m înainte de destinație: încă nesosit (prag 30 m)', () => {
    expect(at(165, 500, 5).arrived).toBe(false);
  });
  it('rută degenerată sau poziție invalidă: null, fără excepții', () => {
    expect(navProgress([[LAT, LON]], { lat: LAT, lon: LON, acc: 5 })).toBeNull();
    expect(navProgress(route, { lat: NaN, lon: LON, acc: 5 })).toBeNull();
  });
});
