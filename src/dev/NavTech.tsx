// ShockGrid Dev: navigare cu măsurare (aceeași înregistrare ca „Înregistrare live”), starea senzorilor în mers,
// întrebările după tură. Aplicația pentru bicicliști nu are nimic din acestea.
import { useSyncExternalStore } from 'react';
import { monitorHealth } from '../capture/health';
import { requestMotionPermission } from '../capture/recorder';
import { markRide, rideActive, rideStats, startRide, stopRide, subscribeRide } from '../services/ride';
import { updateSettings, getState, useApp } from '../state/store';
import type { ReportHooks } from '../ui/components/QuickReport';
import { toast } from '../ui/kit';
import { go } from '../ui/nav';
import type { NavTech } from '../ui/pages/RouteScreen';

/** reperul în tura în curs + linkul de editare completă a raportului */
export const DEV_REPORT_HOOKS: ReportHooks = {
  onSaved: (r) => { if (rideActive()) markRide(`raport ${r.type}`); },
  detailsHref: (id) => `/report/${id}`,
};

function Status() {
  const recording = useSyncExternalStore(subscribeRide, rideActive);
  const live = useSyncExternalStore(subscribeRide, rideStats);
  if (!recording || !live) return <span className="health" role="status">Fără măsurare</span>;
  const h = monitorHealth(live);
  return <span className={`health ${h.level}`} role="status" title={h.detail ?? undefined}><i aria-hidden="true" /> {h.text}{h.detail ? ` · ${h.detail}` : ''}</span>;
}

function SheetControl() {
  const contribute = useApp((s) => s.settings.contribute);
  return <label className="switch" style={{ marginTop: 4 }}><input type="checkbox" checked={contribute} onChange={(e) => void updateSettings({ contribute: e.target.checked })} /><span className="small">Măsoară vibrațiile în timpul navigării</span></label>;
}

export const NAV_TECH: NavTech = {
  onStart: (destName) => {
    if (!getState().settings.contribute || rideActive()) return;
    const perm = requestMotionPermission(); // iOS: prima instrucțiune din handlerul click-ului
    perm.then(async (p) => {
      if (p !== 'granted') toast(p === 'unsupported' ? 'Browserul nu oferă senzori de mișcare: se salvează doar traseul.' : 'Fără acces la senzorii de mișcare: se salvează doar traseul.');
      await startRide({ label: `Spre ${destName}`, device: '', bike: '', mount: '', navigation: true });
    }).catch((e) => toast((e as Error).message));
  },
  isActive: rideActive,
  onStop: async (progress) => {
    const r = await stopRide((stage) => progress(stage));
    if (r.rideId) go(`/after/${r.rideId}`);
    else if (r.empty) toast('Nu s-a măsurat nimic pe drum (senzori sau GPS indisponibili).');
    else toast(`Tura e păstrată, dar analiza a eșuat: ${r.error ?? 'eroare necunoscută'}`);
  },
  Status,
  SheetControl,
  reportHooks: DEV_REPORT_HOOKS,
};
