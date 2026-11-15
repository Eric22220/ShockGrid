// Raportarea rapidă (2 atingeri) și confirmările după tură. Logică pură, testată fără browser.
// Rapoartele rămân DOAR pe telefon (IndexedDB); nimic de aici nu publică sau nu trimite la Primărie.
import type { RideRoughness, RoughZone } from '../core/roughness';
import type { LocalReport, ReportType } from '../storage/idb';
import { createReport, shockKey, type ShockReview } from './reports';

/** categoriile rapide, în ordinea în care le vede ciclistul */
export const QUICK_TYPES: { id: ReportType; label: string }[] = [
  { id: 'groapa', label: 'Groapă' },
  { id: 'denivelare', label: 'Denivelare' },
  { id: 'obstacol', label: 'Obstacol' },
  { id: 'capac', label: 'Capac de canal' },
  { id: 'rost', label: 'Șine / rost' },
  { id: 'alta', label: 'Altă problemă' },
];

/** o poziție mai veche de atât nu mai e „aici” (la 20 km/h, 15 s ≈ 80 m) */
export const FIX_MAX_AGE_MS = 15000;
/** peste această incertitudine nu punem automat raportul: cerem alegerea pe hartă */
export const FIX_MAX_ACC_M = 25;
/** cât așteptăm un fix bun după alegerea categoriei, înainte de alegerea pe hartă */
export const FIX_WAIT_MS = 10000;

export interface FixLike { lat: number; lon: number; acc: number | null; t: number }
export type LocKind = 'active' | 'locating' | 'denied' | 'unavailable' | 'timeout' | 'unsupported' | 'insecure' | 'idle';
export type PlaceReason = 'none' | 'stale' | 'inaccurate' | 'denied';

export type Placement = { ok: true; lat: number; lon: number; acc: number } | { ok: false; reason: PlaceReason };

export const PLACE_REASON_TEXT: Record<PlaceReason, string> = {
  none: 'Nu avem încă poziția GPS.',
  stale: 'Ultima poziție GPS e prea veche.',
  inaccurate: 'GPS-ul e prea imprecis acum.',
  denied: 'Accesul la locație nu e disponibil.',
};

export function placement(fix: FixLike | null, now: number, status: LocKind = 'active'): Placement {
  if (status === 'denied' || status === 'unsupported' || status === 'insecure') return { ok: false, reason: 'denied' };
  if (!fix) return { ok: false, reason: 'none' };
  if (now - fix.t > FIX_MAX_AGE_MS) return { ok: false, reason: 'stale' };
  if (fix.acc === null || !Number.isFinite(fix.acc) || fix.acc > FIX_MAX_ACC_M) return { ok: false, reason: 'inaccurate' };
  return { ok: true, lat: fix.lat, lon: fix.lon, acc: fix.acc };
}

/** raport manual, neverificat, pe poziția GPS curentă */
export function quickHazard(p: Extract<Placement, { ok: true }>, type: ReportType, now: number): LocalReport {
  return { ...createReport({ lat: p.lat, lon: p.lon, acc: Math.round(p.acc), type, source: 'manual', now }), verification: 'unverified' };
}

// ---- fluxul în atingeri (reducer folosit de interfață) ----
export type QState =
  | { s: 'closed' }
  | { s: 'open' }
  | { s: 'waiting'; type: ReportType; since: number }
  | { s: 'saved'; report: LocalReport }
  | { s: 'pick'; type: ReportType; reason: PlaceReason };
export type QAction =
  | { a: 'fab' }
  | { a: 'close' }
  | { a: 'type'; type: ReportType; fix: FixLike | null; now: number; status: LocKind }
  | { a: 'fix'; fix: FixLike | null; now: number; status: LocKind };

export function quickReducer(st: QState, ac: QAction): QState {
  switch (ac.a) {
    case 'fab': return { s: 'open' };
    case 'close': return { s: 'closed' };
    case 'type': {
      if (st.s !== 'open') return st;
      const p = placement(ac.fix, ac.now, ac.status);
      if (p.ok) return { s: 'saved', report: quickHazard(p, ac.type, ac.now) };
      // GPS-ul tocmai pornește sau fixul e vechi: așteptăm puțin un fix proaspăt; altfel alegerea pe hartă
      if (p.reason === 'none' || p.reason === 'stale') return { s: 'waiting', type: ac.type, since: ac.now };
      return { s: 'pick', type: ac.type, reason: p.reason };
    }
    case 'fix': {
      if (st.s !== 'waiting') return st;
      const p = placement(ac.fix, ac.now, ac.status);
      if (p.ok) return { s: 'saved', report: quickHazard(p, st.type, ac.now) };
      if (p.reason === 'denied' || p.reason === 'inaccurate' && ac.now - st.since >= FIX_WAIT_MS / 2) return { s: 'pick', type: st.type, reason: p.reason };
      if (ac.now - st.since >= FIX_WAIT_MS) return { s: 'pick', type: st.type, reason: p.reason };
      return st;
    }
  }
}

// ---- confirmările după tură ----
/** câte întrebări punem după o tură; restul rămân în ShockGrid Lab */
export const MAX_PROMPTS = 5;

/** Întrebările nu se pun NICIODATĂ în timpul turei: doar după oprire. */
export function promptTiming(s: { rideActive: boolean }): 'defer' | 'now' {
  return s.rideActive ? 'defer' : 'now';
}

/** O zonă (grup de vârfuri ale aceluiași obstacol probabil) = o singură întrebare. Doar zonele prioritare,
 * nerăspunse; manevrarea telefonului și vârfurile slabe izolate nu ajung aici. */
export function pendingPrompts(rideId: string, rr: RideRoughness | null, reviews: Record<string, ShockReview>, skipped: string[] = [], max = MAX_PROMPTS): RoughZone[] {
  if (!rr) return [];
  return rr.zones
    .filter((z) => z.priority !== 'low' && !skipped.includes(z.id))
    .filter((z) => z.events.every((e) => !reviews[shockKey(rideId, e.shock.id)]))
    .slice(0, max);
}

export function zoneForReview(z: RoughZone) {
  return { lat: z.lat, lon: z.lon, radius_m: z.radius_m, members: z.events.map((e) => e.shock), strongest: z.strongest };
}
