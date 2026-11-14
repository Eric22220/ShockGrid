import { useMemo } from 'react';
import { DEFAULT_CONFIG } from '../../core/config';
import { CATEGORY_LABEL, SPEED_BANDS, rideQuality } from '../../core/quality';
import type { ProcessedRide } from '../../core/types';
import { fmt, fmtDur, fmtLen } from '../format';

const BAND_COLORS: Record<string, string> = { stop: '#9aa3ae', e1: '#c9b48a', e2: '#d9a441', e3: '#e08a2c', r1: '#3d9a50', r2: '#2c7a3f', r3: '#1f5c2e', fast: '#7a3fb0', unk: '#d4d8dd' };

/** Raportul de calitate după import: ce e utilizabil pentru ce, fără a schimba măsurătorile. */
export function RideQualityCard({ p, rideId }: { p: ProcessedRide; rideId: string }) {
  const q = useMemo(() => rideQuality(p, DEFAULT_CONFIG), [p]);
  const cat = CATEGORY_LABEL[q.category];
  const total = Object.values(q.seconds_by_band).reduce((a, b) => a + b, 0) || 1;
  const bands = [...SPEED_BANDS.map((b) => ({ id: b.id, label: b.label })), { id: 'unk', label: 'fără viteză GPS' }].filter((b) => q.seconds_by_band[b.id]);
  const pct = (a: number, b: number) => (b > 0 ? `${Math.round((100 * a) / b)}%` : '—');
  return (
    <div className="card">
      <div className="row nowrap" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h3 style={{ margin: 0 }}>Calitatea datelor</h3>
        <span className={`badge ${cat.tone === 'ok' ? 'comfort' : cat.tone === 'warn' ? 'warn' : 'primary'}`}>{cat.title}</span>
      </div>
      <p className="small" style={{ margin: '6px 0 10px' }}>{cat.text}</p>
      <div className="small" style={{ marginBottom: 4 }}><b>Timp pe viteze</b> · în mișcare {fmtDur(q.moving_s)}, oprit {fmtDur(q.stationary_s)}</div>
      <div className="bar" style={{ height: 14 }} role="img" aria-label={bands.map((b) => `${b.label}: ${pct(q.seconds_by_band[b.id], total)}`).join(', ')}>
        {bands.map((b) => <i key={b.id} title={b.label} style={{ width: `${(100 * q.seconds_by_band[b.id]) / total}%`, background: BAND_COLORS[b.id] }} />)}
      </div>
      <div className="xs" style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 12px', margin: '6px 0 10px' }}>
        {bands.map((b) => <span key={b.id}><i style={{ display: 'inline-block', width: 9, height: 9, borderRadius: 2, background: BAND_COLORS[b.id], marginRight: 4 }} />{b.label} {pct(q.seconds_by_band[b.id], total)}</span>)}
      </div>
      <dl className="kv">
        <dt>durată · distanță</dt><dd>{fmtDur(q.duration_s)} · {fmtLen(q.distance_m)}</dd>
        <dt>senzori</dt><dd>{fmt(q.fs_median, 1, 'Hz')} · {p.summary.n_motion.toLocaleString('ro-RO')} mostre</dd>
        <dt>GPS</dt><dd>{q.n_fix} fixuri · precizie mediană ±{fmt(q.acc_median, 1, 'm')}{q.n_fix_poor ? ` · ${q.n_fix_poor} peste ±${DEFAULT_CONFIG.mm_max_acc} m (ignorate)` : ''}</dd>
        <dt>ferestre RVI valide</dt><dd><b>{q.windows.valid}</b> din {q.windows.total} ({pct(q.windows.valid, q.windows.total)})</dd>
        <dt>excluse: viteză mică</dt><dd>{q.windows.low_speed}{q.windows.exploratory ? ` (din care ${q.windows.exploratory} explorabile la 0,5–2,5 m/s)` : ''}</dd>
        {q.windows.high_speed > 0 && <><dt>excluse: viteză mare</dt><dd>{q.windows.high_speed}</dd></>}
        {q.windows.no_gps + q.windows.speed_unknown > 0 && <><dt>excluse: fără GPS</dt><dd>{q.windows.no_gps + q.windows.speed_unknown}</dd></>}
        {q.windows.phone_motion > 0 && <><dt>excluse: telefon rotit</dt><dd>{q.windows.phone_motion}</dd></>}
        {q.windows.signal > 0 && <><dt>excluse: semnal</dt><dd>{q.windows.signal}</dd></>}
        <dt>pe străzi</dt><dd>{q.matched.windows} ferestre potrivite, {q.matched.ambiguous} ambigue (carosabil/trotuar/pistă); valide: {q.matched.valid_matched}, ambigue {q.matched.valid_ambiguous}</dd>
        <dt>șocuri candidate</dt><dd>{q.shocks.total} · {q.shocks.clean} fără semnale de alarmă · {q.shocks.needs_review} de verificat{q.shocks.low_speed ? ` (${q.shocks.low_speed} sub 2,5 m/s)` : ''}</dd>
        <dt>eligibil pentru stratul public</dt><dd>{q.publish.rvi_windows} ferestre RVI · {q.publish.exploratory_windows} explorare · {q.publish.clean_shocks} șocuri; {q.publish.excluded_privacy} excluse lângă începutul/sfârșitul turei. Nimic nu se publică automat.</dd>
      </dl>
      {q.notes.length > 0 && <ul className="small" style={{ margin: '10px 0 0', paddingLeft: 18 }}>{q.notes.map((n) => <li key={n}>{n}</li>)}</ul>}
      {p.match.graph_available && q.matched.windows > 0 && <a className="btn block" style={{ marginTop: 12 }} href={`#/ride/${rideId}/street`}>Analiză pe stradă (studiu de caz)</a>}
    </div>
  );
}
