// „Reset demonstrație” (ShockGrid Dev). Două acțiuni SEPARATE, fiecare cu confirmarea ei:
//  1. local: turele importate, analizele, deciziile, rapoartele și starea demo-ului DIN ACEST BROWSER (baza „shockgrid-dev”).
//     Nu publică nimic, deci nu poate goli harta publică din greșeală.
//  2. harta publică: publică, prin același mecanism auditat (commit atomic + verificare live), un set GOL marcat `reset`.
//     Versiunea anterioară rămâne în istoricul git (se poate restaura cu `git revert`) și se poate descărca înainte.
// Nu atinge niciodată aplicația ShockGrid a altor telefoane (rapoartele și istoricul lor rămân pe acele telefoane),
// fișierele ZIP originale sau baza aplicației pentru bicicliști de pe acest telefon.
import { Download, RotateCcw, Trash2 } from 'lucide-react';
import { useState } from 'react';
import type { Snapshot } from '../core/aggregate';
import { checkLive, GhError, LIVE_BASE, publishToGitHub, STAGE_LABEL } from '../core/github';
import { resetLayer } from '../core/publiclayer';
import { snapshotVersion } from '../core/publication';
import { resetLocalDemo, useApp } from '../state/store';
import { download } from '../ui/format';
import { Banner, toast } from '../ui/kit';

const MAX_WAIT_MS = 10 * 60 * 1000;

