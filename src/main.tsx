// Intrarea aplicației pentru bicicliști (/ShockGrid/). Partea tehnică are altă intrare: src/main-dev.tsx.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import * as store from './state/store';
import { initUpdates } from './services/update';
import '@fontsource-variable/inter';
import './ui/styles.css';

// doar în dezvoltare: acces la store din consolă pentru testele manuale
if (import.meta.env.DEV) (window as unknown as { __sg: typeof store }).__sg = store;
// o versiune nouă se aplică imediat, dar nu cât timp utilizatorul alege locul unui raport
initUpdates(() => location.hash.startsWith('#/report'));
store.init().catch((e) => console.error('init', e));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
