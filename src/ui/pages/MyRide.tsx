// Pagina unei ture, pentru bicicliști: rezumat, întrebările rămase, traseul, ștergere. Analiza tehnică e în ShockGrid Dev.
import { Map as MapIcon, Trash2, TriangleAlert } from 'lucide-react';
import { useMemo } from 'react';
import { DEFAULT_CONFIG } from '../../core/config';
import { rideRoughness } from '../../core/roughness';
import { MAX_PROMPTS, pendingPrompts } from '../../services/hazard';
import { removeRide, setIncluded, useApp } from '../../state/store';
import { RideMiniMap } from '../components/RideMiniMap';
import { fmt, fmtLen } from '../format';
import { Header, Stat, toast } from '../kit';
import { go } from '../nav';

export function MyRide({ id }: { id?: string }) {
  const r = useApp((s) => s.rides.find((x) => x.ride_id === id));
  const loaded = useApp((s) => s.ready);
  const graph = useApp((s) => s.graph);
  const reviews = useApp((s) => s.reviews);
  const rr = useMemo(() => (r ? rideRoughness(r.processed, DEFAULT_CONFIG, graph) : null), [r, graph]);
  if (!r) return <main className="screen"><div className="wrap"><Header title="Tură" back="#/rides" /><p>{loaded ? 'Tura nu există pe acest telefon.' : 'Se încarcă…'}</p></div></main>;
  const p = r.processed, s = p.summary;
  const pending = pendingPrompts(r.ride_id, rr, reviews, [], Infinity).length;
  const measuredS = p.windows.filter((w) => w.valid).length;
  return (
    <main className="screen"><div className="wrap stack">
      <Header title={p.meta.label || 'Tură'} back="#/rides" />
      <p className="small muted" style={{ marginTop: -8 }}>{new Date(p.meta.start_ms).toLocaleString('ro-RO', { dateStyle: 'full', timeStyle: 'short' })}</p>
      <div className="grid3">
        <Stat v={fmtLen(s.distance_m)} l="distanță" />
        <Stat v={s.duration_s < 60 ? '<1' : `${Math.round(s.duration_s / 60)}`} unit="min" l="durată" />
        <Stat v={s.speed_median ? fmt(s.speed_median * 3.6, 0) : '—'} unit="km/h" l="viteză tipică" />
      </div>
      {pending > 0 && (
        <a className="card tint-warn" href={`#/after/${r.ride_id}`} style={{ display: 'flex', gap: 12, alignItems: 'center', textDecoration: 'none', color: 'inherit' }}>
          <TriangleAlert style={{ color: 'var(--warn)', flex: 'none' }} />
          <div className="grow"><b>Ai întâlnit o problemă pe drum?</b><div className="small muted">{Math.min(pending, MAX_PROMPTS)} {Math.min(pending, MAX_PROMPTS) === 1 ? 'loc' : 'locuri'} unde telefonul a simțit șocuri</div></div>
          <span className="btn sm primary">Răspunde</span>
        </a>
      )}
      <p className="small">{measuredS > 0 ? 'Porțiunile parcurse cu viteză obișnuită apar colorate pe hartă.' : s.n_motion === 0 ? 'Senzorii de mișcare nu au trimis date: tura are doar traseul.' : 'Tura a fost prea lentă (sau fără GPS bun) pentru o culoare de confort; porțiunile lente apar violet pe hartă.'}</p>
      <RideMiniMap p={p} />
      <label className="switch card" style={{ padding: '6px 16px' }}><input type="checkbox" checked={r.included} onChange={(e) => setIncluded(r.ride_id, e.target.checked)} /><span><b>Folosește tura în harta mea</b><div className="xs muted">Doar pe acest telefon</div></span></label>
      <a className="btn block" href={`#/map/${r.ride_id}`}><MapIcon /> Vezi pe hartă</a>
      <button className="btn danger block" onClick={async () => { if (confirm('Ștergi tura de pe acest telefon? Nu se poate anula.')) { await removeRide(r.ride_id); toast('Tura a fost ștearsă.'); go('/rides'); } }}><Trash2 /> Șterge tura</button>
      <p className="xs muted">Tura rămâne doar pe acest telefon. Nu e publicată și nu e trimisă nicăieri.</p>
    </div></main>
  );
}