export function DemoReset({ token, setToken, live, liveOk, reload, busy }: { token: string; setToken: (t: string) => void; live: Snapshot | null; liveOk: boolean; reload: () => Promise<void>; busy: boolean }) {
  const graph = useApp((s) => s.graph);
  const rides = useApp((s) => s.rides);
  const reviews = useApp((s) => s.reviews);
  const rejected = useApp((s) => s.rejected);
  const reports = useApp((s) => s.reports);
  const [okLocal, setOkLocal] = useState(false);
  const [localDone, setLocalDone] = useState<string | null>(null);
  const [okPublic, setOkPublic] = useState(false);
  const [pub, setPub] = useState<{ k: 'idle' } | { k: 'running'; msg: string } | { k: 'done'; id: string } | { k: 'error'; msg: string }>({ k: 'idle' });
  const liveIsEmpty = !!live && !live.edges.length && !live.shocks.length && !(live.hazards?.length);

  const backup = () => {
    // copia de siguranță: deciziile de verificare și stratul publicat acum (deja public); fără fișiere ZIP sau trasee
    const data = { saved_at: new Date().toISOString(), what: 'ShockGrid Dev: copia de siguranță înainte de reset (decizii de verificare + stratul publicat acum)', reviews, rejected, public_layer: live };
    download(`shockgrid-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data, null, 1), 'application/json');
  };

  const resetLocal = async () => {
    const n = await resetLocalDemo();
    setOkLocal(false);
    setLocalDone(`Șterse din acest browser: ${n.rides} ${n.rides === 1 ? 'tură' : 'ture'}, ${n.reviews} decizii, ${n.reports} rapoarte locale. Harta publică a rămas neschimbată (${snapshotVersion(live) ?? 'fără versiune'}).`);
    toast('Datele locale ale demonstrației au fost șterse');
  };

  const resetPublic = async () => {
    if (!graph || !okPublic || !liveOk) return;
    const files = resetLayer(graph);
    const id = files.snap.meta.publication_id!;
    try {
      setPub({ k: 'running', msg: 'Se publică setul gol (reset)…' });
      const res = await publishToGitHub({
        token, files: files.files, publicationId: id, expectedPrevious: live?.meta.publication_id ?? null,
        message: `Reset demonstrație: harta publică golită (${id})\n\nVersiunea anterioară: ${snapshotVersion(live) ?? '—'} (se poate restaura cu git revert).`,
      });
      const t0 = Date.now();
      while (Date.now() - t0 < MAX_WAIT_MS) {
        const l = await checkLive(id, 0);
        if (l.kind === 'live') { setPub({ k: 'done', id }); setToken(''); setOkPublic(false); await reload(); return; }
        if (l.kind === 'failed') throw new GhError('verify', `Site-ul live nu corespunde: ${l.reason}.`, undefined, 'verify');
        setPub({ k: 'running', msg: `Commit ${res.commit?.slice(0, 7) ?? '(neschimbat)'} · așteptăm site-ul live (${Math.round((Date.now() - t0) / 1000)} s)…` });
        await new Promise((r) => setTimeout(r, 10000));
      }
      setPub({ k: 'error', msg: 'Commitul a fost creat, dar site-ul live nu arată încă harta goală după 10 minute. Verifică Actions.' });
    } catch (e) {
      setPub({ k: 'error', msg: e instanceof GhError ? `${e.stage ? `Etapa: ${STAGE_LABEL[e.stage]}${e.status ? ` · HTTP ${e.status}` : ''}. ` : ''}${e.message}` : 'Golirea a eșuat; nimic nu s-a schimbat.' });
    }
  };

  return (
    <section className="card stack pub-step">
      <h3><RotateCcw style={{ width: 18, height: 18, verticalAlign: -3 }} /> Reset demonstrație</h3>
      <p className="small" style={{ margin: 0 }}>Pentru a repeta demonstrația de la zero. Cele două resetări sunt separate: datele locale de mai jos nu golesc harta publică.</p>

      <div className="card stack" style={{ gap: 8 }}>
        <b>1. Date locale (doar acest browser, ShockGrid Dev)</b>
        <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
          <li>Se șterg: {rides.length} {rides.length === 1 ? 'tură importată' : 'ture importate'} și analizele lor, {Object.keys(reviews).length} decizii de verificare, {reports.length} rapoarte locale, traseul A–B al demo-ului.</li>
          <li>Rămân: harta publică, setările, istoricul rutelor, fișierele ZIP din telefon, aplicația ShockGrid (bicicliști) de pe acest telefon și orice alt telefon.</li>
        </ul>
        <div className="row">
          <button className="btn sm ghost" onClick={backup}><Download /> Copie de siguranță (decizii + stratul publicat)</button>
        </div>
        <label className="switch pub-confirm"><input type="checkbox" checked={okLocal} onChange={(e) => setOkLocal(e.target.checked)} /><span>Șterg turele și deciziile din ShockGrid Dev pe acest browser. Reimport ZIP-ul după reset.</span></label>
        <button className="btn" disabled={!okLocal || busy} onClick={() => void resetLocal()}><Trash2 /> Resetează datele locale</button>
        {localDone && <Banner kind="ok">{localDone}</Banner>}
      </div>

      <div className="card stack" style={{ gap: 8, borderColor: 'var(--danger)' }}>
        <b>2. Harta publică (toți utilizatorii ShockGrid)</b>
        <p className="small" style={{ margin: 0 }}>Publică un set gol, auditat, prin același mecanism (un commit, verificare live). Pe fiecare telefon, aplicația afișează harta goală la următoarea deschidere cu internet; rapoartele personale și istoricul rutelor de pe telefoane rămân acolo. Versiunea de acum ({snapshotVersion(live) ?? '—'}, {live?.edges.length ?? 0} segmente) rămâne în istoricul git.</p>
        <div className="row"><button className="btn sm ghost" disabled={!live} onClick={() => live && download(`comfort-layer-${snapshotVersion(live)}.json`, JSON.stringify(live), 'application/json')}><Download /> Descarcă stratul publicat acum</button></div>
        {liveIsEmpty ? <Banner kind="info">Harta publică e deja goală.</Banner> : (
          <>
            <label className="switch pub-confirm"><input type="checkbox" checked={okPublic} onChange={(e) => setOkPublic(e.target.checked)} /><span>Confirm că vreau să golesc harta publică pentru toți utilizatorii.</span></label>
            {okPublic && (
              <label className="field"><span>Token GitHub (același ca la publicare)</span>
                <input className="input" type="password" name="sg-reset-token" autoComplete="off" autoCapitalize="off" autoCorrect="off" spellCheck={false} value={token} onChange={(e) => setToken(e.target.value)} placeholder="github_pat_…" disabled={pub.k === 'running'} />
              </label>
            )}
            <button className="btn danger" disabled={!okPublic || !liveOk || token.trim().length < 20 || pub.k === 'running' || busy || !graph} onClick={() => void resetPublic()}><Trash2 /> Golește harta publică</button>
          </>
        )}
        {pub.k === 'running' && <p className="small" role="status" style={{ margin: 0 }}>{pub.msg}</p>}
        {pub.k === 'done' && <Banner kind="ok">Harta publică a fost golită și verificată pe site-ul live ({pub.id}). <a href={LIVE_BASE} target="_blank" rel="noopener">Deschide ShockGrid</a></Banner>}
        {pub.k === 'error' && <Banner kind="danger">{pub.msg}{token ? ' Tokenul a rămas în câmp: poți reîncerca.' : ''}</Banner>}
      </div>
    </section>
  );
}
