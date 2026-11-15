// ShockGrid Dev — platforma tehnică (https://eric22220.github.io/ShockGridDev/), build separat (vite --mode devapp).
// Refolosește paginile de analiză existente și același nucleu (src/core) ca aplicația pentru bicicliști.
import { Activity, BookOpen, Bike, Database, Download, ExternalLink, FlaskConical, LayoutDashboard, Map as MapIcon, Navigation, Route, ShieldCheck, SlidersHorizontal, Upload } from 'lucide-react';
import { useApp } from '../state/store';
import { ErrorBoundary } from '../ui/ErrorBoundary';
import { Header, Toaster } from '../ui/kit';
import { parseHash, useHash } from '../ui/nav';
import { AdvancedPage } from '../ui/pages/AdvancedPage';
import { AfterRide } from '../ui/pages/AfterRide';
import { ComparePage } from '../ui/pages/ComparePage';
import { DataPage } from '../ui/pages/DataPage';
import { EventsPage } from '../ui/pages/EventsPage';
import { ImportPage } from '../ui/pages/ImportPage';
import { MapScreen } from '../ui/pages/MapScreen';
import { MethodologyPage } from '../ui/pages/MethodologyPage';
import { PrivacyPage } from '../ui/pages/PrivacyPage';
import { RecordScreen } from '../ui/pages/RecordScreen';
import { ReplayPage } from '../ui/pages/ReplayPage';
import { ReportScreen } from '../ui/pages/ReportScreen';
import { ReportsPage } from '../ui/pages/ReportsPage';
import { ReviewScreen } from '../ui/pages/ReviewScreen';
import { RideDetail } from '../ui/pages/RideDetail';
import { RidesPage } from '../ui/pages/RidesPage';
import { RouteScreen } from '../ui/pages/RouteScreen';
import { StreetPage } from '../ui/pages/StreetPage';
import { Dashboard } from './Dashboard';
import { MAP_TECH } from './MapTech';
import { PublishPage } from './PublishPage';

const NAV: { href: string; label: string; Icon: typeof MapIcon; match: (b: string, a?: string, a2?: string) => boolean; group?: string }[] = [
  { href: '#/', label: 'Panou', Icon: LayoutDashboard, match: (b) => b === '' },
  { href: '#/import', label: 'Import ZIP', Icon: Upload, match: (b) => b === 'import', group: 'Date' },
  { href: '#/rides', label: 'Ture și analiză', Icon: Bike, match: (b) => ['rides', 'ride', 'review', 'after', 'compare', 'record'].includes(b) },
  { href: '#/map', label: 'Hartă tehnică', Icon: MapIcon, match: (b) => b === 'map' },
  { href: '#/route', label: 'Rutare', Icon: Navigation, match: (b) => b === 'route' },
  { href: '#/more/advanced/diag', label: 'Diagnostic senzori', Icon: Activity, match: (b, a, a2) => a === 'advanced' && a2 === 'diag', group: 'Algoritm' },
  { href: '#/more/advanced/settings', label: 'Parametri', Icon: SlidersHorizontal, match: (b, a, a2) => a === 'advanced' && a2 === 'settings' },
  { href: '#/more/advanced/validation', label: 'Validare', Icon: FlaskConical, match: (b, a, a2) => a === 'advanced' && a2 === 'validation' },
  { href: '#/more/advanced/sim', label: 'SIMULARE rutare', Icon: Route, match: (b, a, a2) => a === 'advanced' && a2 === 'sim' },
  { href: '#/more/method', label: 'Metodologie', Icon: BookOpen, match: (b, a) => a === 'method' },
  { href: '#/publish', label: 'Strat public + audit', Icon: ShieldCheck, match: (b) => b === 'publish', group: 'Publicare' },
  { href: '#/more/advanced/exports', label: 'Exporturi GeoJSON', Icon: Download, match: (b, a, a2) => a === 'advanced' && a2 === 'exports' },
  { href: '#/more/data', label: 'Date și surse', Icon: Database, match: (b, a) => a === 'data' },
];

export function DevApp() {
  const { pathname, base, arg, arg2, params } = parseHash(useHash());
  const mapStyle = useApp((s) => s.settings.mapStyle);
  let page: JSX.Element;
  switch (base) {
    case '': page = <Dashboard />; break;
    case 'map': page = <MapScreen focus={arg} tech={MAP_TECH} />; break;
    case 'route': page = <RouteScreen focus={params.get('focus')} />; break;
    case 'rides': page = <RidesPage dev />; break;
    case 'import': page = <ImportPage />; break;
    case 'record': page = <RecordScreen />; break;
    case 'ride': page = arg2 === 'street' ? <StreetPage id={arg} name={params.get('name')} /> : arg2 === 'events' ? <EventsPage id={arg} /> : arg2 === 'replay' ? <main className="screen"><div className="wrap"><Header title="Accelerație, giroscop, RVI" back={`#/ride/${arg}`} /><ReplayPage id={arg} /></div></main> : <RideDetail id={arg} />; break;
    case 'review': page = <ReviewScreen id={arg} shock={params.get('shock')} />; break;
    case 'after': page = <AfterRide id={arg} />; break;
    case 'compare': page = <main className="screen"><div className="wrap"><Header title="Compară ture" back="#/rides" /><ComparePage /></div></main>; break;
    case 'report': page = <ReportScreen id={arg} lat={Number(params.get('lat'))} lon={Number(params.get('lon'))} type={params.get('type')} why={params.get('why')} />; break;
    case 'reports': page = <ReportsPage />; break;
    case 'publish': page = <PublishPage />; break;
    case 'more':
      page = arg === 'method' ? <MethodologyPage /> : arg === 'data' ? <DataPage /> : arg === 'privacy' ? <PrivacyPage /> : arg === 'advanced' ? <AdvancedPage sub={arg2} /> : <Dashboard />;
      break;
    default: page = <Dashboard />;
  }
  let group: string | undefined;
  return (
    <div className={`app dev tiles-${mapStyle}`}>
      <aside className="devnav" aria-label="Navigare ShockGrid Dev">
        <a className="devbrand" href="#/"><b>ShockGrid</b> <span>Dev</span></a>
        <nav>
          {NAV.map(({ href, label, Icon, match, group: g }) => {
            const head = g && g !== group ? (group = g) : null;
            return (
              <span key={href} style={{ display: 'contents' }}>
                {head && <div className="devnav-group">{head}</div>}
                <a href={href} aria-current={match(base, arg, arg2) ? 'page' : undefined}><Icon aria-hidden="true" /><span>{label}</span></a>
              </span>
            );
          })}
          <a href="/ShockGrid/" target="_blank" rel="noopener" className="devnav-out"><ExternalLink aria-hidden="true" /><span>Aplicația pentru bicicliști</span></a>
        </nav>
        <p className="devnav-note">Platformă tehnică publică · datele importate rămân în acest browser</p>
      </aside>
      <div className="devmain"><ErrorBoundary resetKey={pathname}>{page}</ErrorBoundary></div>
      <Toaster />
    </div>
  );
}

// pentru teste: lista de pagini din meniul Dev
export const DEV_NAV_LABELS = NAV.map((n) => n.label);
