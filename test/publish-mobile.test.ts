// Publicarea din browser (iPhone/Safari, Chrome): cauza reală a eșecului, reprodusă în WebKit 18.2 real pe 15.11.2026:
// GitHubClient apela `this.f(url)` cu f = window.fetch → browserul aruncă „Can only call Window.fetch on instances of
// Window” (Chrome: „Illegal invocation”) înainte de a trimite cererea → afișat greșit „fără internet”. În Node (testul
// cap-coadă din terminal) și cu fetch simulat (testele vechi), fetch nu verifică `this`, deci eroarea nu apărea.
// Aici fetch-ul simulat se comportă ca cel nativ; în plus, cererile au doar antete permise de CORS la api.github.com.
import { describe, expect, it } from 'vitest';
import { deployStatus, GhError, normalizeToken, publishToGitHub, TARGET, testConnection } from '../src/core/github';
import { fakeGitHub } from './fake-github';

/** lista reală din răspunsul OPTIONS al api.github.com (15.11.2026): Cache-Control și Pragma NU sunt permise */
export const GH_ALLOWED_HEADERS = ['authorization', 'content-type', 'if-match', 'if-modified-since', 'if-none-match', 'if-unmodified-since', 'accept-encoding', 'x-github-otp', 'x-requested-with', 'user-agent', 'graphql-features', 'x-github-next-global-id', 'x-github-api-version', 'x-fetch-nonce', 'idempotency-key', 'accept'];

/** regulă conservatoare de browser: doar antete din Access-Control-Allow-Headers al GitHub (WebKit adaugă Cache-Control
 *  și Pragma pentru `cache: 'no-store'`; WebKit 18.2 le acceptă totuși, dar nu ne bazăm pe asta) */
function corsBrowser(inner: typeof fetch, opts: { blockAuth?: boolean; offline?: boolean } = {}) {
  const seen: { url: string; headers: string[]; cache?: RequestCache }[] = [];
  const f = (async (url: string, init?: RequestInit) => {
    const headers = Object.keys((init?.headers as Record<string, string>) ?? {}).map((h) => h.toLowerCase());
    if (init?.cache && !['default', 'force-cache', 'only-if-cached'].includes(init.cache)) headers.push('cache-control', 'pragma');
    seen.push({ url, headers, cache: init?.cache });
    if (opts.offline) throw new TypeError('Load failed');
    if (headers.some((h) => !GH_ALLOWED_HEADERS.includes(h))) throw new TypeError('Load failed');
    if (opts.blockAuth && headers.includes('authorization')) throw new TypeError('Load failed');
    return inner(url, init);
  }) as typeof fetch;
  return { f, seen };
}

const TOKEN = 'tok_valid_1234567890abcdef';
const FILES = { 'comfort-layer.json': '{"meta":{"publication_id":"pub-test"},"edges":[],"shocks":[]}', 'publication.json': '{"publication_id":"pub-test"}' };
const input = (gh: ReturnType<typeof fakeGitHub>, extra: Partial<Parameters<typeof publishToGitHub>[0]> = {}) => ({ token: TOKEN, files: FILES, publicationId: 'pub-test', expectedPrevious: null, message: 'test', fetch: gh.f, ...extra });
const caught = async (p: Promise<unknown>) => (await p.then(() => null, (x) => x)) as GhError;

/** ca fetch-ul nativ: aruncă dacă e apelat ca metodă a altui obiect (this ≠ globalThis/undefined) */
function nativeLikeFetch(inner: typeof fetch): typeof fetch {
  return function (this: unknown, input: RequestInfo | URL, init?: RequestInit) {
    if (this !== undefined && this !== globalThis) throw new TypeError('Can only call Window.fetch on instances of Window');
    return inner(input, init);
  } as typeof fetch;
}

