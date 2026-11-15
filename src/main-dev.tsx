// Intrarea ShockGrid Dev (vite --mode devapp → dist-dev/, publicat la /ShockGridDev/).
// Aceeași stare, același nucleu și același worker de procesare ca aplicația pentru bicicliști; altă bază IndexedDB.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { DevApp } from './dev/DevApp';
import * as store from './state/store';
import { initUpdates } from './services/update';
import { rideActive } from './services/ride';
import { warmWorker } from './worker/client';
import '@fontsource-variable/inter';
import './ui/styles.css';
import './dev/dev.css';

if (import.meta.env.DEV) (window as unknown as { __sg: typeof store }).__sg = store;
warmWorker();
initUpdates(() => rideActive() || location.hash.startsWith('#/report') || location.hash.startsWith('#/import'));
store.init().catch((e) => console.error('init', e));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DevApp />
  </StrictMode>,
);
