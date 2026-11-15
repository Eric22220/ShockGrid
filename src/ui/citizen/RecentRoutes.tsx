// „Rute recente”: rutele pornite din aplicație, doar pe acest telefon. „Folosește din nou” recalculează de la
// poziția CURENTĂ spre aceeași destinație (nu reia o rută veche de altundeva).
import { History, RotateCcw, Trash2 } from 'lucide-react';
import { reusePlan, STATUS_LABEL, type RouteEntry } from '../../services/history';
import { historyClear, historyDelete, setPlan, useApp } from '../../state/store';
import { fmtLen } from '../format';
import { Sheet } from '../kit';
import { go } from '../nav';

export function RecentRoutes({ onClose }: { onClose: () => void }) {
  const list = useApp((s) => s.routeHistory);
  const use = async (e: RouteEntry) => { await setPlan(reusePlan(e)); onClose(); go('/route'); };
  return (
    <Sheet title="Rute recente" onClose={onClose}>
      {list.length === 0 ? (
        <div className="empty-hist"><History aria-hidden="true" /><p className="small muted">Rutele pe care pornești navigarea apar aici. Rămân doar pe acest telefon.</p></div>
      ) : (
        <>
          <ul className="hist" aria-label="Rute recente">
            {list.map((e) => (
              <li key={e.id} className="hist-card">
                <div className="hist-main">
                  <div className="hist-route"><span className="muted">{e.origin.name}</span> → <b>{e.dest.name}</b></div>
                  <div className="small muted">
                    {new Date(e.started_at).toLocaleString('ro-RO', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} · {fmtLen(e.distance_m)} · ~{e.minutes} min
                    <span className={`badge hist-${e.status}`}>{STATUS_LABEL[e.status]}</span>
                  </div>
                </div>
                <div className="hist-actions">
                  <button className="btn sm primary" onClick={() => void use(e)}><RotateCcw /> Folosește din nou</button>
                  <button className="icon-btn flat" onClick={() => void historyDelete(e.id)} aria-label={`Șterge ruta spre ${e.dest.name}`}><Trash2 /></button>
                </div>
              </li>
            ))}
          </ul>
          <button className="btn sm ghost block" style={{ marginTop: 10 }} onClick={() => { if (confirm('Ștergi toate rutele recente de pe acest telefon?')) void historyClear(); }}>Șterge istoricul</button>
        </>
      )}
    </Sheet>
  );
}
