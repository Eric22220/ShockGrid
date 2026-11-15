// GitHub simulat pentru testele de publicare (fără rețea).
import { TARGET } from '../src/core/github';

// ---- GitHub simulat: refs, commit-uri, blob-uri, fișiere pe commit ----
export function fakeGitHub(opts: { token?: string; readonly?: boolean; noRepo?: boolean } = {}) {
  const commits = new Map<string, { parent: string | null; files: Map<string, string> }>();
  commits.set('c0', { parent: null, files: new Map([[`${TARGET.dir}/comfort-layer.json`, '{"meta":{"generated_at":"x"},"edges":[],"shocks":[]}']]) });
  const blobs = new Map<string, string>();
  const trees = new Map<string, { base: string; entries: { path: string; sha: string }[] }>();
  let head = 'c0', n = 0;
  const calls: string[] = [];
  const inits: { url: string; init?: RequestInit }[] = [];
  let beforePatch: (() => void) | null = null;
  const json = (status: number, body: unknown) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const f = (async (url: string, init?: RequestInit) => {
    const u = new URL(url);
    const method = init?.method ?? 'GET';
    const auth = (init?.headers as Record<string, string>)?.Authorization;
    calls.push(`${method} ${u.pathname}`);
    inits.push({ url, init });
    if (auth !== `Bearer ${opts.token ?? 'tok_valid_1234567890abcdef'}`) return json(401, { message: 'Bad credentials' });
    const p = u.pathname.replace(`/repos/${TARGET.owner}/${TARGET.repo}`, '');
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    if (opts.noRepo) return json(404, { message: 'Not Found' });
    if (p === '' && method === 'GET') return json(200, { full_name: 'x' });
    if (p === `/git/ref/heads/main`) return json(200, { object: { sha: head } });
    if (p.startsWith('/contents/')) { const c = commits.get(u.searchParams.get('ref')!)!; const t = c.files.get(p.slice('/contents/'.length)); return t ? new Response(t, { status: 200 }) : json(404, {}); }
    if (p.startsWith('/git/commits/') && method === 'GET') return json(200, { tree: { sha: `tree-of-${p.split('/').pop()}` } });
    if (opts.readonly && method !== 'GET') return json(403, { message: 'Resource not accessible by personal access token' });
    if (p === '/git/blobs' && typeof body?.content !== 'string') return json(422, { message: 'Invalid request.' });
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
    f, calls, inits, commits, get head() { return head; },
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
