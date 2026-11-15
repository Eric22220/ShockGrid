// „Raportează” → „Groapă”: două atingeri când GPS-ul e proaspăt și precis. Altfel alegerea locului pe hartă,
// cu explicația de ce. Raportul rămâne doar pe acest telefon.
import { Flag, MapPin, X } from 'lucide-react';
import { useEffect, useReducer, useState } from 'react';
import { createPortal } from 'react-dom';
import { FIX_MAX_ACC_M, PLACE_REASON_TEXT, placement, QUICK_TYPES, quickReducer, type LocKind, type QAction, type QState } from '../../services/hazard';
import { markRide } from '../../services/ride';
import { removeReport, saveReport } from '../../state/store';
import { toast } from '../kit';
import { useLocation } from '../map/me';
import { go } from '../nav';

/** butonul flotant (pe hartă) sau butonul mare din panoul de navigare/tură */
export function ReportButton({ variant = 'fab' }: { variant?: 'fab' | 'panel' }) {
  const [st, dispatch] = useReducer(quickReducer, { s: 'closed' });
  const open = st.s !== 'closed';
  return (
    <>
      {variant === 'fab'
        ? !open && <button className="fab" onClick={() => dispatch({ a: 'fab' })} aria-label="Raportează o problemă a drumului"><Flag aria-hidden="true" /> Raportează</button>
        : <button className="btn report lg block" onClick={() => dispatch({ a: 'fab' })} aria-label="Raportează o problemă a drumului"><Flag aria-hidden="true" /> Raportează</button>}
      {open && <QuickSheet st={st} dispatch={dispatch} />}
    </>
  );
}

function QuickSheet({ st, dispatch }: { st: QState; dispatch: (a: QAction) => void }) {
  const loc = useLocation(true);
  const status = loc.status as LocKind;
  const [now, setNow] = useState(() => Date.now());
  // ceasul avansează ca un fix să devină „vechi” și ca așteptarea să expire
  useEffect(() => { const h = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(h); }, []);
  useEffect(() => { if (st.s === 'waiting') dispatch({ a: 'fix', fix: loc.fix, now: Date.now(), status }); }, [st.s, loc.fix, status, now]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (st.s === 'saved') {
      const r = st.report;
      dispatch({ a: 'close' });
      void saveReport(r).then(() => {
        markRide(`raport ${r.type}`);
        toast('Raport salvat pe acest telefon', [
          { label: 'Anulează', run: () => { void removeReport(r.id).then(() => toast('Raportul a fost anulat.')); } },
          { label: 'Detalii', run: () => go(`/report/${r.id}`) },
        ]);
      });
    } else if (st.s === 'pick') {
      dispatch({ a: 'close' });
      go(`/report/new?type=${st.type}&why=${st.reason}`);
    }
  }, [st]); // eslint-disable-line react-hooks/exhaustive-deps

  const pl = placement(loc.fix, now, status);
  const where = pl.ok
    ? <>Locul: <b>poziția ta acum</b> (±{Math.round(pl.acc)} m)</>
    : pl.reason === 'inaccurate' ? <>GPS imprecis (±{Math.round(loc.fix?.acc ?? 0)} m, peste {FIX_MAX_ACC_M} m): după alegere fixezi locul pe hartă.</>
      : pl.reason === 'denied' ? <>{PLACE_REASON_TEXT.denied} După alegere fixezi locul pe hartă.</>
        : <>Se caută poziția GPS…</>;
  const waiting = st.s === 'waiting';
  return createPortal(
    <>
    <div className="quick-backdrop" onClick={() => dispatch({ a: 'close' })} aria-hidden="true" />
    <section className="sheet quick" role="dialog" aria-modal="true" aria-label="Ce ai întâlnit?">
      <div className="handle" aria-hidden="true" />
      <div className="sheet-head">
        <h2>{waiting ? 'Se așteaptă GPS-ul…' : 'Ce ai întâlnit?'}</h2>
        <button className="icon-btn flat" onClick={() => dispatch({ a: 'close' })} aria-label="Închide"><X /></button>
      </div>
      <div className="sheet-body stack">
        {waiting ? (
          <p className="small">Salvăm <b>{QUICK_TYPES.find((q) => q.id === st.type)?.label}</b> imediat ce GPS-ul dă o poziție proaspătă. Dacă nu vine în câteva secunde, alegi locul pe hartă.</p>
        ) : (
          <div className="hazard-grid" role="group" aria-label="Tipul problemei">
            {QUICK_TYPES.map((q, i) => (
              <button key={q.id} className={i === 0 ? 'first' : ''} onClick={() => dispatch({ a: 'type', type: q.id, fix: loc.fix, now: Date.now(), status })}>{q.label}</button>
            ))}
          </div>
        )}
        <p className="small muted" style={{ margin: 0 }} aria-live="polite">{where}</p>
        <div className="row spread">
          <button className="btn sm ghost" onClick={() => { const t = waiting ? st.type : 'groapa'; dispatch({ a: 'close' }); go(`/report/new?type=${t}&why=manual`); }}><MapPin /> Aleg locul pe hartă</button>
          {waiting && <button className="btn sm" onClick={() => dispatch({ a: 'close' })}>Renunță</button>}
        </div>
        <p className="xs muted" style={{ margin: 0 }}>Se salvează doar pe acest telefon, neverificat. Nu e public și nu e trimis la Primărie. Detaliile și fotografia le poți adăuga mai târziu.</p>
      </div>
    </section>
    </>,
    document.body,
  );
}
