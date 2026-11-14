// Analiza pe stradă (studiu de caz) pentru o tură locală: unde a vibrat mai tare, șocurile candidate cu ora lor
// (pentru potrivirea cu filmarea), incertitudinea GPS, limitele potrivirii pe străzi și intervalele declarate din filmare.
// Totul rămâne pe acest telefon.
import { Plus, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { DEFAULT_CONFIG } from '../../core/config';
import {
  compareByBand, distToEdges, fmtOffset, parallelInfra, parseOffset, relativeTercile, rideStart, shocksInInterval,
  streetsOfRide, usable, windowsInInterval, type BandComparison, type RideInterval,
} from '../../core/corridor';
import type { ProcessedRide, Shock } from '../../core/types';
import { shockKey, typeLabel } from '../../services/reports';
import { setRideIntervals, useApp } from '../../state/store';
import { fmt } from '../format';
import { Banner, Header } from '../kit';
import { drawReports, drawTrack } from '../map/draw';
import { L, useLayerGroup, useLeaflet } from '../map/useLeaflet';

const TERC = ['#7f93a8', '#e3a12f', '#d9480f'];
const SURF: Record<string, string> = { carosabil: 'carosabil', pista: 'pistă de biciclete', trotuar: 'trotuar', traversare: 'traversare / bordură', altul: 'altul' };

export function StreetPage({ id, name }: { id?: string; name?: string | null }) {
  const ride = useApp((s) => s.rides.find((r) => r.ride_id === id));
  const loaded = useApp((s) => s.ready);
  const graph = useApp((s) => s.graph);
  const reports = useApp((s) => s.reports);
  const reviews = useApp((s) => s.reviews);
  const cfg = DEFAULT_CONFIG;
  const p = ride?.processed;
  const streets = useMemo(() => (p && graph ? streetsOfRide(p, graph) : []), [p, graph]);
  const street = streets.find((s) => s.name === name) ?? streets[0] ?? null;
  const [selShock, setSelShock] = useState<Shock | null>(null);
  const [byPeak, setByPeak] = useState(true);
  const [all, setAll] = useState(false);
  const t0 = p ? rideStart(p) : 0;

  const data = useMemo(() => {
    if (!p || !graph || !street) return null;
    const set = new Set(street.edges);
    const on = p.windows.filter((w) => w.edge >= 0 && set.has(w.edge) && usable(w, cfg));
    const off = p.windows.filter((w) => !(w.edge >= 0 && set.has(w.edge)) && usable(w, cfg));
    const shocks = p.shocks.filter((s) => s.edge >= 0 && set.has(s.edge)).sort((a, b) => a.t - b.t);
    const terc = relativeTercile(p, cfg);
    const par = parallelInfra(graph, street.edges);
    const amb = p.windows.filter((w) => w.edge >= 0 && set.has(w.edge)).filter((w) => w.amb).length;
    const nearReports = reports.filter((r) => distToEdges(graph, street.edges, r.lat, r.lon) <= 25);
    return { on, off, shocks, terc, par, amb, nearReports, cmp: compareByBand(on, off, cfg), set };
  }, [p, graph, street, reports, cfg]);

  const { ref, map } = useLeaflet({ zoom: 17 });
  useLayerGroup(map, (g) => {
    if (!p || !graph || !street || !data) return;
    drawTrack(g, p.track, '#5a6677', true, 2);
    const bounds = L.latLngBounds([]);
    for (const e of street.edges) {
      const ll = graph.geometry(e);
      L.polyline(ll, { color: '#1857f5', weight: 14, opacity: 0.3, interactive: false }).addTo(g);
      ll.forEach((x) => bounds.extend(x));
    }
    for (const w of data.on) {
      const k = data.terc(w);
      if (k === null || w.lat === null || w.lon === null) continue;
      L.circleMarker([w.lat, w.lon], { radius: 4, color: TERC[k], fillColor: TERC[k], fillOpacity: 0.95, weight: 0, interactive: false }).addTo(g);
    }
    for (const s of data.shocks) {
      if (s.lat === null || s.lon === null) continue;
      if (s === selShock) L.circle([s.lat, s.lon], { radius: Math.max(4, s.r ?? 10), color: '#e8590c', weight: 1.5, fillOpacity: 0.08, dashArray: '3 4', interactive: false }).addTo(g);
      L.circleMarker([s.lat, s.lon], { radius: s === selShock ? 8 : 4.5, color: '#fff', weight: 1.5, fillColor: '#e8590c', fillOpacity: s === selShock || !s.needs_review ? 1 : 0.55 })
        .bindTooltip(`+${fmtOffset((s.t - t0) / 1000)} · vârf ${s.peak.toFixed(1)} m/s²`).on('click', () => setSelShock(s)).addTo(g);
    }
    drawReports(g, data.nearReports, null);
    if (bounds.isValid()) map!.fitBounds(bounds, { padding: [24, 24], maxZoom: 18, animate: false });
  }, [p, graph, street, data, selShock]);

  if (!ride || !p) return <main className="screen"><div className="wrap"><Header title="Analiză pe stradă" back="#/rides" /><p>{loaded ? 'Tura nu există pe acest telefon.' : 'Se încarcă…'}</p></div></main>;
  if (!graph) return <main className="screen"><div className="wrap"><Header title="Analiză pe stradă" back={`#/ride/${ride.ride_id}`} /><p>Se încarcă străzile…</p></div></main>;
  const intervals = ride.intervals ?? [];

  return (
    <main className="screen"><div className="wrap stack">
      <Header title="Analiză pe stradă" back={`#/ride/${ride.ride_id}`} />
      {!streets.length ? <p className="small">Tura nu are ferestre potrivite pe străzi cu nume.</p> : (
        <>
          <label className="field"><span>Strada (nume OSM)</span>
            <select value={street?.name ?? ''} onChange={(e) => { location.hash = `#/ride/${ride.ride_id}/street?name=${encodeURIComponent(e.target.value)}`; setSelShock(null); }}>
              {streets.map((s) => <option key={s.name} value={s.name}>{s.name} · {s.windows} s</option>)}
            </select>
          </label>
          <Banner kind="warn"><span><b>Explorare, nu clase de confort.</b> Comparăm vibrațiile doar în aceeași bandă de viteză și doar în această tură. Punctele colorate arată treimea (jos / mediu / sus) în banda lor de viteză, nu o notă a străzii. Datele rămân pe acest telefon.</span></Banner>
          <div ref={ref} className="map inline tall" role="img" aria-label={`Harta străzii ${street?.name ?? ''}: traseul turei, vibrațiile relative și șocurile candidate`} />
          <div className="xs" style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 12px' }}>
            {['jos', 'mediu', 'sus'].map((l, i) => <span key={l}><i style={{ display: 'inline-block', width: 9, height: 9, borderRadius: 5, background: TERC[i], marginRight: 4 }} />vibrație {l} (în banda de viteză)</span>)}
            <span><i style={{ display: 'inline-block', width: 9, height: 9, borderRadius: 5, background: '#e8590c', marginRight: 4 }} />șoc candidat (atinge unul pentru ±GPS)</span>
            <span><i style={{ display: 'inline-block', width: 9, height: 9, borderRadius: 5, background: '#c2261b', marginRight: 4 }} />observație manuală</span>
          </div>
          {data && <MatchingNote kinds={data.par.kinds} amb={data.amb} total={data.on.length} />}
          {data && (
            <div className="card">
              <h3 style={{ marginTop: 0 }}>{street!.name} față de restul turei</h3>
              <CompareTable rows={data.cmp} a="strada" b="restul turei" />
            </div>
          )}
          {data && (
            <div className="card">
              <h3 style={{ marginTop: 0 }}>Șocuri candidate pe stradă ({data.shocks.length})</h3>
              <p className="xs muted" style={{ marginTop: 0 }}>Ora = ceasul telefonului; +mm:ss = de la începutul turei ({new Date(t0).toLocaleTimeString('ro-RO')}). Pentru filmare: notați diferența dintre ceasul camerei și al telefonului (filmați ecranul telefonului la început). Un șoc nu e automat o groapă; sub 2,5 m/s poate fi și o mișcare a telefonului.</p>
              {data.shocks.length === 0 ? <p className="small">Niciun șoc candidat pe această stradă.</p> : (
                <div className="stack" style={{ gap: 6 }}>
                  <div className="seg" role="group" aria-label="Ordinea șocurilor">
                    <button aria-pressed={byPeak} onClick={() => setByPeak(true)}>Cele mai puternice</button>
                    <button aria-pressed={!byPeak} onClick={() => setByPeak(false)}>După oră</button>
                  </div>
                  {(byPeak ? [...data.shocks].sort((a, b) => b.peak - a.peak) : data.shocks).slice(0, all ? undefined : 8).map((s) => {
                    const rv = reviews[shockKey(ride.ride_id, s.id)];
                    return (
                      <button key={s.id} className="card flat" style={{ textAlign: 'left', padding: 10, borderColor: s === selShock ? 'var(--primary)' : undefined }} onClick={() => { setSelShock(s); if (map && s.lat !== null) map.setView([s.lat, s.lon!], 19); }}>
                        <div className="row nowrap" style={{ justifyContent: 'space-between' }}>
                          <b>+{fmtOffset((s.t - t0) / 1000)} · {new Date(s.t).toLocaleTimeString('ro-RO')}</b>
                          <span className={`badge ${rv?.answer === 'yes' ? 'danger' : rv?.answer === 'no' ? '' : 'warn'}`}>{rv?.answer === 'yes' ? `confirmat${rv.type ? ': ' + typeLabel(rv.type) : ''}` : rv?.answer === 'no' ? 'respins' : rv?.answer === 'unsure' ? 'nesigur' : 'neverificat'}</span>
                        </div>
                        <div className="small">vârf {fmt(s.peak, 1, 'm/s²')} · viteză {fmt(s.speed, 1, 'm/s')} · ±{Math.round(s.r ?? 10)} m{s.double_hit ? ' · roată față + spate (ipoteză)' : ''}{s.flags.length ? ` · ${s.flags.map((f) => FLAG[f] ?? f).join(', ')}` : ''}</div>
                      </button>
                    );
                  })}
                  {data.shocks.length > 8 && <button className="btn ghost block sm" onClick={() => setAll(!all)}>{all ? 'Arată mai puține' : `Arată toate (${data.shocks.length})`}</button>}
                  <a className="btn block" href={`#/review/${ride.ride_id}${selShock ? `?shock=${encodeURIComponent(selShock.id)}` : ''}`}>{selShock ? 'Verifică șocul selectat (confirmă / respinge / tip)' : 'Verifică șocurile'}</a>
                </div>
              )}
            </div>
          )}
          {data && data.nearReports.length > 0 && (
            <div className="card">
              <h3 style={{ marginTop: 0 }}>Observații manuale ({data.nearReports.length})</h3>
              <p className="xs muted" style={{ marginTop: 0 }}>Rapoarte de pe acest telefon la ≤ 25 m de stradă. O observație umană nu e o măsurătoare a senzorilor.</p>
              {data.nearReports.map((r) => <a key={r.id} className="small" style={{ display: 'block' }} href={`#/report/${r.id}`}>{typeLabel(r.type)} · {new Date(r.created_at).toLocaleString('ro-RO', { dateStyle: 'short', timeStyle: 'short' })}{r.description ? ` · ${r.description}` : ''}</a>)}
            </div>
          )}
        </>
      )}
      <Intervals rideId={ride.ride_id} intervals={intervals} p={p} />
    </div></main>
  );
}

const FLAG: Record<string, string> = { speed_band: 'viteză în afara benzii', speed_unknown: 'viteză necunoscută', gyro: 'telefon rotit', mount_shift: 'suport mișcat', gap: 'gol în date' };

function MatchingNote({ kinds, amb, total }: { kinds: string[]; amb: number; total: number }) {
  if (!kinds.length) return <Banner kind="info"><span><b>Latura nu se poate stabili din GPS.</b> În OpenStreetMap, pe această stradă nu există trotuare sau piste desenate separat, deci toate vibrațiile sunt puse pe axa străzii. Cu precizia GPS de ~±9 m nu putem spune pe ce trotuar sau pe carosabil a fost bicicleta. Pentru o comparație între laturi, declarați intervalele din filmare (mai jos).</span></Banner>;
  return <Banner kind="info"><span><b>Căi paralele în OSM:</b> {kinds.join(', ')} la ≤ 15 m. {amb} din {total} ferestre sunt ambigue (o cale paralelă de alt tip e la fel de aproape): nu le atribuim sigur unei laturi.</span></Banner>;
}

function CompareTable({ rows, a, b }: { rows: BandComparison[]; a: string; b: string }) {
  const shown = rows.filter((r) => r.a.n > 0 || r.b.n > 0);
  if (!shown.length) return <p className="small">Nicio fereastră utilizabilă.</p>;
  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="small" style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr style={{ textAlign: 'left' }}><th>viteză</th><th>{a}<br /><span className="xs muted">n · mediană</span></th><th>{b}<br /><span className="xs muted">n · mediană</span></th><th>raport</th></tr></thead>
        <tbody>
          {shown.map((r) => (
            <tr key={r.band} style={{ borderTop: '1px solid var(--border)' }}>
              <td>{r.label}</td>
              <td>{r.a.n} · {fmt(r.a.p50, 2)}</td>
              <td>{r.b.n} · {fmt(r.b.p50, 2)}</td>
              <td>{r.verdict === 'insufficient' ? <span className="muted">prea puține (min. 20)</span> : <>×{fmt(r.ratio, 2)} <span className="xs muted">(IÎ 90% {fmt(r.ci?.[0], 2)}–{fmt(r.ci?.[1], 2)})</span><br /><b>{r.verdict === 'higher' ? `${a}: mai mare` : r.verdict === 'lower' ? `${a}: mai mică` : 'nedeterminat'}</b></>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="xs muted">Mediana RMS a vibrației verticale (m/s²) pe ferestre de 2 s. Intervalul de încredere vine din reeșantionarea blocurilor de 10 s (ferestrele vecine sunt corelate). „Mai mare” = diferență consistentă în această tură, nu o dovadă generală; pe viteze sub 2,5 m/s nu există clase de confort.</p>
    </div>
  );
}

function Intervals({ rideId, intervals, p }: { rideId: string; intervals: RideInterval[]; p: ProcessedRide }) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [label, setLabel] = useState('');
  const [surface, setSurface] = useState<RideInterval['surface']>('trotuar');
  const [ia, setIa] = useState(0);
  const [ib, setIb] = useState(1);
  const dur = p.summary.duration_s;
  const t0 = parseOffset(from), t1 = parseOffset(to);
  const err = from || to ? (t0 === null || t1 === null ? 'Format: mm:ss (ex. 6:55)' : t1 <= t0 ? 'Sfârșitul trebuie să fie după început' : t1 > dur + 5 ? `Tura durează ${fmtOffset(dur)}` : null) : null;
  const add = () => {
    if (t0 === null || t1 === null || err) return;
    void setRideIntervals(rideId, [...intervals, { id: `iv${Date.now().toString(36)}`, t0_s: t0, t1_s: t1, label: label.trim() || `${SURF[surface ?? 'altul']} ${fmtOffset(t0)}–${fmtOffset(t1)}`, surface }]);
    setFrom(''); setTo(''); setLabel('');
  };
  const A = intervals[ia], B = intervals[ib];
  const cmp = A && B && A !== B ? compareByBand(windowsInInterval(p, A).filter((w) => usable(w)), windowsInInterval(p, B).filter((w) => usable(w))) : null;
  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>Intervale din filmare</h3>
      <p className="xs muted" style={{ marginTop: 0 }}>Declarați din filmare pe ce suprafață și pe ce latură ați fost (ex. „trotuar nord 5:19–11:40”). Doar așa se pot compara două laturi ale aceleiași străzi: GPS-ul nu le deosebește. Intervalele rămân pe acest telefon.</p>
      {intervals.map((iv) => {
        const ws = windowsInInterval(p, iv).filter((w) => usable(w));
        const sh = shocksInInterval(p, iv);
        return (
          <div key={iv.id} className="row nowrap" style={{ justifyContent: 'space-between', borderTop: '1px solid var(--border)', padding: '6px 0' }}>
            <div className="small"><b>{iv.label}</b><div className="xs muted">{fmtOffset(iv.t0_s)}–{fmtOffset(iv.t1_s)} · {SURF[iv.surface ?? 'altul']} · {ws.length} ferestre utilizabile · {sh.length} șocuri</div></div>
            <button className="icon-btn sm" aria-label={`Șterge intervalul ${iv.label}`} onClick={() => void setRideIntervals(rideId, intervals.filter((x) => x.id !== iv.id))}><Trash2 /></button>
          </div>
        );
      })}
      <div className="grid2" style={{ marginTop: 8 }}>
        <label className="field"><span>De la (mm:ss)</span><input className="input" inputMode="numeric" placeholder="5:19" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="field"><span>Până la (mm:ss)</span><input className="input" inputMode="numeric" placeholder="11:40" value={to} onChange={(e) => setTo(e.target.value)} /></label>
      </div>
      <div className="grid2">
        <label className="field"><span>Suprafață</span>
          <select value={surface} onChange={(e) => setSurface(e.target.value as RideInterval['surface'])}>{Object.entries(SURF).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        </label>
        <label className="field"><span>Etichetă</span><input className="input" placeholder="trotuar latura nord" value={label} onChange={(e) => setLabel(e.target.value)} /></label>
      </div>
      {err && <p className="small" style={{ color: 'var(--danger)' }}>{err}</p>}
      <button className="btn block" disabled={t0 === null || t1 === null || !!err} onClick={add}><Plus /> Adaugă intervalul</button>
      {intervals.length >= 2 && (
        <div style={{ marginTop: 12 }}>
          <div className="grid2">
            <label className="field"><span>A</span><select value={ia} onChange={(e) => setIa(Number(e.target.value))}>{intervals.map((iv, i) => <option key={iv.id} value={i}>{iv.label}</option>)}</select></label>
            <label className="field"><span>B</span><select value={ib} onChange={(e) => setIb(Number(e.target.value))}>{intervals.map((iv, i) => <option key={iv.id} value={i}>{iv.label}</option>)}</select></label>
          </div>
          {cmp ? <CompareTable rows={cmp} a="A" b="B" /> : <p className="small muted">Alegeți două intervale diferite.</p>}
        </div>
      )}
    </div>
  );
}
