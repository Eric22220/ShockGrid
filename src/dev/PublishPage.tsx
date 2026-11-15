// ShockGrid Dev → „Strat public”: date → generare + audit → previzualizare pe hartă → aprobare explicită →
// publicare reală în repo-ul ShockGrid (un commit atomic prin API-ul GitHub) → verificare pe site-ul LIVE.
// Tokenul GitHub stă doar în memoria acestei pagini (starea componentei): nu se salvează nicăieri (fără localStorage,
// sessionStorage, IndexedDB, cookie sau URL). Rămâne după o eroare, pentru reîncercare; se șterge după publicarea
// confirmată, la „Șterge tokenul” sau la ieșirea din pagină.
import { CheckCircle2, Circle, Download, ExternalLink, FileCheck2, Loader2, ShieldCheck, Upload, XCircle } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { aggregate, snapshotRideCount, type Snapshot } from '../core/aggregate';
import { checkLive, deployStatus, GhError, LIVE_BASE, publishToGitHub, STAGE_LABEL, TARGET, testConnection, type ConnResult, type GhStage, type PublishStep } from '../core/github';
import { diffSnapshots, parseSnapshot, publishBlockers, validatePublicDataset, type SnapshotDiff } from '../core/publication';
import { auditLayer, buildPublicLayer, coverageReport, type AuditResult, type CoverageReport, type PublicLayerFiles } from '../core/publiclayer';
import { fromPublic } from '../core/hazards';
import { PRIVACY_RADIUS_M } from '../core/publish';
import { useApp } from '../state/store';
import { download, fmtLen } from '../ui/format';
import { Banner, toast } from '../ui/kit';
import { drawComfort, drawHazards } from '../ui/map/draw';
import { L, useLayerGroup, useLeaflet } from '../ui/map/useLeaflet';
import { CoveragePanel, useCoverage } from './Hazards';
import { DemoReset } from './DemoReset';

type Out = { layer: PublicLayerFiles; audit: AuditResult; invalid: string[]; diff: SnapshotDiff | null; cov: CoverageReport };
type Phase =
  | { k: 'idle' }
  | { k: 'running'; step: PublishStep | 'deploy' | 'verify'; detail?: string }
  | { k: 'done'; commit: string | null; url: string | null; run: string | null; unchanged: boolean }
  | { k: 'error'; msg: string; stage?: GhStage; status?: number };

const MAX_WAIT_MS = 10 * 60 * 1000;

