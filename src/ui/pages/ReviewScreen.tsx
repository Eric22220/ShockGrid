// Verificarea după tură, pe ZONE: evenimentele brute sunt triate și grupate; utilizatorul verifică doar zonele
// cu prioritate, nu fiecare vârf de accelerometru. Toate evenimentele brute rămân în diagnostic (#/ride/<id>/events).
import { ChevronDown, ChevronUp, HelpCircle, ListFilter, ThumbsDown, ThumbsUp } from 'lucide-react';
import { useMemo, useState } from 'react';
import { DEFAULT_CONFIG } from '../../core/config';
import { fmtOffset, rideStart } from '../../core/corridor';
import { EVENT_KIND_LABEL, PRIORITY_LABEL, rideRoughness, type RoughZone } from '../../core/roughness';
import { REPORT_TYPES, shockKey, typeLabel, type ShockReview } from '../../services/reports';
import { reviewZone, useApp } from '../../state/store';
import { fmt } from '../format';
import { Header } from '../kit';
import { L, useLayerGroup, useLeaflet } from '../map/useLeaflet';

const PRIO_COLOR = { high: '#c92a2a', medium: '#e8590c', low: '#868e96' } as const;

export function ReviewScreen({ id, shock }: { id?: string; shock?: string | null }) {
  return <ZoneReview key={id} rideId={id ?? ''} focusShock={shock} />;
}

