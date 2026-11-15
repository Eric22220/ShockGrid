// Starea reală a măsurării în timpul turei, din fluxurile care chiar sosesc (nu din faptul că am apăsat „Pornește”).
// Nu spunem „Se măsoară” dacă senzorii s-au oprit, pagina e în fundal sau GPS-ul lipsește.
import type { LiveStats } from './recorder';

export type HealthLevel = 'ok' | 'warn' | 'off' | 'paused' | 'starting';
export interface Health { level: HealthLevel; text: string; detail: string | null }

/** sub această frecvență vibrațiile nu se mai pot calcula ca la import (filtru 4 Hz, ferestre 2 s) */
export const MIN_RATE_HZ = 20;
/** fără mostre de atâtea secunde → senzorii s-au oprit */
export const MOTION_STALL_S = 1.5;

export function monitorHealth(s: Pick<LiveStats, 'state' | 'sources' | 'imu' | 'gps' | 'fs' | 'samples'> & { motionAge_s: number | null; hidden: boolean }): Health {
  if (s.state === 'paused') return { level: 'paused', text: 'Măsurare în pauză', detail: null };
  if (s.hidden) return { level: 'off', text: 'Măsurare întreruptă', detail: 'Aplicația e în fundal sau ecranul e stins: browserul nu mai trimite senzorii.' };
  if (s.sources === 'waiting') return { level: 'starting', text: 'Se pornesc senzorii…', detail: null };
  if (s.sources === 'none') return { level: 'off', text: 'Nu se măsoară nimic', detail: s.gps === 'denied' ? 'Locația e refuzată și senzorii de mișcare nu trimit date.' : 'Nici GPS-ul, nici senzorii de mișcare nu trimit date.' };
  if (s.imu === 'ok' && s.samples > 0 && s.motionAge_s !== null && s.motionAge_s > MOTION_STALL_S) return { level: 'off', text: 'Senzorii s-au oprit', detail: 'Ține aplicația deschisă și ecranul aprins.' };
  if (s.sources === 'gps_only') return { level: 'warn', text: 'Doar traseul', detail: 'Senzorii de mișcare nu trimit date: fără vibrații și fără șocuri.' };
  if (s.sources === 'imu_only') return { level: 'warn', text: 'Fără GPS', detail: s.gps === 'denied' ? 'Locația e refuzată: vibrațiile nu pot fi puse pe hartă.' : 'Nu primim semnal GPS: vibrațiile nu pot fi puse pe hartă.' };
  if (s.gps === 'stale') return { level: 'warn', text: 'GPS întrerupt', detail: 'Niciun semnal GPS de peste 5 s.' };
  if (s.fs > 0 && s.fs < MIN_RATE_HZ) return { level: 'warn', text: `Senzori lenți (${Math.round(s.fs)} Hz)`, detail: `Browserul trimite mai rar de ${MIN_RATE_HZ} ori pe secundă.` };
  return { level: 'ok', text: 'Se măsoară', detail: null };
}
