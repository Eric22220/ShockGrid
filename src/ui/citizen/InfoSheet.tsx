// „Informații”: ajutor scurt, confidențialitate, surse, raportarea oficială. Nu e un meniu cu setări.
import { ExternalLink } from 'lucide-react';
import { useState } from 'react';
import { snapshotRideCount } from '../../core/aggregate';
import { useApp, wipeAll } from '../../state/store';
import { Sheet, toast } from '../kit';
import { ROUGH_STYLE } from '../map/draw';
import { CITIZEN_ROUGH } from './labels';

export function InfoSheet({ onClose }: { onClose: () => void }) {
  const snapshot = useApp((s) => s.snapshot);
  const reports = useApp((s) => s.reports);
  const pub = snapshotRideCount(snapshot);
  const [wiped, setWiped] = useState(false);
  return (
    <Sheet title="Informații" onClose={onClose}>
      <div className="info stack">
        <details open>
          <summary>Harta</summary>
          {(['green', 'yellow', 'red'] as const).map((k) => (
            <div key={k} className="legend-row"><span className="legend-line" style={{ background: ROUGH_STYLE[k].color, height: ROUGH_STYLE[k].weight }} /><span>{CITIZEN_ROUGH[k]}</span></div>
          ))}
          <p className="small">Culorile vin din vibrațiile măsurate pe bicicletă de echipa ShockGrid. Strada fără culoare: nu avem date. Culorile nu sunt o clasificare oficială a siguranței.</p>
          <p className="small muted">{pub ? `Date publicate de echipă: actualizate ${snapshot!.meta.generated_at.slice(0, 10)}.` : 'Echipa nu a publicat încă date de confort.'}</p>
        </details>
        <details>
          <summary>Raportare</summary>
          <p className="small">Apasă <b>Raportează</b> și alege problema. Raportul se salvează doar pe acest telefon{reports.length ? ` (acum: ${reports.length})` : ''}: nu e public și nu ajunge la Primărie.</p>
          <a className="btn sm block" href="https://sesizari.primariatm.ro/" target="_blank" rel="noopener"><ExternalLink /> Sesizare oficială la Primăria Timișoara</a>
        </details>
        <details>
          <summary>Confidențialitate</summary>
          <p className="small">Fără cont și fără trackere. Locația se folosește doar pe telefon, când o ceri. Căutarea adreselor trimite doar textul căutat la Photon (OpenStreetMap), nu poziția ta. Rapoartele rămân în acest browser până le ștergi.</p>
          <button className="btn sm danger block" disabled={wiped} onClick={async () => { if (confirm('Ștergi toate datele ShockGrid de pe acest telefon (rapoarte, destinații recente, setări)? Nu se poate anula.')) { await wipeAll(); setWiped(true); toast('Datele de pe acest telefon au fost șterse'); } }}>Șterge datele de pe acest telefon</button>
        </details>
        <details>
          <summary>Surse</summary>
          <p className="small">Hartă și străzi: © OpenStreetMap contributors (ODbL). Căutare: Photon (komoot). Rute: doar căi permise bicicletelor, fără trotuare. Cod: MIT.</p>
        </details>
        <p className="xs muted" style={{ textAlign: 'center', margin: '8px 0 0' }}>ShockGrid · UniHack 2026 · versiunea {__APP_VERSION__}</p>
      </div>
    </Sheet>
  );
}
