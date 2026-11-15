// Panoul principal al ShockGrid Dev: starea datelor, copierea turelor existente, pașii demo-ului pentru juriu.
import { ArrowRight, Copy, Database, ShieldAlert } from 'lucide-react';
import { useMemo, useState } from 'react';
import { snapshotRideCount } from '../core/aggregate';
import { DEFAULT_CONFIG } from '../core/config';
import { streetsOfRide } from '../core/corridor';
import { rideRoughness } from '../core/roughness';
import { getRide, putRide } from '../storage/idb';
import { copyRides, readRidesFrom } from '../storage/migrate';
import { useApp } from '../state/store';
import { fmtLen } from '../ui/format';
import { Banner, toast } from '../ui/kit';

const PIPELINE = ['Senzori 100 Hz + GPS', 'Ferestre 2 s · RVI', 'Potrivire pe străzi', 'Triaj șocuri', 'Zone', 'Agregare pe segmente', 'Audit confidențialitate', 'Strat public (cu aprobare)'];

export function Dashboard() {
  const rides = useApp((s) => s.rides);
  const graph = useApp((s) => s.graph);
  const snapshot = useApp((s) => s.snapshot);
  const layer = useApp((s) => s.layer);
  const [found, setFound] = useState<number | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const latest = useMemo(() => [...rides].sort((a, b) => b.processed.meta.start_ms - a.processed.meta.start_ms)[0], [rides]);
  const stats = useMemo(() => {
    let valid = 0, events = 0, zones = 0, review = 0;
    for (const r of rides) {
      valid += r.processed.windows.filter((w) => w.valid).length;
      const rr = rideRoughness(r.processed, DEFAULT_CONFIG);
      events += rr.counts.raw; zones += rr.counts.zones; review += rr.counts.review;
    }
    return { valid, events, zones, review };
  }, [rides]);
  const vidu = useMemo(() => (latest && graph ? streetsOfRide(latest.processed, graph).find((s) => /vidu/i.test(s.name))?.name ?? null : null), [latest, graph]);
  const measured = [...layer.edges.values()].filter((e) => e.status !== 'UNKNOWN').length;
  const pub = snapshotRideCount(snapshot);

  const check = async () => {
    try { const r = await readRidesFrom(); setFound(r ? r.length : null); } catch (e) { toast((e as Error).message); }
  };
  const copy = async () => {
    setBusy(true);
    try {
      const res = await copyRides(await readRidesFrom(), async (id) => !!(await getRide(id)), putRide);
      if (res.missing) toast('Pe acest browser nu există date ale aplicației ShockGrid.');
      else { toast(`${res.copied} ${res.copied === 1 ? 'tură copiată' : 'ture copiate'}${res.skipped ? `, ${res.skipped} existau deja` : ''}. Se reîncarcă…`); setTimeout(() => location.reload(), 900); }
    } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <main className="screen"><div className="wrap stack">
      <h1>Panou</h1>
      <Banner kind="warn"><b>Site public, fără autentificare.</b> Nu conține date private: turele se analizează doar în acest browser, după ce le importi. Ascunderea paginilor nu ar fi securitate, deci nu o simulăm.</Banner>
      <div className="dev-stats">
        <div className="card"><div className="small muted">Ture locale</div><div className="big num">{rides.length}</div><div className="xs muted">doar în acest browser</div></div>
        <div className="card"><div className="small muted">Ferestre RVI valide</div><div className="big num">{stats.valid}</div><div className="xs muted">2 s, la 9–32 km/h cu GPS</div></div>
        <div className="card"><div className="small muted">Evenimente → zone</div><div className="big num">{stats.events} → {stats.zones}</div><div className="xs muted">{stats.review} de verificat</div></div>
        <div className="card"><div className="small muted">Strat public</div><div className="big num">{pub || '—'}</div><div className="xs muted">{pub ? `ture publicate · ${snapshot!.meta.generated_at.slice(0, 10)}` : 'nimic publicat (aprobare în așteptare)'}</div></div>
      </div>
      <div className="card">
        <h3>Lanțul de procesare</h3>
        <ol className="pipeline">{PIPELINE.map((p) => <li key={p}>{p}</li>)}</ol>
        <p className="xs muted" style={{ margin: '8px 0 0' }}>Același cod (<code>src/core</code>) rulează în aplicația pentru bicicliști, aici și în scripturile echipei. {measured} segmente cu date în stratul curent{graph?.json.meta.stats ? ` · graf OSM ${graph.json.meta.stats.edges} muchii` : ''}.</p>
      </div>
      <div className="card stack">
        <h3><Database style={{ verticalAlign: '-4px' }} /> Ture din aplicația ShockGrid, pe acest browser</h3>
        <p className="small" style={{ margin: 0 }}>Cele două site-uri au baze de date separate (<code>shockgrid</code> și <code>shockgrid-dev</code>). Dacă ai importat sau înregistrat ture în aplicația pentru bicicliști pe acest browser, le poți copia aici. Baza aplicației se citește doar, nu se modifică.</p>
        <div className="row">
          <button className="btn sm" onClick={() => void check()}>Verifică</button>
          {found !== undefined && <span className="small">{found === null ? 'Aplicația ShockGrid nu are date pe acest browser.' : `${found} ${found === 1 ? 'tură găsită' : 'ture găsite'}.`}</span>}
          {!!found && <button className="btn sm primary" disabled={busy} onClick={() => void copy()}><Copy /> Copiază în Dev</button>}
        </div>
        <p className="xs muted" style={{ margin: 0 }}>Altfel: <a href="#/import">importă ZIP-ul din Sensor Logger</a>. Răspunsurile la zone nu se copiază.</p>
      </div>
      <div className="card">
        <h3>Demo pentru juriu: „cum funcționează în spate”</h3>
        <ol className="demo-steps">
          <li><a href="#/import">Importă înregistrarea din telefon</a> (ZIP Sensor Logger: accelerometru, giroscop, GPS)</li>
          <li>{latest ? <a href={`#/ride/${latest.ride_id}`}>Tura: calitatea datelor, frecvența, viteze, traseul GPS</a> : 'Tura: calitatea datelor, frecvența, viteze, traseul GPS'}</li>
          <li>{latest ? <a href={`#/ride/${latest.ride_id}/replay`}>Accelerația și giroscopul, cu ferestrele RVI</a> : 'Accelerația și giroscopul, cu ferestrele RVI'}</li>
          <li>{latest ? <a href={`#/review/${latest.ride_id}`}>Șocuri detectate → zone grupate → prioritate</a> : 'Șocuri detectate → zone grupate → prioritate'}</li>
          <li>{latest && vidu ? <a href={`#/ride/${latest.ride_id}/street?name=${encodeURIComponent(vidu)}`}>Studiu de caz: {vidu}</a> : 'Studiu de caz: Strada Ion Vidu (după import)'}</li>
          <li><a href="#/map">Harta tehnică: tronsoane, încredere, explorare lentă</a></li>
          <li><a href="#/publish">Stratul public: generare + audit de confidențialitate</a></li>
          <li><a href="/ShockGrid/" target="_blank" rel="noopener">Aplicația pentru bicicliști <ArrowRight style={{ width: 14, height: 14, verticalAlign: '-2px' }} /></a>: ce vede ciclistul după publicare</li>
        </ol>
      </div>
      {latest && <p className="xs muted">Ultima tură: {new Date(latest.processed.meta.start_ms).toLocaleDateString('ro-RO')} · {fmtLen(latest.processed.summary.distance_m)} · {latest.processed.processing_version}</p>}
      <p className="xs muted"><ShieldAlert style={{ width: 14, height: 14, verticalAlign: '-2px' }} /> Datele brute (ZIP, trasee, ore) nu se publică niciodată. Stratul public se construiește doar din agregate auditate și doar cu aprobare.</p>
    </div></main>
  );
}
