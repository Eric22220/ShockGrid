// Pagina SIMULARE (Instrumente avansate): demonstrează regulile motorului de rutare pe un strat inventat.
import { useMemo, useState } from 'react';
import { routeEvidence } from '../../core/routeplan';
import { simulate, type SimScenario } from '../../core/simulate';
import { snapNode, useApp } from '../../state/store';
import { fmtLen } from '../format';
import { Header } from '../kit';
import { pinIcon, routeLatLngs } from '../map/draw';
import { L, useLayerGroup, useLeaflet } from '../map/useLeaflet';

/** perechea demo: Bd. Vasile Pârvan (UVT) → Piața Victoriei; doar străzi publice, niciun punct de plecare al echipei */
const A: [number, number] = [45.7468, 21.2312];
const B: [number, number] = [45.7536, 21.2253];

const SCEN: { k: SimScenario; l: string }[] = [
  { k: 'none', l: 'Fără date' },
  { k: 'short_rough', l: 'Doar ruta scurtă' },
  { k: 'both', l: 'Ambele rute' },
];

export function SimulationPage() {
  const graph = useApp((s) => s.graph);
  const [sc, setSc] = useState<SimScenario>('both');
  const sim = useMemo(() => {
    if (!graph) return null;
    const a = snapNode(A[0], A[1]), b = snapNode(B[0], B[1]);
    return a >= 0 && b >= 0 ? simulate(graph, a, b, sc) : null;
  }, [graph, sc]);
  const { ref, map } = useLeaflet({ zoom: 15, center: [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2] });
  useLayerGroup(map, (g) => {
    if (!graph || !sim) return;
    for (const e of sim.rough) L.polyline(graph.geometry(e), { color: '#c92a2a', weight: 7, opacity: 0.85, interactive: false }).addTo(g);
    for (const e of sim.smooth) L.polyline(graph.geometry(e), { color: '#2f9e44', weight: 7, opacity: 0.85, interactive: false }).addTo(g);
    sim.plan.options.forEach((o, i) => {
      const ll = routeLatLngs(graph, o.r.edges);
      L.polyline(ll, { color: i === 0 ? '#1857f5' : '#111827', weight: 3, opacity: 0.95, dashArray: i === 0 ? undefined : '6 6', interactive: false }).addTo(g);
    });
    L.marker(A, { icon: pinIcon('A', '#1857f5'), interactive: false }).addTo(g);
    L.marker(B, { icon: pinIcon('B', '#111827'), interactive: false }).addTo(g);
    const all = sim.plan.options.flatMap((o) => routeLatLngs(graph, o.r.edges));
    if (all.length) map!.fitBounds(L.latLngBounds(all), { padding: [24, 24], animate: false });
  }, [graph, sim]);
  const best = sim?.plan.verdict.kind === 'better' ? sim.plan.verdict.best : null;
  return (
    <main className="screen"><div className="wrap stack">
      <Header title="SIMULARE rutare" back="#/more/advanced" />
      <div className="card tint-danger" role="note"><b>SIMULARE — date inventate, nu măsurători.</b> Străzile sunt reale, dar „denivelat” (roșu) și „neted” (verde) sunt puse de noi, ca să arătăm cum decide motorul. Nimic de aici nu se salvează, nu intră pe hartă și nu e o îmbunătățire reală.</div>
      <div className="seg" role="group" aria-label="Scenariul simulat">
        {SCEN.map((s) => <button key={s.k} aria-pressed={sc === s.k} onClick={() => setSc(s.k)}>{s.l}</button>)}
      </div>
      <div ref={ref} className="map inline tall" role="img" aria-label="Harta simulării: ruta cea mai scurtă și alternativa" />
      {!graph ? <p className="small">Se încarcă străzile…</p> : !sim ? <p className="small">Nu am găsit ruta demo.</p> : (
        <>
          <div className="card">
            <span className="badge danger">SIMULARE</span>
            <h3 style={{ margin: '6px 0' }}>Ce ar spune aplicația</h3>
            <p className="small" style={{ margin: 0 }}>{sim.plan.verdict.text}</p>
          </div>
          {sim.plan.options.map((o, i) => {
            const ev = routeEvidence(o, o.key === best);
            return (
              <div key={o.key} className="card flat">
                <div className="row nowrap" style={{ justifyContent: 'space-between' }}>
                  <b>{i === 0 ? 'Cea mai scurtă' : 'Alternativă'} · {fmtLen(o.s.length)}</b>
                  <span className={`badge ${ev.tone === 'comfort' ? 'comfort' : ev.tone === 'warn' ? 'warn' : ''}`}>{ev.text}</span>
                </div>
                <div className="small muted">{i > 0 ? `+${Math.round(o.s.length - sim.plan.options[0].s.length)} m · ` : ''}D–E: {Math.round(o.knownByClass.D + o.knownByClass.E)} m · A–B: {Math.round(o.knownByClass.A + o.knownByClass.B)} m</div>
              </div>
            );
          })}
          <p className="xs muted">Reguli verificate prin teste automate: fără ≥ 50% măsurat pe ambele rute (și pe porțiunea prin care diferă) nu recomandăm nimic; o alternativă e „cu mai puține vibrații” doar cu ≥ 10 m mai puțin D–E sau ≥ 10 puncte procentuale mai mult A–B.</p>
        </>
      )}
    </div></main>
  );
}