export function PublishPage() {
  const graph = useApp((s) => s.graph);
  const rides = useApp((s) => s.rides);
  const localLayer = useApp((s) => s.layer);
  const reviews = useApp((s) => s.reviews);
  const included = useMemo(() => rides.filter((r) => r.included), [rides]);
  // implicit: tot traseul parcurs eligibil (neutru, „Parcurs, neevaluat”) și toate problemele detectate automat
  const [exploratory, setExploratory] = useState(true);
  const [hazMode, setHazMode] = useState<'all' | 'confirmed'>('all');
  const cov = useCoverage();
  const [out, setOut] = useState<Out | null>(null);
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState<{ snap: Snapshot | null; ok: boolean } | null>(null);
  const [approve, setApprove] = useState(false);
  const [approveLow, setApproveLow] = useState(false);
  const [token, setToken] = useState('');
  const [phase, setPhase] = useState<Phase>({ k: 'idle' });
  const [conn, setConn] = useState<ConnResult | 'running' | null>(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []); // StrictMode montează de două ori
  const clearToken = () => { setToken(''); setConn(null); };
  const errPhase = (e: unknown): Phase => e instanceof GhError
    ? { k: 'error', msg: e.message, stage: e.stage, status: e.status }
    : { k: 'error', msg: 'Publicarea a eșuat dintr-un motiv neașteptat. Propunerea și tokenul rămân aici; încearcă din nou.' };
  const runTest = async () => {
    setConn('running');
    const r = await testConnection(token);
    if (alive.current) setConn(r);
  };

  // stratul publicat ACUM pe site-ul bicicliștilor (sursa adevărului pentru diferență și conflicte)
  const loadLive = async () => {
    try {
      const r = await fetch(`${LIVE_BASE}data/comfort-layer.json?t=${Date.now()}`, { cache: 'no-store' });
      const j = r.ok ? parseSnapshot(await r.json()) : null;
      setLive({ snap: j, ok: r.ok && !!j });
    } catch { setLive({ snap: null, ok: false }); }
  };
  useEffect(() => { void loadLive(); }, []);

  const reset = () => { setOut(null); setApprove(false); setApproveLow(false); setPhase({ k: 'idle' }); };
  const generate = () => {
    if (!graph || !included.length) return;
    setBusy(true); reset();
    setTimeout(() => {
      try {
        const ps = included.map((r) => r.processed);
        const layer = buildPublicLayer(ps, graph, { exploratory, shocks: 'none', hazards: hazMode, decisionOf: (k) => reviews[k] });
        const audit = auditLayer(layer.snap, Object.values(layer.files).join(''), included.map((r) => ({ p: r.processed, file: r.file_name, name: r.file_name.replace(/\.zip$/i, '') })), graph);
        const invalid = validatePublicDataset(layer.snap);
        setOut({ layer, audit, invalid, diff: live?.ok ? diffSnapshots(live.snap, layer.snap) : null, cov: coverageReport(ps, graph, layer.snap) });
      } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
    }, 30);
  };
  useEffect(() => { if (out && live?.ok && !out.diff) setOut({ ...out, diff: diffSnapshots(live.snap, out.layer.snap) }); }, [live]); // eslint-disable-line react-hooks/exhaustive-deps

  const c = out?.layer.manifest.counts;
  // date cu încredere redusă: segmente incerte, traseu parcurs neevaluat și probleme detectate automat (neconfirmate)
  const lowCount = c ? c.low_confidence + c.explored + c.hazards_unverified : 0;
  const pass = !!out && out.audit.ok && out.invalid.length === 0;
  const blockers = out ? publishBlockers({ auditOk: out.audit.ok, invalid: out.invalid, liveKnown: !!live?.ok, approved: approve, lowCount, lowApproved: approveLow, token }) : ['generează propunerea'];
  const canPublish = blockers.length === 0 && phase.k !== 'running';

  const publish = async () => {
    if (!out || !canPublish) return;
    const tok = token; // rămâne în câmp până la confirmare: la o eroare se poate reîncerca fără a-l lipi din nou
    const id = out.layer.snap.meta.publication_id!;
    try {
      setPhase({ k: 'running', step: 'connect' });
      const res = await publishToGitHub({
        token: tok, files: out.layer.files, publicationId: id, expectedPrevious: live?.snap?.meta.publication_id ?? null,
        message: `Strat public ${id} (publicat din ShockGrid Dev)\n\n${c!.segments} segmente, ${c!.meters} m; probleme: ${c!.hazards_verified} confirmate, ${c!.hazards_unverified} detectate automat (neconfirmate). Date agregate auditate; fără trasee, ore sau identificatori.`,
        onStep: (s) => alive.current && setPhase({ k: 'running', step: s }),
      });
      // verificarea pe site-ul live: deploy-ul GitHub Pages durează câteva minute
      const t0 = Date.now();
      let run: string | null = null;
      while (alive.current && Date.now() - t0 < MAX_WAIT_MS) {
        const st = res.commit ? await deployStatus(res.commit) : null;
        if (st) run = st.url;
        if (st?.status === 'completed' && st.conclusion !== 'success') throw new GhError('deploy', `Deploy-ul GitHub Pages a eșuat (${st.conclusion}). Commitul există; vezi Actions, apoi apasă din nou Publică (nu se creează alt commit).`, undefined, 'deploy');
        const l = await checkLive(id, out.layer.snap.edges.length);
        if (l.kind === 'live') { setToken(''); setConn(null); setPhase({ k: 'done', commit: res.commit, url: res.url, run, unchanged: res.unchanged }); void loadLive(); return; }
        if (l.kind === 'failed') throw new GhError('verify', `Versiunea a ajuns pe site, dar nu corespunde: ${l.reason}.`, undefined, 'verify');
        setPhase({ k: 'running', step: st && st.status !== 'completed' ? 'deploy' : 'verify', detail: `${Math.round((Date.now() - t0) / 1000)} s${st ? ` · deploy: ${st.status === 'completed' ? 'terminat' : st.status === 'in_progress' ? 'în curs' : 'în așteptare'}` : ''}` });
        await new Promise((r) => setTimeout(r, 10000));
      }
      if (alive.current) setPhase({ k: 'error', stage: 'verify', msg: `Commitul a fost creat${res.commit ? ` (${res.commit.slice(0, 7)})` : ''}, dar site-ul live nu arată încă versiunea nouă după ${MAX_WAIT_MS / 60000} minute. Verifică Actions; propunerea rămâne aici.` });
    } catch (e) {
      if (alive.current) setPhase(errPhase(e));
      if (e instanceof GhError && e.kind === 'conflict') void loadLive();
    }
  };

  const center = useMemo(() => {
    if (!graph || !out?.layer.snap.edges.length) return null;
    let la = 0, lo = 0, n = 0;
    for (const e of out.layer.snap.edges) for (const [a, b] of graph.geometry(e.edge_id)) { la += a; lo += b; n++; }
    return n ? [la / n, lo / n] as [number, number] : null;
  }, [graph, out]);
  const citizenUrl = `${LIVE_BASE}#/${center ? `?at=${center[0].toFixed(5)},${center[1].toFixed(5)}${lowCount ? '&uncertain=1' : ''}` : ''}`;

  return (
    <main className="screen"><div className="wrap stack">
      <h1>Strat public</h1>
      <p className="small muted" style={{ marginTop: -6 }}>Din turele din acest browser în aplicația ShockGrid, pentru toți utilizatorii. Nimic nu se publică fără aprobarea ta.</p>

      <section className="card stack pub-step">
        <h3><span className="pub-n">1</span> Date</h3>
        <div className="dev-stats">
          <div className="card"><div className="small muted">Ture selectate</div><div className="big num">{included.length}</div><div className="xs muted">din {rides.length} în acest browser</div></div>
          <div className="card"><div className="small muted">Segmente eligibile</div><div className="big num">{c ? c.segments : '—'}</div><div className="xs muted">{c ? fmtLen(c.meters) : 'după generare'}</div></div>
          <div className="card"><div className="small muted">Încredere</div><div className="big num">{c ? `${c.measured} / ${c.low_confidence}` : '—'}</div><div className="xs muted">{c ? `măsurate sigur / incerte${c.explored ? ` · ${c.explored} explorate lent` : ''}` : 'măsurat / incert'}</div></div>
          <div className="card"><div className="small muted">Probleme</div><div className="big num">{c ? `${c.hazards_verified} / ${c.hazards_unverified}` : '—'}</div><div className="xs muted">{c ? `confirmate / detectate automat${c.hazards_likely ? ` (${c.hazards_likely} probabile)` : ''}` : 'confirmate / automate'}</div></div>
        </div>
        {cov && <CoveragePanel c={cov} pub={out?.cov ?? null} />}
        <div className="row">
          <label className="switch"><input type="checkbox" checked={exploratory} onChange={(e) => { setExploratory(e.target.checked); reset(); }} /><span className="small">Include traseul parcurs neevaluat („Parcurs, neevaluat”, fără culoare)</span></label>
          <label className="switch"><input type="checkbox" checked={hazMode === 'all'} onChange={(e) => { setHazMode(e.target.checked ? 'all' : 'confirmed'); reset(); }} /><span className="small">Include problemele detectate automat (neconfirmate); altfel doar cele confirmate</span></label>
        </div>
        <p className="xs muted" style={{ margin: 0 }}>Verificarea manuală e opțională (Zone și șocuri): „Nu este o problemă” scoate zona din această publicare; „Confirmă” o marchează confirmată.</p>
      </section>

      <section className="card stack pub-step">
        <h3><span className="pub-n">2</span> Generează și auditează</h3>
        <button className="btn primary" disabled={!graph || !included.length || busy} onClick={generate}><FileCheck2 /> {busy ? 'Se generează…' : 'Generează și auditează'}</button>
        {!included.length && <p className="small muted" style={{ margin: 0 }}>Nicio tură activă. Importă una sau copiaz-o din aplicația ShockGrid (Panou).</p>}
        {out && (
          <>
            <Banner kind={pass ? 'ok' : 'danger'}><b>{pass ? 'PASS' : 'FAIL: publicarea e blocată.'}</b> {pass ? 'Confidențialitatea și structura sunt în regulă.' : 'Motive mai jos.'}</Banner>
            <ul className="small pub-checks">
              {out.invalid.map((m) => <li key={m} className="bad"><XCircle /> {m}</li>)}
              {out.audit.checks.map((x, i) => <li key={i} className={x.ok ? '' : 'bad'}>{x.ok ? <CheckCircle2 /> : <XCircle />} {x.msg}</li>)}
            </ul>
            <p className="xs muted" style={{ margin: 0 }}>Reguli fixe: fără ID-uri, nume de fișiere sau dispozitive, fără ore (doar data), fără primii/ultimii 200 m și nimic la mai puțin de {PRIVACY_RADIUS_M} m de capetele turelor.</p>
          </>
        )}
      </section>

      {out && graph && (
        <section className="card stack pub-step">
          <h3><span className="pub-n">3</span> Previzualizare</h3>
          <PreviewMap snap={out.layer.snap} published={live?.snap ?? null} localEdges={[...localLayer.edges.values()].filter((e) => e.status !== 'UNKNOWN' || e.explore).map((e) => e.edge_id)} />
          <div className="pub-legend small">
            <span><i style={{ background: '#1b7a3a' }} />propus (culoare = confort; întrerupt = incert)</span>
            <span><i style={{ background: '#5a6677' }} />publicat acum</span>
            <span><i style={{ background: '#c2261b', height: 2 }} />exclus (confidențialitate sau date insuficiente)</span>
            <span><i style={{ background: '#e8590c', height: 6 }} />problemă (plin = confirmată/probabilă, întrerupt = posibilă)</span>
          </div>
          {out.layer.hazards.some((h) => h.detail?.excluded && h.level !== 'rejected' && h.level !== 'weak') && <p className="xs muted" style={{ margin: 0 }}>Probleme detectate dar nepublicate (confidențialitate): {out.layer.hazards.filter((h) => h.detail?.excluded && h.level !== 'rejected' && h.level !== 'weak').length}. Rămân vizibile doar în Dev.</p>}
          {out.diff ? (
            <p className="small" style={{ margin: 0 }}><b>{out.diff.added.length}</b> segmente noi · <b>{out.diff.updated.length}</b> actualizate · <b>{out.diff.unchanged.length}</b> neschimbate · <b>{out.diff.removed.length}</b> dispar din stratul public{live?.snap && snapshotRideCount(live.snap) ? ` (stratul publicat acum: ${live.snap.edges.length} segmente)` : ' (acum nu e nimic publicat)'}.</p>
          ) : <Banner kind="warn">Nu am putut citi stratul publicat de pe {LIVE_BASE}. <button className="btn sm" onClick={() => void loadLive()}>Reîncearcă</button></Banner>}
          {out.diff && out.diff.removed.length > 0 && <Banner kind="warn">Publicarea înlocuiește stratul actual: {out.diff.removed.length} segmente publicate anterior nu apar în propunere (turele lor nu sunt în acest browser).</Banner>}
          {c && c.meters < 1000 && <Banner kind="info">Propunerea adaugă foarte puțin: {fmtLen(c.meters)} de stradă. Harta bicicliștilor va rămâne aproape fără culori.</Banner>}
          {c && c.measured === 0 && c.segments > 0 && <Banner kind="warn">Niciun segment nu e „măsurat sigur” (o singură trecere, viteză mică sau GPS slab). În ShockGrid apar ca „Parcurs, neevaluat” (neutru), iar rutele nu le folosesc ca dovadă de confort.</Banner>}
        </section>
      )}

      {out && pass && (
        <section className="card stack pub-step">
          <h3><span className="pub-n">4</span> Aprobare</h3>
          <p className="small" style={{ margin: 0 }}>Un singur commit în <code>{TARGET.owner}/{TARGET.repo}</code>, ramura <code>{TARGET.branch}</code>, versiunea <code>{out.layer.snap.meta.publication_id}</code>:</p>
          <ul className="small pub-files">{Object.entries(out.layer.files).map(([n, t]) => <li key={n}><code>{TARGET.dir}/{n}</code> <span className="muted">{(t.length / 1024).toFixed(1)} KB</span></li>)}</ul>
          <div className="row">{Object.entries(out.layer.files).map(([n, t]) => <button key={n} className="btn sm ghost" onClick={() => download(n, t, 'application/json')}><Download /> {n}</button>)}</div>
          <label className="switch pub-confirm"><input type="checkbox" checked={approve} onChange={(e) => setApprove(e.target.checked)} /><span>Confirm că am dreptul să public aceste măsurători și aprob setul de date anonimizat.</span></label>
          {lowCount > 0 && <label className="switch pub-confirm"><input type="checkbox" checked={approveLow} onChange={(e) => setApproveLow(e.target.checked)} /><span>Știu că {c!.low_confidence + c!.explored} {c!.low_confidence + c!.explored === 1 ? 'segment are' : 'segmente au'} încredere redusă (apar neutru, „Parcurs, neevaluat”){c!.hazards_unverified ? ` și ${c!.hazards_unverified} ${c!.hazards_unverified === 1 ? 'problemă e detectată' : 'probleme sunt detectate'} automat, neconfirmate (apar ca „posibile”)` : ''}; nimic nu e validat pe teren.</span></label>}
        </section>
      )}

      {out && pass && (
        <section className="card stack pub-step">
          <h3><span className="pub-n">5</span> Publică</h3>
          {phase.k !== 'done' && (
            <>
              <label className="field"><span>Token GitHub (doar pentru această publicare)</span>
                <input className="input" type="password" name="sg-publish-token" autoComplete="off" autoCapitalize="off" autoCorrect="off" spellCheck={false} value={token} onChange={(e) => { setToken(e.target.value); setConn(null); }} placeholder="github_pat_…" disabled={phase.k === 'running'} />
              </label>
              <div className="row">
                <button className="btn" disabled={!token || conn === 'running' || phase.k === 'running'} onClick={() => void runTest()}>{conn === 'running' ? <Loader2 className="spin" /> : <ShieldCheck />} Testează conexiunea GitHub</button>
                {token && <button className="btn ghost" disabled={phase.k === 'running'} onClick={clearToken}><XCircle /> Șterge tokenul</button>}
              </div>
              {conn && conn !== 'running' && <ConnReport r={conn} />}
              <details className="small">
                <summary>Cum obțin tokenul (1 minut)</summary>
                <ol style={{ margin: '6px 0 0', paddingLeft: 20 }}>
                  <li><a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">GitHub → Fine-grained token nou <ExternalLink style={{ width: 13, height: 13 }} /></a>, expirare 1 zi.</li>
                  <li>Repository access: <b>Only select repositories → {TARGET.owner}/{TARGET.repo}</b>.</li>
                  <li>Permissions → Repository → <b>Contents: Read and write</b> (nimic altceva).</li>
                  <li>Copiază tokenul aici și apasă „Testează conexiunea GitHub” (nu modifică nimic).</li>
                  <li>Tokenul nu se salvează: rămâne doar cât e deschisă pagina, dispare după publicarea confirmată sau la „Șterge tokenul”. Revocă-l după demo.</li>
                </ol>
              </details>
              <button className="btn primary lg block" disabled={!canPublish} onClick={() => void publish()}><Upload /> Publică pe ShockGrid</button>
              {blockers.length > 0 && phase.k !== 'running' && <p className="xs muted" style={{ margin: 0 }}>Încă nu: {blockers.join('; ')}.</p>}
            </>
          )}
          {phase.k !== 'idle' && <Progress phase={phase} />}
          {phase.k === 'error' && <Banner kind="danger">{phase.stage && <><b>Etapa: {STAGE_LABEL[phase.stage]}{phase.status ? ` · HTTP ${phase.status}` : ''}.</b> </>}{phase.msg}{token ? ' Tokenul a rămas în câmp: poți reîncerca.' : ''}</Banner>}
        </section>
      )}

      {phase.k === 'done' && out && (
        <section className="card stack pub-step pub-done">
          <h3><span className="pub-n">6</span> {phase.unchanged ? 'Deja publicat' : 'Datele au fost publicate în ShockGrid.'}</h3>
          <dl className="kv">
            <dt>versiune</dt><dd><code>{out.layer.snap.meta.publication_id}</code></dd>
            <dt>segmente</dt><dd>{out.diff ? `${out.diff.added.length} noi, ${out.diff.updated.length} actualizate` : '—'} · total {c!.segments} ({fmtLen(c!.meters)})</dd>
            <dt>pe site-ul live</dt><dd>verificat: aceeași versiune, {out.layer.snap.edges.length} segmente</dd>
            {phase.commit && <><dt>commit</dt><dd><a href={phase.url ?? '#'} target="_blank" rel="noopener">{phase.commit.slice(0, 7)}</a>{phase.run && <> · <a href={phase.run} target="_blank" rel="noopener">deploy</a></>}</dd></>}
          </dl>
          {phase.unchanged && <p className="small" style={{ margin: 0 }}>Aceeași versiune era deja publicată: nu am creat alt commit.</p>}
          <a className="btn primary lg block" href={citizenUrl} target="_blank" rel="noopener"><ExternalLink /> Deschide ShockGrid</a>
          <p className="xs muted" style={{ margin: 0 }}>Pe alt telefon: deschide {LIVE_BASE.replace('https://', '')}: traseul parcurs apare neutru, problemele apar pe străzi. Fără import de fișiere.</p>
        </section>
      )}

      <DemoReset token={token} setToken={setToken} live={live?.snap ?? null} liveOk={!!live?.ok} reload={loadLive} busy={phase.k === 'running'} />
    </div></main>
  );
}

