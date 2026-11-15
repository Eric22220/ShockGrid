// Publicarea Dev → ShockGrid (GitHub simulat) și citirea stratului publicat în aplicația pentru bicicliști.
// Testele NU contactează GitHub: API-ul e simulat. Publicarea reală se verifică separat, cu un set sintetic.
import 'fake-indexeddb/auto';
import { beforeAll, describe, expect, it } from 'vitest';
import { aggregate, type Snapshot } from '../src/core/aggregate';
import { checkLive, GhError, GitHubClient, publishToGitHub, TARGET, type PublishStep } from '../src/core/github';
import { diffSnapshots, parseSnapshot, publicationId, publishBlockers, validatePublicDataset } from '../src/core/publication';
import { auditLayer, buildPublicLayer, type PublicLayerFiles } from '../src/core/publiclayer';
import { processRide } from '../src/core/process';
import { DEFAULT_ROUTE_OPTIONS, Router } from '../src/core/route';
import type { ProcessedRide } from '../src/core/types';
import * as store from '../src/state/store';
import { makeGraph, pathAlong, syntheticRide } from './helpers';

// stradă dreaptă de 4 km în 8 segmente; tura merge dus-întors pe primii 3 km (două treceri), restul rămâne necunoscut
const LAT = 45.75, LON = 21.22, dLon = (m: number) => m / 77600;
const N = Array.from({ length: 9 }, (_, i) => [LAT, LON + dLon(i * 500)] as [number, number]);
const g = makeGraph(N, N.slice(1).map((_, i) => ({ f: i, t: i + 1, highway: 'residential' })));
let ride: ProcessedRide;
let pub: PublicLayerFiles;
beforeAll(() => {
  const { path, seconds } = pathAlong([N[0], N[6], N[0]], 5, 0.5, 9);
  const raw = syntheticRide({ seconds: Math.floor(seconds), fs: 100, vibAmp: 0.9, speed: 5, path, acc: 5 });
  raw.meta.ride_key = 'privat-tura-test';
  raw.meta.device = 'Telefonul lui X';
  ride = processRide(raw, { graph: g });
  pub = buildPublicLayer([ride], g, { exploratory: false, shocks: 'clean' });
});

describe('P0. setul de date public', () => {
  it('1. se generează un set valid, cu aceeași versiune în toate fișierele', () => {
    expect(validatePublicDataset(pub.snap)).toEqual([]);
    const id = pub.snap.meta.publication_id!;
    expect(id).toBe(publicationId(pub.snap));
    for (const [name, text] of Object.entries(pub.files)) expect(text, name).toContain(id);
    expect(pub.manifest.counts.segments).toBe(pub.snap.edges.length);
    expect(pub.snap.edges.length).toBeGreaterThan(0);
  });
  it('2. fără câmpuri private sau brute: ID-uri, dispozitiv, timpi; un câmp străin e refuzat', () => {
    const text = Object.values(pub.files).join('');
    for (const secret of [ride.ride_id, 'privat-tura-test', 'Telefonul lui X']) expect(text).not.toContain(secret);
    expect(text).not.toMatch(/\b1[6-9]\d{11}\b/);
    const bad = JSON.parse(JSON.stringify(pub.snap)) as Snapshot & { edges: Record<string, unknown>[] };
    (bad.edges[0] as Record<string, unknown>).t = [1_800_000_000_000];
    bad.meta.ride_ids = ['r1'];
    const errs = validatePublicDataset(bad as Snapshot);
    expect(errs.join(' ')).toMatch(/câmp nepermis.*t/);
    expect(errs.join(' ')).toMatch(/ID-uri de tură/);
  });
  it('3. un audit eșuat blochează publicarea', () => {
    const leaked = auditLayer(pub.snap, Object.values(pub.files).join('') + ride.ride_id, [{ p: ride }], g);
    expect(leaked.ok).toBe(false);
    const ok = { auditOk: true, invalid: [], liveKnown: true, approved: true, lowCount: 0, lowApproved: false, token: 'x'.repeat(40) };
    expect(publishBlockers(ok)).toEqual([]);
    expect(publishBlockers({ ...ok, auditOk: leaked.ok })).toContain('auditul de confidențialitate a eșuat');
    expect(publishBlockers({ ...ok, invalid: ['x'] }).length).toBe(1);
  });
  it('4. datele cu încredere redusă își păstrează clasificarea; 5. șocurile publicate sunt neverificate', () => {
    const one = buildPublicLayer([processRide({ ...syntheticRide({ seconds: 600, fs: 100, vibAmp: 0.9, speed: 5, path: pathAlong([N[0], N[6]], 5, 0.5, 4).path, acc: 5 }), meta: { ...syntheticRide({ seconds: 1, fs: 10, vibAmp: 0, speed: 5, path: () => N[0], acc: 5 }).meta, ride_key: 'o-trecere' } }, { graph: g })], g, { exploratory: false, shocks: 'clean' });
    const layer = aggregate({ snapshot: one.snap, rides: [], version: 1, lengthOf: (e) => g.length[e] });
    const st = [...layer.edges.values()].map((e) => e.status);
    expect(st.length).toBeGreaterThan(0);
    expect(st.every((s) => s === 'LOW_CONFIDENCE')).toBe(true); // o singură trecere → niciodată „măsurat sigur”
    expect(one.manifest.counts.low_confidence).toBe(st.length);
    expect(one.manifest.counts.measured).toBe(0);
    expect(one.manifest.counts.hazards_verified).toBe(0);
    expect(JSON.stringify(one.files)).not.toMatch(/"verified"\s*:\s*true|confirmed_pothole/);
  });
  it('6. fără aprobare explicită (și fără acord pentru datele incerte) nu se publică; 7. fără token nu se publică', () => {
    const ok = { auditOk: true, invalid: [], liveKnown: true, approved: true, lowCount: 2, lowApproved: true, token: 'x'.repeat(40) };
    expect(publishBlockers({ ...ok, approved: false })).toContain('lipsește aprobarea explicită');
    expect(publishBlockers({ ...ok, lowApproved: false })).toContain('lipsește acordul pentru datele cu încredere redusă');
    expect(publishBlockers({ ...ok, token: '' })).toContain('lipsește tokenul GitHub');
    expect(() => new GitHubClient('')).toThrow(GhError);
  });
});

