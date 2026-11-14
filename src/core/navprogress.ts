// Progresul pe ruta urmărită („Urmărește-mă”): distanța rămasă, ieșirea de pe rută și sosirea.
// Sosirea se anunță doar când poziția o susține: aproape de capătul rutei ȘI de destinație, cu GPS suficient de precis.
import { TM_PROJ, haversine, pointSegment } from './geo';

/** sub câți metri rămași pe rută spunem „Ai ajuns” */
export const ARRIVE_M = 30;
/** distanța maximă în linie dreaptă până la destinație la care mai putem spune „Ai ajuns” */
export const ARRIVE_DIRECT_M = 45;
/** peste această incertitudine GPS nu anunțăm sosirea (cercul de precizie e mai mare decât pragul de sosire) */
export const ARRIVE_MAX_ACC_M = 30;

export interface NavProgress {
  /** metri rămași pe rută, de la proiecția poziției pe traseu */
  rem: number;
  /** distanța de la poziție la traseu */
  offBy: number;
  off: boolean;
  arrived: boolean;
  /** aproape de destinație, dar GPS-ul e prea imprecis ca să confirmăm sosirea */
  uncertain: boolean;
}

export function navProgress(routePts: [number, number][], fix: { lat: number; lon: number; acc: number | null }): NavProgress | null {
  if (routePts.length < 2 || !Number.isFinite(fix.lat) || !Number.isFinite(fix.lon)) return null;
  const px = TM_PROJ.x(fix.lon), py = TM_PROJ.y(fix.lat);
  let best = Infinity, bi = 0, bt = 0;
  for (let i = 0; i + 1 < routePts.length; i++) {
    const [d, tt] = pointSegment(px, py, TM_PROJ.x(routePts[i][1]), TM_PROJ.y(routePts[i][0]), TM_PROJ.x(routePts[i + 1][1]), TM_PROJ.y(routePts[i + 1][0]));
    if (d < best) { best = d; bi = i; bt = tt; }
  }
  let rem = haversine(routePts[bi][0], routePts[bi][1], routePts[bi + 1][0], routePts[bi + 1][1]) * (1 - bt);
  for (let i = bi + 1; i + 1 < routePts.length; i++) rem += haversine(routePts[i][0], routePts[i][1], routePts[i + 1][0], routePts[i + 1][1]);
  // precizie necunoscută = tratată ca slabă (nu confirmăm sosirea pe o poziție fără incertitudine declarată)
  const acc = fix.acc !== null && Number.isFinite(fix.acc) && fix.acc >= 0 ? fix.acc : Infinity;
  const end = routePts[routePts.length - 1];
  const direct = haversine(fix.lat, fix.lon, end[0], end[1]);
  const off = best > Math.max(40, Number.isFinite(acc) ? acc * 1.5 : 40);
  const near = rem < ARRIVE_M && direct <= ARRIVE_DIRECT_M;
  const arrived = near && acc <= ARRIVE_MAX_ACC_M;
  return { rem, offBy: best, off, arrived, uncertain: near && !arrived };
}
