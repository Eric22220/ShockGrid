// Publicarea stratului aprobat în repo-ul ShockGrid prin API-ul REST GitHub (din browser, ShockGrid Dev).
// Un singur commit atomic cu toate fișierele (blob-uri → tree → commit → ref fără „force”), deci aplicația pentru
// bicicliști nu poate vedea o combinație de versiuni. GitHub Actions publică apoi site-ul (deploy.yml).
// Tokenul: primit ca parametru, folosit doar în antetul Authorization, niciodată salvat, logat sau inclus în erori.
import { PRIMARY_FILE, PUBLIC_DIR } from './publication';

export const TARGET = { owner: 'Eric22220', repo: 'ShockGrid', branch: 'main', dir: PUBLIC_DIR } as const;
import { LIVE_BASE } from '../appkind';
export { LIVE_BASE };
const API = 'https://api.github.com';

export type GhErrorKind = 'no_token' | 'token_format' | 'auth' | 'no_access' | 'forbidden' | 'rate' | 'conflict' | 'network' | 'blocked' | 'invalid' | 'deploy' | 'verify' | 'other';
/** etapa în care a apărut eroarea (afișată în interfață) */
export type GhStage = 'network' | 'token' | 'repo' | 'branch' | 'write' | 'read_layer' | 'upload' | 'commit' | 'ref' | 'deploy' | 'verify';
export const STAGE_LABEL: Record<GhStage, string> = {
  network: 'Conexiunea la api.github.com',
  token: 'Verificarea tokenului',
  repo: `Accesul la ${TARGET.owner}/${TARGET.repo}`,
  branch: 'Citirea ramurii main',
  write: 'Permisiunea de scriere',
  read_layer: 'Citirea stratului publicat',
  upload: 'Încărcarea fișierelor',
  commit: 'Crearea commitului',
  ref: 'Actualizarea ramurii main',
  deploy: 'Deploy (GitHub Pages)',
  verify: 'Verificarea pe site-ul live',
};
export class GhError extends Error {
  constructor(public kind: GhErrorKind, message: string, public status?: number, public stage?: GhStage) { super(message); }
}

export type PublishStep = 'connect' | 'check' | 'upload' | 'commit' | 'unchanged';
export interface PublishResult { commit: string | null; unchanged: boolean; previous: string | null; url: string | null }

type Fetch = typeof fetch;

/**
 * Curăță tokenul lipit (spații, rânduri noi, caractere invizibile copiate din Notițe/Mail) și verifică formatul.
 * Un caracter nepermis într-un antet HTTP face ca fetch să arunce înainte de a trimite cererea, ceea ce ar arăta
 * ca o eroare de rețea; îl prindem aici, cu un mesaj clar, fără a afișa tokenul.
 */
export function normalizeToken(raw: string): string {
  const t = (raw ?? '').replace(/[\s​-‍⁠﻿]/g, '');
  if (!t) throw new GhError('no_token', 'Publicarea cere un token GitHub.', undefined, 'token');
  if (!/^[A-Za-z0-9_]+$/.test(t)) throw new GhError('token_format', 'Tokenul conține caractere care nu apar într-un token GitHub (ghilimele, liniuțe, diacritice?). Copiază-l din nou, direct din pagina GitHub.', undefined, 'token');
  if (t.length < 20) throw new GhError('token_format', 'Tokenul pare incomplet (prea scurt). Copiază-l din nou, întreg.', undefined, 'token');
  return t;
}

/** mesajul GitHub din corpul răspunsului (sigur de afișat: GitHub nu repetă tokenul) */
function ghMessage(body: string): string {
  try { const m = (JSON.parse(body) as { message?: unknown }).message; return typeof m === 'string' ? m.slice(0, 160) : ''; } catch { return ''; }
}

