// Leaflet direct, printr-un hook propriu (fără react-leaflet, care are licența Hippocratic).
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useEffect, useRef, useState } from 'react';
import { TIMISOARA_CENTER } from '../../core/geo';

// Leaflet 1.9: o redesenare a canvasului programată (requestAnimationFrame) poate rula după ce harta a fost
// eliminată la schimbarea ecranului, când contextul canvasului nu mai există → „clearRect of undefined”.
// O redesenare fără context nu are ce desena: o ignorăm.
type CanvasInternals = { _ctx?: unknown; _redrawRequest: unknown; _redraw: () => void };
const canvasProto = L.Canvas.prototype as unknown as CanvasInternals;
const origRedraw = canvasProto._redraw;
canvasProto._redraw = function (this: CanvasInternals) { if (!this._ctx) { this._redrawRequest = null; return; } origRedraw.call(this); };

export function useLeaflet(opts: { zoom?: number; center?: [number, number]; onClick?: (lat: number, lon: number) => void; onDrag?: () => void; interactive?: boolean } = {}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [map, setMap] = useState<L.Map | null>(null);
  const clickRef = useRef(opts.onClick);
  clickRef.current = opts.onClick;
  const dragRef = useRef(opts.onDrag);
  dragRef.current = opts.onDrag;
  useEffect(() => {
    if (!ref.current) return;
    const interactive = opts.interactive !== false;
    const m = L.map(ref.current, {
      preferCanvas: true, zoomControl: false, attributionControl: false, tapTolerance: 20,
      dragging: interactive, scrollWheelZoom: interactive, touchZoom: interactive, doubleClickZoom: interactive, boxZoom: false, keyboard: interactive,
    }).setView(opts.center ?? TIMISOARA_CENTER, opts.zoom ?? 13);
    L.control.attribution({ position: 'bottomleft', prefix: false }).addTo(m);
    if (interactive && window.innerWidth >= 900) L.control.zoom({ position: 'bottomright' }).addTo(m);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(m);
    m.on('click', (e: L.LeafletMouseEvent) => clickRef.current?.(e.latlng.lat, e.latlng.lng));
    m.on('dragstart', () => dragRef.current?.());
    setMap(m);
    if (import.meta.env.DEV) (window as unknown as { __map?: L.Map }).__map = m; // doar pentru testare locală
    const ro = new ResizeObserver(() => m.invalidateSize());
    ro.observe(ref.current);
    return () => { ro.disconnect(); m.stop(); m.remove(); setMap(null); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return { ref, map };
}

/** o hartă eliminată (de ex. la reîncărcarea modulelor) nu mai are panouri: nu mai adăugăm nimic pe ea */
export const alive = (map: L.Map | null): map is L.Map => !!map && !!map.getPane('overlayPane');

/** un LayerGroup care se reconstruiește când se schimbă dependențele */
export function useLayerGroup(map: L.Map | null, build: (g: L.LayerGroup) => void, deps: unknown[]) {
  useEffect(() => {
    if (!alive(map)) return;
    const g = L.layerGroup().addTo(map);
    build(g);
    // harta poate fi deja eliminată (efectul ei se curăță primul): o eliminare pe o hartă moartă ar programa
    // o redesenare a canvasului fără context („clearRect of undefined”)
    return () => { if (alive(map)) g.remove(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, ...deps]);
}

export { L };
