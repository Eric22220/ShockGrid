// Regulile de confidențialitate pentru stratul public (comfort-layer.json). Nimic nu se publică automat:
// stratul se construiește local cu `npm run build-layer`, se auditează (`npm run audit-layer`) și se publică doar după aprobare.
import { DEFAULT_CONFIG, type VibrationConfig } from './config';
import { haversine } from './geo';
import { hashString } from './stats';
import type { ProcessedRide } from './types';

/** Raza (m, în linie dreaptă) în jurul primului și ultimului fix GPS din care nu publicăm nimic.
 * Tăierea primilor/ultimilor 200 m pe traseu nu ajunge: o tură se poate întoarce lângă punctul de plecare. */
export const PRIVACY_RADIUS_M = 250;

export interface PublishRules { trim_m: number; radius_m: number }
export const defaultRules = (cfg: VibrationConfig = DEFAULT_CONFIG): PublishRules => ({ trim_m: cfg.publish_trim_m, radius_m: PRIVACY_RADIUS_M });

/** primul și ultimul fix GPS utilizabil al turei */
export function rideEnds(p: ProcessedRide): { lat: number; lon: number }[] {
  const good = p.gps.filter((f) => f.acc === null || f.acc <= 50);
  return good.length ? [good[0], good[good.length - 1]] : [];
}

/** Predicat: o măsurătoare la distanța cumulată `dist` și poziția (lat, lon) poate fi publicată? */
export function publishFilter(p: ProcessedRide, cfg: VibrationConfig = DEFAULT_CONFIG, rules: PublishRules = defaultRules(cfg)) {
  const total = p.summary.distance_m;
  const ends = rideEnds(p);
  return (dist: number, lat: number | null, lon: number | null): boolean => {
    if (dist < rules.trim_m || dist > total - rules.trim_m) return false;
    if (lat === null || lon === null) return false;
    for (const f of ends) if (haversine(f.lat, f.lon, lat, lon) < rules.radius_m) return false;
    return true;
  };
}

/** Cheia publică de deduplicare a unei ture: nu e ID-ul turei și nu poate fi legată de un telefon fără fișierul original.
 * Aplicația o recalculează din tura locală, ca o tură deja publicată să nu fie numărată de două ori. */
export function publicKey(rideId: string): string {
  return 'k' + hashString('shockgrid-public-v1:' + rideId) + hashString(rideId + ':v1', 7);
}
