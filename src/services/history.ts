// Istoricul rutelor (aplicația pentru bicicliști): doar ce a ales utilizatorul și când a pornit/oprit navigarea.
// Fără traseu GPS, fără senzori, fără măsurători. Doar pe acest telefon (IndexedDB, cheia „route-history”).
import type { Place } from './geocode';

export type RouteStatus = 'active' | 'ended' | 'arrived' | 'interrupted';
export interface RoutePoint { name: string; lat: number; lon: number; kind: Place['kind'] }
export interface RouteEntry {
  id: string;
  origin: RoutePoint;
  dest: RoutePoint;
  distance_m: number;
  minutes: number;
  started_at: number;
  ended_at: number | null;
  status: RouteStatus;
}

export const HISTORY_MAX = 20;
export const HISTORY_KEY = 'route-history';
export const STATUS_LABEL: Record<RouteStatus, string> = { active: 'în curs', ended: 'oprită', arrived: 'ajuns', interrupted: 'întreruptă' };

const pt = (p: Place, at?: { lat: number; lon: number } | null): RoutePoint => ({ name: p.name, lat: at?.lat ?? p.lat, lon: at?.lon ?? p.lon, kind: p.kind });

/** pornirea navigării: o singură sesiune activă (una rămasă activă devine „întreruptă”, nu „terminată”) */
export function startRoute(list: RouteEntry[], i: { origin: Place; originAt?: { lat: number; lon: number } | null; dest: Place; distance_m: number; minutes: number }, now = Date.now()): { list: RouteEntry[]; entry: RouteEntry } {
  const closed = list.map((e) => (e.status === 'active' ? { ...e, status: 'interrupted' as const } : e));
  const entry: RouteEntry = {
    id: `nav-${now.toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    origin: pt(i.origin, i.originAt), dest: pt(i.dest),
    distance_m: Math.round(i.distance_m), minutes: Math.max(1, Math.round(i.minutes)),
    started_at: now, ended_at: null, status: 'active',
  };
  return { list: [entry, ...closed].slice(0, HISTORY_MAX), entry };
}

/** „Oprește” (ended) sau sosirea detectată de GPS (arrived). Sosirea deja înregistrată nu e retrogradată. */
export function finishRoute(list: RouteEntry[], id: string, how: 'ended' | 'arrived', now = Date.now()): RouteEntry[] {
  return list.map((e) => {
    if (e.id !== id) return e;
    if (e.status === 'arrived') return e;
    if (e.status !== 'active' && how === 'ended') return e;
    return { ...e, status: how, ended_at: now };
  });
}

/** la pornirea aplicației: o navigare rămasă „activă” a fost întreruptă (aplicația s-a închis), nu terminată */
export function recoverRoutes(list: unknown): RouteEntry[] {
  if (!Array.isArray(list)) return [];
  return list
    .filter((e): e is RouteEntry => !!e && typeof e === 'object' && typeof (e as RouteEntry).id === 'string' && !!(e as RouteEntry).dest && Number.isFinite((e as RouteEntry).dest.lat))
    .map((e) => (e.status === 'active' ? { ...e, status: 'interrupted' as const } : e))
    .slice(0, HISTORY_MAX);
}

export const deleteRoute = (list: RouteEntry[], id: string) => list.filter((e) => e.id !== id);

/** „Folosește din nou”: aceeași destinație, pornire de la poziția CURENTĂ (ruta se recalculează) */
export function reusePlan(e: RouteEntry): { origin: Place; dest: Place } {
  return {
    origin: { id: 'me', name: 'Locația mea', detail: 'GPS', lat: 0, lon: 0, kind: 'mylocation', source: 'gps' },
    dest: { id: `hist:${e.dest.lat},${e.dest.lon}`, name: e.dest.name, detail: 'Rută recentă', lat: e.dest.lat, lon: e.dest.lon, kind: e.dest.kind === 'mylocation' ? 'map' : e.dest.kind, source: 'recent' },
  };
}
