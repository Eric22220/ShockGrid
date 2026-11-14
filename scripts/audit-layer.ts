// npm run audit-layer -- <folder-strat> rides/*.zip
// Auditul de confidențialitate al unui strat propus, ÎNAINTE de publicare. Nu afișează coordonate.
// Verifică: identificatori (ID tură/telefon, nume de fișier sau dispozitiv), timpi epoch, distanța în linie dreaptă
// de la începutul/sfârșitul fiecărei ture la cel mai apropiat element publicat, lanțurile continue de segmente (traseu ghicibil).
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { aggregate, type Snapshot } from '../src/core/aggregate';
import { haversine } from '../src/core/geo';
import { PRIVACY_RADIUS_M } from '../src/core/publish';
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
const say = (s: string) => { console.log(s); lines.push(s); };
let fail = 0;
const check = (ok: boolean, msg: string) => { say(`${ok ? 'OK  ' : 'FAIL'} ${msg}`); if (!ok) fail++; };

say(`# Audit strat: ${dir}`);
say(`generat ${snap.meta.generated_at} · ${snap.meta.processing_version} · ${snap.edges.length} muchii · ${snap.shocks.length} șocuri · explorare: ${snap.meta.includes_exploratory ? 'da' : 'nu'}`);
say(`notă dispozitive: „${snap.meta.device_note}”`);
say('\n## Identificatori');
check(!snap.meta.ride_ids?.length, 'fără ID-uri de tură în meta (doar chei de deduplicare)');
const all = text + zonesText + readFileSync(join(dir, 'comfort-layer.geojson'), 'utf8') + readFileSync(join(dir, 'shock-zones.geojson'), 'utf8');
for (const r of rides) {
  const m = r.p.meta;
  const secrets = [r.p.ride_id, m.ride_key, m.device, m.extra['device id'], m.extra['device name'], m.recording_time, r.name, r.file].filter((x): x is string => !!x && x.length >= 4);
  const leaked = secrets.filter((x) => all.includes(x));
  check(leaked.length === 0, `tura ${rides.indexOf(r) + 1}: niciun ID, nume de fișier, nume de dispozitiv sau oră de înregistrare în fișierele publice${leaked.length ? ` (găsit: ${leaked.length})` : ''}`);
}
const epochs = (all.match(/\b1[6-9]\d{11}\b/g) ?? []).length;
check(epochs === 0, `niciun timp epoch în ms (${epochs})`);
check(!/"t"\s*:/.test(text), 'nicio cheie „t” (timp individual) în snapshot');

say('\n## Distanța de la începutul/sfârșitul turelor la datele publicate (linie dreaptă)');
const geo = snap.edges.map((e) => graph.geometry(e.edge_id));
for (const [i, r] of rides.entries()) {
  const good = r.p.gps.filter((f) => f.acc === null || f.acc <= 50);
  if (!good.length) continue;
  for (const [lbl, f] of [['început', good[0]], ['sfârșit', good[good.length - 1]]] as const) {
    let dE = Infinity, dS = Infinity;
    for (const g of geo) for (const [a, b] of g) dE = Math.min(dE, haversine(a, b, f.lat, f.lon));
    for (const s of snap.shocks) dS = Math.min(dS, haversine(s.lat, s.lon, f.lat, f.lon));
    const d = Math.min(dE, dS);
    check(d >= PRIVACY_RADIUS_M - 20, `tura ${i + 1}, ${lbl}: cel mai apropiat segment publicat la ${Number.isFinite(dE) ? Math.round(dE) : '—'} m, șoc la ${Number.isFinite(dS) ? Math.round(dS) : '—'} m (prag ${PRIVACY_RADIUS_M} m; vârfurile geometriei pot fi mai aproape decât ferestrele)`);
  }
}

say('\n## Ce se vede public');
const layer = aggregate({ snapshot: snap, rides: [], surfaceKindOf: (e) => graph.kind[e] ?? null, version: 1, lengthOf: (e) => graph.length[e] });
const by: Record<string, { n: number; m: number }> = {};
for (const e of layer.edges.values()) {
  const k = e.status === 'UNKNOWN' ? (e.explore ? 'EXPLORAT' : 'UNKNOWN') : e.status;
  by[k] ??= { n: 0, m: 0 };
  by[k].n++; by[k].m += graph.length[e.edge_id];
}
for (const [k, v] of Object.entries(by)) say(`- ${k}: ${v.n} segmente, ${Math.round(v.m)} m`);
const secs: Record<string, number> = {};
for (const e of layer.edges.values()) for (const sg of e.segments ?? []) if (sg.cat !== 'none') secs[`${sg.cat}${sg.status ? '/' + sg.status : ''}`] = (secs[`${sg.cat}${sg.status ? '/' + sg.status : ''}`] ?? 0) + (sg.to_m - sg.from_m);
say(`- tronsoane pe hartă (m): ${Object.entries(secs).map(([k, v]) => `${k} ${Math.round(v)}`).join(', ') || 'niciunul'}`);
say(`- zone cu șocuri: ${layer.zones.length} (${Object.entries(layer.zones.reduce((a: Record<string, number>, z) => ((a[z.status] = (a[z.status] ?? 0) + 1), a), {})).map(([k, v]) => `${k} ${v}`).join(', ') || '—'})`);
const streets = new Map<string, number>();
for (const e of snap.edges) { const n = graph.name[e.edge_id] || '(fără nume)'; streets.set(n, (streets.get(n) ?? 0) + graph.length[e.edge_id]); }
say(`- străzi: ${[...streets.entries()].sort((a, b) => b[1] - a[1]).map(([n, m]) => `${n} (${Math.round(m)} m)`).join(', ')}`);
// lanțuri continue: componente conexe ale segmentelor publicate
const ids = new Set(snap.edges.map((e) => e.edge_id));
const seen = new Set<number>();
const chains: number[] = [];
for (const e of ids) {
  if (seen.has(e)) continue;
  let len = 0;
  const st = [e];
  seen.add(e);
  while (st.length) {
    const x = st.pop()!;
    len += graph.length[x];
    for (const n of [graph.from[x], graph.to[x]]) for (const y of graph.edgesAt(n)) if (ids.has(y) && !seen.has(y)) { seen.add(y); st.push(y); }
  }
  chains.push(len);
}
chains.sort((a, b) => b - a);
say(`- lanțuri continue de segmente: ${chains.length}; cel mai lung ${Math.round(chains[0] ?? 0)} m (un lanț lung arată o bucată de traseu)`);
say(`- praguri clase: ${JSON.stringify(snap.meta.thresholds)} (${snap.meta.thresholds_source})`);
say(`\n${fail ? `${fail} verificări au EȘUAT: nu publica.` : 'Toate verificările automate au trecut. Decizia de publicare rămâne a echipei.'}`);
writeFileSync(join(dir, 'AUDIT.md'), lines.join('\n') + '\n');
process.exitCode = fail ? 1 : 0;