// ---- GitHub simulat: refs, commit-uri, blob-uri, fișiere pe commit ----
function fakeGitHub(opts: { token?: string; readonly?: boolean } = {}) {
  const commits = new Map<string, { parent: string | null; files: Map<string, string> }>();
  commits.set('c0', { parent: null, files: new Map([[`${TARGET.dir}/comfort-layer.json`, '{"meta":{"generated_at":"x"},"edges":[],"shocks":[]}']]) });
  const blobs = new Map<string, string>();
  const trees = new Map<string, { base: string; entries: { path: string; sha: string }[] }>();
  let head = 'c0', n = 0;
  const calls: string[] = [];
  let beforePatch: (() => void) | null = null;
  const json = (status: number, body: unknown) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const f = (async (url: string, init?: RequestInit) => {
    const u = new URL(url);
    const method = init?.method ?? 'GET';
    const auth = (init?.headers as Record<string, string>)?.Authorization;
    calls.push(`${method} ${u.pathname}`);
    if (auth !== `Bearer ${opts.token ?? 'tok-valid-1234567890abcdef'}`) return json(401, { message: 'Bad credentials' });
    const p = u.pathname.replace(`/repos/${TARGET.owner}/${TARGET.repo}`, '');
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    if (p === '' && method === 'GET') return json(200, { full_name: 'x' });
    if (p === `/git/ref/heads/main`) return json(200, { object: { sha: head } });
    if (p.startsWith('/contents/')) { const c = commits.get(u.searchParams.get('ref')!)!; const t = c.files.get(p.slice('/contents/'.length)); return t ? new Response(t, { status: 200 }) : json(404, {}); }
    if (p.startsWith('/git/commits/') && method === 'GET') return json(200, { tree: { sha: `tree-of-${p.split('/').pop()}` } });
    if (opts.readonly && method !== 'GET') return json(403, { message: 'Resource not accessible by personal access token' });
    if (p === '/git/blobs') { const sha = `b${++n}`; blobs.set(sha, body.content); return json(201, { sha }); }
    if (p === '/git/trees') { const sha = `t${++n}`; trees.set(sha, { base: body.base_tree, entries: body.tree }); return json(201, { sha }); }
    if (p === '/git/commits' && method === 'POST') {
      const sha = `c${++n}`; const parent = body.parents[0]; const tr = trees.get(body.tree)!;
      const files = new Map(commits.get(parent)!.files);
      for (const e of tr.entries) files.set(e.path, blobs.get(e.sha)!);
      commits.set(sha, { parent, files });
      return json(201, { sha, html_url: `https://github.com/x/commit/${sha}` });
    }
    if (p === '/git/refs/heads/main' && method === 'PATCH') {
      beforePatch?.(); beforePatch = null;
      if (commits.get(body.sha)!.parent !== head) return json(422, { message: 'Update is not a fast forward' });
      head = body.sha; return json(200, { object: { sha: head } });
    }
    return json(404, {});
  }) as typeof fetch;
  return {
    f, calls, commits, get head() { return head; },
    filesAtHead: () => commits.get(head)!.files,
    /** altcineva împinge un commit înainte de actualizarea ramurii */
    racePush(changeLayer: boolean) {
      beforePatch = () => {
        const sha = `x${++n}`; const files = new Map(commits.get(head)!.files);
        if (changeLayer) files.set(`${TARGET.dir}/comfort-layer.json`, '{"meta":{"generated_at":"y","publication_id":"pub-altul"},"edges":[],"shocks":[]}');
        else files.set('README.md', 'alt commit');
        commits.set(sha, { parent: head, files }); head = sha;
      };
    },
  };
}
const TOKEN = 'tok-valid-1234567890abcdef';
const input = (gh: ReturnType<typeof fakeGitHub>, extra: Partial<Parameters<typeof publishToGitHub>[0]> = {}) => ({ token: TOKEN, files: pub.files, publicationId: pub.snap.meta.publication_id!, expectedPrevious: null, message: 'test', fetch: gh.f, ...extra });

