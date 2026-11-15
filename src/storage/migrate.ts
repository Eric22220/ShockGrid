// Copierea turelor din aplicația pentru bicicliști (baza „shockgrid”) în ShockGrid Dev (baza „shockgrid-dev”),
// pe același browser. NEDISTRUCTIV: baza sursă se deschide doar pentru citire, nu se modifică, nu se șterge și
// nu e creată dacă nu există. Copierea pornește doar la cererea operatorului.
import { CITIZEN_DB_NAME } from '../appkind';
import type { LocalReport, StoredRide } from './idb';

/** turele din altă bază, doar citire; null = baza nu există pe acest browser */
export function readRidesFrom(name: string = CITIZEN_DB_NAME, factory: IDBFactory = indexedDB): Promise<StoredRide[] | null> {
  return readStoreFrom<StoredRide>(name, 'rides', factory);
}

/** rapoartele din altă bază (doar citire) */
export function readReportsFrom(name: string = CITIZEN_DB_NAME, factory: IDBFactory = indexedDB): Promise<LocalReport[] | null> {
  return readStoreFrom<LocalReport>(name, 'reports', factory);
}

/** toate înregistrările unui depozit din altă bază, doar citire; null = baza nu există (și nu e creată) */
export function readStoreFrom<T>(name: string, store: string, factory: IDBFactory = indexedDB): Promise<T[] | null> {
  return new Promise((resolve, reject) => {
    let missing = false;
    const req = factory.open(name);
    req.onupgradeneeded = (e) => {
      // fără versiune, „upgrade” de la 0 înseamnă că baza nu exista: anulăm, ca să nu o creăm goală
      if ((e as IDBVersionChangeEvent).oldVersion === 0) { missing = true; req.transaction?.abort(); }
    };
    req.onerror = () => { if (missing) resolve(null); else reject(req.error); };
    req.onblocked = () => reject(new Error('Baza aplicației ShockGrid e ocupată (închide alte file ShockGrid).'));
    req.onsuccess = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains(store)) { d.close(); resolve([]); return; }
      const tx = d.transaction(store, 'readonly');
      const all = tx.objectStore(store).getAll();
      all.onsuccess = () => { d.close(); resolve(all.result as T[]); };
      all.onerror = () => { d.close(); reject(all.error); };
    };
  });
}

export interface CopyResult { found: number; copied: number; skipped: number; missing: boolean }

/** copiază turele care lipsesc din destinație (după ride_id); nu suprascrie nimic */
export async function copyRides(src: StoredRide[] | null, has: (id: string) => Promise<boolean>, put: (r: StoredRide) => Promise<void>): Promise<CopyResult> {
  return copyMissing(src, (r) => r.ride_id, has, put);
}

/** copiază elementele care lipsesc din destinație (după cheie); nu suprascrie nimic */
export async function copyMissing<T>(src: T[] | null, key: (x: T) => string, has: (id: string) => Promise<boolean>, put: (x: T) => Promise<void>): Promise<CopyResult> {
  if (!src) return { found: 0, copied: 0, skipped: 0, missing: true };
  let copied = 0, skipped = 0;
  for (const r of src) {
    if (await has(key(r))) { skipped++; continue; }
    await put(r);
    copied++;
  }
  return { found: src.length, copied, skipped, missing: false };
}
