import { Flag, Layers, LocateFixed, Locate, LocateOff, Search } from 'lucide-react';
import { useMemo, useState, useSyncExternalStore } from 'react';
import { CLASSES, snapshotRideCount, type EdgeAgg, type ShockZone } from '../../core/aggregate';
import { t } from '../../i18n/ro';
import { rideActive, subscribeRide } from '../../services/ride';
import { typeLabel, VISIBILITY_LABEL } from '../../services/reports';
import type { LocalReport } from '../../storage/idb';
import { rejectZone, updateSettings, useApp } from '../../state/store';
import { UPlot } from '../charts/UPlot';
import { CLASS_COLORS, fmt, fmtLen } from '../format';
import { Banner, ClassBadge, Sheet } from '../kit';
import { drawComfort, drawReports, drawTrack, drawZones, EXPLORE_COLOR } from '../map/draw';
import { distToEdges } from '../../core/corridor';
import { useLocation, useMeLayer } from '../map/me';
import { useLayerGroup, useLeaflet } from '../map/useLeaflet';
import { go } from '../App';

type Sel = { edge?: EdgeAgg; zone?: ShockZone; report?: LocalReport; layers?: true } | null;

// dacă utilizatorul a pornit „Locația mea”, rămâne pornită când revine pe hartă (în aceeași sesiune)
let rememberLoc = false;