/** Mesaje acționabile, fără conținutul tokenului. */
export function errorFor(status: number, what: string, body: string, stage?: GhStage, rateLeft?: string | null): GhError {
  const gm = ghMessage(body);
  const tail = gm ? ` GitHub: „${gm}”.` : '';
  if (status === 401) return new GhError('auth', 'GitHub a refuzat tokenul (HTTP 401): e greșit, incomplet sau expirat. Creează un token nou și încearcă din nou.', status, stage);
  if (status === 404) return new GhError('no_access', `Tokenul nu are acces la ${TARGET.owner}/${TARGET.repo} (HTTP 404, ${what}). La „Repository access” alege „Only select repositories” → ${TARGET.owner}/${TARGET.repo}.`, status, stage);
  if ((status === 403 && rateLeft === '0') || status === 429) return new GhError('rate', `GitHub limitează temporar cererile (HTTP ${status}). Așteaptă câteva minute și încearcă din nou.`, status, stage);
  if (status === 403) return new GhError('forbidden', `Tokenul nu are permisiunea necesară (HTTP 403, ${what}). Setează „Contents: Read and write” pentru ${TARGET.owner}/${TARGET.repo}.${tail}`, status, stage);
  if (status === 409 || (status === 422 && /fast forward|reference/i.test(body))) return new GhError('conflict', `Ramura main s-a schimbat în timpul publicării (HTTP ${status}). Nu am suprascris nimic; încearcă din nou.`, status, stage);
  if (status === 422) return new GhError('invalid', `GitHub a respins cererea ca nevalidă (HTTP 422, ${what}).${tail}`, status, stage);
  return new GhError('other', `Eroare GitHub HTTP ${status} (${what}).${tail}`, status, stage);
}

