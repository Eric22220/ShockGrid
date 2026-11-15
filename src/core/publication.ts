// Setul de date public (stratul agregat): identificator de versiune, validare înainte de publicare, citire
// tolerantă în aplicația pentru bicicliști, diferența față de stratul deja publicat. Fără rețea aici.
import type { Snapshot, SnapshotEdge, SnapshotShock } from './aggregate';
import { hashString } from './stats';

/** fișierele publicate împreună, într-un singur commit (aplicația pentru bicicliști citește doar primul) */
export const PUBLIC_DIR = 'public/data';
export const PRIMARY_FILE = 'comfort-layer.json';

/** ID-ul publicării = amprenta conținutului, fără momentul generării: același conținut → același ID (idempotent) */
export function publicationId(snap: Snapshot): string {
  const { generated_at: _g, publication_id: _p, ...meta } = snap.meta;
  const body = JSON.stringify({ meta, edges: snap.edges, shocks: snap.shocks });
  return `pub-${hashString(body)}${hashString(body, 7).slice(0, 4)}`;
}

const EDGE_KEYS = new Set<keyof SnapshotEdge>(['edge_id', 'rms', 'speed', 'acc', 'n_total', 'n_amb', 'n_passes', 'n_rides', 'last_seen', 'sources', 'slow_rms', 'slow_speed', 'slow_passes', 'off', 'pk', 'slow_off']);
const SHOCK_KEYS = new Set<keyof SnapshotShock>(['lat', 'lon', 'r', 'peak', 'z', 'double_hit', 'speed', 'edge', 'needs_review', 'pass_key', 'snippet', 'date']);
const META_KEYS = new Set(['processing_version', 'generated_at', 'thresholds', 'thresholds_source', 'device_note', 'ride_ids', 'ride_keys', 'n_rides', 'includes_exploratory', 'attribution', 'license', 'publication_id']);
const num = (x: unknown) => typeof x === 'number' && Number.isFinite(x);
const nums = (a: unknown) => Array.isArray(a) && a.every(num);

/** Verificările de structură înainte de publicare (pe lângă auditul de confidențialitate). Întoarce motivele de refuz. */
export function validatePublicDataset(snap: Snapshot): string[] {
  const err: string[] = [];
  if (!snap || typeof snap !== 'object' || !snap.meta || !Array.isArray(snap.edges) || !Array.isArray(snap.shocks)) return ['structură invalidă (lipsesc meta / edges / shocks)'];
  for (const k of Object.keys(snap.meta)) if (!META_KEYS.has(k)) err.push(`câmp nepermis în meta: ${k}`);
  if (snap.meta.ride_ids?.length) err.push('meta conține ID-uri de tură (sunt permise doar chei de deduplicare)');
  if (!snap.meta.publication_id || snap.meta.publication_id !== publicationId(snap)) err.push('ID-ul publicării lipsește sau nu corespunde conținutului');
  if (!snap.edges.length && !snap.shocks.length) err.push('setul de date e gol: nimic de publicat');
  const seen = new Set<number>();
  for (const e of snap.edges) {
    for (const k of Object.keys(e)) if (!EDGE_KEYS.has(k as keyof SnapshotEdge)) err.push(`câmp nepermis în segmentul ${e.edge_id}: ${k}`);
    if (!Number.isInteger(e.edge_id) || e.edge_id < 0) err.push('segment cu edge_id invalid');
    if (seen.has(e.edge_id)) err.push(`segment duplicat: ${e.edge_id}`);
    seen.add(e.edge_id);
    if (!nums(e.rms) || !nums(e.speed) || !nums(e.acc) || e.rms.length !== e.speed.length || e.rms.length !== e.acc.length) err.push(`segmentul ${e.edge_id}: ferestre inconsistente`);
    if (e.off && (!nums(e.off) || e.off.length !== e.rms.length)) err.push(`segmentul ${e.edge_id}: poziții inconsistente`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(e.last_seen)) err.push(`segmentul ${e.edge_id}: dată invalidă (doar AAAA-LL-ZZ, fără oră)`);
  }
  for (const s of snap.shocks) {
    for (const k of Object.keys(s)) if (!SHOCK_KEYS.has(k as keyof SnapshotShock)) err.push(`câmp nepermis într-un șoc: ${k}`);
    if (!num(s.lat) || !num(s.lon)) err.push('șoc fără poziție validă');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s.date)) err.push('șoc cu dată invalidă (doar AAAA-LL-ZZ)');
  }
  const text = JSON.stringify(snap);
  if (/\b1[6-9]\d{11}\b/.test(text)) err.push('conține timpi epoch (ms)');
  return [...new Set(err)];
}

