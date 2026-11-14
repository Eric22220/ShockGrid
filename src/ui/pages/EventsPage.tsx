// Diagnostic: toate evenimentele brute ale turei, cu clasificarea și motivele ei. Nimic nu e ascuns sau șters.
import { useMemo, useState } from 'react';
import { DEFAULT_CONFIG } from '../../core/config';
import { fmtOffset, parseOffset, rideStart } from '../../core/corridor';
import { EVENT_KIND_LABEL, rideRoughness, type EventKind } from '../../core/roughness';
import { shockKey } from '../../services/reports';
import { reviewShock, useApp } from '../../state/store';
import { fmt } from '../format';
import { Header } from '../kit';

type KindF = 'all' | EventKind;
type ConfF = 'all' | 'ok' | 'low';
type GroupF = 'all' | 'zone' | 'isolated' | 'excluded';

export function EventsPage({ id }: { id?: string }) {
  const ride = useApp((s) => s.rides.find((r) => r.ride_id === id));
  const loaded = useApp((s) => s.ready);
  const graph = useApp((s) => s.graph);
  const reviews = useApp((s) => s.reviews);
  const rr = useMemo(() => (ride ? rideRoughness(ride.processed, DEFAULT_CONFIG, graph) : null), [ride, graph]);
  const [kind, setKind] = useState<KindF>('all');
  const [conf, setConf] = useState<ConfF>('all');
  const [group, setGroup] = useState<GroupF>('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [byPeak, setByPeak] = useState(false);
  if (!ride || !rr) return <main className="screen"><div className="wrap"><Header title="Evenimente brute" back="#/rides" /><p>{loaded ? 'Tura nu există pe acest telefon.' : 'Se încarcă…'}</p></div></main>;
  const t0 = rideStart(ride.processed);
  const f0 = parseOffset(from), f1 = parseOffset(to);
  const list = rr.events
    .filter((e) => kind === 'all' || e.kind === kind)
    .filter((e) => conf === 'all' || (conf === 'ok' ? e.low.length === 0 : e.low.length > 0))
    .filter((e) => group === 'all' || (group === 'zone' ? e.zone >= 0 : group === 'isolated' ? e.isolated : e.kind === 'handling' || e.kind === 'stationary'))
    .filter((e) => { const o = (e.shock.t - t0) / 1000; return (f0 === null || o >= f0) && (f1 === null || o <= f1); })
    .sort((a, b) => (byPeak ? b.shock.peak - a.shock.peak : a.shock.t - b.shock.t));
  const sel = (label: string, value: string, set: (v: string) => void, opts: [string, string][]) => (
    <label className="field"><span>{label}</span><select value={value} onChange={(e) => set(e.target.value)}>{opts.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
  );
  return (
    <main className="screen"><div className="wrap stack">
      <Header title="Evenimente brute" back={`#/review/${ride.ride_id}`} />
      <p className="small muted" style={{ marginTop: -6 }}>Diagnostic: toate cele {rr.counts.raw} vârfuri detectate, cu clasificarea și motivul ei. Pragurile: detecție la z &gt; {DEFAULT_CONFIG.shock_z} și vârf &gt; {DEFAULT_CONFIG.shock_abs} m/s² față de ultimele {DEFAULT_CONFIG.shock_baseline_s} s; „puternic” = de {DEFAULT_CONFIG.shock_strong_factor}× ambele; manevrare = rotație &gt; {DEFAULT_CONFIG.gyro_max} °/s sau orientare schimbată &gt; {DEFAULT_CONFIG.mount_shift_deg}°.</p>
      <div className="grid2">
        {sel('Clasă', kind, (v) => setKind(v as KindF), [['all', 'toate'], ['strong', 'șoc puternic'], ['weak', 'șoc slab'], ['handling', 'manevrare'], ['stationary', 'oprit']])}
        {sel('Încredere', conf, (v) => setConf(v as ConfF), [['all', 'toate'], ['ok', 'context bun'], ['low', 'încredere redusă']])}
        {sel('Grupare', group, (v) => setGroup(v as GroupF), [['all', 'toate'], ['zone', 'în zone'], ['isolated', 'izolate'], ['excluded', 'excluse']])}
        {sel('Ordine', byPeak ? 'peak' : 'time', (v) => setByPeak(v === 'peak'), [['time', 'după oră'], ['peak', 'după intensitate']])}
        <label className="field"><span>De la (mm:ss)</span><input className="input" inputMode="numeric" value={from} onChange={(e) => setFrom(e.target.value)} placeholder="0:00" /></label>
        <label className="field"><span>Până la (mm:ss)</span><input className="input" inputMode="numeric" value={to} onChange={(e) => setTo(e.target.value)} placeholder={fmtOffset(ride.processed.summary.duration_s)} /></label>
      </div>
      <p className="small"><b>{list.length}</b> din {rr.counts.raw} evenimente</p>
      <div className="stack" style={{ gap: 6 }}>
        {list.slice(0, 300).map((e) => {
          const s = e.shock;
          const rv = reviews[shockKey(ride.ride_id, s.id)];
          return (
            <div key={s.id} className="card flat" style={{ padding: 10 }}>
              <div className="row nowrap" style={{ justifyContent: 'space-between' }}>
                <b>+{fmtOffset((s.t - t0) / 1000)} · {new Date(s.t).toLocaleTimeString('ro-RO')}</b>
                <span className={`badge ${e.kind === 'strong' ? 'danger' : e.kind === 'handling' || e.kind === 'stationary' ? '' : 'warn'}`}>{EVENT_KIND_LABEL[e.kind]}</span>
              </div>
              <div className="small">vârf {fmt(s.peak, 1, 'm/s²')} · z {fmt(s.z, 0)} · {s.speed === null ? 'viteză ?' : `${Math.round(s.speed * 3.6)} km/h`} · ±{Math.round(s.r ?? 10)} m · rotație {s.gyro_max == null ? '?' : `${Math.round(s.gyro_max)} °/s`} · orientare {s.tilt == null ? '?' : `${Math.round(s.tilt)}°`}</div>
              <div className="xs muted">{e.why.join('; ')}{e.low.length ? ` · încredere redusă: ${e.low.join(', ')}` : ''}{e.zone >= 0 ? ` · zona ${e.zone + 1}` : e.isolated ? ' · izolat' : ''}{rv ? ` · răspunsul tău: ${rv.answer === 'yes' ? 'Da' : rv.answer === 'no' ? 'Nu' : 'Nesigur'}` : ''}</div>
              {s.lat !== null && (
                <div className="row" style={{ gap: 6, marginTop: 6 }}>
                  <button className="btn sm" onClick={() => void reviewShock(ride.ride_id, s, 'yes')}>Problemă</button>
                  <button className="btn sm" onClick={() => void reviewShock(ride.ride_id, s, 'no')}>Nu e</button>
                  <button className="btn sm" onClick={() => void reviewShock(ride.ride_id, s, 'unsure')}>Nesigur</button>
                </div>
              )}
            </div>
          );
        })}
        {list.length > 300 && <p className="small muted">Afișăm primele 300; restrânge filtrele.</p>}
      </div>
    </div></main>
  );
}
