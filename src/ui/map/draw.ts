import L from 'leaflet';
import { roughOf, type ComfortLayer, type EdgeAgg, type RoughCat, type ShockZone } from '../../core/aggregate';
import type { Graph } from '../../core/graph';
import type { LocalReport } from '../../storage/idb';

/** culoarea neutră a segmentelor explorate doar la viteză redusă (fără clasă de confort) */
export const EXPLORE_COLOR = '#8a7fb5';
/** Hartă simplă, provizorie: verde = A–B, galben = C, roșu = D–E (relativ la ferestrele echipei). Grosimea crește cu
 * vibrația, ca harta să nu depindă doar de culoare; încrederea redusă = linie întreruptă. */
export const ROUGH_STYLE: Record<RoughCat, { color: string; weight: number }> = {
  green: { color: '#1b7a3a', weight: 4 },
  yellow: { color: '#d99a00', weight: 6 },
  red: { color: '#b3261e', weight: 8 },
};
export const GREY_COLOR = '#8a929b';

/** Segmentele colorate pe tronsoane (când avem poziții pe muchie), altfel pe toată muchia. Nemăsuratul nu se colorează. */
export function drawComfort(g: L.LayerGroup, graph: Graph, layer: ComfortLayer, onClick: ((e: EdgeAgg) => void) | null, opts: { dim?: boolean; explore?: boolean; uncertain?: boolean } = {}) {
  // uncertain === false: doar tronsoanele măsurate sigur (aplicația pentru bicicliști, implicit); restul e sub controlul straturilor
  const sure = opts.uncertain === false;
  const renderer = L.canvas({ tolerance: 10 });
  const op = opts.dim ? 0.55 : 1;
  const click = (pl: L.Polyline, e: EdgeAgg) => { if (onClick) pl.on('click', (ev) => { L.DomEvent.stopPropagation(ev); onClick(e); }); };
  const explore = (ll: [number, number][], e: EdgeAgg) => {
    if (opts.explore === false || sure) return;
    click(L.polyline(ll, { renderer, color: EXPLORE_COLOR, weight: 4, opacity: opts.dim ? 0.5 : 0.9, dashArray: '2 6', lineCap: 'round', interactive: !!onClick }).addTo(g), e);
  };
  const grey = (ll: [number, number][], e: EdgeAgg) => click(L.polyline(ll, { renderer, color: GREY_COLOR, weight: 3, opacity: 0.8 * op, dashArray: '1 6', lineCap: 'round', interactive: !!onClick }).addTo(g), e);
  const rough = (ll: [number, number][], cat: RoughCat, low: boolean, e: EdgeAgg) => {
    const st = ROUGH_STYLE[cat];
    L.polyline(ll, { renderer, color: '#ffffff', weight: st.weight + 3, opacity: 0.7 * op, interactive: false }).addTo(g);
    click(L.polyline(ll, { renderer, color: st.color, weight: st.weight, opacity: op, dashArray: low ? '7 6' : undefined, lineCap: low ? 'butt' : 'round', interactive: !!onClick }).addTo(g), e);
  };
  // întâi explorarea și „date insuficiente”, apoi culorile (deasupra)
  const later: (() => void)[] = [];
  for (const e of layer.edges.values()) {
    const measured = e.status !== 'UNKNOWN' && !!e.class;
    if (!measured && !e.explore) continue;
    if (e.segments) {
      for (const s of e.segments) {
        if (s.cat === 'none') continue;
        const ll = graph.slice(e.edge_id, s.from_m, s.to_m);
        if (s.cat === 'explore') explore(ll, e);
        else if (s.cat === 'insufficient') { if (measured && !sure) grey(ll, e); }
        else if (!(sure && s.status !== 'measured')) later.push(() => rough(ll, s.cat as RoughCat, s.status !== 'measured', e));
      }
      continue;
    }
    const ll = graph.geometry(e.edge_id);
    if (measured) { if (!(sure && e.status === 'LOW_CONFIDENCE')) later.push(() => rough(ll, roughOf(e.class!), e.status === 'LOW_CONFIDENCE', e)); }
    else explore(ll, e);
  }
  later.forEach((f) => f());
}

export function drawZones(g: L.LayerGroup, zones: ShockZone[], showReview: boolean, onClick: ((z: ShockZone) => void) | null) {
  for (const z of zones) {
    if (z.status === 'REJECTED') continue;
    if (z.status === 'NEEDS_REVIEW' && !showReview) continue;
    const strong = z.status === 'REPEATED' || (z.confirmed ?? 0) > 0;
    L.circle([z.lat, z.lon], { radius: z.radius_m, color: '#e8590c', weight: 1, opacity: 0.6, fillOpacity: 0.08, interactive: false }).addTo(g);
    const m = L.circleMarker([z.lat, z.lon], { radius: 9, color: '#ffffff', weight: 2.5, fillColor: '#e8590c', fillOpacity: strong ? 1 : 0.35, dashArray: z.status === 'NEEDS_REVIEW' ? '3 3' : undefined, interactive: !!onClick }).addTo(g);
    m.bindTooltip(strong ? 'Zonă cu șocuri repetate' : 'Posibilă denivelare');
    if (onClick) m.on('click', (ev) => { L.DomEvent.stopPropagation(ev); onClick(z); });
  }
}

const REPORT_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 22V4a1 1 0 0 1 1-1h12l-2 4 2 4H5"/></svg>';

export function drawReports(g: L.LayerGroup, reports: LocalReport[], onClick: ((r: LocalReport) => void) | null) {
  for (const r of reports) {
    const color = r.status === 'draft' ? '#6b7280' : '#c2261b';
    const icon = L.divIcon({ className: '', html: `<div class="rep-marker" style="background:${color}">${REPORT_SVG}</div>`, iconSize: [34, 34], iconAnchor: [17, 17] });
    const m = L.marker([r.lat, r.lon], { icon, keyboard: true, title: 'Raportul tău (local)', zIndexOffset: 500 }).addTo(g);
    if (onClick) m.on('click', (ev) => { L.DomEvent.stopPropagation(ev); onClick(r); });
  }
}

export function drawTrack(g: L.LayerGroup, track: [number, number, number?][], color = '#1857f5', dashed = false, weight = 4) {
  if (track.length < 2) return null;
  return L.polyline(track.map(([a, b]) => [a, b] as [number, number]), { color, weight, opacity: 0.9, dashArray: dashed ? '4 7' : undefined, interactive: false }).addTo(g);
}

export function pinIcon(label: string, color: string) {
  return L.divIcon({ className: '', html: `<div class="pin" style="background:${color}"><span>${label}</span></div>`, iconSize: [30, 30], iconAnchor: [15, 30] });
}

export function routeLatLngs(graph: Graph, edges: { edge: number; forward: boolean }[]): [number, number][] {
  const pts: [number, number][] = [];
  for (const { edge, forward } of edges) {
    const geo = graph.geometry(edge);
    const seq = forward ? geo : [...geo].reverse();
    pts.push(...(pts.length ? seq.slice(1) : seq));
  }
  return pts;
}
