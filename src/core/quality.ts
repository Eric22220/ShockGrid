// Calitatea datelor unei ture: ce poate fi folosit și pentru ce (RVI, explorare la viteză redusă, șocuri, publicare).
// Nu schimbă nicio măsurătoare: doar numără și explică.
import { DEFAULT_CONFIG, type VibrationConfig } from './config';
import { median, medianOrNull } from './stats';
import { publishFilter } from './publish';
import type { ProcessedRide, VibWindow } from './types';

/** sub această viteză (m/s) bicicleta e considerată oprită */
export const STOP_SPEED = 0.5;

/** Benzile de viteză pentru explorarea la viteză redusă. Vibrația crește puternic cu viteza, deci
 * valorile se compară DOAR în aceeași bandă și nu se transformă în clase A–E. */
export const EXPLORE_BANDS: { id: string; lo: number; hi: number; label: string }[] = [
  { id: 'e1', lo: 0.5, hi: 1.0, label: '0,5–1 m/s (≈ 2–4 km/h)' },
  { id: 'e2', lo: 1.0, hi: 1.5, label: '1–1,5 m/s (≈ 4–5 km/h)' },
  { id: 'e3', lo: 1.5, hi: 2.5, label: '1,5–2,5 m/s (≈ 5–9 km/h)' },
];

export const SPEED_BANDS: { id: string; lo: number; hi: number; label: string }[] = [
  { id: 'stop', lo: -Infinity, hi: STOP_SPEED, label: 'oprit (< 0,5 m/s)' },
  ...EXPLORE_BANDS,
  { id: 'r1', lo: 2.5, hi: 4, label: '2,5–4 m/s (9–14 km/h)' },
  { id: 'r2', lo: 4, hi: 6, label: '4–6 m/s (14–22 km/h)' },
  { id: 'r3', lo: 6, hi: 9, label: '6–9 m/s (22–32 km/h)' },
  { id: 'fast', lo: 9, hi: Infinity, label: '> 9 m/s' },
];

export function bandOf(speed: number, bands = SPEED_BANDS): string | null {
  for (const b of bands) if (speed >= b.lo && speed < b.hi) return b.id;
  return null;
}

/** Fereastră utilizabilă pentru explorare la viteză redusă: semnal curat, GPS, viteză 0,5 m/s … pragul RVI.
 * Aceste ferestre NU intră în RVI, în clasele A–E sau în costul rutei. */
export function isExploratory(w: VibWindow, cfg: VibrationConfig = DEFAULT_CONFIG): boolean {
  return w.reason === 'speed_low' && w.speed !== null && w.speed >= EXPLORE_BANDS[0].lo && w.speed < cfg.speed_min && w.lat !== null;
}

export type RideCategory = 'RVI_OK' | 'PARTIAL_RVI' | 'LOW_SPEED_EXPLORATORY' | 'STATIONARY' | 'NO_GPS' | 'NO_MOTION';

export const CATEGORY_LABEL: Record<RideCategory, { title: string; text: string; tone: 'ok' | 'info' | 'warn' }> = {
  RVI_OK: { title: 'Utilizabilă pentru RVI', text: 'Cea mai mare parte a mersului e la 2,5–9 m/s cu GPS: vibrațiile se pot compara pe segmente.', tone: 'ok' },
  PARTIAL_RVI: { title: 'Parțial utilizabilă', text: 'O parte din tură trece de filtre; restul e exclus (motivele sunt mai jos).', tone: 'info' },
  LOW_SPEED_EXPLORATORY: { title: 'Tură lentă · explorator', text: 'Cea mai mare parte a mersului e sub 2,5 m/s. RVI se calculează doar pe porțiunile mai rapide; restul se poate inspecta ca explorare, comparat doar la aceeași viteză, fără clase de confort.', tone: 'warn' },
  STATIONARY: { title: 'Aproape staționară', text: 'Aproape tot timpul viteza e sub 0,5 m/s. Bună pentru test de senzori, nu pentru măsurarea străzilor.', tone: 'warn' },
  NO_GPS: { title: 'Fără GPS', text: 'Vibrațiile s-au înregistrat, dar nu pot fi puse pe hartă.', tone: 'warn' },
  NO_MOTION: { title: 'Fără senzori de mișcare', text: 'Doar traseul GPS: nu putem măsura vibrațiile.', tone: 'warn' },
};

