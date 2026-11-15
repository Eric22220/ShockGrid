import { Activity, BookOpen, Database, Download, Flag, FlaskConical, GitCompare, Lock, Navigation, Radio, Route, SlidersHorizontal, Upload } from 'lucide-react';
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
  if (sub === 'diag') return <main className="screen"><div className="wrap"><Header title="Diagnostic senzori" back="#/more/advanced" /><DiagnosticPage /></div></main>;
  if (sub === 'settings') return <main className="screen"><div className="wrap"><Header title="Parametri" back="#/more/advanced" /><SettingsPage /></div></main>;
  if (sub === 'exports') return <ExportsPage />;
  if (sub === 'sim') return <SimulationPage />;
  if (sub === 'validation') return (
    <main className="screen"><div className="wrap stack"><Header title="Validare" back="#/more/advanced" />
      {evalResults ? <pre>{JSON.stringify(evalResults, null, 2)}</pre> : <p className="small">Rezultatele <code>npm run validate</code> apar aici după turele de teren publicate. Încă nu există: nu afișăm cifre inventate.</p>}
    </div></main>
  );
  const st = graph?.json.meta.stats;
  return (
    <main className="screen"><div className="wrap stack">
      <h1>Instrumente</h1>
      <div className="section-label">Achiziție de date</div>
      <div className="list">
        <Item href="#/import" icon={<Upload />} tone="comfort" title="Import ZIP din Sensor Logger" sub="accelerometru, giroscop, GPS; fiabil și cu ecranul blocat" />
        <Item href="#/record" icon={<Radio />} tone="danger" title="Înregistrare live în browser" sub="senzori + GPS, starea senzorilor, recuperarea turelor întrerupte" />
        <Item href="#/route" icon={<Navigation />} title="Navigare cu măsurare" sub="ruta A→B; cu „Măsoară vibrațiile” pornește aceeași înregistrare" />
        <Item href="#/more/advanced/diag" icon={<Activity />} tone="primary" title="Diagnostic senzori și GPS" sub="frecvență, permisiuni, rotunjire" />
      </div>
      <div className="section-label">Algoritm și validare</div>
      <div className="list">
        <Item href="#/more/advanced/settings" icon={<SlidersHorizontal />} title="Parametri algoritm" sub="VibrationConfig, praguri, calibrare" />
        <Item href="#/more/advanced/validation" icon={<FlaskConical />} tone="comfort" title="Validare" sub="repetabilitate, referințe, map-matching" />
        <Item href="#/more/advanced/sim" icon={<Route />} tone="danger" title="SIMULARE rutare" sub="regulile motorului pe un strat inventat (nu date reale)" />
        <Item href="#/more/method" icon={<BookOpen />} title="Metodologie" sub="RVI, clase, încredere, limite" />
        {rides.length > 1 && <Item href="#/compare" icon={<GitCompare />} title="Compară ture" sub="aceleași segmente, ture diferite" />}
      </div>
      <div className="section-label">Date</div>
      <div className="list">
        <Item href="#/reports" icon={<Flag />} title="Rapoarte" sub="raportele din acest browser: editare, fotografie, text pentru Sesizări" />
        <Item href="#/more/advanced/exports" icon={<Download />} title="Exporturi GeoJSON / JSON" sub="stratul curent și zonele cu șocuri" />
        <Item href="#/more/data" icon={<Database />} title="Date și surse" sub="public vs. local, OSM, Photon" />
        <Item href="#/more/privacy" icon={<Lock />} title="Confidențialitate și ștergere date" sub="baza shockgrid-dev din acest browser" />
      </div>
      {st && <p className="xs muted">Graf OSM: {st.edges} muchii, {st.km_total} km, {st.km_sidewalk_separate} km trotuare desenate separat, {st.km_cycleway} km piste.</p>}
    </div></main>
  );
}
