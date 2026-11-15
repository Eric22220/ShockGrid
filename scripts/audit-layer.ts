// npm run audit-layer -- <folder-strat> rides/*.zip
// Auditul de confidențialitate al unui strat propus, ÎNAINTE de publicare. Nu afișează coordonate.
// Verifică: identificatori (ID tură/telefon, nume de fișier sau dispozitiv), timpi epoch, distanța în linie dreaptă
// de la începutul/sfârșitul fiecărei ture la cel mai apropiat element publicat, lanțurile continue de segmente (traseu ghicibil).
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Snapshot } from '../src/core/aggregate';
import { auditLayer } from '../src/core/publiclayer';
import { loadGraphIfExists } from './lib';
import { expandArgs, loadRides } from './rides';

const [dir, ...rest] = process.argv.slice(2);
if (!dir) { console.error('Utilizare: npm run audit-layer -- <folder-strat> rides/*.zip'); process.exit(1); }
const graph = loadGraphIfExists();
if (!graph) { console.error('Lipsește graful.'); process.exit(1); }
const text = readFileSync(join(dir, 'comfort-layer.json'), 'utf8');
const snap = JSON.parse(text) as Snapshot;
const zonesText = readFileSync(join(dir, 'shock-zones.json'), 'utf8');
const rides = loadRides(expandArgs(rest.length ? rest : ['rides']), graph);
const lines: string[] = [];
const say = (x: string) => { console.log(x); lines.push(x); };
say(`# Audit strat: ${dir}`);
say(`generat ${snap.meta.generated_at} · ${snap.meta.processing_version} · ${snap.edges.length} muchii · ${snap.shocks.length} șocuri · explorare: ${snap.meta.includes_exploratory ? 'da' : 'nu'}`);
say(`notă dispozitive: „${snap.meta.device_note}”`);
const all = text + zonesText + readFileSync(join(dir, 'comfort-layer.geojson'), 'utf8') + readFileSync(join(dir, 'shock-zones.geojson'), 'utf8');
// aceeași implementare ca în ShockGrid Dev (src/core/publiclayer.ts)
const res = auditLayer(snap, all, rides.map((r) => ({ p: r.p, name: r.name, file: r.file })), graph);
say('\n## Verificări (identificatori, timpi, distanța de la capetele turelor)');
for (const c of res.checks) say(`${c.ok ? 'OK  ' : 'FAIL'} ${c.msg}`);
say('\n## Ce se vede public');
for (const x of res.summary) say(`- ${x}`);
const fail = res.checks.filter((c) => !c.ok).length;
say(`\n${fail ? `${fail} verificări au EȘUAT: nu publica.` : 'Toate verificările automate au trecut. Decizia de publicare rămâne a echipei.'}`);
writeFileSync(join(dir, 'AUDIT.md'), lines.join('\n') + '\n');
process.exitCode = fail ? 1 : 0;
