import { BookOpen, Database, Flag, Lock, RefreshCw } from 'lucide-react';
import { checkForUpdate, reloadIfSafe } from '../../services/update';
import { updateSettings, useApp } from '../../state/store';
import { Item, toast } from '../kit';

export function MorePage() {
  const reports = useApp((s) => s.reports);
  const contribute = useApp((s) => s.settings.contribute);
  return (
    <main className="screen"><div className="wrap stack">
      <h1>Mai mult</h1>
      <div className="list">
        <Item href="#/reports" icon={<Flag />} tone="danger" title="Rapoartele mele" sub={reports.length ? `${reports.length} pe acest telefon` : 'Problemele pe care le-ai semnalat'} />
      </div>
      <div className="section-label">Despre</div>
      <div className="list">
        <Item href="#/more/help" icon={<BookOpen />} tone="primary" title="Cum funcționează" sub="Culori, rute, raportare, pe scurt" />
        <Item href="#/more/data" icon={<Database />} tone="comfort" title="Date și surse" sub="Ce e public și ce rămâne pe telefon" />
        <Item href="#/more/privacy" icon={<Lock />} title="Confidențialitate" sub="Ce date stocăm și unde" />
      </div>
      <div className="section-label">Măsurători</div>
      <div className="card" style={{ padding: '4px 16px' }}>
        <label className="switch"><input type="checkbox" checked={contribute} onChange={(e) => void updateSettings({ contribute: e.target.checked })} /><span><b>Contribuie cu măsurători în timpul navigării</b><div className="xs muted">Când pornești navigarea, telefonul măsoară vibrațiile pe drum, doar cu aplicația deschisă și ecranul aprins. Se salvează doar pe acest telefon; oprești oricând din „Oprește”.</div></span></label>
      </div>
      <div className="section-label">Aplicația</div>
      <div className="list">
        <Item icon={<RefreshCw />} title="Caută actualizări" sub={`Versiunea ${__APP_VERSION__} · ${__BUILD_TIME__.replace('T', ' ')} UTC`} onClick={async () => {
          toast('Se verifică…');
          const r = await checkForUpdate();
          if (r === 'pending') { toast('Versiune nouă instalată. Se reîncarcă…'); if (!reloadIfSafe()) toast('Versiune nouă instalată: se aplică după tura sau raportul în curs.'); }
          else toast(r === 'current' ? 'Ai cea mai nouă versiune.' : 'Verificarea nu e disponibilă acum (fără internet?).');
        }} />
      </div>
      <p className="xs muted" style={{ textAlign: 'center', marginTop: 24 }}>ShockGrid · UniHack 2026 · cod MIT, date © OpenStreetMap contributors (ODbL)</p>
    </div></main>
  );
}
