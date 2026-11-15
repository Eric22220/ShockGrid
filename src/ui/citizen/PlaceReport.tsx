// Corectarea locului când GPS-ul nu e destul de bun: harta cu un ac în centru, tipul problemei, Salvează.
// Nu atribuim o precizie GPS unui loc ales de mână.
import { Check, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { TIMISOARA_CENTER } from '../../core/geo';
import { QUICK_TYPES } from '../../services/hazard';
import { createReport } from '../../services/reports';
import { nearestStreetName } from '../../services/geocode';
import type { ReportType } from '../../storage/idb';
import { saveReport, useApp } from '../../state/store';
import { savedToast } from '../components/QuickReport';
import { HazardIcon } from '../components/HazardIcons';
import { useLocation } from '../map/me';
import { useLeaflet } from '../map/useLeaflet';
import { go } from '../nav';

const WHY: Record<string, string> = {
  inaccurate: 'GPS-ul e imprecis acum.',
  stale: 'Nu avem o poziție GPS recentă.',
  none: 'Nu avem încă poziția GPS.',
  denied: 'Nu avem acces la locație.',
};

export function PlaceReport({ type, why }: { type?: string | null; why?: string | null }) {
  const graph = useApp((s) => s.graph);
  const loc = useLocation(true);
  const [t, setT] = useState<ReportType>(QUICK_TYPES.some((q) => q.id === type) ? (type as ReportType) : 'groapa');
  const start: [number, number] = loc.fix ? [loc.fix.lat, loc.fix.lon] : TIMISOARA_CENTER;
  const { ref, map } = useLeaflet({ zoom: loc.fix ? 18 : 14, center: start });
  const [point, setPoint] = useState<[number, number]>(start);
  const [moved, setMoved] = useState(false);
  // primul fix (chiar imprecis) centrează harta, cât timp utilizatorul n-a mutat-o
  useEffect(() => { if (loc.fix && map && !moved) { map.setView([loc.fix.lat, loc.fix.lon], 18, { animate: false }); setPoint([loc.fix.lat, loc.fix.lon]); } }, [loc.fix?.lat, loc.fix?.lon, map]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!map) return;
    const upd = () => { const c = map.getCenter(); setPoint([c.lat, c.lng]); };
    const drag = () => setMoved(true);
    map.on('moveend', upd);
    map.on('dragstart zoomstart', drag);
    return () => { map.off('moveend', upd); map.off('dragstart zoomstart', drag); };
  }, [map]);
  const street = useMemo(() => (graph ? nearestStreetName(graph, point[0], point[1]) : null), [graph, point]);
  const save = async () => {
    const r = createReport({ lat: point[0], lon: point[1], acc: null, type: t, source: 'manual' });
    await saveReport(r);
    savedToast(r);
    go('/');
  };
  return (
    <main className="screen-map place" aria-label="Alege locul problemei">
      <div ref={ref} className="map" role="application" aria-label="Mută harta până când acul e pe problemă" />
      <div className="pick-center" aria-hidden="true"><div className="pin" style={{ background: 'var(--danger)' }}><span>!</span></div></div>
      <div className="map-top">
        <div className="place-hint"><b>Unde e problema?</b><span>{why && WHY[why] ? `${WHY[why]} ` : ''}Mută harta până când acul e pe loc.</span></div>
        <button className="icon-btn" onClick={() => go('/')} aria-label="Renunță"><X /></button>
      </div>
      <div className="live-panel">
        <div className="hazard3 compact" role="radiogroup" aria-label="Tipul problemei">
          {QUICK_TYPES.map((q) => (
            <button key={q.id} role="radio" aria-checked={t === q.id} aria-pressed={t === q.id} onClick={() => setT(q.id)}>
              <span className="hz-ic"><HazardIcon type={q.id} size={26} /></span>
              <span className="hz-l">{q.label}</span>
            </button>
          ))}
        </div>
        <p className="small muted" style={{ margin: '10px 2px' }}>{street ?? 'Punctul ales'} · se salvează doar pe acest telefon</p>
        <button className="btn primary block lg" onClick={() => void save()}><Check /> Salvează aici</button>
      </div>
    </main>
  );
}
