// Două site-uri din același cod: aplicația pentru bicicliști nu ajunge la componentele tehnice; bazele IndexedDB
// sunt separate; copierea turelor existente în Dev e nedistructivă.
import 'fake-indexeddb/auto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CITIZEN_DB_NAME, DB_NAME } from '../src/appkind';
import { copyRides, readRidesFrom } from '../src/storage/migrate';
import type { StoredRide } from '../src/storage/idb';

/** fișierele sursă atinse pornind de la o intrare (doar importuri relative) */
function reachable(entry: string): Set<string> {
  const seen = new Set<string>();
  const st = [resolve(entry)];
  while (st.length) {
    const f = st.pop()!;
    if (seen.has(f)) continue;
    seen.add(f);
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(/(?:import|export)[^'"]*?from\s+['"](\.[^'"]+)['"]|import\s+['"](\.[^'"]+)['"]/g)) {
      const spec = m[1] ?? m[2];
      const base = join(dirname(f), spec);
      const cand = [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts')].find((c) => existsSync(c) && !c.endsWith('.css') && /\.(ts|tsx)$/.test(c));
      if (cand) st.push(resolve(cand));
    }
  }
  return seen;
}
const rel = (s: Set<string>) => [...s].map((f) => f.replace(/\\/g, '/').replace(/^.*\/src\//, 'src/'));
const DEV_ONLY = ['src/dev/', 'src/ui/pages/AdvancedPage', 'src/ui/pages/DiagnosticPage', 'src/ui/pages/SettingsPage', 'src/ui/pages/SimulationPage', 'src/ui/pages/ImportPage', 'src/ui/pages/RideDetail', 'src/ui/pages/ReviewScreen', 'src/ui/pages/EventsPage', 'src/ui/pages/StreetPage', 'src/ui/pages/ReplayPage', 'src/ui/pages/ComparePage', 'src/ui/pages/MethodologyPage', 'src/ui/charts/', 'src/core/publiclayer'];

describe('două aplicații, un singur cod sursă', () => {
  it('aplicația pentru bicicliști nu importă (nici indirect) componente tehnice', () => {
    const cit = rel(reachable('src/main.tsx'));
    const leaked = cit.filter((f) => DEV_ONLY.some((d) => f.startsWith(d)));
    expect(leaked).toEqual([]);
    expect(cit).toContain('src/core/route.ts'); // rutarea reală e prezentă
    expect(cit).toContain('src/ui/components/QuickReport.tsx');
  });
  it('ShockGrid Dev refolosește aceleași module de nucleu (fără copii ale algoritmilor)', () => {
    const dev = rel(reachable('src/main-dev.tsx'));
    for (const f of ['src/core/vibration.ts', 'src/core/mapmatch.ts', 'src/core/aggregate.ts', 'src/core/route.ts', 'src/core/io/sensorlogger.ts', 'src/core/roughness.ts', 'src/core/publiclayer.ts', 'src/dev/PublishPage.tsx']) expect(dev).toContain(f);
    // nicio a doua implementare a nucleului în src/dev
    expect(dev.filter((f) => f.startsWith('src/dev/')).every((f) => /\.(tsx)$/.test(f))).toBe(true);
    const scripts = readFileSync('scripts/build-layer.ts', 'utf8') + readFileSync('scripts/audit-layer.ts', 'utf8');
    expect(scripts).toContain("from '../src/core/publiclayer'");
  });
  it('baze IndexedDB separate (implicit = baza aplicației pentru bicicliști)', () => {
    expect(DB_NAME).toBe('shockgrid'); // în teste/bicicliști; Dev = „shockgrid-dev” (verificat în build de check-bundles)
    expect(CITIZEN_DB_NAME).toBe('shockgrid');
    expect(readFileSync('src/appkind.ts', 'utf8')).toContain("IS_DEV_APP ? 'shockgrid-dev' : 'shockgrid'");
  });
});

function makeDb(name: string, rides: Partial<StoredRide>[]) {
  return new Promise<void>((res, rej) => {
    const r = indexedDB.open(name, 2);
    r.onupgradeneeded = () => { r.result.createObjectStore('rides', { keyPath: 'ride_id' }); r.result.createObjectStore('kv'); };
    r.onsuccess = () => { const tx = r.result.transaction('rides', 'readwrite'); for (const x of rides) tx.objectStore('rides').put(x); tx.oncomplete = () => { r.result.close(); res(); }; };
    r.onerror = () => rej(r.error);
  });
}
const dbNames = async () => (await indexedDB.databases()).map((d) => d.name);

describe('copierea turelor existente în Dev (nedistructivă)', () => {
  it('o bază inexistentă nu e creată', async () => {
    expect(await readRidesFrom('nu-exista')).toBeNull();
    expect(await dbNames()).not.toContain('nu-exista');
    expect(await copyRides(null, async () => false, async () => {})).toEqual({ found: 0, copied: 0, skipped: 0, missing: true });
  });
  it('citește turele fără a le modifica și copiază doar ce lipsește', async () => {
    await makeDb('src-cit', [{ ride_id: 'a', file_name: 'a.zip' }, { ride_id: 'b', file_name: 'b.zip' }]);
    const got = await readRidesFrom('src-cit');
    expect(got!.map((r) => r.ride_id).sort()).toEqual(['a', 'b']);
    const dest = new Map<string, StoredRide>([['a', { ride_id: 'a', file_name: 'deja' } as StoredRide]]);
    const res = await copyRides(got, async (id) => dest.has(id), async (r) => { dest.set(r.ride_id, r); });
    expect(res).toEqual({ found: 2, copied: 1, skipped: 1, missing: false });
    expect(dest.get('a')!.file_name).toBe('deja'); // nu suprascrie
    // sursa e neschimbată
    expect((await readRidesFrom('src-cit'))!.length).toBe(2);
  });
});
