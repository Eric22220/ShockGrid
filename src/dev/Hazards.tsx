// Problemele de pe drum detectate AUTOMAT (Dev): nivelul automat, dovezile, decizia manuală OPȚIONALĂ și acoperirea.
// Verificarea manuală nu e obligatorie: problemele posibile/probabile se publică și pot influența rutarea fără ea.
import { CheckCircle2, ChevronDown, ChevronUp, HelpCircle, ThumbsDown, ThumbsUp } from 'lucide-react';
import { useMemo, useState } from 'react';
import { HAZARD_LABEL, isActive, type Hazard } from '../core/hazards';
import { coverageReport, type CoverageReport } from '../core/publiclayer';
import type { ReportType } from '../storage/idb';
import { reviewHazard, useApp } from '../state/store';
import { fmtLen } from '../ui/format';
import { HAZARD_STYLE } from '../ui/map/draw';

const TYPES: { id: ReportType; label: string }[] = [
  { id: 'groapa', label: 'Groapă' },
  { id: 'denivelare', label: 'Denivelare / prag' },
  { id: 'obstacol', label: 'Obstacol' },
];
const TYPE_LABEL: Record<string, string> = { groapa: 'groapă', denivelare: 'denivelare / prag', obstacol: 'obstacol' };

export function HazardBadge({ h }: { h: Hazard }) {
  const st = HAZARD_STYLE[h.level];
  return <span className="badge" style={{ background: st.color, color: '#fff', borderColor: st.color, opacity: isActive(h) ? 1 : 0.7 }}>{HAZARD_LABEL[h.level]}{h.type ? ` · ${TYPE_LABEL[h.type]}` : ''}</span>;
}

export function HazardCard({ h, n, open, onOpen }: { h: Hazard; n?: number; open?: boolean; onOpen?: () => void }) {
  const [askType, setAskType] = useState(false);
  const [ev, setEv] = useState(false);
  const d = h.detail;
  if (!d) return null;
  const rideId = d.strongest.split(':')[0];
  const shockId = d.strongest.slice(rideId.length + 1);
  return (
    <div className="card" style={{ borderColor: open ? 'var(--primary)' : undefined }}>
      <button className="row nowrap" style={{ width: '100%', justifyContent: 'space-between', background: 'none', border: 0, padding: 0, textAlign: 'left', cursor: 'pointer', color: 'inherit' }} onClick={onOpen} aria-expanded={open}>
        <div className="grow"><b>{n ? `${n}. ` : ''}{d.street ?? 'Fără nume de stradă'}</b><div className="xs muted">±{Math.round(h.r)} m · {d.passes} {d.passes === 1 ? 'trecere' : 'treceri'} · {d.events} evenimente{d.strong ? `, ${d.strong} puternice` : ''}</div></div>
        <HazardBadge h={h} />
      </button>
      <p className="xs muted" style={{ margin: '6px 0' }}>{d.why.join(' · ')}</p>
      {d.decision && d.decision !== 'rejected' && d.auto !== h.level && <p className="xs" style={{ margin: '0 0 6px' }}>Nivel automat: {HAZARD_LABEL[d.auto].toLowerCase()}.</p>}
      {d.decision === 'unsure' && <p className="xs" style={{ margin: '0 0 6px' }}>Marcat „Nu sunt sigur”: rămâne la nivelul automat.</p>}
      {d.excluded && <p className="xs" style={{ margin: '0 0 6px', color: 'var(--warn)' }}>Nu intră în harta publică: {d.excluded}.</p>}
      {!askType ? (
        <div className="grid2" style={{ gap: 8 }}>
          <button className="btn sm comfort" onClick={() => setAskType(true)} aria-pressed={h.level === 'confirmed'}><ThumbsUp /> Confirmă problemă</button>
          <button className="btn sm" onClick={() => void reviewHazard(d.members, 'no')} aria-pressed={h.level === 'rejected'}><ThumbsDown /> Nu este o problemă</button>
          <button className="btn sm" onClick={() => void reviewHazard(d.members, 'unsure')} aria-pressed={d.decision === 'unsure'}><HelpCircle /> Nu sunt sigur</button>
          <button className="btn sm ghost" onClick={() => setEv(!ev)} aria-expanded={ev}>{ev ? <ChevronUp /> : <ChevronDown />} Dovezi</button>
        </div>
      ) : (
        <>
          <p className="small" style={{ margin: '0 0 6px' }}>Tipul problemei:</p>
          <div className="choice-grid">
            {TYPES.map((x) => <button key={x.id} className="choice" onClick={() => { void reviewHazard(d.members, 'yes', x.id); setAskType(false); }}><b>{x.label}</b></button>)}
          </div>
          <button className="btn ghost block sm" onClick={() => setAskType(false)}>Înapoi</button>
        </>
      )}
      {ev && (
        <dl className="kv" style={{ marginTop: 8 }}>
          <dt>ture</dt><dd>{d.rides}</dd>
          <dt>evenimente cu context bun</dt><dd>{d.good} din {d.events}</dd>
          <dt>viteză mediană</dt><dd>{d.speed_p50 === null ? '—' : `${Math.round(d.speed_p50 * 3.6)} km/h`}{d.slow ? ' (sub banda RVI)' : ''}</dd>
          {d.rough_ratio !== null && <><dt>vibrație continuă</dt><dd>×{d.rough_ratio.toFixed(2)} față de restul turei, la aceeași viteză</dd></>}
          <dt>muchii</dt><dd>{h.edges.length ? h.edges.join(', ') : 'nepotrivită pe stradă'}</dd>
          <dt>detalii</dt><dd><a href={`#/review/${rideId}?shock=${encodeURIComponent(shockId)}`}>evenimentele pe tură</a></dd>
        </dl>
      )}
    </div>
  );
}

