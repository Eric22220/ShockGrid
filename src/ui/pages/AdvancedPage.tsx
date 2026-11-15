import { Activity, Download, FlaskConical, Route, SlidersHorizontal, Upload } from 'lucide-react';
import { useApp } from '../../state/store';
import { Header, Item } from '../kit';
import { ExportsPage } from '../../dev/ExportsPage';
import { DiagnosticPage } from './DiagnosticPage';
import { SettingsPage } from './SettingsPage';
import { SimulationPage } from './SimulationPage';

export function AdvancedPage({ sub }: { sub?: string }) {
  const evalResults = useApp((s) => s.evalResults);
  const graph = useApp((s) => s.graph);
  const rides = useApp((s) => s.rides);
  if (sub === 'diag') return <main className="screen"><div className="wrap"><Header title="Lab · diagnostic senzori" back="#/" /><DiagnosticPage /></div></main>;
  if (sub === 'settings') return <main className="screen"><div className="wrap"><Header title="Parametri" back="#/" /><SettingsPage /></div></main>;
  if (sub === 'exports') return <ExportsPage />;
  if (sub === 'sim') return <SimulationPage />;
  if (sub === 'validation') return (
    <main className="screen"><div className="wrap stack"><Header title="Validare" back="#/" />
      {evalResults ? <pre>{JSON.stringify(evalResults, null, 2)}</pre> : <p className="small">Rezultatele <code>npm run validate</code> apar aici după turele de teren publicate. Încă nu există: nu afișăm cifre inventate.</p>}
    </div></main>
  );
  const st = graph?.json.meta.stats;
  return (
    <main className="screen"><div className="wrap stack">
      <Header title="Instrumente" back="#/" />
      <p className="small muted">Platforma tehnică ShockGrid Dev, separată de aplicația pentru bicicliști. Site public, fără autentificare; turele importate rămân doar în acest browser.</p>
      <div className="section-label">Ture și analiză</div>
      <div className="list">
        {rides.length === 0 && <Item icon={<Upload />} href="#/import" title="Importă o tură" sub="ZIP din Sensor Logger (fiabil și cu ecranul blocat)" />}
        {rides.slice(0, 6).map((r) => (
          <Item key={r.ride_id} icon={<Activity />} href={`#/review/${r.ride_id}`} title={r.processed.meta.label || r.file_name.replace(/\.zip$/i, '')}
            sub={`${new Date(r.processed.meta.start_ms).toLocaleDateString('ro-RO')} · ${r.processed.shocks.length} evenimente brute · zone, GPS, dovezi`} />
        ))}
        {rides.length > 0 && <Item icon={<Upload />} href="#/import" title="Importă o tură" sub="ZIP din Sensor Logger sau ShockGrid" />}
      </div>
      <p className="xs muted" style={{ marginTop: -4 }}>Pe pagina fiecărei ture, „Analiză tehnică” are graficul accelerației, toate evenimentele brute cu filtre, calitatea datelor și analiza pe stradă.</p>
      <div className="section-label">Instrumente</div>
      <div className="list">
        <Item href="#/more/advanced/diag" icon={<Activity />} tone="primary" title="Diagnostic senzori și GPS" sub="Frecvență, permisiuni, rotunjire" />
        <Item href="#/more/advanced/settings" icon={<SlidersHorizontal />} title="Parametri algoritm" sub="VibrationConfig, praguri, ștergere date" />
        <Item href="#/more/advanced/validation" icon={<FlaskConical />} tone="comfort" title="Validare" sub="Repetabilitate, referințe, map-matching" />
        <Item href="#/more/advanced/sim" icon={<Route />} tone="danger" title="SIMULARE rutare" sub="Cum decide motorul pe un strat inventat (nu date reale)" />
        <Item href="#/more/advanced/exports" icon={<Download />} title="Exporturi pentru instituții" sub="Stratul de confort și zonele cu șocuri, GeoJSON/JSON" />
      </div>
      {st && <p className="xs muted">Graf OSM: {st.edges} muchii, {st.km_total} km, {st.km_sidewalk_separate} km trotuare desenate separat, {st.km_cycleway} km piste.</p>}
    </div></main>
  );
}