describe('P0. publicarea în repo (GitHub simulat)', () => {
  it('8. token invalid → eroare acționabilă, fără conținutul tokenului', async () => {
    const gh = fakeGitHub();
    const e = await publishToGitHub(input(gh, { token: 'github_pat_GRESIT_secret_value_123' })).catch((x) => x);
    expect(e).toBeInstanceOf(GhError);
    expect(e.kind).toBe('auth');
    expect(e.message).toMatch(/token nou/);
    expect(e.message).not.toContain('GRESIT');
    const ro = fakeGitHub({ readonly: true });
    const e2 = await publishToGitHub(input(ro)).catch((x) => x);
    expect(e2.kind).toBe('forbidden');
    expect(e2.message).toContain('Contents: Read and write');
  });
  it('9. publicare reușită: un singur commit atomic cu toate fișierele, pe main', async () => {
    const gh = fakeGitHub();
    const steps: PublishStep[] = [];
    const r = await publishToGitHub(input(gh, { onStep: (s) => steps.push(s) }));
    expect(r.unchanged).toBe(false);
    expect(gh.head).toBe(r.commit);
    const files = gh.filesAtHead();
    for (const name of Object.keys(pub.files)) expect(files.get(`${TARGET.dir}/${name}`)).toBe(pub.files[name as keyof typeof pub.files]);
    expect(gh.calls.filter((c) => c.startsWith('PATCH')).length).toBe(1);
    expect(gh.calls.filter((c) => c === `POST /repos/${TARGET.owner}/${TARGET.repo}/git/commits`).length).toBe(1);
    expect(steps).toEqual(['connect', 'check', 'upload', 'commit']);
  });
  it('10. conflict: stratul publicat s-a schimbat după previzualizare → refuz (nu suprascrie); alt commit pe main → reîncearcă', async () => {
    const gh = fakeGitHub();
    gh.racePush(true);
    const e = await publishToGitHub(input(gh)).catch((x) => x);
    expect(e.kind).toBe('conflict');
    expect(gh.filesAtHead().get(`${TARGET.dir}/comfort-layer.json`)).toContain('pub-altul'); // publicarea celuilalt a rămas
    const gh2 = fakeGitHub();
    gh2.racePush(false);
    const r = await publishToGitHub(input(gh2));
    expect(r.commit).toBe(gh2.head);
    expect(gh2.filesAtHead().get('README.md')).toBe('alt commit'); // commitul celuilalt e păstrat
    // previzualizarea veche (alt ID publicat) e refuzată înainte de orice scriere
    const gh3 = fakeGitHub();
    const e3 = await publishToGitHub(input(gh3, { expectedPrevious: 'pub-vazut-in-preview' })).catch((x) => x);
    expect(e3.kind).toBe('conflict');
    expect(gh3.calls.some((c) => c.startsWith('POST'))).toBe(false);
  });
  it('11. a doua publicare cu același conținut nu creează alt commit', async () => {
    const gh = fakeGitHub();
    const r1 = await publishToGitHub(input(gh));
    const r2 = await publishToGitHub(input(gh, { expectedPrevious: null }));
    expect(r1.commit).toBeTruthy();
    expect(r2.unchanged).toBe(true);
    expect(gh.head).toBe(r1.commit);
    // generarea din nou (alt moment) dă același ID
    const again = buildPublicLayer([ride], g, { exploratory: false, shocks: 'clean' });
    expect(again.snap.meta.publication_id).toBe(pub.snap.meta.publication_id);
  });
  it('12. versiuni amestecate nu sunt raportate ca publicate; verificarea live cere ID-ul și numărul de segmente', async () => {
    const id = pub.snap.meta.publication_id!;
    const serve = (body: unknown) => (async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch;
    expect((await checkLive(id, pub.snap.edges.length, serve({ meta: { publication_id: 'pub-vechi' }, edges: [] }))).kind).toBe('waiting');
    expect((await checkLive(id, pub.snap.edges.length, serve({ meta: { publication_id: id }, edges: [1] }))).kind).toBe(pub.snap.edges.length === 1 ? 'live' : 'failed');
    expect((await checkLive(id, pub.snap.edges.length, serve(pub.snap))).kind).toBe('live');
    expect((await checkLive(id, 1, (async () => { throw new Error('offline'); }) as unknown as typeof fetch)).kind).toBe('waiting');
  });
});

describe('P0. aplicația pentru bicicliști citește stratul publicat', () => {
  const resp = (body: unknown, ok = true) => (async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status: ok ? 200 : 503, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch;
  it('13. citește ultima versiune; 14. o versiune veche (cache, deploy întârziat) nu o înlocuiește pe cea nouă la verificare', async () => {
    const old = { meta: { generated_at: '2026-11-14T00:00:00Z', processing_version: 'x', thresholds: null, thresholds_source: '', device_note: '', attribution: '', license: '' }, edges: [], shocks: [] };
    expect(await store.refreshSnapshot(resp(old))).toBe(true);
    expect(await store.refreshSnapshot(resp(pub.snap))).toBe(true);
    expect(store.getState().snapshot!.meta.publication_id).toBe(pub.snap.meta.publication_id);
    expect(store.getState().layer.edges.size).toBeGreaterThan(0);
    expect(await store.refreshSnapshot(resp(pub.snap))).toBe(false); // aceeași versiune: nimic de reîncărcat
  });
  it('15. un fișier stricat sau lipsa rețelei nu șterg stratul deja încărcat', async () => {
    await store.refreshSnapshot(resp(pub.snap));
    expect(await store.refreshSnapshot(resp('{nu e json'))).toBe(false);
    expect(await store.refreshSnapshot(resp({ edges: 'x' }))).toBe(false);
    expect(await store.refreshSnapshot(resp(pub.snap, false))).toBe(false);
    expect(await store.refreshSnapshot((async () => { throw new TypeError('offline'); }) as unknown as typeof fetch)).toBe(false);
    expect(store.getState().snapshot!.meta.publication_id).toBe(pub.snap.meta.publication_id);
    expect(parseSnapshot({ meta: {}, edges: [] })).toBeNull();
  });
  it('16. harta colorează doar porțiunile măsurate; 17. restul rămâne necunoscut', () => {
    const layer = aggregate({ snapshot: pub.snap, rides: [], version: 1, lengthOf: (e) => g.length[e] });
    const published = new Set(pub.snap.edges.map((e) => e.edge_id));
    expect(published.has(7)).toBe(false); // ultimul segment nu a fost parcurs
    expect(layer.edges.get(7)?.status ?? 'UNKNOWN').toBe('UNKNOWN');
    for (const e of layer.edges.values()) {
      const segs = (e.segments ?? []).filter((s) => s.cat !== 'none');
      for (const s of segs) { expect(s.from_m).toBeGreaterThanOrEqual(0); expect(s.to_m).toBeLessThanOrEqual(g.length[e.edge_id] + 1e-6); }
    }
    // tăierea de confidențialitate: capătul turei (primii 200 m + raza de 250 m) nu e publicat
    expect(published.has(0)).toBe(false);
    expect(diffSnapshots(null, pub.snap).added.length).toBe(pub.snap.edges.length);
    expect(diffSnapshots(pub.snap, pub.snap).unchanged.length).toBe(pub.snap.edges.length);
  });
  it('18. rutarea funcționează cu stratul publicat (aceleași reguli, fără penalizări din șocuri)', () => {
    const layer = aggregate({ snapshot: pub.snap, rides: [], version: 1, lengthOf: (e) => g.length[e] });
    const r = new Router(g).route(0, 8, layer, DEFAULT_ROUTE_OPTIONS);
    expect(r).not.toBeNull();
    expect(r!.edges.length).toBe(8);
  });
});
