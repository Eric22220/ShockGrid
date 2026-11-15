// Istoricul rutelor (aplicația pentru bicicliști): pornire/oprire/sosire, întreruperi, reutilizare, ștergere.
// Doar local; nu creează măsurători și nu atinge turele sau rapoartele.
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Place } from '../src/services/geocode';
import { createReport } from '../src/services/reports';
import { finishRoute, HISTORY_KEY, HISTORY_MAX, recoverRoutes, reusePlan, startRoute } from '../src/services/history';
import * as idb from '../src/storage/idb';
import * as store from '../src/state/store';

const me: Place = { id: 'me', name: 'Locația mea', detail: 'GPS', lat: 0, lon: 0, kind: 'mylocation', source: 'gps' };
const uvt: Place = { id: 'u', name: 'Universitatea de Vest', detail: '', lat: 45.7471, lon: 21.2316, kind: 'place', source: 'photon' };
const start = (dest = uvt) => ({ origin: me, originAt: { lat: 45.7537, lon: 21.2257 }, dest, distance_m: 1260.4, minutes: 5.2 });

async function freshDb() {
  await idb._resetDb();
  await new Promise<void>((res) => { const r = indexedDB.deleteDatabase('shockgrid'); r.onsuccess = () => res(); r.onerror = () => res(); r.onblocked = () => res(); });
  await store.historyClear();
}

describe('istoricul rutelor: logica', () => {
  it('pornire → oprire = „oprită”; sosire = „ajuns” și nu e retrogradată de Oprește', () => {
    let { list, entry } = startRoute([], start(), 1000);
    expect(entry).toMatchObject({ status: 'active', distance_m: 1260, minutes: 5, started_at: 1000, ended_at: null });
    expect(entry.origin).toMatchObject({ name: 'Locația mea', lat: 45.7537 }); // poziția de la pornire, nu (0,0)
    list = finishRoute(list, entry.id, 'ended', 2000);
    expect(list[0]).toMatchObject({ status: 'ended', ended_at: 2000 });
    let b = startRoute(list, start(), 3000);
    let l2 = finishRoute(b.list, b.entry.id, 'arrived', 4000);
    l2 = finishRoute(l2, b.entry.id, 'ended', 5000);
    expect(l2[0]).toMatchObject({ status: 'arrived', ended_at: 4000 });
  });
  it('aplicația închisă în timpul navigării → „întreruptă”, niciodată „terminată”', () => {
    const { list } = startRoute([], start(), 1000);
    const back = recoverRoutes(JSON.parse(JSON.stringify(list)));
    expect(back[0].status).toBe('interrupted');
    expect(back[0].ended_at).toBeNull();
    expect(recoverRoutes('stricat')).toEqual([]);
    expect(recoverRoutes([{ nu: 'e o rută' }])).toEqual([]);
  });
  it('aceeași destinație pornită de două ori → o singură sesiune activă; maximum 20 de intrări', () => {
    let l = startRoute([], start(), 1).list;
    l = startRoute(l, start(), 2).list;
    expect(l.filter((e) => e.status === 'active')).toHaveLength(1);
    expect(l[1].status).toBe('interrupted');
    for (let i = 0; i < 30; i++) l = startRoute(l, start(), 10 + i).list;
    expect(l).toHaveLength(HISTORY_MAX);
  });
  it('„Folosește din nou” pornește de la poziția CURENTĂ, spre aceeași destinație', () => {
    const { entry } = startRoute([], start(), 1);
    const p = reusePlan(entry);
    expect(p.origin.kind).toBe('mylocation');
    expect([p.dest.lat, p.dest.lon, p.dest.name]).toEqual([uvt.lat, uvt.lon, uvt.name]);
  });
});

describe('istoricul rutelor: stocare locală', () => {
  beforeEach(freshDb);
  it('se salvează doar în IndexedDB, fără rețea; ștergerea unei intrări și a istoricului', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    const a = await store.historyStart(start());
    await store.historyFinish(a, 'ended');
    const b = await store.historyStart(start({ ...uvt, name: 'Gara de Nord', lat: 45.75, lon: 21.207 }));
    await store.historyFinish(b, 'arrived');
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
    const saved = await idb.kvGet<{ id: string; status: string }[]>(HISTORY_KEY);
    expect(saved!.map((e) => e.status)).toEqual(['arrived', 'ended']);
    await store.historyDelete(b);
    expect(store.getState().routeHistory.map((e) => e.id)).toEqual([a]);
    await store.historyClear();
    expect(await idb.kvGet(HISTORY_KEY)).toEqual([]);
  });
  it('nu creează măsurători și nu atinge rapoartele sau turele', async () => {
    const r = createReport({ lat: 45.75, lon: 21.22, acc: 5, type: 'groapa' });
    await store.saveReport(r);
    const ridesBefore = store.getState().rides.length;
    const edgesBefore = store.getState().layer.edges.size;
    const id = await store.historyStart(start());
    await store.historyFinish(id, 'ended');
    await store.historyClear();
    expect(store.getState().rides.length).toBe(ridesBefore);
    expect(store.getState().layer.edges.size).toBe(edgesBefore);
    expect((await idb.listReports()).map((x) => x.id)).toContain(r.id);
  });
  it('o navigare activă salvată e recuperată ca „întreruptă” la pornirea aplicației', async () => {
    await store.historyStart(start());
    const raw = await idb.kvGet<unknown>(HISTORY_KEY);
    expect(recoverRoutes(raw)[0].status).toBe('interrupted');
  });
});
