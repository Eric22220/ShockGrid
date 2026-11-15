// ShockGrid — aplicația pentru bicicliști (https://eric22220.github.io/ShockGrid/).
// Un singur ecran centrat pe hartă: „Unde mergi?”, locația, traseul, „Raportează”, Informații. Fără bare de
// meniu, fără ture, fără setări tehnice. Tot ce e tehnic e în ShockGrid Dev (src/dev/), un build separat:
// componentele lui nu sunt importate aici, deci nu ajung în acest bundle (verificat de check-bundles și teste).
import { useApp } from '../state/store';
import { subscribeUpdate, updatePending } from '../services/update';
import { useSyncExternalStore } from 'react';
import { CitizenMap } from './citizen/CitizenMap';
import { PlaceReport } from './citizen/PlaceReport';
import { ErrorBoundary } from './ErrorBoundary';
import { Toaster } from './kit';
import { parseHash, useHash } from './nav';
import { RouteScreen } from './pages/RouteScreen';

export { go } from './nav';

export function App() {
  const { pathname, base, params } = parseHash(useHash());
  const mapStyle = useApp((s) => s.settings.mapStyle);
  const updateReady = useSyncExternalStore(subscribeUpdate, updatePending);
  let page: JSX.Element;
  switch (base) {
    case 'route': page = <RouteScreen focus={params.get('focus')} />; break;
    case 'report': page = <PlaceReport type={params.get('type')} why={params.get('why')} />; break;
    default: page = <CitizenMap />; // inclusiv linkurile vechi (#/more, #/rides…): duc la hartă
  }
  return (
    <div className={`app citizen tiles-${mapStyle}`}>
      <ErrorBoundary resetKey={pathname}>{page}</ErrorBoundary>
      {updateReady && <button className="update-pill" onClick={() => location.reload()}>Versiune nouă · Reîncarcă</button>}
      <Toaster />
    </div>
  );
}