/** parametru unic în URL: ocolește cache-ul HTTP al browserului fără antete în plus (vezi GitHubClient.req) */
export const bust = (url: string) => `${url}${url.includes('?') ? '&' : '?'}_sg=${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/**
 * Când fetch aruncă (nu există răspuns HTTP), deosebim lipsa rețelei de blocarea cererii autentificate de către
 * browser: o cerere simplă (fără antete, deci fără preflight CORS) către același API.
 */
export async function diagnoseThrow(f: Fetch, stage: GhStage, err: unknown): Promise<GhError> {
  const detail = err instanceof Error && err.message ? ` (browserul: „${err.message.slice(0, 80)}”)` : '';
  // erori ale browserului înainte de a trimite ceva (apel greșit, antet nevalid): nu sunt probleme de rețea
  if (err instanceof Error && /illegal invocation|instances of window|invalid (header|value)|not a valid http header/i.test(err.message)) {
    return new GhError('other', `Cererea nu a putut fi construită în acest browser${detail}. Nu s-a trimis nimic către GitHub; raportează eroarea.`, undefined, stage);
  }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return new GhError('network', `Telefonul nu are conexiune la internet${detail}.`, undefined, stage);
  try {
    const r = await f(bust(`${API}/zen`));
    if (r.status > 0) return new GhError('blocked', `api.github.com răspunde, dar browserul a blocat cererea cu token${detail}. Cauze posibile: un blocator de conținut, un VPN/filtru care modifică cererile sau o regulă CORS. Dezactivează blocatoarele pentru acest site și încearcă din nou.`, undefined, stage);
  } catch { /* nici cererea simplă nu trece */ }
  return new GhError('network', `Nu am putut contacta api.github.com${detail}. Verifică internetul (Wi-Fi/date mobile), VPN-ul sau un filtru de rețea.`, undefined, stage);
}

/**
 * `fetch` nativ al browserului trebuie apelat ca funcție, nu ca metodă a altui obiect: `this.f(url)` cu
 * `f = window.fetch` aruncă „Illegal invocation” (Chrome) / „Can only call Window.fetch on instances of Window”
 * (Safari) ÎNAINTE de a trimite cererea. Aceasta era cauza eșecului publicării din browser (afișat greșit ca
 * „fără internet”); în Node (testul cap-coadă din terminal) fetch nu verifică `this`, deci nu se vedea.
 */
export const callableFetch = (f?: Fetch): Fetch => {
  const g = f ?? fetch;
  return ((input: RequestInfo | URL, init?: RequestInit) => g(input, init)) as Fetch;
};

export class GitHubClient {
  private token: string;
  private f: Fetch;
  constructor(token: string, f?: Fetch) {
    this.token = normalizeToken(token);
    this.f = callableFetch(f);
  }
  /**
   * Fără opțiunea `cache`: prospețimea citirilor (ramura are Cache-Control: max-age=60) e asigurată de un parametru
   * unic în URL. Astfel cererea are doar antete din Access-Control-Allow-Headers al api.github.com (WebKit adaugă
   * pentru `cache: 'no-store'` antetele Cache-Control și Pragma, care nu sunt în listă; WebKit 18.2 le acceptă
   * totuși, dar nu ne bazăm pe asta).
   */
  async req<T>(method: string, path: string, what: string, body?: unknown, accept = 'application/vnd.github+json', stage?: GhStage): Promise<T> {
    let r: Response;
    try {
      r = await this.f(`${API}${method === 'GET' ? bust(path) : path}`, {
        method,
        headers: { Authorization: `Bearer ${this.token}`, Accept: accept, 'X-GitHub-Api-Version': '2022-11-28', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      throw await diagnoseThrow(this.f, stage ?? 'network', e);
    }
    const text = await r.text();
    if (!r.ok) throw errorFor(r.status, what, text, stage, r.headers.get('x-ratelimit-remaining'));
    if (accept.endsWith('raw') || accept.endsWith('raw+json')) return text as unknown as T;
    return (text ? JSON.parse(text) : null) as T;
  }
}

const repoPath = `/repos/${TARGET.owner}/${TARGET.repo}`;

/** ID-ul publicării din comfort-layer.json la o anumită versiune a repo-ului (null = fișier vechi, fără ID) */
async function publishedIdAt(gh: GitHubClient, ref: string): Promise<string | null> {
  try {
    const raw = await gh.req<string>('GET', `${repoPath}/contents/${TARGET.dir}/${PRIMARY_FILE}?ref=${ref}`, 'citirea stratului publicat', undefined, 'application/vnd.github.raw+json', 'read_layer');
    const j = JSON.parse(raw) as { meta?: { publication_id?: string; generated_at?: string } };
    return j.meta?.publication_id ?? null;
  } catch (e) {
    if (e instanceof GhError && e.status === 404) return null;
    throw e;
  }
}

export interface PublishInput {
  token: string;
  files: Record<string, string>;
  publicationId: string;
  /** ID-ul stratului publicat văzut în previzualizare: dacă între timp altcineva a publicat altceva, nu suprascriem */
  expectedPrevious: string | null;
  message: string;
  onStep?: (s: PublishStep) => void;
  fetch?: Fetch;
}

/**
 * Publică fișierele într-un singur commit pe main. Idempotent: dacă stratul publicat are deja același ID, nu face nimic.
 * Conflict: dacă stratul publicat diferă de cel din previzualizare → eroare „conflict” (nu suprascrie).
 * Dacă main a avansat doar cu alte modificări, reîncearcă o dată pe noul vârf.
 */
export async function publishToGitHub(i: PublishInput): Promise<PublishResult> {
  const gh = new GitHubClient(i.token, i.fetch);
  i.onStep?.('connect');
  await gh.req('GET', repoPath, 'accesul la repo', undefined, undefined, 'repo');
  for (let attempt = 0; attempt < 2; attempt++) {
    i.onStep?.('check');
    const ref = await gh.req<{ object: { sha: string } }>('GET', `${repoPath}/git/ref/heads/${TARGET.branch}`, 'ramura main', undefined, undefined, 'branch');
    const head = ref.object.sha;
    const current = await publishedIdAt(gh, head);
    if (current === i.publicationId) { i.onStep?.('unchanged'); return { commit: null, unchanged: true, previous: current, url: null }; }
    if (current !== i.expectedPrevious) throw new GhError('conflict', `Stratul publicat s-a schimbat după previzualizare (acum: ${current ?? 'fără ID'}). Generează din nou propunerea.`, undefined, 'read_layer');
    const base = await gh.req<{ tree: { sha: string } }>('GET', `${repoPath}/git/commits/${head}`, 'commitul curent', undefined, undefined, 'branch');
    i.onStep?.('upload');
    const tree: { path: string; mode: '100644'; type: 'blob'; sha: string }[] = [];
    for (const [name, content] of Object.entries(i.files)) {
      const b = await gh.req<{ sha: string }>('POST', `${repoPath}/git/blobs`, `încărcarea ${name}`, { content, encoding: 'utf-8' }, undefined, 'upload');
      tree.push({ path: `${TARGET.dir}/${name}`, mode: '100644', type: 'blob', sha: b.sha });
    }
    const t = await gh.req<{ sha: string }>('POST', `${repoPath}/git/trees`, 'structura commitului', { base_tree: base.tree.sha, tree }, undefined, 'commit');
    const c = await gh.req<{ sha: string; html_url?: string }>('POST', `${repoPath}/git/commits`, 'commitul', { message: i.message, tree: t.sha, parents: [head] }, undefined, 'commit');
    try {
      await gh.req('PATCH', `${repoPath}/git/refs/heads/${TARGET.branch}`, 'actualizarea ramurii main', { sha: c.sha, force: false }, undefined, 'ref');
    } catch (e) {
      if (e instanceof GhError && e.kind === 'conflict' && attempt === 0) continue; // main a avansat: reverificăm pe noul vârf
      throw e;
    }
    i.onStep?.('commit');
    return { commit: c.sha, unchanged: false, previous: current, url: c.html_url ?? `https://github.com/${TARGET.owner}/${TARGET.repo}/commit/${c.sha}` };
  }
  throw new GhError('conflict', 'Ramura main se schimbă continuu; încearcă din nou peste un minut.', 409, 'ref');
}