export function MapScreen({ focus }: { focus?: string }) {
  const graph = useApp((s) => s.graph);
  const graphStatus = useApp((s) => s.graphStatus);
  const layer = useApp((s) => s.layer);
  const rides = useApp((s) => s.rides);
  const reports = useApp((s) => s.reports);
  const settings = useApp((s) => s.settings);
  const snapshot = useApp((s) => s.snapshot);
  const recording = useSyncExternalStore(subscribeRide, rideActive);
  const [sel, setSel] = useState<Sel>(null);
  const [locOn, setLocOnState] = useState(rememberLoc);
  const setLocOn = (v: boolean) => { rememberLoc = v; setLocOnState(v); };
  const [follow, setFollow] = useState(false);
  const [showTracks, setShowTracks] = useState(!!focus);
  const loc = useLocation(locOn);
  const { ref, map } = useLeaflet({ onClick: () => setSel(null), onDrag: () => setFollow(false) });
  useMeLayer(map, loc, follow);

  useLayerGroup(map, (g) => { if (graph) drawComfort(g, graph, layer, (e) => setSel({ edge: e })); }, [graph, layer]);
  useLayerGroup(map, (g) => { if (settings.showZones) drawZones(g, layer.zones, settings.showReview, (z) => setSel({ zone: z })); }, [layer, settings.showZones, settings.showReview]);
  useLayerGroup(map, (g) => { drawReports(g, reports, (r) => setSel({ report: r })); }, [reports]);
  useLayerGroup(map, (g) => {
    const focused = focus ? rides.find((r) => r.ride_id === focus) : undefined;
    for (const r of rides) {
      if (!showTracks && r !== focused) continue;
      const pl = drawTrack(g, r.processed.track, r === focused ? '#1857f5' : '#5a6677', r !== focused, r === focused ? 5 : 3);
      if (pl && r === focused && pl.getBounds().isValid()) map!.fitBounds(pl.getBounds(), { padding: [40, 40], maxZoom: 17 });
    }
  }, [rides, showTracks, focus]);

  const measured = useMemo(() => [...layer.edges.values()].filter((e) => e.status !== 'UNKNOWN').length, [layer]);
  const lastLocal = rides.reduce((m, r) => Math.max(m, r.processed.meta.start_ms), 0);

  const onLocate = () => {
    if (!locOn) { setLocOn(true); setFollow(true); return; }
    if (follow) { setFollow(false); return; } // a doua apăsare oprește urmărirea; poziția rămâne afișată
    if (loc.fix && map) map.setView([loc.fix.lat, loc.fix.lon], Math.max(map.getZoom(), 16));
    setFollow(true);
  };
  const LocIcon = !locOn ? Locate : loc.status === 'denied' || loc.status === 'unsupported' || loc.status === 'insecure' ? LocateOff : LocateFixed;

  return (
    <main className="screen-map" aria-label="Harta confortului">
      <div ref={ref} className="map" />
      <div className="map-top">
        <button className="search-pill" onClick={() => go('/route?focus=dest')} aria-label="Caută o destinație și planifică traseul">
          <Search aria-hidden="true" /><span>Unde mergi?</span>
        </button>
        <button className="icon-btn" onClick={() => setSel({ layers: true })} aria-label="Straturi și legendă"><Layers /></button>
      </div>
      <div className="map-side">
        <button className={`icon-btn ${follow && loc.fix ? 'following' : locOn ? 'active' : ''}`} onClick={onLocate} aria-label={!locOn ? 'Arată locația mea' : follow ? 'Oprește urmărirea poziției' : 'Centrează pe locația mea și urmărește'} aria-pressed={follow}>
          <LocIcon />
        </button>
      </div>
      <div className="map-chip">
        {recording ? (
          <a className="chip live" href="#/record"><span className="rec-dot" aria-hidden="true" /> Tură în curs</a>
        ) : locOn && loc.message ? (
          <span className="chip" role="status">{loc.message}</span>
        ) : graphStatus === 'loading' ? (
          <span className="chip" role="status">Se încarcă străzile…</span>
        ) : graphStatus === 'ready' && measured === 0 && !sel ? (
          <button className="chip" onClick={() => setSel({ layers: true })}>Încă nu sunt străzi măsurate</button>
        ) : null}
      </div>
      {!sel && (
        <button className="fab" onClick={() => go(loc.fix ? `/report/new?lat=${loc.fix.lat}&lon=${loc.fix.lon}` : '/report/new')} aria-label="Raportează o problemă a drumului">
          <Flag aria-hidden="true" /> Raportează
        </button>
      )}

      {sel?.layers && (
        <Sheet title="Harta confortului" onClose={() => setSel(null)}>
          <div className="stack">
            <div>
              {CLASSES.map((c) => (
                <div key={c} className="legend-row"><span className="legend-line" style={{ background: CLASS_COLORS[c] }} /><b style={{ width: 18 }}>{c}</b><span>{t.classShort[c]}</span></div>
              ))}
              <div className="legend-row"><span className="legend-line" style={{ background: 'repeating-linear-gradient(90deg,#5a6677 0 6px,transparent 6px 11px)' }} /><span>Linie întreruptă: puține măsurători</span></div>
              <div className="legend-row"><span className="legend-line" style={{ background: `repeating-linear-gradient(90deg,${EXPLORE_COLOR} 0 3px,transparent 3px 8px)` }} /><span>Punctat violet: parcurs doar lent (explorare, fără clasă)</span></div>
              <div className="legend-row"><span className="legend-line" style={{ background: 'var(--surface-3)' }} /><span>Fără culoare: încă nemăsurat (nu înseamnă neted)</span></div>
              <div className="legend-row"><span className="legend-line" style={{ background: '#e8590c', height: 12, width: 12, borderRadius: 6, marginLeft: 9, marginRight: 9 }} /><span>Posibilă denivelare detectată</span></div>
              <div className="legend-row"><span className="legend-line" style={{ background: '#c2261b', height: 14, width: 14, borderRadius: 4, marginLeft: 8, marginRight: 8 }} /><span>Rapoartele tale (doar pe acest telefon)</span></div>
            </div>
            <div className="field"><span>Hartă de fundal</span>
              <div className="seg" role="group" aria-label="Stilul hărții de fundal">
                {([['auto', 'Automat'], ['light', 'Luminoasă'], ['dark', 'Întunecată']] as const).map(([k, l]) => <button key={k} aria-pressed={settings.mapStyle === k} onClick={() => updateSettings({ mapStyle: k })}>{l}</button>)}
              </div>
            </div>
            <label className="switch"><input type="checkbox" checked={settings.showZones} onChange={(e) => updateSettings({ showZones: e.target.checked })} />Posibile denivelări</label>
            <label className="switch"><input type="checkbox" checked={showTracks} onChange={(e) => setShowTracks(e.target.checked)} />Traseele turelor mele</label>
            <div className="small muted">
              {measured > 0 ? `${measured} segmente de stradă cu date.` : 'Încă nu sunt străzi măsurate. Fă o tură sau importă una din Sensor Logger: harta se actualizează imediat.'}{' '}
              Date publicate de echipă: {snapshotRideCount(snapshot) ? `actualizate ${snapshot!.meta.generated_at.slice(0, 10)}` : 'încă nicio tură publicată'}.
              {lastLocal > 0 && ` Ultima ta tură: ${new Date(lastLocal).toLocaleDateString('ro-RO')}.`}
            </div>
            <p className="xs muted">Clasele sunt relative la telefonul, bicicleta și suportul folosite la măsurare. Confortul nu înseamnă siguranță. <a href="#/more/method">Cum măsurăm</a></p>
          </div>
        </Sheet>
      )}
      {sel?.edge && graph && <EdgeSheet e={sel.edge} name={graph.name[sel.edge.edge_id] || 'Stradă fără nume'} len={graph.length[sel.edge.edge_id]} osm={`${graph.highway[sel.edge.edge_id]}${graph.surface[sel.edge.edge_id] ? ', suprafață ' + graph.surface[sel.edge.edge_id] : ''}`} version={layer.processing_version} onClose={() => setSel(null)} />}
      {sel?.zone && <ZoneSheet z={sel.zone} onClose={() => setSel(null)} />}
      {sel?.report && <ReportSheet r={sel.report} onClose={() => setSel(null)} />}
    </main>
  );
}