function ConnReport({ r }: { r: ConnResult }) {
  return (
    <div className="stack" style={{ gap: 6 }}>
      <Banner kind={r.ok ? 'ok' : 'danger'}>{r.ok ? <><b>Conexiune în regulă.</b> Tokenul poate publica în {TARGET.owner}/{TARGET.repo}. Nimic nu a fost modificat.</> : <><b>Testul a eșuat la: {STAGE_LABEL[r.error!.stage ?? 'network']}{r.error!.status ? ` · HTTP ${r.error!.status}` : ''}.</b> {r.error!.message}</>}</Banner>
      <ul className="small pub-checks">
        {r.checks.map((c, i) => <li key={i} className={c.ok ? '' : 'bad'}>{c.ok ? <CheckCircle2 /> : <XCircle />} {STAGE_LABEL[c.stage]}{c.status ? ` (HTTP ${c.status})` : ''}: {c.msg}</li>)}
      </ul>
    </div>
  );
}

const STEPS: { k: string; l: string }[] = [
  { k: 'connect', l: 'Conectare la GitHub' },
  { k: 'upload', l: 'Încărcarea setului aprobat' },
  { k: 'commit', l: 'Commit creat' },
  { k: 'deploy', l: 'Deploy (GitHub Pages)' },
  { k: 'verify', l: 'Verificare pe site-ul live' },
  { k: 'done', l: 'Publicat' },
];
function Progress({ phase }: { phase: Phase }) {
  const at = phase.k === 'done' ? 6 : phase.k === 'running' ? ({ connect: 0, check: 0, upload: 1, commit: 2, unchanged: 3, deploy: 3, verify: 4 } as Record<string, number>)[phase.step] ?? 0 : -1;
  return (
    <ol className="pub-progress">
      {STEPS.map((s, i) => (
        <li key={s.k} className={i < at ? 'ok' : i === at && phase.k === 'running' ? 'now' : ''}>
          {i < at ? <CheckCircle2 /> : i === at && phase.k === 'running' ? <Loader2 className="spin" /> : <Circle />}
          <span>{s.l}{i === at && phase.k === 'running' && phase.detail ? ` · ${phase.detail}` : ''}</span>
        </li>
      ))}
    </ol>
  );
}