export interface ConnCheck { stage: GhStage; ok: boolean; status?: number; msg: string }
export interface ConnResult { ok: boolean; checks: ConnCheck[]; head: string | null; publishedId: string | null; error: GhError | null }

/**
 * „Testează conexiunea GitHub”: verifică rețeaua, tokenul, accesul la repo, ramura și permisiunea de scriere
 * FĂRĂ a modifica nimic. Scrierea se verifică trimițând un blob gol (fără conținut): cu permisiune, GitHub îl
 * respinge ca nevalid (422) fără a crea nimic; fără permisiune răspunde 403.
 */
export async function testConnection(token: string, f: Fetch = fetch): Promise<ConnResult> {
  const checks: ConnCheck[] = [];
  const done = (error: GhError | null, head: string | null = null, publishedId: string | null = null): ConnResult => ({ ok: !error, checks, head, publishedId, error });
  const fail = (e: unknown, stage: GhStage) => {
    const g = e instanceof GhError ? e : new GhError('other', (e as Error)?.message ?? 'eroare necunoscută', undefined, stage);
    if (!g.stage) g.stage = stage;
    checks.push({ stage: g.stage, ok: false, status: g.status, msg: g.message });
    return done(g);
  };
  let gh: GitHubClient;
  try { gh = new GitHubClient(token, f); } catch (e) { return fail(e, 'token'); }
  // 1. rețeaua: cerere simplă, fără token și fără antete (nu are preflight CORS)
  try {
    const r = await f(bust(`${API}${repoPath}`));
    checks.push({ stage: 'network', ok: true, status: r.status, msg: `api.github.com răspunde (HTTP ${r.status}).` });
  } catch (e) {
    return fail(await diagnoseThrow(f, 'network', e), 'network');
  }
  // 2. tokenul + accesul la repo (cerere autentificată, cu preflight CORS)
  try {
    await gh.req('GET', repoPath, 'accesul la repo', undefined, undefined, 'token');
    checks.push({ stage: 'token', ok: true, status: 200, msg: `Token acceptat; are acces la ${TARGET.owner}/${TARGET.repo}.` });
  } catch (e) { return fail(e, 'token'); }
  // 3. ramura main
  let head: string;
  try {
    head = (await gh.req<{ object: { sha: string } }>('GET', `${repoPath}/git/ref/heads/${TARGET.branch}`, 'ramura main', undefined, undefined, 'branch')).object.sha;
    checks.push({ stage: 'branch', ok: true, status: 200, msg: `Ramura main citită (${head.slice(0, 7)}).` });
  } catch (e) { return fail(e, 'branch'); }
  // 4. permisiunea de scriere, fără a scrie nimic
  try {
    await gh.req('POST', `${repoPath}/git/blobs`, 'verificarea permisiunii de scriere', {}, undefined, 'write');
    checks.push({ stage: 'write', ok: true, status: 201, msg: 'Scrierea e permisă.' });
  } catch (e) {
    if (e instanceof GhError && e.status === 422) checks.push({ stage: 'write', ok: true, status: 422, msg: 'Scrierea e permisă (verificat fără a crea nimic).' });
    else return fail(e, 'write');
  }
  // 5. stratul publicat acum (pentru conflicte)
  let publishedId: string | null = null;
  try {
    publishedId = await publishedIdAt(gh, head);
    checks.push({ stage: 'read_layer', ok: true, status: 200, msg: `Stratul publicat acum: ${publishedId ?? 'fără versiune (gol sau vechi)'}.` });
  } catch (e) { return fail(e, 'read_layer'); }
  return done(null, head, publishedId);
}

