// Paginile de secțiune din ShockGrid Dev: „Analiză” și „Zone și șocuri”, cu alegerea turei.
// Nu adaugă calcule: deschid paginile existente (RideDetail, ReplayPage, StreetPage, ReviewScreen, EventsPage).
import { Activity, BarChart3, GitCompare, ListFilter, Map as MapIcon, MapPinned, Route, ShieldCheck, Upload } from 'lucide-react';
import { useMemo, useState } from 'react';
import { DEFAULT_CONFIG } from '../core/config';
import { streetsOfRide } from '../core/corridor';
import { rideRoughness } from '../core/roughness';
import type { StoredRide } from '../storage/idb';
import { useApp } from '../state/store';
import { fmtLen } from '../ui/format';
import { Item } from '../ui/kit';
import { CoveragePanel, HazardList, useCoverage } from './Hazards';

function useRidePick() {
  const rides = useApp((s) => s.rides);
  const sorted = useMemo(() => [...rides].sort((a, b) => b.processed.meta.start_ms - a.processed.meta.start_ms), [rides]);
  const [id, setId] = useState<string | null>(null);
  const r = sorted.find((x) => x.ride_id === id) ?? sorted[0] ?? null;
  const picker = sorted.length > 1 && (
    <label className="field"><span>Tura</span>
      <select value={r?.ride_id ?? ''} onChange={(e) => setId(e.target.value)}>
        {sorted.map((x) => <option key={x.ride_id} value={x.ride_id}>{x.processed.meta.label || x.file_name} · {new Date(x.processed.meta.start_ms).toLocaleDateString('ro-RO')}</option>)}
      </select>
    </label>
  );
  return { r, picker, count: sorted.length };
}

function NoRides() {
  return (
    <div className="card stack">
      <p style={{ margin: 0 }}>Nicio tură în acest browser.</p>
      <div className="list"><Item href="#/import" icon={<Upload />} tone="comfort" title="Importă ZIP din Sensor Logger" sub="sau copiază turele din aplicația ShockGrid, din Panou" /></div>
    </div>
  );
}

const rideSub = (r: StoredRide) => `${new Date(r.processed.meta.start_ms).toLocaleString('ro-RO', { dateStyle: 'medium', timeStyle: 'short' })} · ${fmtLen(r.processed.summary.distance_m)} · ${r.processed.processing_version}`;

export function AnalysisPage() {
  const graph = useApp((s) => s.graph);
  const { r, picker, count } = useRidePick();
  const streets = useMemo(() => (r && graph ? streetsOfRide(r.processed, graph).slice(0, 6) : []), [r, graph]);
  const p = r?.processed;
  return (
    <main className="screen"><div className="wrap stack">
      <h1>Analiză</h1>
      {!r || !p ? <NoRides /> : (
        <>
          {picker}
          <p className="small muted" style={{ margin: 0 }}>{rideSub(r)}</p>
          <div className="dev-stats">
            <div className="card"><div className="small muted">Mostre accelerometru</div><div className="big num">{p.summary.n_motion.toLocaleString('ro-RO')}</div><div className="xs muted">{p.summary.fs_median ? `${Math.round(p.summary.fs_median)} Hz` : '—'}</div></div>
            <div className="card"><div className="small muted">Poziții GPS</div><div className="big num">{p.summary.n_fix.toLocaleString('ro-RO')}</div><div className="xs muted">{p.summary.acc_median !== null ? `±${Math.round(p.summary.acc_median)} m median` : '—'}</div></div>
            <div className="card"><div className="small muted">Ferestre RVI valide</div><div className="big num">{p.windows.filter((w) => w.valid).length}</div><div className="xs muted">din {p.windows.length} ferestre de 2 s</div></div>
            <div className="card"><div className="small muted">Potrivite pe străzi</div><div className="big num">{p.windows.length ? Math.round((100 * p.windows.filter((w) => w.edge >= 0).length) / p.windows.length) : 0}%</div><div className="xs muted">ferestre pe o muchie OSM</div></div>
          </div>
          <div className="list">
            <Item href={`#/ride/${r.ride_id}`} icon={<Activity />} tone="primary" title="Calitatea datelor și RVI" sub="frecvență, timpi, viteze, ferestre valide/excluse, clase" />
            <Item href={`#/ride/${r.ride_id}/replay`} icon={<BarChart3 />} title="Accelerometru, giroscop, RVI în timp" sub="semnalele brute și filtrate, ferestrele, șocurile" />
            <Item href={`#/map/${r.ride_id}`} icon={<MapIcon />} title="Traseul GPS pe harta tehnică" sub="potrivirea pe străzi, tronsoane, încredere" />
            {count > 1 && <Item href="#/compare" icon={<GitCompare />} title="Compară ture" sub="aceleași segmente, ture diferite" />}
          </div>
          {streets.length > 0 && (
            <>
              <div className="section-label">Analiză pe stradă</div>
              <div className="list">{streets.map((s) => <Item key={s.name} href={`#/ride/${r.ride_id}/street?name=${encodeURIComponent(s.name)}`} icon={<MapPinned />} title={s.name} sub={`${s.windows} s pe stradă · vibrația față de restul turei, la aceeași viteză`} />)}</div>
            </>
          )}
        </>
      )}
    </div></main>
  );
}

export function ZonesPage() {
  const graph = useApp((s) => s.graph);
  const hazards = useApp((s) => s.layer.hazards);
  const { r, picker } = useRidePick();
  const rr = useMemo(() => (r ? rideRoughness(r.processed, DEFAULT_CONFIG, graph) : null), [r, graph]);
  const cov = useCoverage();
  return (
    <main className="screen"><div className="wrap stack">
      <h1>Zone și șocuri</h1>
      {!r || !rr ? <NoRides /> : (
        <>
          <div className="section-label">Probleme detectate automat (toate turele active)</div>
          <HazardList hazards={hazards} />
          {cov && <><div className="section-label">Acoperire</div><CoveragePanel c={cov} /></>}
          <div className="section-label">Analiza pe tură</div>
          {picker}
          <p className="small muted" style={{ margin: 0 }}>{rideSub(r)}</p>
          <div className="funnel">
            <div><b className="num">{rr.counts.raw}</b><span>evenimente brute</span></div>
            <div><b className="num">{rr.counts.handling}</b><span>manevrarea telefonului</span></div>
            <div><b className="num">{rr.counts.isolated}</b><span>slabe, izolate</span></div>
            <div><b className="num">{rr.counts.zones}</b><span>zone grupate</span></div>
            <div className="hl"><b className="num">{rr.counts.review}</b><span>de verificat</span></div>
          </div>
          <div className="list">
            <Item href={`#/review/${r.ride_id}`} icon={<ShieldCheck />} tone="warn" title="Zone de verificat" sub="prioritate, treceri, dovezi, confirmare / respingere" />
            <Item href={`#/ride/${r.ride_id}/events`} icon={<ListFilter />} title="Toate evenimentele brute" sub="filtre după clasă, încredere, grupare, timp" />
            <Item href={`#/after/${r.ride_id}`} icon={<Route />} title="Întrebările de după tură" sub="ce ar vedea ciclistul care a înregistrat (Da / Nu / Mai târziu)" />
          </div>
        </>
      )}
    </div></main>
  );
}