export interface RideQuality {
  category: RideCategory;
  duration_s: number;
  fs_median: number;
  n_fix: number;
  acc_median: number | null;
  /** fixuri cu precizie mai slabă decât pragul de potrivire pe străzi (mm_max_acc) */
  n_fix_poor: number;
  distance_m: number;
  /** secunde (o fereastră pe secundă) pe benzi de viteză; 'unk' = fără viteză GPS */
  seconds_by_band: Record<string, number>;
  moving_s: number;
  stationary_s: number;
  windows: {
    total: number;
    valid: number;
    low_speed: number;
    exploratory: number;
    high_speed: number;
    no_gps: number;
    speed_unknown: number;
    phone_motion: number; // giroscop / suport mișcat
    signal: number; // goluri, stabilizare, frecvență mică, aplicație în fundal
  };
  /** ferestre potrivite pe străzi; ambigue = o cale paralelă de alt tip e la fel de aproape */
  matched: { windows: number; ambiguous: number; with_pos: number; valid_matched: number; valid_ambiguous: number };
  shocks: { total: number; clean: number; needs_review: number; low_speed: number };
  /** ce ar putea intra în stratul public, după regulile de confidențialitate (fără să fie publicat automat) */
  publish: { rvi_windows: number; exploratory_windows: number; clean_shocks: number; excluded_privacy: number };
  /** explicații în limbaj simplu, în ordinea importanței */
  notes: string[];
}