export type LiveState = { kind: 'deploying'; run: string | null } | { kind: 'waiting' } | { kind: 'live'; edges: number } | { kind: 'failed'; reason: string };

/** starea deploy-ului pentru un commit (API public, fără token; repo-ul e public). Cerere simplă: fără `cache`
 *  (în Safari ar adăuga antete care cer preflight CORS, refuzat de api.github.com) și fără antete proprii. */
export async function deployStatus(commit: string, f: Fetch = fetch): Promise<{ status: string; conclusion: string | null; url: string } | null> {
  try {
    const r = await f(bust(`${API}${repoPath}/actions/runs?head_sha=${commit}&per_page=5`));
    if (!r.ok) return null;
    const j = (await r.json()) as { workflow_runs?: { name: string; status: string; conclusion: string | null; html_url: string }[] };
    const run = j.workflow_runs?.find((x) => /deploy/i.test(x.name)) ?? j.workflow_runs?.[0];
    return run ? { status: run.status, conclusion: run.conclusion, url: run.html_url } : null;
  } catch { return null; }
}

/** Verifică pe site-ul LIVE că stratul are exact ID-ul și numărul de segmente așteptate (ocolind cache-urile). */
export async function checkLive(publicationId: string, expectedEdges: number, f: Fetch = fetch, base = LIVE_BASE): Promise<LiveState> {
  try {
    const r = await f(`${base}data/${PRIMARY_FILE}?v=${encodeURIComponent(publicationId)}&t=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) return { kind: 'waiting' };
    const j = (await r.json()) as { meta?: { publication_id?: string }; edges?: unknown[] };
    if (j.meta?.publication_id !== publicationId) return { kind: 'waiting' };
    if (!Array.isArray(j.edges) || j.edges.length !== expectedEdges) return { kind: 'failed', reason: `site-ul are ${Array.isArray(j.edges) ? j.edges.length : 0} segmente, se așteptau ${expectedEdges}` };
    return { kind: 'live', edges: j.edges.length };
  } catch { return { kind: 'waiting' }; }
}