/** Citirea tolerantă a stratului publicat (aplicația pentru bicicliști): un fișier stricat nu șterge datele existente. */
export function parseSnapshot(json: unknown): Snapshot | null {
  if (!json || typeof json !== 'object') return null;
  const s = json as Snapshot;
  if (!s.meta || typeof s.meta !== 'object' || typeof s.meta.generated_at !== 'string' || !Array.isArray(s.edges) || !Array.isArray(s.shocks)) return null;
  const edges = s.edges.filter((e) => e && Number.isInteger(e.edge_id) && nums(e.rms) && nums(e.speed) && nums(e.acc) && e.rms.length === e.speed.length);
  const shocks = s.shocks.filter((x) => x && num(x.lat) && num(x.lon));
  return { ...s, edges, shocks };
}

/** versiunea unui strat (ID-ul publicării sau, la straturile vechi, momentul generării) */
export const snapshotVersion = (s: Snapshot | null) => (s ? s.meta.publication_id ?? s.meta.generated_at : null);

export interface SnapshotDiff { added: number[]; updated: number[]; removed: number[]; unchanged: number[] }
/** diferența pe segmente între stratul publicat și cel propus */
export function diffSnapshots(prev: Snapshot | null, next: Snapshot): SnapshotDiff {
  const old = new Map((prev?.edges ?? []).map((e) => [e.edge_id, JSON.stringify(e)]));
  const d: SnapshotDiff = { added: [], updated: [], removed: [], unchanged: [] };
  for (const e of next.edges) {
    const o = old.get(e.edge_id);
    if (o === undefined) d.added.push(e.edge_id);
    else if (o === JSON.stringify(e)) d.unchanged.push(e.edge_id);
    else d.updated.push(e.edge_id);
    old.delete(e.edge_id);
  }
  d.removed = [...old.keys()];
  return d;
}

/** manifestul publicării: ce s-a publicat, când, cu ce cifre (fără date personale) */
export interface PublicationManifest {
  publication_id: string;
  generated_at: string;
  processing_version: string;
  files: string[];
  counts: { segments: number; measured: number; low_confidence: number; explored: number; hazards_unverified: number; hazards_verified: number; meters: number };
  note: string;
}

/** De ce nu se poate publica încă (gol = se poate). Aceleași reguli în interfață și în teste. */
export function publishBlockers(i: { auditOk: boolean; invalid: string[]; liveKnown: boolean; approved: boolean; lowCount: number; lowApproved: boolean; token: string }): string[] {
  const b: string[] = [];
  if (!i.auditOk) b.push('auditul de confidențialitate a eșuat');
  if (i.invalid.length) b.push('setul de date nu e valid');
  if (!i.liveKnown) b.push('stratul publicat acum nu a putut fi citit (necesar pentru conflicte)');
  if (!i.approved) b.push('lipsește aprobarea explicită');
  if (i.lowCount > 0 && !i.lowApproved) b.push('lipsește acordul pentru datele cu încredere redusă');
  if (i.token.trim().length < 20) b.push('lipsește tokenul GitHub');
  return b;
}
