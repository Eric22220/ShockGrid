// După tură: rezumatul și câteva întrebări scurte despre zonele unde telefonul a simțit șocuri.
// Niciodată în timpul mersului. O zonă = o întrebare (nu un vârf). „Mai târziu” lasă zona în așteptare.
import { Check, Clock, Map as MapIcon, ThumbsDown, ThumbsUp } from 'lucide-react';
import { useMemo, useState } from 'react';
import { DEFAULT_CONFIG } from '../../core/config';
import { fmtOffset, rideStart } from '../../core/corridor';
import { rideRoughness, type RoughZone } from '../../core/roughness';
import { MAX_PROMPTS, pendingPrompts, zoneForReview } from '../../services/hazard';
import type { ReportType } from '../../storage/idb';
import { reviewZone, useApp } from '../../state/store';
import { fmt, fmtLen } from '../format';
import { Banner, Header, Stat, toast } from '../kit';
import { L, useLayerGroup, useLeaflet } from '../map/useLeaflet';

const ASK_TYPES: { id: ReportType; label: string }[] = [
  { id: 'groapa', label: 'Groapă' },
  { id: 'denivelare', label: 'Denivelare' },
  { id: 'obstacol', label: 'Alt obstacol' },
];

// „Mai târziu” ține doar în această sesiune: întrebarea rămâne pe pagina turei
const skippedSession = new Set<string>();

export function AfterRide({ id }: { id?: string }) {
  const r = useApp((s) => s.rides.find((x) => x.ride_id === id));
  const loaded = useApp((s) => s.ready);
  const graph = useApp((s) => s.graph);
  const reviews = useApp((s) => s.reviews);
  const rr = useMemo(() => (r ? rideRoughness(r.processed, DEFAULT_CONFIG, graph) : null), [r, graph]);
  const [skipped, setSkipped] = useState<string[]>(() => [...skippedSession]);
  const [askType, setAskType] = useState(false);
  const [answered, setAnswered] = useState(0);
  const [later, setLater] = useState(0);
  if (!r || !id) return <main className="screen"><div className="wrap"><Header title="Tură" back="#/rides" /><p>{loaded ? 'Tura nu există pe acest telefon.' : 'Se încarcă…'}</p></div></main>;
  const s = r.processed.summary;
  const all = pendingPrompts(id, rr, reviews, [], Infinity);
  const prompts = pendingPrompts(id, rr, reviews, skipped);
  // cel mult MAX_PROMPTS întrebări pe vizită, chiar dacă unele sunt amânate
  const seen = answered + later;
  const z = seen < MAX_PROMPTS ? prompts[0] : undefined;
  const deferred = all.filter((x) => skipped.includes(x.id)).length;
  const t0 = rideStart(r.processed);
  const answer = async (a: 'yes' | 'no', type?: ReportType) => {
    if (!z) return;
    await reviewZone(id, zoneForReview(z), a, type);
    setAskType(false);
    setAnswered((n) => n + 1);
    toast(a === 'yes' ? 'Raport salvat pe acest telefon' : 'Notat: nu era o problemă a drumului.');
  };
  const skip = () => { if (!z) return; skippedSession.add(z.id); setSkipped([...skippedSession]); setAskType(false); setLater((n) => n + 1); };
  return (
    <main className="screen"><div className="wrap stack">
      <Header title="Tură salvată" back="#/rides" />
      <div className="grid3">
        <Stat v={fmtLen(s.distance_m)} l="distanță" />
        <Stat v={s.duration_s < 60 ? '<1' : `${Math.round(s.duration_s / 60)}`} unit="min" l="durată" />
        <Stat v={s.speed_median ? fmt(s.speed_median * 3.6, 0) : '—'} unit="km/h" l="viteză tipică" />
      </div>
      {z ? (
        <div className="card ask-card stack">
          <div className="row spread nowrap">
            <h2 style={{ margin: 0 }}>Ai întâlnit o problemă pe drum?</h2>
            <span className="badge">{seen + 1} din {Math.min(MAX_PROMPTS, seen + prompts.length)}</span>
          </div>
          <ZoneMap z={z} />
          <p className="small" style={{ margin: 0 }}>
            {z.street ? <b>{z.street}</b> : 'Aici'}<>, la minutul <b>{fmtOffset((z.strongest.t - t0) / 1000)}</b> al turei</>. Telefonul a simțit {z.n_strong ? 'un șoc puternic' : 'mai multe șocuri'}{z.passes >= 2 ? ', de fiecare dată când ai trecut pe aici' : ''}. Poate fi o groapă, dar și o bordură sau o mișcare a ghidonului.
          </p>
          {!askType ? (
            <div className="grid3">
              <button className="btn comfort" onClick={() => setAskType(true)}><ThumbsUp /> Da</button>
              <button className="btn" onClick={() => void answer('no')}><ThumbsDown /> Nu</button>
              <button className="btn ghost" onClick={skip}><Clock /> Mai târziu</button>
            </div>
          ) : (
            <>
              <div className="hazard-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }} role="group" aria-label="Ce era?">
                {ASK_TYPES.map((x, i) => <button key={x.id} className={i === 0 ? 'first' : ''} onClick={() => void answer('yes', x.id)}>{x.label}</button>)}
              </div>
              <button className="btn sm ghost block" onClick={() => setAskType(false)}>Înapoi</button>
            </>
          )}
          <p className="xs muted" style={{ margin: 0 }}>Un „Da” creează un singur raport pentru tot locul, doar pe acest telefon. Un „Nu” păstrează semnalul ca respins; nu devine raport.</p>
        </div>
      ) : (
        <Banner kind="ok">
          {answered > 0 ? `Mulțumim! Ai răspuns la ${answered} ${answered === 1 ? 'întrebare' : 'întrebări'}.` : rr && rr.counts.raw > 0 ? 'Nimic de confirmat acum.' : 'Telefonul nu a simțit șocuri de semnalat pe această tură.'}
          {deferred > 0 && ` ${deferred} ${deferred === 1 ? 'întrebare amânată rămâne' : 'întrebări amânate rămân'} pe pagina turei.`}
        </Banner>
      )}
      {all.length > MAX_PROMPTS && <p className="xs muted">Îți arătăm doar cele mai clare {MAX_PROMPTS} locuri. Restul sunt în ShockGrid Lab (pagina turei → ShockGrid Lab).</p>}
      <div className="grid2">
        <a className="btn primary" href={`#/ride/${id}`}><Check /> Gata</a>
        <a className="btn" href={`#/map/${id}`}><MapIcon /> Pe hartă</a>
      </div>
    </div></main>
  );
}

function ZoneMap({ z }: { z: RoughZone }) {
  const { ref, map } = useLeaflet({ zoom: 18, center: [z.lat, z.lon] });
  useLayerGroup(map, (g) => {
    map!.setView([z.lat, z.lon], 18, { animate: false });
    L.circle([z.lat, z.lon], { radius: Math.max(6, z.radius_m), color: '#e8590c', weight: 2, fillColor: '#e8590c', fillOpacity: 0.25, interactive: false }).addTo(g);
  }, [z.id]);
  return <div ref={ref} className="map inline" style={{ height: 170 }} role="img" aria-label={`Locul aproximativ, ±${Math.round(z.radius_m)} m`} />;
}