function EdgeSheet({ e, name, len, osm, version, onClose }: { e: EdgeAgg; name: string; len: number; osm: string; version: string; onClose: () => void }) {
  const layer = useApp((s) => s.layer);
  const graph = useApp((s) => s.graph);
  const reports = useApp((s) => s.reports);
  const zones = useMemo(() => layer.zones.filter((z) => z.edge_id === e.edge_id && z.status !== 'REJECTED'), [layer, e.edge_id]);
  const manual = useMemo(() => (graph ? reports.filter((r) => distToEdges(graph, [e.edge_id], r.lat, r.lon) <= 20).length : 0), [graph, reports, e.edge_id]);
  const measured = e.status !== 'UNKNOWN' && !!e.class;
  const x = e.explore;
  const status = e.status === 'MEASURED' ? { t: 'Măsurat', k: 'comfort' } : e.status === 'LOW_CONFIDENCE' ? { t: 'Încredere redusă', k: 'warn' } : x ? { t: 'Explorat la viteză redusă', k: 'primary' } : { t: 'Nemăsurat', k: '' };
  const accM = e.gps_acc_median ?? x?.acc_p50 ?? null;
  const gps = accM === null ? null : accM <= 6 ? 'bună' : accM <= 10 ? 'medie' : 'slabă';
  const kmh = (v: number | null) => (v === null ? '—' : `${Math.round(v * 3.6)}`);
  return (
    <Sheet title={name} onClose={onClose}>
      <div className="stack">
        <div className="row nowrap">
          {measured && <ClassBadge c={e.class!} />}
          <div className="grow">
            {measured ? <><b>{t.classShort[e.class!]}</b><div className="small muted">{t.classPlain[e.class!]}</div></> : <b>{x ? 'Fără clasă de confort' : 'Fără măsurători valide'}</b>}
          </div>
          <span className={`badge ${status.k}`}>{status.t}</span>
        </div>
        {measured ? (
          <Banner kind={e.status === 'MEASURED' ? 'ok' : 'warn'}>{e.status === 'MEASURED' ? `Măsurat în ${e.n_passes} treceri independente.` : `Încredere redusă: ${e.reasons.join(', ')}.`} Clasele sunt relative la turele echipei, nu o scală absolută.</Banner>
        ) : x ? (
          <Banner kind="info">Parcurs doar la viteză mică (~{fmt(x.speed_p50 * 3.6, 0)} km/h). Vibrația la viteză mică nu se compară cu cea la 15–20 km/h, deci nu dăm o clasă și nu influențează rutele. Arătăm valorile ca explorare.</Banner>
        ) : null}
        <dl className="kv">
          <dt>RVI (mediana)</dt><dd>{measured ? fmt(e.rms_median, 2, 'm/s²') : '—'}{x ? ` · explorare: ${fmt(x.rms_p50, 2, 'm/s²')} la ~${fmt(x.speed_p50, 1, 'm/s')}` : ''}</dd>
          <dt>segment</dt><dd>{fmtLen(len)} · {e.surface_kind ?? '—'}</dd>
          <dt>treceri</dt><dd>{measured ? `${e.n_passes} (din ${e.n_rides} ${e.n_rides === 1 ? 'tură' : 'ture'})` : '—'}{x ? ` · lente: ${x.passes}` : ''}</dd>
          <dt>GPS</dt><dd>{gps ? `${gps} (±${fmt(accM, 0, 'm')})` : '—'}{e.ambiguous_ratio > 0 ? ` · ${fmt(e.ambiguous_ratio * 100, 0, '%')} ambiguu carosabil/trotuar/pistă` : ''}</dd>
          <dt>viteze măsurate</dt><dd>{measured ? `${kmh(e.speed_p10)}–${kmh(e.speed_p90)} km/h` : x ? `~${kmh(x.speed_p50)} km/h (lent)` : '—'}</dd>
          <dt>șocuri candidate</dt><dd>{zones.length ? `${zones.length} ${zones.length === 1 ? 'zonă' : 'zone'}: ${zones.filter((z) => z.status === 'NEEDS_REVIEW').length} de verificat, ${zones.filter((z) => z.status === 'REPEATED').length} repetate, ${zones.filter((z) => (z.confirmed ?? 0) > 0).length} confirmate de tine` : 'niciuna'}</dd>
          <dt>observații manuale</dt><dd>{manual ? `${manual} pe acest telefon (nu sunt măsurători)` : 'niciuna'}</dd>
          <dt>sursa</dt><dd>{e.origin.map((o) => (o === 'public' ? 'date publicate de echipă' : 'turele tale (doar pe acest telefon)')).join(' + ') || '—'}</dd>
          <dt>ultima măsurătoare</dt><dd>{e.last_seen ? new Date(e.last_seen).toLocaleDateString('ro-RO') : '—'}</dd>
        </dl>
        <details>
          <summary>Cum se calculează</summary>
          <p className="small">Telefonul fixat pe ghidon măsoară accelerația verticală de 100 de ori pe secundă. Pe ferestre de 2 s, la 2,5–9 m/s și cu GPS, calculăm RMS-ul vibrației (filtru trece-sus 4 Hz), apoi mediana pe segment. „Măsurat” cere ≥ 3 ferestre, ≥ 2 treceri, GPS ≤ 10 m și nicio ambiguitate cu o cale paralelă. Clasele A–E sunt percentilele 20/40/60/80 ale ferestrelor echipei ({layer.thresholds_source}).</p>
          <dl className="kv">
            <dt>ferestre valide</dt><dd>{e.n_windows} din {e.n_windows_total}</dd>
            {x && <><dt>explorare pe viteze</dt><dd>{x.bands.map((b) => `${b.label}: ${b.n} · ${fmt(b.rms_p50, 2)}`).join('; ')}</dd></>}
            <dt>OSM</dt><dd>{osm}</dd>
            <dt>surse</dt><dd>{e.sources.join(', ') || '—'}</dd>
            <dt>algoritm</dt><dd>{version}</dd>
          </dl>
        </details>
      </div>
    </Sheet>
  );
}