function PreviewMap({ snap, published, localEdges }: { snap: Snapshot; published: Snapshot | null; localEdges: number[] }) {
  const graph = useApp((s) => s.graph)!;
  const { ref, map } = useLeaflet({ zoom: 14 });
  const proposed = useMemo(() => aggregate({ snapshot: snap, rides: [], surfaceKindOf: (e) => graph.kind[e] ?? null, version: 1, lengthOf: (e) => graph.length[e] }), [snap, graph]);
  useLayerGroup(map, (g) => {
    const inSnap = new Set(snap.edges.map((e) => e.edge_id));
    const pts: [number, number][] = [];
    for (const e of published?.edges ?? []) L.polyline(graph.geometry(e.edge_id), { color: '#5a6677', weight: 10, opacity: 0.35, interactive: false }).addTo(g);
    for (const id of localEdges) if (!inSnap.has(id)) L.polyline(graph.geometry(id), { color: '#c2261b', weight: 2, opacity: 0.7, dashArray: '3 5', interactive: false }).addTo(g);
    drawComfort(g, graph, proposed, null, { uncertain: true });
    for (const e of snap.edges) pts.push(...graph.geometry(e.edge_id));
    for (const s of snap.shocks) L.circleMarker([s.lat, s.lon], { radius: 7, color: '#fff', weight: 2, fillColor: '#e8590c', fillOpacity: 0.5, dashArray: '3 3', interactive: false }).bindTooltip('șoc neverificat').addTo(g);
    drawHazards(g, graph, fromPublic(snap.hazards), null);
    if (pts.length) map!.fitBounds(L.latLngBounds(pts), { padding: [30, 30], maxZoom: 17, animate: false });
  }, [snap, published, proposed]);
  return <div ref={ref} className="map inline tall" role="img" aria-label="Previzualizarea stratului propus pe hartă" />;
}
