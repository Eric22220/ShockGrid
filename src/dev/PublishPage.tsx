// Generarea stratului public din turele locale + auditul de confidențialitate, în browser.
// NU publică nimic: produce fișierele propuse, pe care echipa le copiază în public/data/ doar după aprobare.
import { Download, FileCheck2, ShieldCheck } from 'lucide-react';
import { useMemo, useState } from 'react';
import { snapshotRideCount } from '../core/aggregate';
import { auditLayer, buildPublicLayer, type AuditResult, type PublicLayerFiles } from '../core/publiclayer';
import { PRIVACY_RADIUS_M } from '../core/publish';
import { useApp } from '../state/store';
import { download } from '../ui/format';
import { Banner, Header, toast } from '../ui/kit';

export function PublishPage() {
  const graph = useApp((s) => s.graph);
  const rides = useApp((s) => s.rides);
  const snapshot = useApp((s) => s.snapshot);
  const included = useMemo(() => rides.filter((r) => r.included), [rides]);
  const [exploratory, setExploratory] = useState(false);
  const [shocks, setShocks] = useState<'none' | 'clean' | 'all'>('clean');
  const [out, setOut] = useState<{ layer: PublicLayerFiles; audit: AuditResult } | null>(null);
  const [busy, setBusy] = useState(false);
  const pub = snapshotRideCount(snapshot);
  const generate = () => {
    if (!graph || !included.length) return;
    setBusy(true);
    setTimeout(() => {
      try {
        const layer = buildPublicLayer(included.map((r) => r.processed), graph, { exploratory, shocks });
        const audit = auditLayer(layer.snap, Object.values(layer.files).join(''), included.map((r) => ({ p: r.processed, file: r.file_name, name: r.file_name.replace(/\.zip$/i, '') })), graph);
        setOut({ layer, audit });
      } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
    }, 30);
  };
  const auditMd = out ? [`# Audit strat propus (ShockGrid Dev)`, `generat ${out.layer.snap.meta.generated_at} · ${out.layer.snap.meta.processing_version} · explorare: ${exploratory ? 'da' : 'nu'} · șocuri: ${shocks}`, '', ...out.audit.checks.map((c) => `${c.ok ? 'OK  ' : 'FAIL'} ${c.msg}`), '', ...out.audit.summary.map((x) => `- ${x}`), '', out.audit.ok ? 'Toate verificările automate au trecut. Decizia de publicare rămâne a echipei.' : 'Verificări EȘUATE: nu publica.'].join('\n') : '';
  return (
    <main className="screen"><div className="wrap stack">
      <Header title="Strat public: generare și audit" back="#/" />
      <Banner kind="warn"><b>Această pagină nu publică nimic.</b> Generează, în acest browser, fișierele propuse pentru stratul public și verifică automat confidențialitatea. Publicarea înseamnă copierea fișierelor aprobate în <code>public/data/</code> din repo-ul ShockGrid (commit + deploy) și cere acordul explicit al celor care au înregistrat turele.</Banner>
      <div className="card">
        <h3>Ce vede acum aplicația pentru bicicliști</h3>
        <p className="small" style={{ margin: 0 }}>{pub ? `Strat publicat: ${pub} ${pub === 1 ? 'tură' : 'ture'}, ${snapshot!.edges.length} segmente, generat ${snapshot!.meta.generated_at.slice(0, 16).replace('T', ' ')} UTC.` : 'Niciun strat publicat: aplicația spune „Încă nu există măsurători publicate de echipă”.'}</p>
      </div>
      <div className="card stack">
        <h3>Propunere din turele locale ({included.length} {included.length === 1 ? 'tură activă' : 'ture active'})</h3>
        <label className="switch"><input type="checkbox" checked={exploratory} onChange={(e) => { setExploratory(e.target.checked); setOut(null); }} /><span>Include explorarea lentă (violet, fără clasă de confort)</span></label>
        <label className="field"><span>Șocuri</span>
          <select value={shocks} onChange={(e) => { setShocks(e.target.value as typeof shocks); setOut(null); }}>
            <option value="clean">doar zonele cu context bun (implicit)</option>
            <option value="none">fără șocuri</option>
            <option value="all">toate zonele (nerecomandat)</option>
          </select>
        </label>
        <p className="xs muted" style={{ margin: 0 }}>Reguli fixe: fără ID-uri de tură sau de telefon, fără nume de fișiere sau dispozitive, fără timpi individuali, fără primii/ultimii 200 m ai fiecărei ture și nimic la mai puțin de {PRIVACY_RADIUS_M} m în linie dreaptă de capete. Reducerea razei se poate face doar din linia de comandă, cu acordul explicit al celor care au înregistrat.</p>
        <button className="btn primary block" disabled={!graph || !included.length || busy} onClick={generate}><FileCheck2 /> {busy ? 'Se generează…' : 'Generează și auditează'}</button>
        {!included.length && <p className="small muted" style={{ margin: 0 }}>Importă o tură (sau copiază turele din aplicația ShockGrid, din Panou) ca să generezi o propunere.</p>}
      </div>
      {out && (
        <>
          <Banner kind={out.audit.ok ? 'ok' : 'danger'}><b>{out.audit.ok ? 'Toate verificările automate au trecut.' : `${out.audit.checks.filter((c) => !c.ok).length} verificări au eșuat: nu publica.`}</b> Decizia de publicare rămâne a echipei.</Banner>
          <div className="card">
            <h3><ShieldCheck style={{ verticalAlign: '-4px' }} /> Verificări</h3>
            <ul className="small" style={{ paddingLeft: 18, margin: 0 }}>{out.audit.checks.map((c, i) => <li key={i} style={{ color: c.ok ? undefined : 'var(--danger)' }}><b>{c.ok ? 'OK' : 'EȘUAT'}</b> {c.msg}</li>)}</ul>
          </div>
          <div className="card">
            <h3>Ce ar deveni public</h3>
            <ul className="small" style={{ paddingLeft: 18, margin: 0 }}>{out.audit.summary.map((x, i) => <li key={i}>{x}</li>)}</ul>
          </div>
          <div className="grid2">
            {Object.entries(out.layer.files).map(([name, text]) => <button key={name} className="btn" onClick={() => download(name, text, name.endsWith('geojson') ? 'application/geo+json' : 'application/json')}><Download /> {name}</button>)}
            <button className="btn" onClick={() => download('AUDIT.md', auditMd, 'text/markdown')}><Download /> AUDIT.md</button>
          </div>
          <p className="xs muted">Fișierele se descarcă doar pe acest calculator. Aceeași propunere se obține și din linia de comandă: <code>npm run build-layer -- rides/*.zip</code> și <code>npm run audit-layer -- eval/private/propunere rides/*.zip</code> (aceeași implementare, <code>src/core/publiclayer.ts</code>).</p>
        </>
      )}
    </div></main>
  );
}
