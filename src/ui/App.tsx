// ShockGrid — aplicația pentru bicicliști (https://eric22220.github.io/ShockGrid/).
// Doar ce folosește un ciclist: hartă, traseu, raportare, ture proprii, confidențialitate. Partea tehnică
// (analiză, diagnostic, parametri, publicare) e un site separat, ShockGrid Dev (src/dev/), cu alt build:
// componentele ei nu sunt importate aici, deci nu ajung în acest bundle.
import { Bike, Map as MapIcon, Menu, Navigation } from 'lucide-react';
import { useSyncExternalStore } from 'react';
import { rideActive, subscribeRide } from '../services/ride';
import { subscribeUpdate, updatePending } from '../services/update';
import { useApp } from '../state/store';
import { ErrorBoundary } from './ErrorBoundary';
import { Toaster } from './kit';
import { parseHash, useHash } from './nav';
import { AfterRide } from './pages/AfterRide';
import { DataPage } from './pages/DataPage';
import { HelpPage } from './pages/HelpPage';
import { MapScreen } from './pages/MapScreen';
import { MorePage } from './pages/MorePage';
import { MyRide } from './pages/MyRide';
import { PrivacyPage } from './pages/PrivacyPage';
import { RecordScreen } from './pages/RecordScreen';
import { ReportScreen } from './pages/ReportScreen';
import { ReportsPage } from './pages/ReportsPage';
import { RidesPage } from './pages/RidesPage';
import { RouteScreen } from './pages/RouteScreen';

export { go } from './nav';

type Tab = 'map' | 'route' | 'rides' | 'more';
const TABS: { id: Tab; href: string; label: string; Icon: typeof MapIcon }[] = [
  { id: 'map', href: '#/', label: 'Hartă', Icon: MapIcon },
  { id: 'route', href: '#/route', label: 'Traseu', Icon: Navigation },
  { id: 'rides', href: '#/rides', label: 'Ture', Icon: Bike },
  { id: 'more', href: '#/more', label: 'Mai mult', Icon: Menu },
];

export function App() {
  const { pathname, base, arg, params } = parseHash(useHash());
  const recording = useSyncExternalStore(subscribeRide, rideActive);
  const mapStyle = useApp((s) => s.settings.mapStyle);
  const updateReady = useSyncExternalStore(subscribeUpdate, updatePending);
  let page: JSX.Element;
  let tab: Tab = 'map';
  let navHidden = false;
  switch (base) {
    case '': case 'map': page = <MapScreen focus={arg} />; break;
    case 'route': tab = 'route'; page = <RouteScreen focus={params.get('focus')} />; break;
    case 'rides': tab = 'rides'; page = <RidesPage />; break;
    case 'record': tab = 'rides'; navHidden = true; page = <RecordScreen />; break;
    case 'ride': tab = 'rides'; page = <MyRide id={arg} />; break;
    case 'after': tab = 'rides'; page = <AfterRide id={arg} />; break;
    case 'report': tab = 'map'; navHidden = true; page = <ReportScreen id={arg} quick={params.get('quick') === '1'} lat={Number(params.get('lat'))} lon={Number(params.get('lon'))} type={params.get('type')} why={params.get('why')} />; break;
    case 'reports': tab = 'more'; page = <ReportsPage />; break;
    case 'more':
      tab = 'more';
      page = arg === 'help' ? <HelpPage /> : arg === 'data' ? <DataPage /> : arg === 'privacy' ? <PrivacyPage /> : <MorePage />;
      break;
    default: page = <MapScreen />;
  }
  return (
    <div className={`app tiles-${mapStyle}`}>
      <ErrorBoundary resetKey={pathname}>{page}</ErrorBoundary>
      {!navHidden && (
        <nav className="nav" aria-label="Navigare principală">
          {TABS.map(({ id, href, label, Icon }) => (
            <a key={id} href={href} aria-current={tab === id ? 'page' : undefined}>
              <Icon aria-hidden="true" />
              <span>{label}</span>
              {id === 'rides' && recording && <i className="dot" aria-label="tură în curs" />}
            </a>
          ))}
        </nav>
      )}
      {updateReady && <button className="update-pill" onClick={() => location.reload()}>Versiune nouă instalată · Reîncarcă</button>}
      <Toaster />
    </div>
  );
}