describe('publicarea din browser (cauza reală)', () => {
  it('0a. fetch-ul nativ apelat ca metodă aruncă (exact eroarea din WebKit); funcția de publicare îl apelează corect', async () => {
    const gh = fakeGitHub();
    const nf = nativeLikeFetch(gh.f);
    expect(() => ({ f: nf }).f('https://api.github.com/x')).toThrow(/instances of Window/); // tiparul vechi
    const r = await publishToGitHub(input(gh, { fetch: nf }));
    expect(r.commit).toBe(gh.head);
    expect((await testConnection(TOKEN, nf)).ok).toBe(true);
  });
  it('0b. cu fetch-ul GLOBAL implicit (ca în pagină, fără parametru), publicarea, testul, deploy-ul și verificarea merg', async () => {
    const gh = fakeGitHub();
    const orig = globalThis.fetch;
    const deployFake = (async (url: string, init?: RequestInit) => String(url).includes('/actions/runs')
      ? new Response(JSON.stringify({ workflow_runs: [{ name: 'Deploy', status: 'completed', conclusion: 'success', html_url: 'u' }] }), { status: 200 })
      : String(url).includes('github.io') ? new Response(JSON.stringify({ meta: { publication_id: 'pub-test' }, edges: [] }), { status: 200 }) : gh.f(url, init)) as typeof fetch;
    globalThis.fetch = nativeLikeFetch(deployFake);
    try {
      const { publishToGitHub: pub, testConnection: tc, deployStatus: ds, checkLive: cl } = await import('../src/core/github');
      expect((await tc(TOKEN)).ok).toBe(true);
      const r = await pub({ token: TOKEN, files: FILES, publicationId: 'pub-test', expectedPrevious: null, message: 'm' });
      expect(r.commit).toBe(gh.head);
      expect(await ds(r.commit!)).toMatchObject({ conclusion: 'success' });
      expect((await cl('pub-test', 0)).kind).toBe('live');
    } finally { globalThis.fetch = orig; }
  });
  it('0c. o eroare a browserului înainte de trimitere nu e raportată ca „fără internet”', async () => {
    const broken = (() => { throw new TypeError('Illegal invocation'); }) as unknown as typeof fetch;
    const e = await caught(publishToGitHub(input(fakeGitHub(), { fetch: broken })));
    expect(e.kind).toBe('other');
    expect(e.message).toContain('Nu s-a trimis nimic');
  });
});

