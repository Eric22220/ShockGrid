// Publicarea stratului aprobat în repo-ul ShockGrid prin API-ul REST GitHub (din browser, ShockGrid Dev).
// Un singur commit atomic cu toate fișierele (blob-uri → tree → commit → ref fără „force”), deci aplicația pentru
// bicicliști nu poate vedea o combinație de versiuni. GitHub Actions publică apoi site-ul (deploy.yml).
// Tokenul: primit ca parametru, folosit doar în antetul Authorization, niciodată salvat, logat sau inclus în erori.
import { PRIMARY_FILE, PUBLIC_DIR } from './publication';

export const TARGET = { owner: 'Eric22220', repo: 'ShockGrid', branch: 'main', dir: PUBLIC_DIR } as const;
import { LIVE_BASE } from '../appkind';
export { LIVE_BASE };
const API = 'https://api.github.com';

export type GhErrorKind = 'no_token' | 'auth' | 'no_access' | 'forbidden' | 'conflict' | 'network' | 'invalid' | 'other';
export class GhError extends Error {
  constructor(public kind: GhErrorKind, message: string, public status?: number) { super(message); }
}

export type PublishStep = 'connect' | 'check' | 'upload' | 'commit' | 'unchanged';
export interface PublishResult { commit: string | null; unchanged: boolean; previous: string | null; url: string | null }

type Fetch = typeof fetch;

/** Mesaje acționabile, fără conținutul tokenului. */
function errorFor(status: number, what: string, body: string): GhError {
  if (status === 401) return new GhError('auth', 'GitHub a refuzat tokenul (invalid sau expirat). Creează un token nou și încearcă din nou.', status);
  if (status === 404) return new GhError('no_access', `Tokenul nu are acces la ${TARGET.owner}/${TARGET.repo} (${what}). La „Repository access” alege doar acest repo.`, status);
  if (status === 403) return new GhError('forbidden', `Tokenul nu are permisiunea necesară (${what}). Setează „Contents: Read and write” pentru ${TARGET.owner}/${TARGET.repo}.`, status);
  if (status === 409 || (status === 422 && /fast forward|reference/i.test(body))) return new GhError('conflict', 'Repo-ul s-a schimbat între timp.', status);
  if (status === 422) return new GhError('invalid', `GitHub a respins cererea (${what}).`, status);
  return new GhError('other', `Eroare GitHub ${status} (${what}).`, status);
}

export class GitHubClient {
  constructor(private token: string, private f: Fetch = fetch) {
    if (!token || !token.trim()) throw new GhError('no_token', 'Publicarea cere un token GitHub.');
  }
  async req<T>(method: string, path: string, what: string, body?: unknown, accept = 'application/vnd.github+json'): Promise<T> {
    let r: Response;
    try {
      r = await this.f(`${API}${path}`, {
        method,
        headers: { Authorization: `Bearer ${this.token.trim()}`, Accept: accept, 'X-GitHub-Api-Version': '2022-11-28', ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        cache: 'no-store',
      });
    } catch {
      throw new GhError('network', 'Nu am putut contacta GitHub (fără internet?).');
    }
    const text = await r.text();
    if (!r.ok) throw errorFor(r.status, what, text);
    if (accept.endsWith('raw') || accept.endsWith('raw+json')) return text as unknown as T;
    return (text ? JSON.parse(text) : null) as T;
  }
}

const repoPath = `/repos/${TARGET.owner}/${TARGET.repo}`;

/** ID-ul publicării din comfort-layer.json la o anumită versiune a repo-ului (null = fișier vechi, fără ID) */
async function publishedIdAt(gh: GitHubClient, ref: string): Promise<string | null> {
  try {
    const raw = await gh.req<string>('GET', `${repoPath}/contents/${TARGET.dir}/${PRIMARY_FILE}?ref=${ref}`, 'citirea stratului publicat', undefined, 'application/vnd.github.raw+json');
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
  await gh.req('GET', repoPath, 'accesul la repo');
  for (let attempt = 0; attempt < 2; attempt++) {
    i.onStep?.('check');
    const ref = await gh.req<{ object: { sha: string } }>('GET', `${repoPath}/git/ref/heads/${TARGET.branch}`, 'ramura main');
    const head = ref.object.sha;
    const current = await publishedIdAt(gh, head);
    if (current === i.publicationId) { i.onStep?.('unchanged'); return { commit: null, unchanged: true, previous: current, url: null }; }
    if (current !== i.expectedPrevious) throw new GhError('conflict', `Stratul publicat s-a schimbat după previzualizare (acum: ${current ?? 'fără ID'}). Generează din nou propunerea.`);
    const base = await gh.req<{ tree: { sha: string } }>('GET', `${repoPath}/git/commits/${head}`, 'commitul curent');
    i.onStep?.('upload');
    const tree: { path: string; mode: '100644'; type: 'blob'; sha: string }[] = [];
    for (const [name, content] of Object.entries(i.files)) {
      const b = await gh.req<{ sha: string }>('POST', `${repoPath}/git/blobs`, `încărcarea ${name}`, { content, encoding: 'utf-8' });
      tree.push({ path: `${TARGET.dir}/${name}`, mode: '100644', type: 'blob', sha: b.sha });
    }
    const t = await gh.req<{ sha: string }>('POST', `${repoPath}/git/trees`, 'structura commitului', { base_tree: base.tree.sha, tree });
    const c = await gh.req<{ sha: string; html_url?: string }>('POST', `${repoPath}/git/commits`, 'commitul', { message: i.message, tree: t.sha, parents: [head] });
    try {
      await gh.req('PATCH', `${repoPath}/git/refs/heads/${TARGET.branch}`, 'actualizarea ramurii main', { sha: c.sha, force: false });
    } catch (e) {
      if (e instanceof GhError && e.kind === 'conflict' && attempt === 0) continue; // main a avansat: reverificăm pe noul vârf
      throw e;
    }
    i.onStep?.('commit');
    return { commit: c.sha, unchanged: false, previous: current, url: c.html_url ?? `https://github.com/${TARGET.owner}/${TARGET.repo}/commit/${c.sha}` };
  }
  throw new GhError('conflict', 'Ramura main se schimbă continuu; încearcă din nou peste un minut.');
}

export type LiveState = { kind: 'deploying'; run: string | null } | { kind: 'waiting' } | { kind: 'live'; edges: number } | { kind: 'failed'; reason: string };

/** starea deploy-ului pentru un commit (API public, fără token; repo-ul e public) */
export async function deployStatus(commit: string, f: Fetch = fetch): Promise<{ status: string; conclusion: string | null; url: string } | null> {
  try {
    const r = await f(`${API}${repoPath}/actions/runs?head_sha=${commit}&per_page=5`, { headers: { Accept: 'application/vnd.github+json' }, cache: 'no-store' });
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