/** Lista problemelor: primele `top` (cele mai importante) deschise; restul, inclusiv slabe și respinse, într-un grup închis. */
export function HazardList({ hazards, top = 5 }: { hazards: Hazard[]; top?: number }) {
  const [sel, setSel] = useState(0);
  const local = hazards.filter((h) => h.origin === 'local' && h.detail);
  const active = local.filter(isActive);
  const rest = local.filter((h) => !isActive(h));
  const first = active.slice(0, top), more = active.slice(top);
  if (!local.length) return <p className="small muted" style={{ margin: 0 }}>Nicio problemă detectată în turele din acest browser.</p>;
  const c = (l: string) => local.filter((h) => h.level === l).length;
  return (
    <div className="stack">
      <div className="funnel">
        <div><b className="num">{c('confirmed')}</b><span>confirmate</span></div>
        <div><b className="num">{c('likely')}</b><span>probabile</span></div>
        <div className="hl"><b className="num">{c('possible')}</b><span>posibile</span></div>
        <div><b className="num">{c('weak')}</b><span>slabe</span></div>
        <div><b className="num">{c('rejected')}</b><span>respinse</span></div>
      </div>
      <p className="xs muted" style={{ margin: 0 }}>Detectate automat, fără verificare obligatorie. Confirmarea crește încrederea (și face ca rutarea implicită să le ocolească); „Nu este o problemă” le scoate din rutare și din următoarea publicare.</p>
      {first.map((h, i) => <HazardCard key={h.id} h={h} n={i + 1} open={sel === i} onOpen={() => setSel(i)} />)}
      {more.length > 0 && (
        <details className="card"><summary>Alte {more.length} probleme posibile</summary>
          <div className="stack" style={{ marginTop: 8 }}>{more.map((h, i) => <HazardCard key={h.id} h={h} n={top + i + 1} />)}</div>
        </details>
      )}
      {rest.length > 0 && (
        <details className="card"><summary>Slabe sau respinse ({rest.length})</summary>
          <div className="stack" style={{ marginTop: 8 }}>{rest.map((h) => <HazardCard key={h.id} h={h} />)}</div>
        </details>
      )}
    </div>
  );
}

export function useCoverage(): CoverageReport | null {
  const rides = useApp((s) => s.rides);
  const graph = useApp((s) => s.graph);
  const snapshot = useApp((s) => s.snapshot);
  return useMemo(() => {
    const inc = rides.filter((r) => r.included).map((r) => r.processed);
    return graph && inc.length ? coverageReport(inc, graph, snapshot) : null;
  }, [rides, graph, snapshot]);
}

/** Acoperirea: GPS → pe străzi → clasificat → public. `pub` = acoperirea stratului propus (după generare). */
export function CoveragePanel({ c, pub }: { c: CoverageReport; pub?: { public_m: number; public_classified_m: number; excluded_m: number } | null }) {
  const p = pub ?? null;
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="dev-stats">
        <div className="card"><div className="small muted">Traseu GPS</div><div className="big num">{fmtLen(c.gps_m)}</div><div className="xs muted">toate vitezele, privat</div></div>
        <div className="card"><div className="small muted">Parcurs pe străzi</div><div className="big num">{fmtLen(c.traversed_m)}</div><div className="xs muted">potrivit pe hartă, privat</div></div>
        <div className="card"><div className="small muted">Clasificat confort</div><div className="big num">{fmtLen(c.classified_m)}</div><div className="xs muted">{fmtLen(c.measured_m)} măsurat sigur · restul „Parcurs, neevaluat”</div></div>
        <div className="card"><div className="small muted">Public</div><div className="big num">{p ? fmtLen(p.public_m) : '—'}</div><div className="xs muted">{p ? `${fmtLen(p.public_classified_m)} cu culoare · ${fmtLen(p.excluded_m)} exclus (confidențialitate)` : 'după generare'}</div></div>
      </div>
      <p className="xs muted" style={{ margin: 0 }}><CheckCircle2 style={{ width: 12, height: 12, verticalAlign: -2 }} /> Traseul complet rămâne vizibil privat (Hartă tehnică). În harta publică lipsesc capetele turelor (primii/ultimii 200 m pe traseu și tot ce e la mai puțin de 250 m de pornire/sosire) și străzile parcurse cu prea puține ferestre. Încetineala nu devine verde: apare „Parcurs, neevaluat”.</p>
    </div>
  );
}