describe('publicarea din Safari/iOS', () => {
  it('1. nicio cerere către api.github.com nu folosește opțiunea cache și nici antete refuzate de preflight', async () => {
    const gh = fakeGitHub();
    const br = corsBrowser(gh.f);
    const r = await publishToGitHub(input(gh, { fetch: br.f }));
    expect(r.commit).toBeTruthy();
    expect(gh.filesAtHead().get(`${TARGET.dir}/comfort-layer.json`)).toBe(FILES['comfort-layer.json']);
    expect(br.seen.length).toBeGreaterThan(5);
    for (const s of br.seen) {
      expect(s.cache, s.url).toBeUndefined();
      for (const h of s.headers) expect(GH_ALLOWED_HEADERS, `${h} în ${s.url}`).toContain(h);
    }
    // citirile ocolesc cache-ul HTTP printr-un URL unic (GitHub trimite max-age=60 pentru ramură)
    const gets = gh.inits.filter((x) => (x.init?.method ?? 'GET') === 'GET');
    expect(gets.every((x) => /[?&]_sg=/.test(x.url))).toBe(true);
    expect(new Set(gets.map((x) => x.url)).size).toBe(gets.length);
  });
  it('2. starea deploy-ului: cerere simplă (fără antete proprii, fără cache), deci fără preflight', async () => {
    const d = corsBrowser((async () => new Response(JSON.stringify({ workflow_runs: [{ name: 'Deploy', status: 'completed', conclusion: 'success', html_url: 'u' }] }), { status: 200 })) as unknown as typeof fetch);
    expect(await deployStatus('abc', d.f)).toMatchObject({ status: 'completed', conclusion: 'success' });
    expect(d.seen[0].headers).toEqual([]);
    expect(d.seen[0].cache).toBeUndefined();
  });
  it('3. regula conservatoare refuză cache: no-store (antete în afara listei GitHub)', async () => {
    const br = corsBrowser(fakeGitHub().f);
    await expect(br.f('https://api.github.com/repos/x', { headers: { Authorization: 'Bearer x' }, cache: 'no-store' })).rejects.toThrow(TypeError);
  });
  it('4. tokenul lipit cu spații, rând nou sau caractere invizibile e curățat; caracterele străine sunt refuzate clar', () => {
    expect(normalizeToken(`  ${TOKEN}\n`)).toBe(TOKEN);
    expect(normalizeToken(`​${TOKEN}﻿`)).toBe(TOKEN);
    for (const bad of ['„github_pat_abcdefghijklmnopqrstuvwxyz”', 'github_pat_abc—defghijklmnopqrstuvwxyz', 'github_pat_ăbcdefghijklmnopqrstuvwxyz']) {
      let e: GhError | null = null;
      try { normalizeToken(bad); } catch (x) { e = x as GhError; }
      expect(e?.kind).toBe('token_format');
      expect(e?.message).not.toContain('abcdefghijkl');
    }
    expect(() => normalizeToken('github_pat_scurt')).toThrow(/incomplet/);
  });
  it('5. fetch aruncă: „blocat de browser” (API-ul răspunde la o cerere simplă) față de „fără rețea”', async () => {
    const gh = fakeGitHub();
    const blocked = await caught(publishToGitHub(input(gh, { fetch: corsBrowser(gh.f, { blockAuth: true }).f })));
    expect([blocked.kind, blocked.stage]).toEqual(['blocked', 'repo']);
    expect(blocked.message).toContain('Load failed');
    const off = await caught(publishToGitHub(input(gh, { fetch: corsBrowser(gh.f, { offline: true }).f })));
    expect(off.kind).toBe('network');
    for (const e of [blocked, off]) expect(e.message).not.toContain(TOKEN);
    expect(gh.head).toBe('c0');
  });
  it('6. „Testează conexiunea GitHub”: totul în regulă, fără a modifica nimic', async () => {
    const gh = fakeGitHub();
    const r = await testConnection(TOKEN, corsBrowser(gh.f).f);
    expect(r.ok).toBe(true);
    expect(r.checks.map((c) => c.stage)).toEqual(['network', 'token', 'branch', 'write', 'read_layer']);
    expect(r.checks.find((c) => c.stage === 'write')?.status).toBe(422);
    expect(r.head).toBe('c0');
    expect(gh.head).toBe('c0'); // nimic scris
    expect(gh.calls.filter((c) => c.startsWith('POST'))).toEqual([`POST /repos/${TARGET.owner}/${TARGET.repo}/git/blobs`]); // doar sonda goală, respinsă
    expect(gh.calls.some((c) => c.startsWith('PATCH'))).toBe(false);
    for (const c of r.checks) expect(c.msg).not.toContain(TOKEN);
  });
  it('7. „Testează conexiunea” deosebește 401, 403, 404, formatul tokenului, rețeaua și blocarea de browser', async () => {
    const at = async (tok: string, gh: ReturnType<typeof fakeGitHub>, o: Parameters<typeof corsBrowser>[1] = {}) => {
      const r = await testConnection(tok, corsBrowser(gh.f, o).f);
      return [r.ok, r.error?.kind, r.error?.stage, r.error?.status];
    };
    expect(await at('github_pat_GRESIT_secret_value_123', fakeGitHub())).toEqual([false, 'auth', 'token', 401]);
    expect(await at(TOKEN, fakeGitHub({ readonly: true }))).toEqual([false, 'forbidden', 'write', 403]);
    expect(await at(TOKEN, fakeGitHub({ noRepo: true }))).toEqual([false, 'no_access', 'token', 404]);
    expect(await at('„tok”', fakeGitHub())).toEqual([false, 'token_format', 'token', undefined]);
    expect(await at(TOKEN, fakeGitHub(), { offline: true })).toEqual([false, 'network', 'network', undefined]);
    expect(await at(TOKEN, fakeGitHub(), { blockAuth: true })).toEqual([false, 'blocked', 'token', undefined]);
  });
  it('8. 409 = conflict pe ramură, 422 = cerere nevalidă (cu mesajul GitHub); etapa și codul HTTP sunt păstrate', async () => {
    const mk = (status: number, message: string) => (async (url: string) => (String(url).includes('/git/ref/')
      ? new Response(JSON.stringify({ message }), { status })
      : new Response(JSON.stringify({ full_name: 'x', tree: { sha: 't' } }), { status: 200 }))) as unknown as typeof fetch;
    const c = await caught(publishToGitHub(input(fakeGitHub(), { fetch: mk(409, 'Git Repository is empty.') })));
    expect([c.kind, c.status, c.stage]).toEqual(['conflict', 409, 'branch']);
    const v = await caught(publishToGitHub(input(fakeGitHub(), { fetch: mk(422, 'Invalid request.') })));
    expect([v.kind, v.status, v.stage]).toEqual(['invalid', 422, 'branch']);
    expect(v.message).toContain('Invalid request.');
  });
  it('9. tokenul nu apare în sursa paginii decât în memorie: fără localStorage/sessionStorage/IndexedDB/URL', async () => {
    const { readFileSync } = await import('node:fs');
    const src = (readFileSync('src/dev/PublishPage.tsx', 'utf8') + readFileSync('src/core/github.ts', 'utf8')).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ''); // fără comentarii
    for (const w of ['localStorage', 'sessionStorage', 'kvSet', 'indexedDB', 'document.cookie', 'console.']) expect(src, w).not.toContain(w);
    expect(src).not.toMatch(/[?&]token=/);
    // după o eroare, tokenul nu e șters (reîncercare); e șters la confirmare și la „Șterge tokenul”
    expect(src).not.toMatch(/const tok = token;\s*setToken\(''\)/);
    expect(src).toMatch(/l\.kind === 'live'\) \{ setToken\(''\)/);
    expect(src).toContain('Șterge tokenul');
  });
});
