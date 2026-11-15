// Copierea turelor din aplicația pentru bicicliști (baza „shockgrid”) în ShockGrid Dev (baza „shockgrid-dev”),
// pe același browser. NEDISTRUCTIV: baza sursă se deschide doar pentru citire, nu se modifică, nu se șterge și
// nu e creată dacă nu există. Copierea pornește doar la cererea operatorului.
import { CITIZEN_DB_NAME } from '../appkind';
import type { StoredRide } from './idb';

/** turele din altă bază, doar citire; null = baza nu există pe acest browser */
export function readRidesFrom(name: string = CITIZEN_DB_NAME, factory: IDBFactory = indexedDB): Promise<StoredRide[] | null> {
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
      if (!d.objectStoreNames.contains('rides')) { d.close(); resolve([]); return; }
      const tx = d.transaction('rides', 'readonly');
      const all = tx.objectStore('rides').getAll();
      all.onsuccess = () => { d.close(); resolve(all.result as StoredRide[]); };
      all.onerror = () => { d.close(); reject(all.error); };
    };
  });
}

export interface CopyResult { found: number; copied: number; skipped: number; missing: boolean }

/** copiază turele care lipsesc din destinație (după ride_id); nu suprascrie nimic */
export async function copyRides(src: StoredRide[] | null, has: (id: string) => Promise<boolean>, put: (r: StoredRide) => Promise<void>): Promise<CopyResult> {
  if (!src) return { found: 0, copied: 0, skipped: 0, missing: true };
  let copied = 0, skipped = 0;
  for (const r of src) {
    if (await has(r.ride_id)) { skipped++; continue; }
    await put(r);
    copied++;
  }
  return { found: src.length, copied, skipped, missing: false };
}
