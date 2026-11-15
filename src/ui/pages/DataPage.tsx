import { snapshotRideCount } from '../../core/aggregate';
import { useApp } from '../../state/store';
import { Banner, Header } from '../kit';

export function DataPage() {
  const graph = useApp((s) => s.graph);
  const snapshot = useApp((s) => s.snapshot);
  const rides = useApp((s) => s.rides);
  const reports = useApp((s) => s.reports);
  const gm = graph?.json.meta;
  const pub = snapshotRideCount(snapshot);
  return (
    <main className="screen"><div className="wrap stack">
      <Header title="Date și surse" back="#/more/advanced" />
      <h2>Ce e public și ce e doar al tău</h2>
      <div className="card stack">
        <div><span className="badge comfort">Public</span> <b>Stratul publicat de echipă</b><p className="small muted" style={{ margin: '4px 0 0' }}>{pub ? `${pub} ${pub === 1 ? 'tură' : 'ture'} · ${snapshot!.edges.length} segmente · versiunea ${snapshot!.meta.generated_at.slice(0, 16).replace('T', ' ')} UTC${snapshot!.meta.includes_exploratory ? ' · include explorare lentă' : ''}.` : 'Încă nicio tură publicată.'} Conține doar valori agregate pe segmente de stradă: fără trasee, fără ore, fără telefoane, fără începutul și sfârșitul turelor.</p></div>
        <div><span className="badge">Doar pe acest telefon</span> <b>Turele tale ({rides.length}) și rapoartele tale ({reports.length})</b><p className="small muted" style={{ margin: '4px 0 0' }}>Rămân în browser (IndexedDB). Nu se încarcă nicăieri automat și nu le vede nimeni altcineva. Platforma tehnică a echipei (ShockGrid Dev) are o bază separată și nu le citește decât dacă îi ceri, pe același telefon.</p></div>
      </div>
      <Banner kind="info">ShockGrid nu are deocamdată o bază comună de rapoarte. Raportările comunitare ar avea nevoie de un server cu moderare și protecție anti-spam; până atunci, problemele concrete merg pe canalul oficial <a href="https://sesizari.primariatm.ro/" target="_blank" rel="noopener">Sesizări</a>.</Banner>
      <h2>Surse</h2>
      <dl className="kv">
        <dt>Străzi</dt><dd>OpenStreetMap{gm ? `, descărcat ${gm.downloaded_at.slice(0, 10)}` : ''} · © OpenStreetMap contributors, ODbL</dd>
        <dt>Măsurători</dt><dd>Ture ale echipei (Sensor Logger și înregistratorul ShockGrid), procesate în aplicație</dd>
        <dt>Căutare adrese</dt><dd>Străzi: local, din OpenStreetMap. Adrese și locuri: Photon (komoot), pe baza OpenStreetMap</dd>
        <dt>Hartă de fundal</dt><dd>Tile-uri OpenStreetMap</dd>
      </dl>
      <p className="xs muted">Cod: MIT. Date derivate din OpenStreetMap: ODbL 1.0.</p>
    </div></main>
  );
}