function ZoneSheet({ z, onClose }: { z: ShockZone; onClose: () => void }) {
  const snip = z.strongest.snippet;
  const data = useMemo(() => (snip ? ([snip.v.map((_, i) => (i * snip.dt) / 1000 - 3), snip.v.map((v) => (Number.isFinite(v) ? v : null))] as [number[], (number | null)[]]) : null), [snip]);
  return (
    <Sheet title={z.status === 'REPEATED' ? 'Șocuri repetate în această zonă' : 'Posibilă denivelare'} onClose={onClose}>
      <div className="stack">
        <p className="small">Detectată automat din vibrații în {z.detections} {z.detections === 1 ? 'trecere' : 'treceri'} din {z.passes}. Nu știm ce tip de obstacol este; cercul arată incertitudinea poziției (±{Math.round(z.radius_m)} m).</p>
        {(z.confirmed ?? 0) > 0 && <Banner kind="ok">Ai confirmat această problemă după o tură.</Banner>}
        <div className="row">
          <a className="btn primary sm" href={`#/report/new?lat=${z.lat}&lon=${z.lon}`}>Raportează aici</a>
          <button className="btn sm ghost" onClick={() => { void rejectZone(z.members, z.status !== 'REJECTED'); onClose(); }}>Nu e o problemă</button>
        </div>
        <details>
          <summary>Detalii tehnice</summary>
          <dl className="kv">
            <dt>vârf</dt><dd>{fmt(z.peak_max, 1, 'm/s²')} (mediana {fmt(z.peak_median, 1)})</dd>
            <dt>stare algoritm</dt><dd>{z.status}</dd>
            <dt>viteză</dt><dd>{fmt(z.speed_median, 1, 'm/s')}</dd>
            <dt>roată față + spate</dt><dd>{fmt(z.double_hit_ratio * 100, 0, '%')} (ipoteză)</dd>
            <dt>ultima detectare</dt><dd>{z.last_seen}</dd>
          </dl>
          {data && <UPlot data={data} series={[{ label: 'a_v filtrat (m/s²)', stroke: '#e8590c', width: 1 }]} height={140} xLabel="s față de vârf" ariaLabel="Semnalul de ±3 s în jurul detectării" />}
        </details>
      </div>
    </Sheet>
  );
}

function ReportSheet({ r, onClose }: { r: LocalReport; onClose: () => void }) {
  return (
    <Sheet title={r.status === 'draft' ? 'Marcaj de completat' : typeLabel(r.type)} onClose={onClose}>
      <div className="stack">
        <span className="badge">{VISIBILITY_LABEL.device}</span>
        <p className="small muted">{new Date(r.created_at).toLocaleString('ro-RO', { dateStyle: 'medium', timeStyle: 'short' })}{r.description ? ` · ${r.description}` : ''}</p>
        <a className="btn primary block" href={`#/report/${r.id}`}>{r.status === 'draft' ? 'Completează raportul' : 'Deschide raportul'}</a>
      </div>
    </Sheet>
  );
}