function ZoneReview({ rideId, focusShock }: { rideId: string; focusShock?: string | null }) {
  const ride = useApp((s) => s.rides.find((r) => r.ride_id === rideId));
  const loaded = useApp((s) => s.ready);
  const graph = useApp((s) => s.graph);
  const reviews = useApp((s) => s.reviews);
  const rr = useMemo(() => (ride ? rideRoughness(ride.processed, DEFAULT_CONFIG, graph) : null), [ride, graph]);
  const focusZone = rr && focusShock ? rr.events.find((e) => e.shock.id === focusShock)?.zone ?? -1 : -1;
  const [sel, setSel] = useState<number>(focusZone >= 0 ? focusZone : 0);
  const { ref, map } = useLeaflet({ zoom: 15 });
  useLayerGroup(map, (g) => {
    if (!ride || !rr) return;
    L.polyline(ride.processed.track.map(([a, b]) => [a, b] as [number, number]), { color: '#5a6677', weight: 2, opacity: 0.6, dashArray: '4 6', interactive: false }).addTo(g);
    rr.zones.forEach((z, i) => {
      const c = PRIO_COLOR[z.priority];
      L.circle([z.lat, z.lon], { radius: z.radius_m, color: c, weight: i === sel ? 3 : 1.5, fillColor: c, fillOpacity: i === sel ? 0.25 : 0.12, interactive: false }).addTo(g);
      L.circleMarker([z.lat, z.lon], { radius: i === sel ? 8 : 5, color: '#fff', weight: 1.5, fillColor: c, fillOpacity: 1 }).bindTooltip(`${i + 1}. ${z.street ?? 'zonă'}`).on('click', () => setSel(i)).addTo(g);
    });
    const z = rr.zones[sel];
    if (z) map!.setView([z.lat, z.lon], 18, { animate: false });
    else if (rr.zones.length) map!.fitBounds(L.latLngBounds(rr.zones.map((x) => [x.lat, x.lon] as [number, number])), { padding: [24, 24], animate: false });
  }, [ride, rr, sel]);

  if (!ride || !rr) return <main className="screen"><div className="wrap"><Header title="Verificare" back="#/rides" /><p>{loaded ? 'Tura nu există pe acest telefon.' : 'Se încarcă…'}</p></div></main>;
  const c = rr.counts;
  const t0 = rideStart(ride.processed);
  const review = rr.zones.map((z, i) => ({ z, i })).filter(({ z }) => z.priority !== 'low');
  const low = rr.zones.map((z, i) => ({ z, i })).filter(({ z }) => z.priority === 'low');
  const done = review.filter(({ z }) => reviews[shockKey(rideId, z.strongest.id)]).length;
  return (
    <main className="screen"><div className="wrap stack">
      <Header title="Zone de verificat" back={`#/ride/${rideId}`} />
      <div className="card tint-warn">
        <h2 style={{ marginTop: 0 }}>{c.zones ? `Am identificat ${c.zones} ${c.zones === 1 ? 'zonă' : 'zone'} cu șocuri grupate.` : 'Nicio zonă cu șocuri grupate.'}</h2>
        <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
          <li><b>{c.review} {c.review === 1 ? 'zonă necesită' : 'zone necesită'} verificare</b>{c.high ? ` (${c.high} cu prioritate mare: șocuri în treceri separate sau un șoc puternic credibil)` : ''}{done ? ` · ${done} verificate` : ''}.</li>
          {low.length > 0 && <li>{low.length} {low.length === 1 ? 'zonă slabă' : 'zone slabe'} de urmărit (doar șocuri slabe, o trecere).</li>}
          <li>{c.in_zones} din {c.raw} evenimente brute au fost grupate în zone.</li>
          {c.handling > 0 && <li>{c.handling} {c.handling === 1 ? 'eveniment tratat' : 'evenimente tratate'} ca manevrarea telefonului (rotație mare sau orientare schimbată).</li>}
          {c.isolated > 0 && <li>{c.isolated} {c.isolated === 1 ? 'eveniment slab izolat rămâne' : 'evenimente slabe izolate rămân'} neverificate, în diagnostic.</li>}
          {c.stationary + c.unlocated > 0 && <li>{c.stationary + c.unlocated} fără poziție sau cu bicicleta oprită.</li>}
        </ul>
        <p className="xs muted" style={{ margin: '8px 0 0' }}>Un șoc nu e automat o groapă. Zonele sunt aproximative (±GPS). Nimic nu se publică automat.</p>
      </div>
      {c.zones > 0 && <div ref={ref} className="map inline tall" role="img" aria-label="Harta zonelor cu șocuri grupate; cercul arată întinderea și incertitudinea GPS" />}
      {c.zones > 0 && (
        <div className="xs" style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 12px' }}>
          {(['high', 'medium', 'low'] as const).map((k) => <span key={k}><i style={{ display: 'inline-block', width: 9, height: 9, borderRadius: 5, background: PRIO_COLOR[k], marginRight: 4 }} />{PRIORITY_LABEL[k]}</span>)}
        </div>
      )}
      {review.map(({ z, i }) => <ZoneCard key={z.id} z={z} n={i + 1} t0={t0} rideId={rideId} rev={reviews[shockKey(rideId, z.strongest.id)]} open={i === sel} onOpen={() => setSel(i)} />)}
      {low.length > 0 && (
        <details className="card">
          <summary>De urmărit, prioritate mică ({low.length})</summary>
          <div className="stack" style={{ marginTop: 8 }}>
            {low.map(({ z, i }) => <ZoneCard key={z.id} z={z} n={i + 1} t0={t0} rideId={rideId} rev={reviews[shockKey(rideId, z.strongest.id)]} open={i === sel} onOpen={() => setSel(i)} />)}
          </div>
        </details>
      )}
      <a className="btn block" href={`#/ride/${rideId}/events`}><ListFilter /> Toate evenimentele brute ({c.raw}) · diagnostic</a>
      <a className="btn block ghost" href={`#/ride/${rideId}`}>Înapoi la tură</a>
    </div></main>
  );
}

