// Verificarea cap-coadă a publicării reale, cu un set SINTETIC marcat „TEST” (nu cu tura privată).
// Folosește exact codul din ShockGrid Dev (src/core/github.ts): commit atomic → deploy GitHub Pages → verificare live.
// Utilizare (tokenul vine din mediu, nu e afișat și nu e salvat):  GH_TOKEN=… npx tsx scripts/e2e-publish.ts
// După verificare, setul sintetic se elimină cu un commit de revert (vezi PROGRESS.md).
import type { Snapshot } from '../src/core/aggregate';
import { checkLive, deployStatus, LIVE_BASE, publishToGitHub } from '../src/core/github';
import { parseSnapshot, publicationId, validatePublicDataset } from '../src/core/publication';
import { publicFiles } from '../src/core/publiclayer';
import { loadGraphIfExists } from './lib';

async function main() {
  const token = process.env.GH_TOKEN ?? '';
  if (!token) throw new Error('Lipsește GH_TOKEN.');
  const graph = loadGraphIfExists();
  if (!graph) throw new Error('Lipsește graful.');
  // două segmente pe un bulevard central, departe de orice tură reală; valori inventate, marcate TEST
  const street = 'Bulevardul Revoluției din 1989';
  const ids: number[] = [];
  for (let e = 0; e < graph.length.length && ids.length < 2; e++) if (graph.name[e] === street && graph.length[e] > 60) ids.push(e);
  if (ids.length < 2) throw new Error(`Nu am găsit segmente pe ${street}.`);
  const day = new Date().toISOString().slice(0, 10);
  const snap: Snapshot = {
    meta: {
      processing_version: 'sg-1.2.0', generated_at: new Date().toISOString(), thresholds: null,
      thresholds_source: 'TEST SINTETIC: verificarea publicării, se șterge imediat',
      device_note: 'TEST SINTETIC — date inventate, se șterg imediat', ride_keys: [], n_rides: 0,
      attribution: '© OpenStreetMap contributors', license: 'ODbL-1.0',
    },
    edges: ids.map((edge_id, i) => ({
      edge_id, rms: Array(8).fill(i ? 2.4 : 0.9), speed: Array(8).fill(5), acc: Array(8).fill(4),
      n_total: 8, n_amb: 0, n_passes: 2, n_rides: 2, last_seen: day, sources: ['shockgrid' as const],
    })),
    shocks: [],
  };
  snap.meta.publication_id = publicationId(snap);
  const errs = validatePublicDataset(snap);
  if (errs.length) throw new Error(`Set invalid: ${errs.join('; ')}`);
  const { files } = publicFiles(snap, graph);
  const liveNow = parseSnapshot(await (await fetch(`${LIVE_BASE}data/comfort-layer.json?t=${Date.now()}`, { cache: 'no-store' })).json());
  console.log(`stratul publicat acum: ${liveNow?.meta.publication_id ?? '(fără ID)'} · ${liveNow?.edges.length ?? '?'} segmente`);
  const id = snap.meta.publication_id;
  const res = await publishToGitHub({ token, files, publicationId: id, expectedPrevious: liveNow?.meta.publication_id ?? null, message: `TEST SINTETIC ${id}: verificarea publicării din ShockGrid Dev (se revine imediat)`, onStep: (s) => console.log(`pas: ${s}`) });
  console.log(`commit: ${res.commit ?? '(neschimbat)'}`);
  const t0 = Date.now();
  while (Date.now() - t0 < 12 * 60 * 1000) {
    const st = res.commit ? await deployStatus(res.commit) : null;
    const l = await checkLive(id, snap.edges.length);
    console.log(`${Math.round((Date.now() - t0) / 1000)} s · deploy ${st ? `${st.status}/${st.conclusion ?? '-'}` : '?'} · live ${l.kind}`);
    if (l.kind === 'live') { console.log(`PUBLICAT ȘI VERIFICAT: ${id}, ${l.edges} segmente pe ${LIVE_BASE}`); return; }
    if (l.kind === 'failed') throw new Error(l.reason);
    if (st?.status === 'completed' && st.conclusion !== 'success') throw new Error(`deploy ${st.conclusion}`);
    await new Promise((r) => setTimeout(r, 15000));
  }
  throw new Error('timeout');
}
main().catch((e) => { console.error(`EȘUAT: ${(e as Error).message}`); process.exit(1); });
