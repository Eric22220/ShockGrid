// Panoul ShockGrid Dev: lanțul de procesare cu cifrele reale ale turelor din acest browser, apoi acțiunile.
// Cifrele apar doar când există ture încărcate (nu sunt valori demo).
import { ArrowRight, Copy, Smartphone, Upload } from 'lucide-react';
import { useMemo, useState } from 'react';
import { snapshotRideCount } from '../core/aggregate';
import { DEFAULT_CONFIG } from '../core/config';
import { streetsOfRide } from '../core/corridor';
import { rideRoughness } from '../core/roughness';
import { getRide, listReports, putReport, putRide } from '../storage/idb';
import { copyMissing, readReportsFrom, readRidesFrom } from '../storage/migrate';
import { useApp } from '../state/store';
import { fmtLen } from '../ui/format';
import { toast } from '../ui/kit';

export function Dashboard() {
  const rides = useApp((s) => s.rides);
  const graph = useApp((s) => s.graph);
  const snapshot = useApp((s) => s.snapshot);
  const layer = useApp((s) => s.layer);
  const [found, setFound] = useState<{ rides: number; reports: number } | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const latest = useMemo(() => [...rides].sort((a, b) => b.processed.meta.start_ms - a.processed.meta.start_ms)[0], [rides]);
  const st = useMemo(() => {
    let samples = 0, fixes = 0, windows = 0, valid = 0, matched = 0, events = 0, zones = 0, review = 0, hz = 0;
    for (const r of rides) {
      const p = r.processed;
      samples += p.summary.n_motion; fixes += p.summary.n_fix; hz = Math.max(hz, p.summary.fs_median ?? 0);
      windows += p.windows.length; valid += p.windows.filter((w) => w.valid).length; matched += p.windows.filter((w) => w.edge >= 0).length;
      const rr = rideRoughness(p, DEFAULT_CONFIG);
      events += rr.counts.raw; zones += rr.counts.zones; review += rr.counts.review;
    }
    return { samples, fixes, windows, valid, matched, events, zones, review, hz };
  }, [rides]);
  const edges = useMemo(() => [...layer.edges.values()].filter((e) => e.status !== 'UNKNOWN' || e.explore), [layer]);
  const km = useMemo(() => (graph ? edges.reduce((a, e) => a + graph.length[e.edge_id], 0) / 1000 : 0), [graph, edges]);
  const vidu = useMemo(() => (latest && graph ? streetsOfRide(latest.processed, graph).find((s) => /vidu/i.test(s.name))?.name ?? null : null), [latest, graph]);
  const pub = snapshotRideCount(snapshot);
  const has = rides.length > 0;
  const n = (v: number) => (has ? v.toLocaleString('ro-RO') : '—');
  const id = latest?.ride_id;

  const steps: { t: string; v: string; s: string; href: string }[] = [
    { t: 'Smartphone', v: n(rides.length), s: has ? 'ture în acest browser' : 'importă o tură', href: '#/rides' },
    { t: 'Senzori brute', v: n(st.samples), s: has ? `mostre · ${Math.round(st.hz)} Hz · ${n(st.fixes)} GPS` : 'accelerometru, giroscop, GPS', href: id ? `#/ride/${id}/replay` : '#/rides' },
    { t: 'RVI', v: n(st.valid), s: has ? `ferestre valide din ${n(st.windows)}` : 'ferestre de 2 s, 9–32 km/h', href: id ? `#/ride/${id}` : '#/analysis' },
    { t: 'Potrivire GPS', v: has && st.windows ? `${Math.round((100 * st.matched) / st.windows)}%` : '—', s: 'ferestre pe străzi OSM', href: '#/map' },
    { t: 'Segmente', v: has ? `${edges.length}` : '—', s: has ? `muchii · ${km.toLocaleString('ro-RO', { maximumFractionDigits: 2 })} km cu date` : 'tronsoane pe stradă', href: '#/map' },
    { t: 'Verificare', v: has ? `${st.events} → ${st.zones}` : '—', s: has ? `evenimente → zone · ${st.review} de verificat` : 'șocuri, zone, prioritate', href: '#/zones' },
    { t: 'Strat public', v: pub ? `${pub}` : '0', s: pub ? 'ture publicate' : 'nimic publicat (aprobare)', href: '#/publish' },
  ];

  const check = async () => {
    try {
      const [r, p] = await Promise.all([readRidesFrom(), readReportsFrom()]);
      setFound(r === null ? null : { rides: r.length, reports: p?.length ?? 0 });
    } catch (e) { toast((e as Error).message); }
  };
  const copy = async () => {
    setBusy(true);
    try {
      const a = await copyMissing(await readRidesFrom(), (r) => r.ride_id, async (x) => !!(await getRide(x)), putRide);
      const mine = new Set((await listReports()).map((r) => r.id));
      const b = await copyMissing(await readReportsFrom(), (r) => r.id, async (x) => mine.has(x), putReport);
      if (a.missing) toast('Pe acest browser nu există date ale aplicației ShockGrid.');
      else { toast(`${a.copied} ture și ${b.copied} rapoarte copiate${a.skipped + b.skipped ? ` (${a.skipped + b.skipped} existau)` : ''}. Se reîncarcă…`); setTimeout(() => location.reload(), 900); }
    } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <main className="screen"><div className="wrap stack">
      <div className="row spread">
        <h1 style={{ margin: 0 }}>Panou</h1>
        <span className="badge">public · fără autentificare · date doar în acest browser</span>
      </div>
      <ol className="chain" aria-label="Lanțul de procesare">
        {steps.map((x, i) => (
          <li key={x.t}>
            <a href={x.href}>
              <span className="chain-n">{i + 1}</span>
              <span className="chain-t">{i === 0 && <Smartphone aria-hidden="true" />}{x.t}</span>
              <b className="num">{x.v}</b>
              <span className="chain-s">{x.s}</span>
            </a>
          </li>
        ))}
      </ol>
      {!has ? (
        <div className="grid2">
          <a className="card tint-comfort" href="#/import" style={{ textDecoration: 'none', color: 'inherit' }}><Upload style={{ color: 'var(--comfort)' }} /><h3 style={{ margin: '8px 0 0' }}>Importă ZIP</h3><p className="xs muted" style={{ margin: 0 }}>Sensor Logger: accelerometru, giroscop, GPS</p></a>
          <button className="card" style={{ textAlign: 'left', cursor: 'pointer', font: 'inherit' }} onClick={() => void check()}><Copy style={{ color: 'var(--primary)' }} /><h3 style={{ margin: '8px 0 0' }}>Din aplicația ShockGrid</h3><p className="xs muted" style={{ margin: 0 }}>turele de pe acest browser (doar citire)</p></button>
        </div>
      ) : (
        <div className="card">
          <h3>Demo: cum funcționează</h3>
          <ol className="demo-steps">
            <li><a href={`#/ride/${id}/replay`}>Accelerometrul și giroscopul înregistrate pe bicicletă</a></li>
            <li><a href={`#/ride/${id}`}>Calitatea datelor și RVI pe ferestre de 2 s</a></li>
            <li><a href={`#/map/${id}`}>Traseul GPS potrivit pe străzi, pe tronsoane</a></li>
            <li><a href={`#/review/${id}`}>Șocuri posibile → zone grupate → de verificat</a></li>
            {vidu && <li><a href={`#/ride/${id}/street?name=${encodeURIComponent(vidu)}`}>Studiu pe stradă: {vidu}</a></li>}
            <li><a href="#/publish">Stratul public: generare și audit de confidențialitate</a></li>
            <li><a href="/ShockGrid/" target="_blank" rel="noopener">Ce vede ciclistul <ArrowRight style={{ width: 14, height: 14, verticalAlign: '-2px' }} /></a></li>
          </ol>
        </div>
      )}
      <details className="card">
        <summary>Date din aplicația ShockGrid pe acest browser</summary>
        <p className="small">Cele două site-uri au baze separate (<code>shockgrid</code> și <code>shockgrid-dev</code>). Baza aplicației se citește doar; nu se modifică și nu se creează.</p>
        <div className="row">
          <button className="btn sm" onClick={() => void check()}>Verifică</button>
          {found !== undefined && <span className="small">{found === null ? 'Aplicația ShockGrid nu are date pe acest browser.' : `${found.rides} ture, ${found.reports} rapoarte găsite.`}</span>}
          {found && (found.rides > 0 || found.reports > 0) && <button className="btn sm primary" disabled={busy} onClick={() => void copy()}><Copy /> Copiază în Dev</button>}
        </div>
      </details>
      <details className="card">
        <summary>Despre acest site</summary>
        <p className="small">Platforma tehnică ShockGrid, publică și fără autentificare (o parolă doar în pagină n-ar fi securitate). Nu conține date private: turele se analizează doar în acest browser, după import. Datele brute (ZIP, trasee, ore) nu se publică; stratul public se construiește din agregate auditate și doar cu aprobare. Același cod (<code>src/core</code>) rulează în aplicația pentru bicicliști, aici și în scripturile echipei.</p>
      </details>
      {latest && <p className="xs muted">Ultima tură: {new Date(latest.processed.meta.start_ms).toLocaleDateString('ro-RO')} · {fmtLen(latest.processed.summary.distance_m)} · {latest.processed.processing_version}</p>}
    </div></main>
  );
}
