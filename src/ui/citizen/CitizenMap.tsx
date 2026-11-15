// Ecranul principal pentru bicicliști: harta reală pe tot ecranul, „Unde mergi?”, locația, straturi, informații,
// „Raportează”. Fără date tehnice: detaliile (RVI, GPS, ferestre) sunt doar în ShockGrid Dev.
import { History, Info, Layers, Locate, LocateFixed, LocateOff, Search, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { roughOf, type EdgeAgg, type ShockZone } from '../../core/aggregate';
import type { Graph } from '../../core/graph';
import { typeLabel } from '../../services/reports';
import type { LocalReport } from '../../storage/idb';
import { removeReport, updateSettings, useApp } from '../../state/store';
import { ReportButton } from '../components/QuickReport';
import { HazardIcon } from '../components/HazardIcons';
import { Sheet, toast } from '../kit';
import { drawComfort, drawHazards, drawReports, drawZones, EXPLORE_COLOR, HAZARD_STYLE, ROUGH_STYLE } from '../map/draw';
import { useLocation, useMeLayer } from '../map/me';
import { alive, useLayerGroup, useLeaflet } from '../map/useLeaflet';
import { go } from '../nav';
import { InfoSheet } from './InfoSheet';
import { RecentRoutes } from './RecentRoutes';
import { CITIZEN_ROUGH, HAZARD_TEXT, NO_DATA_TEXT, UNRATED_TEXT } from './labels';
import { isActive, type Hazard } from '../../core/hazards';
import type L from 'leaflet';

type Sel = { edge?: EdgeAgg; zone?: ShockZone; hazard?: Hazard; report?: LocalReport; layers?: true; info?: true; history?: true } | null;

let rememberLoc = false; // „Locația mea” rămâne pornită în aceeași sesiune
let noDataDismissed = false; // mesajul „fără date” apare o singură dată pe sesiune

/** există date afișate în zona vizibilă (culori, traseu parcurs neevaluat sau probleme)? */
function dataInView(graph: Graph, edges: Iterable<EdgeAgg>, hazards: Hazard[], b: L.LatLngBounds): boolean {
  for (const h of hazards) if (isActive(h) && b.contains([h.lat, h.lon])) return true;
  for (const e of edges) {
    if (e.status === 'UNKNOWN' && !e.explore) continue;
    for (const [lat, lon] of graph.geometry(e.edge_id)) if (b.contains([lat, lon])) return true;
  }
  return false;
}

/** `at` = „lat,lon” (linkul „Deschide ShockGrid” din Dev, spre segmentele publicate); `uncertain` = arată și datele incerte în această vizită */
export function CitizenMap({ at, showUncertain }: { at?: string | null; showUncertain?: boolean } = {}) {
  const graph = useApp((s) => s.graph);
  const graphStatus = useApp((s) => s.graphStatus);
  const layer = useApp((s) => s.layer);
  const reports = useApp((s) => s.reports);
  const settings = useApp((s) => s.settings);
  const [sel, setSel] = useState<Sel>(null);
  const [locOn, setLocOnState] = useState(rememberLoc);
  const setLocOn = (v: boolean) => { rememberLoc = v; setLocOnState(v); };
  const [follow, setFollow] = useState(false);
  const [hasData, setHasData] = useState(true);
  const [dismissed, setDismissed] = useState(noDataDismissed);
  const loc = useLocation(locOn);
  const { ref, map } = useLeaflet({ onClick: () => setSel(null), onDrag: () => setFollow(false) });
  useMeLayer(map, loc, follow);
  const uncertain = settings.showUncertain || !!showUncertain;
  useEffect(() => {
    const m = at?.match(/^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/);
    if (alive(map) && m) map.setView([Number(m[1]), Number(m[2])], 17, { animate: false });
  }, [map, at]);

  useLayerGroup(map, (g) => { if (graph) drawComfort(g, graph, layer, (e) => setSel({ edge: e }), { uncertain }); }, [graph, layer, uncertain]);
  useLayerGroup(map, (g) => {
    if (!settings.showZones) return;
    if (graph) drawHazards(g, graph, layer.hazards, (h) => setSel({ hazard: h }));
    // straturile publicate înainte de problemele agregate: zonele vechi de șocuri
    if (!layer.hazards.length) drawZones(g, layer.zones.filter((z) => z.status === 'REPEATED' || z.status === 'CANDIDATE' || (z.confirmed ?? 0) > 0), false, (z) => setSel({ zone: z }));
  }, [graph, layer, settings.showZones]);
  useLayerGroup(map, (g) => { drawReports(g, reports, (r) => setSel({ report: r })); }, [reports]);

  useEffect(() => {
    if (!map || !graph) return;
    // harta poate fi deja eliminată (schimbarea rapidă a ecranului): atunci nu citim nimic din ea
    const check = () => { if (alive(map)) setHasData(dataInView(graph, layer.edges.values(), layer.hazards, map.getBounds())); };
    check();
    map.on('moveend', check);
    return () => { map.off('moveend', check); };
  }, [map, graph, layer]);

  const onLocate = () => {
    if (!locOn) { setLocOn(true); setFollow(true); return; }
    if (follow) { setFollow(false); return; }
    if (loc.fix && map) map.setView([loc.fix.lat, loc.fix.lon], Math.max(map.getZoom(), 16));
    setFollow(true);
  };
  const LocIcon = !locOn ? Locate : loc.status === 'denied' || loc.status === 'unsupported' || loc.status === 'insecure' ? LocateOff : LocateFixed;
  const chip = locOn && loc.message ? <span className="chip" role="status">{loc.message}</span>
    : graphStatus === 'loading' ? <span className="chip" role="status">Se încarcă harta…</span>
      : graphStatus === 'ready' && !hasData && !dismissed && !sel ? (
        <span className="chip" role="status">{NO_DATA_TEXT}<button className="chip-x" onClick={() => { noDataDismissed = true; setDismissed(true); }} aria-label="Ascunde mesajul"><X /></button></span>
      ) : null;

  return (
    <main className="screen-map" aria-label="Harta">
      <div ref={ref} className="map" />
      <div className="map-top">
        <button className="search-pill" onClick={() => go('/route?focus=dest')} aria-label="Unde mergi? Caută o destinație">
          <Search aria-hidden="true" /><span>Unde mergi?</span>
        </button>
        <button className="icon-btn" onClick={() => setSel({ history: true })} aria-label="Rute recente"><History /></button>
        <button className="icon-btn" onClick={() => setSel({ layers: true })} aria-label="Straturi și legendă"><Layers /></button>
      </div>
      <div className="map-side">
        <button className={`icon-btn ${follow && loc.fix ? 'following' : locOn ? 'active' : ''}`} onClick={onLocate} aria-label={!locOn ? 'Arată locația mea' : follow ? 'Oprește urmărirea poziției' : 'Centrează pe locația mea'} aria-pressed={follow}><LocIcon /></button>
        <button className="icon-btn" onClick={() => setSel({ info: true })} aria-label="Informații"><Info /></button>
      </div>
      {chip && <div className="map-chip">{chip}</div>}
      {!sel && <ReportButton />}

      {sel?.layers && (
        <Sheet title="Hartă" onClose={() => setSel(null)}>
          <div className="stack">
            <div>
              {(['green', 'yellow', 'red'] as const).map((k) => (
                <div key={k} className="legend-row"><span className="legend-line" style={{ background: ROUGH_STYLE[k].color, height: ROUGH_STYLE[k].weight }} /><span>{CITIZEN_ROUGH[k]}</span></div>
              ))}
              <div className="legend-row"><span className="legend-line" style={{ background: `repeating-linear-gradient(90deg,${EXPLORE_COLOR} 0 5px,transparent 5px 11px)` }} /><span>{UNRATED_TEXT}</span></div>
              {(['confirmed', 'possible'] as const).map((k) => <div key={k} className="legend-row"><span className="legend-line" style={{ background: HAZARD_STYLE[k].dash ? `repeating-linear-gradient(90deg,${HAZARD_STYLE[k].color} 0 6px,transparent 6px 11px)` : HAZARD_STYLE[k].color, height: 8 }} /><span>{HAZARD_TEXT[k].title}</span></div>)}
              <div className="legend-row"><span className="legend-line" style={{ background: 'var(--surface-3)' }} /><span className="muted">Fără linie: nu avem date</span></div>
            </div>
            <label className="switch"><input type="checkbox" checked={settings.showZones} onChange={(e) => void updateSettings({ showZones: e.target.checked })} />Probleme pe drum</label>
            <label className="switch"><input type="checkbox" checked={uncertain} onChange={(e) => void updateSettings({ showUncertain: e.target.checked })} />Culori și pe datele incerte (puține măsurători)</label>
            <div className="seg" role="group" aria-label="Stilul hărții">
              {([['auto', 'Automat'], ['light', 'Luminoasă'], ['dark', 'Întunecată']] as const).map(([k, l]) => <button key={k} aria-pressed={settings.mapStyle === k} onClick={() => void updateSettings({ mapStyle: k })}>{l}</button>)}
            </div>
          </div>
        </Sheet>
      )}
      {sel?.info && <InfoSheet onClose={() => setSel(null)} />}
      {sel?.history && <RecentRoutes onClose={() => setSel(null)} />}
      {sel?.edge && graph && <EdgeSheet e={sel.edge} name={graph.name[sel.edge.edge_id] || 'Stradă fără nume'} uncertain={uncertain} onClose={() => setSel(null)} />}
      {sel?.hazard && isActive(sel.hazard) && (
        <Sheet title={HAZARD_TEXT[sel.hazard.level].title} onClose={() => setSel(null)}>
          <p className="small" style={{ marginTop: 0 }}>{HAZARD_TEXT[sel.hazard.level].body}{sel.hazard.type ? ` Tip: ${sel.hazard.type === 'groapa' ? 'groapă' : sel.hazard.type === 'obstacol' ? 'obstacol' : 'denivelare / prag'}.` : ''}</p>
          <p className="xs muted" style={{ margin: 0 }}>{sel.hazard.date ? `Detectată ${new Date(sel.hazard.date).toLocaleDateString('ro-RO')}. ` : ''}Traseele pot ocoli locul{sel.hazard.level === 'possible' ? ' (opțiunea „Ocolește și problemele posibile”)' : ''}.</p>
        </Sheet>
      )}
      {sel?.zone && (
        <Sheet title="Șocuri pe drum" onClose={() => setSel(null)}>
          <p className="small" style={{ marginTop: 0 }}>Bicicliștii echipei au simțit aici {sel.zone.members.length === 1 ? 'un șoc' : 'mai multe șocuri'}. Poate fi o groapă, o bordură sau un capac.</p>
        </Sheet>
      )}
      {sel?.report && <ReportSheet r={sel.report} onClose={() => setSel(null)} />}
    </main>
  );
}

function EdgeSheet({ e, name, uncertain, onClose }: { e: EdgeAgg; name: string; uncertain: boolean; onClose: () => void }) {
  // fără „Date incerte”, tronsoanele incerte apar neutru pe hartă: fișa spune același lucru
  const measured = e.status !== 'UNKNOWN' && !!e.class && (e.status === 'MEASURED' || uncertain);
  const cat = measured ? roughOf(e.class!) : null;
  const lowSegs = (e.segments ?? []).some((s) => s.cat !== 'none' && s.cat !== 'explore' && s.cat !== 'insufficient' && s.cat !== (cat ?? ''));
  return (
    <Sheet title={name} onClose={onClose}>
      <div className="row nowrap">
        {cat && <span aria-hidden="true" style={{ width: 12, height: 28, borderRadius: 4, background: ROUGH_STYLE[cat].color, flex: 'none' }} />}
        <div className="grow">
          <b>{cat ? CITIZEN_ROUGH[cat] : UNRATED_TEXT}</b>
          <div className="small muted">
            {!measured ? 'Echipa a trecut pe aici, dar prea încet sau prea puțin ca să spunem cât de neted e.' : e.status === 'MEASURED' ? 'Măsurat de echipă' : 'Date incerte: puține măsurători'}
            {measured && lowSegs ? ' · diferă pe porțiuni' : ''}
            {e.last_seen ? ` · ${new Date(e.last_seen).toLocaleDateString('ro-RO')}` : ''}
          </div>
        </div>
      </div>
    </Sheet>
  );
}

function ReportSheet({ r, onClose }: { r: LocalReport; onClose: () => void }) {
  return (
    <Sheet title={typeLabel(r.type)} onClose={onClose}>
      <div className="row nowrap">
        <span className="hz-badge"><HazardIcon type={r.type} size={22} /></span>
        <div className="grow small">
          <div>{new Date(r.created_at).toLocaleString('ro-RO', { dateStyle: 'medium', timeStyle: 'short' })}</div>
          <div className="muted">Salvat doar pe acest telefon</div>
        </div>
        <button className="btn sm ghost" onClick={async () => { await removeReport(r.id); toast('Raport șters'); onClose(); }} aria-label="Șterge raportul"><Trash2 /> Șterge</button>
      </div>
    </Sheet>
  );
}
