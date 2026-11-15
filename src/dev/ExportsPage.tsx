// Exporturile GeoJSON/JSON pentru instituții (doar în ShockGrid Dev).
import { Download } from 'lucide-react';
import { comfortGeoJSON, comfortRows, zoneRows, zonesGeoJSON } from '../core/export';
import { useApp } from '../state/store';
import { download } from '../ui/format';
import { Banner, Header } from '../ui/kit';

export function ExportsPage() {
  const graph = useApp((s) => s.graph);
  const layer = useApp((s) => s.layer);
  return (
    <main className="screen"><div className="wrap stack">
      <Header title="Exporturi GeoJSON / JSON" back="#/" />
      <p className="small muted">Stratul curent din acest browser: date publicate de echipă + turele locale activate în hartă. Segmente agregate și zone cu șocuri, licență ODbL.</p>
      <Banner kind="warn">Dacă stratul include ture locale, exportul conține măsurători derivate din trasee private. Pentru publicare folosește „Strat public” (cu tăierile de confidențialitate și audit), nu aceste exporturi brute.</Banner>
      <div className="grid2">
        <button className="btn" disabled={!graph} onClick={() => download('comfort-layer.geojson', JSON.stringify(comfortGeoJSON(layer, graph!)), 'application/geo+json')}><Download /> Confort .geojson</button>
        <button className="btn" onClick={() => download('comfort-layer.json', JSON.stringify({ meta: { processing_version: layer.processing_version, thresholds: layer.thresholds, license: 'ODbL-1.0', attribution: '© OpenStreetMap contributors' }, edges: comfortRows(layer) }), 'application/json')}><Download /> Confort .json</button>
        <button className="btn" onClick={() => download('shock-zones.geojson', JSON.stringify(zonesGeoJSON(layer)), 'application/geo+json')}><Download /> Șocuri .geojson</button>
        <button className="btn" onClick={() => download('shock-zones.json', JSON.stringify(zoneRows(layer)), 'application/json')}><Download /> Șocuri .json</button>
      </div>
      <p className="xs muted">Cod: MIT. Date derivate din OpenStreetMap: ODbL 1.0.</p>
    </div></main>
  );
}
