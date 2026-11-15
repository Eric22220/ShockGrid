// „Raportează” → una din trei categorii: două atingeri când GPS-ul e proaspăt și precis. Altfel alegerea locului
// pe hartă (nu inventăm coordonate). Raportul rămâne doar pe acest telefon. Componenta nu depinde de
// înregistrarea senzorilor: ShockGrid Dev își adaugă reperul în tură prin `onSaved`.
import { Flag, MapPin, X } from 'lucide-react';
import { useEffect, useReducer, useState } from 'react';
import { createPortal } from 'react-dom';
import { placement, QUICK_TYPES, quickReducer, type LocKind, type QAction, type QState } from '../../services/hazard';
import type { LocalReport } from '../../storage/idb';
import { removeReport, saveReport } from '../../state/store';
import { toast, type ToastAction } from '../kit';
import { useLocation } from '../map/me';
import { go } from '../nav';
import { HazardIcon } from './HazardIcons';

export interface ReportHooks {
  /** după salvare (Dev: reper în tura în curs) */
  onSaved?: (r: LocalReport) => void;
  /** Dev: link spre editarea completă a raportului */
  detailsHref?: (id: string) => string;
}

/** butonul flotant (pe hartă) sau butonul mare din panoul de navigare */
export function ReportButton({ variant = 'fab', hooks }: { variant?: 'fab' | 'panel'; hooks?: ReportHooks }) {
  const [st, dispatch] = useReducer(quickReducer, { s: 'closed' });
  const open = st.s !== 'closed';
  return (
    <>
      {variant === 'fab'
        ? !open && <button className="fab" onClick={() => dispatch({ a: 'fab' })} aria-label="Raportează o problemă pe drum"><Flag aria-hidden="true" /> Raportează</button>
        : <button className="btn report lg block" onClick={() => dispatch({ a: 'fab' })} aria-label="Raportează o problemă pe drum"><Flag aria-hidden="true" /> Raportează</button>}
      {open && <QuickSheet st={st} dispatch={dispatch} hooks={hooks} />}
    </>
  );
}

/** confirmarea comună: „Salvat pe acest telefon” + Anulează (și Detalii în Dev) */
export function savedToast(r: LocalReport, hooks?: ReportHooks) {
  const actions: ToastAction[] = [{ label: 'Anulează', run: () => { void removeReport(r.id).then(() => toast('Raport anulat')); } }];
  if (hooks?.detailsHref) actions.push({ label: 'Detalii', run: () => go(hooks.detailsHref!(r.id)) });
  toast('Salvat pe acest telefon', actions);
}

function QuickSheet({ st, dispatch, hooks }: { st: QState; dispatch: (a: QAction) => void; hooks?: ReportHooks }) {
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
      void saveReport(r).then(() => { hooks?.onSaved?.(r); savedToast(r, hooks); });
    } else if (st.s === 'pick') {
      dispatch({ a: 'close' });
      go(`/report/new?type=${st.type}&why=${st.reason}`);
    }
  }, [st]); // eslint-disable-line react-hooks/exhaustive-deps

  const pl = placement(loc.fix, now, status);
  const waiting = st.s === 'waiting';
  const where = pl.ok ? `Poziția ta acum · ±${Math.round(pl.acc)} m`
    : pl.reason === 'inaccurate' ? 'GPS imprecis: vei alege locul pe hartă'
      : pl.reason === 'denied' ? 'Fără locație: vei alege locul pe hartă'
        : 'Se caută poziția…';
  return createPortal(
    <>
      <div className="quick-backdrop" onClick={() => dispatch({ a: 'close' })} aria-hidden="true" />
      <section className="sheet quick" role="dialog" aria-modal="true" aria-label="Ce problemă e pe drum?">
        <div className="handle" aria-hidden="true" />
        <div className="sheet-head">
          <h2>{waiting ? 'Se așteaptă GPS-ul…' : 'Ce e pe drum?'}</h2>
          <button className="icon-btn flat" onClick={() => dispatch({ a: 'close' })} aria-label="Închide"><X /></button>
        </div>
        <div className="sheet-body">
          <div className="hazard3" role="group" aria-label="Tipul problemei">
            {QUICK_TYPES.map((q) => (
              <button key={q.id} disabled={waiting} aria-pressed={waiting && st.type === q.id} onClick={() => dispatch({ a: 'type', type: q.id, fix: loc.fix, now: Date.now(), status })}>
                <span className="hz-ic"><HazardIcon type={q.id} size={34} /></span>
                <span className="hz-l">{q.label}</span>
              </button>
            ))}
          </div>
          <div className="row spread nowrap" style={{ marginTop: 14 }}>
            <span className="small muted" aria-live="polite">{where}</span>
            {waiting
              ? <button className="btn sm ghost" onClick={() => dispatch({ a: 'close' })}>Renunță</button>
              : <button className="btn sm ghost" onClick={() => { dispatch({ a: 'close' }); go('/report/new?type=groapa&why=manual'); }}><MapPin /> Pe hartă</button>}
          </div>
        </div>
      </section>
    </>,
    document.body,
  );
}