export function rideQuality(p: ProcessedRide, cfg: VibrationConfig = DEFAULT_CONFIG): RideQuality {
  const s = p.summary;
  const W = p.windows;
  const seconds: Record<string, number> = {};
  let moving = 0, stationary = 0;
  for (const w of W) {
    const b = w.speed === null ? 'unk' : bandOf(w.speed) ?? 'unk';
    seconds[b] = (seconds[b] ?? 0) + cfg.step_s;
    if (w.speed !== null) { if (w.speed >= STOP_SPEED) moving += cfg.step_s; else stationary += cfg.step_s; }
  }
  const count = (f: (w: VibWindow) => boolean) => W.reduce((a, w) => a + (f(w) ? 1 : 0), 0);
  const windows = {
    total: W.length,
    valid: count((w) => w.valid),
    low_speed: count((w) => w.reason === 'speed_low'),
    exploratory: count((w) => isExploratory(w, cfg)),
    high_speed: count((w) => w.reason === 'speed_high'),
    no_gps: count((w) => w.reason === 'no_gps'),
    speed_unknown: count((w) => w.reason === 'speed_unknown'),
    phone_motion: count((w) => w.reason === 'gyro' || w.reason === 'mount_shift'),
    signal: count((w) => w.reason === 'gap' || w.reason === 'settling' || w.reason === 'low_fs' || w.reason === 'hidden'),
  };
  const matched = {
    windows: count((w) => w.edge >= 0),
    ambiguous: count((w) => w.edge >= 0 && w.amb),
    with_pos: count((w) => w.lat !== null),
    valid_matched: count((w) => w.valid && w.edge >= 0),
    valid_ambiguous: count((w) => w.valid && w.edge >= 0 && w.amb),
  };
  const shocks = {
    total: p.shocks.length,
    clean: p.shocks.filter((x) => !x.needs_review).length,
    needs_review: p.shocks.filter((x) => x.needs_review).length,
    low_speed: p.shocks.filter((x) => x.speed !== null && x.speed < cfg.speed_min).length,
  };
  const keep = publishFilter(p, cfg);
  let excluded = 0;
  const pub = { rvi_windows: 0, exploratory_windows: 0, clean_shocks: 0, excluded_privacy: 0 };
  for (const w of W) {
    if (w.edge < 0 || !(w.valid || isExploratory(w, cfg))) continue;
    if (!keep(w.dist, w.lat, w.lon)) { excluded++; continue; }
    if (w.valid) pub.rvi_windows++; else pub.exploratory_windows++;
  }
  for (const x of p.shocks) {
    if (x.needs_review || !x.located || x.edge < 0) continue;
    const w = W.find((w) => x.t >= w.t0 && x.t < w.t1);
    if (w && keep(w.dist, x.lat, x.lon)) pub.clean_shocks++;
  }
  pub.excluded_privacy = excluded;

  const movingW = count((w) => w.speed !== null && w.speed >= STOP_SPEED && w.lat !== null);
  let category: RideCategory;
  if (s.n_motion === 0) category = 'NO_MOTION';
  else if (s.n_fix === 0) category = 'NO_GPS';
  else if (movingW < 60) category = 'STATIONARY';
  else if (windows.valid >= 0.5 * movingW) category = 'RVI_OK';
  else if (windows.low_speed >= 0.5 * movingW) category = 'LOW_SPEED_EXPLORATORY';
  else category = 'PARTIAL_RVI';

  const accs = p.gps.map((f) => f.acc).filter((a): a is number => a !== null);
  const notes: string[] = [];
  const pct = (a: number, b: number) => (b > 0 ? Math.round((100 * a) / b) : 0);
  if (windows.low_speed) notes.push(`${pct(windows.low_speed, windows.total)}% din ferestre sunt sub ${fmtN(cfg.speed_min)} m/s (≈ ${Math.round(cfg.speed_min * 3.6)} km/h): vibrația la viteză mică nu e comparabilă cu cea la 15–20 km/h, deci nu intră în RVI.`);
  if (windows.exploratory) notes.push(`${windows.exploratory} ferestre lente (0,5–${fmtN(cfg.speed_min)} m/s) cu GPS pot fi inspectate ca explorare, comparate doar în aceeași bandă de viteză.`);
  if (windows.phone_motion) notes.push(`${windows.phone_motion} ferestre excluse pentru rotații mari ale telefonului sau suport mișcat.`);
  if (windows.no_gps + windows.speed_unknown) notes.push(`${windows.no_gps + windows.speed_unknown} ferestre fără poziție sau viteză GPS.`);
  if (windows.signal > 2) notes.push(`${windows.signal} ferestre cu probleme de semnal (goluri, stabilizarea filtrelor, aplicație în fundal).`);
  if (matched.ambiguous) notes.push(`${pct(matched.ambiguous, matched.windows)}% din ferestrele potrivite pe străzi sunt ambigue (o cale paralelă de alt tip e la fel de aproape): segmentele lor rămân cel mult „încredere redusă”.`);
  if (shocks.needs_review) notes.push(`${shocks.needs_review} din ${shocks.total} șocuri candidate sunt „de verificat” (viteză în afara benzii, rotație sau suport mișcat). Un șoc nu e automat o groapă.`);

  return {
    category,
    duration_s: s.duration_s,
    fs_median: s.fs_median,
    n_fix: s.n_fix,
    acc_median: medianOrNull(accs),
    n_fix_poor: accs.filter((a) => a > cfg.mm_max_acc).length,
    distance_m: s.distance_m,
    seconds_by_band: seconds,
    moving_s: moving,
    stationary_s: stationary,
    windows,
    matched,
    shocks,
    publish: pub,
    notes,
  };
}

const fmtN = (v: number) => String(v).replace('.', ',');

/** mediana sau null, pentru afișare */
export function med(a: number[]): number | null { return a.length ? median(a) : null; }