function ZoneCard({ z, n, t0, rideId, rev, open, onOpen }: { z: RoughZone; n: number; t0: number; rideId: string; rev?: ShockReview; open: boolean; onOpen: () => void }) {
  const [askType, setAskType] = useState(false);
  const [ev, setEv] = useState(false);
  const zone = { lat: z.lat, lon: z.lon, radius_m: z.radius_m, members: z.events.map((e) => e.shock), strongest: z.strongest };
  const st = rev?.answer === 'yes' ? { t: `Confirmat${rev.type ? ': ' + typeLabel(rev.type) : ''}`, k: 'danger' } : rev?.answer === 'no' ? { t: 'Nu e o problemă', k: '' } : rev?.answer === 'unsure' ? { t: 'Nesigur', k: 'warn' } : { t: 'Neverificat', k: 'warn' };
  const lowAll = z.low_ratio === 1;
  return (
    <div className="card" style={{ borderColor: open ? 'var(--primary)' : undefined }}>
      <button className="row nowrap" style={{ width: '100%', justifyContent: 'space-between', background: 'none', border: 0, padding: 0, textAlign: 'left', cursor: 'pointer', color: 'inherit' }} onClick={onOpen} aria-expanded={open}>
        <div className="grow"><b>{n}. {z.street ?? 'Zonă fără nume de stradă'}</b><div className="xs muted">~{Math.max(5, Math.round(z.extent_m))} m · ±{Math.round(z.radius_m)} m</div></div>
        <span className={`badge ${z.priority === 'high' ? 'danger' : z.priority === 'medium' ? 'warn' : ''}`}>{PRIORITY_LABEL[z.priority]}</span>
      </button>
      <dl className="kv" style={{ marginTop: 8 }}>
        <dt>evenimente</dt><dd>{z.events.length}{z.n_strong ? ` (${z.n_strong} ${z.n_strong === 1 ? 'puternic' : 'puternice'})` : ''} · vârf {fmt(z.peak_max, 1, 'm/s²')}</dd>
        <dt>cel mai puternic</dt><dd>+{fmtOffset((z.strongest.t - t0) / 1000)} · {new Date(z.strongest.t).toLocaleTimeString('ro-RO')}</dd>
        <dt>treceri</dt><dd>{z.passes >= 2 ? `${z.passes} treceri separate` : 'o singură trecere'}</dd>
        <dt>viteză · GPS</dt><dd>~{z.speed_p50 === null ? '?' : Math.round(z.speed_p50 * 3.6)} km/h · ±{fmt(z.acc_p50, 0, 'm')}</dd>
        {z.rough_ratio !== null && <><dt>vibrație continuă</dt><dd>×{fmt(z.rough_ratio, 2)} față de restul turei, la aceeași viteză</dd></>}
        <dt>stare</dt><dd><span className={`badge ${st.k}`}>{st.t}</span></dd>
      </dl>
      <p className="xs muted" style={{ margin: '6px 0' }}>{z.why.join(' · ')}{lowAll ? '. Încredere redusă: confirmă doar ce ai văzut pe teren sau în filmare.' : ''}</p>
      {!askType ? (
        <div className="grid2" style={{ gap: 8 }}>
          <button className="btn sm comfort" onClick={() => setAskType(true)}><ThumbsUp /> Confirmă problema</button>
          <button className="btn sm" onClick={() => void reviewZone(rideId, zone, 'no')}><ThumbsDown /> Nu e o problemă</button>
          <button className="btn sm" onClick={() => void reviewZone(rideId, zone, 'unsure')}><HelpCircle /> Nu sunt sigur</button>
          <button className="btn sm ghost" onClick={() => setEv(!ev)} aria-expanded={ev}>{ev ? <ChevronUp /> : <ChevronDown />} Vezi dovezile</button>
        </div>
      ) : (
        <>
          <div className="choice-grid">
            {REPORT_TYPES.map((x) => <button key={x.id} className="choice" onClick={() => { void reviewZone(rideId, zone, 'yes', x.id); setAskType(false); }}><b>{x.label}</b>{x.hint && <span>{x.hint}</span>}</button>)}
          </div>
          <button className="btn ghost block sm" onClick={() => setAskType(false)}>Înapoi</button>
        </>
      )}
      {ev && (
        <div className="stack" style={{ gap: 4, marginTop: 8 }}>
          {z.events.map((e) => (
            <div key={e.shock.id} className="small" style={{ borderTop: '1px solid var(--border)', paddingTop: 4 }}>
              <b>+{fmtOffset((e.shock.t - t0) / 1000)}</b> · {EVENT_KIND_LABEL[e.kind]} · vârf {fmt(e.shock.peak, 1)} · ~{e.shock.speed === null ? '?' : Math.round(e.shock.speed * 3.6)} km/h
              {e.low.length > 0 && <span className="xs muted"> · {e.low.join(', ')}</span>}
            </div>
          ))}
          <a className="btn sm block" href={`#/ride/${rideId}/street${z.street && !z.street.startsWith('lângă') ? `?name=${encodeURIComponent(z.street)}` : ''}`}>Analiză pe stradă (vibrație continuă, intervale din filmare)</a>
        </div>
      )}
    </div>
  );
}

