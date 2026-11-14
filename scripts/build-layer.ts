// npm run build-layer -- rides/*.zip [--out eval/private/propunere] [--exploratory] [--shocks none|clean|all] [--radius 250] [--note "text"]
// Produce stratul public (snapshot): comfort-layer.json/.geojson, shock-zones.json/.geojson.
// Implicit scrie într-un folder PRIVAT de propunere (eval/private/propunere/), NU în public/data/:
// stratul se auditează (`npm run audit-layer`) și se copiază în public/data/ doar după aprobarea echipei (--out public/data).
// Fără timpi individuali, fără ID-uri de tură sau de telefon, fără nume de fișiere sau de dispozitive,
// fără primii/ultimii 200 m și nimic la < 250 m în linie dreaptă de începutul/sfârșitul fiecărei ture. Licență ODbL.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { aggregate, buildSnapshot, diffLayers, toContribution, type Thresholds } from '../src/core/aggregate';
import { DEFAULT_CONFIG } from '../src/core/config';
import { PRIVACY_RADIUS_M } from '../src/core/publish';
import { comfortGeoJSON, zoneRows, zonesGeoJSON } from '../src/core/export';
import { percentileSorted } from '../src/core/stats';
import { loadGraphIfExists } from './lib';
import { expandArgs, loadRides } from './rides';

const args = process.argv.slice(2);
const opt = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const valued = new Set(['--note', '--out', '--shocks', '--radius']);
const files = expandArgs(args.filter((a, i) => !a.startsWith('--') && !valued.has(args[i - 1])));
const out = opt('--out') ?? 'eval/private/propunere';
const shocks = (opt('--shocks') ?? 'clean') as 'none' | 'clean' | 'all';
const exploratory = args.includes('--exploratory');
// --radius 0 = fără raza din jurul capetelor turei (doar cu acordul explicit al celor care au înregistrat turele)
const radius = opt('--radius') !== undefined ? Number(opt('--radius')) : PRIVACY_RADIUS_M;
const graph = loadGraphIfExists();
if (!graph) { console.error('Lipsește public/data/graph-timisoara.json (rulează build-graph).'); process.exit(1); }
const rides = loadRides(files.length ? files : expandArgs(['rides']), graph);
if (!rides.length) { console.error('Nicio tură. Copiază exporturile în rides/ și rulează: npm run build-layer -- rides/*.zip'); process.exit(1); }

// pragurile = percentilele 20/40/60/80 ale ferestrelor valide ale echipei (calibrare relativă) [EXPERIMENTAL]
const all = rides.flatMap((r) => r.p.windows.filter((w) => w.valid).map((w) => w.rms)).sort((a, b) => a - b);
const thresholds: Thresholds | null = all.length >= 30 ? ([20, 40, 60, 80].map((q) => Math.round(percentileSorted(all, q) * 1000) / 1000) as Thresholds) : null;
const thSrc = thresholds ? `percentilele 20/40/60/80 din ${all.length} ferestre valide (${rides.length} ${rides.length === 1 ? 'tură' : 'ture'}); clase relative, necalibrate absolut` : 'implicite (prea puține ferestre)';
// doar platformele, niciodată numele dispozitivului (Sensor Logger salvează numele dat de utilizator telefonului)
const platforms = [...new Set(rides.map((r) => r.p.meta.platform).filter(Boolean))].join(', ');
const note = opt('--note') ?? `${rides.length} ${rides.length === 1 ? 'tură' : 'ture'}${platforms ? ` (${platforms})` : ''}`;
const snap = buildSnapshot(rides.map((r) => r.p), DEFAULT_CONFIG, note, thresholds, thSrc, { exploratory, shocks, rules: { trim_m: DEFAULT_CONFIG.publish_trim_m, radius_m: radius }, geometry: (e) => graph.geometry(e) });
if (radius < PRIVACY_RADIUS_M) console.warn(`ATENȚIE: raza de confidențialitate redusă la ${radius} m (implicit ${PRIVACY_RADIUS_M} m).`);

// diferența înainte/după pentru fiecare tură
const kind = (e: number) => graph.kind[e] ?? null;
let prev = aggregate({ rides: [], fixedThresholds: thresholds, surfaceKindOf: kind, version: 0 });
const contribs = rides.map((r) => toContribution(r.p));
console.log('\nDiferența înainte/după, pe ture (ordinea fișierelor; local, fără tăieri de confidențialitate):');
contribs.forEach((c, i) => {
  const next = aggregate({ rides: contribs.slice(0, i + 1), fixedThresholds: thresholds, surfaceKindOf: kind, version: i + 1 });
  const d = diffLayers(prev, next, (e) => graph.length[e]);
  console.log(`- tura ${i + 1}: km ${d.km_before.toFixed(2)} → ${d.km_after.toFixed(2)}, muchii noi ${d.new_covered}, MEASURED noi ${d.new_measured}, treceri +${d.passes_added}, zone ${d.zones_before} → ${d.zones_after}`);
  prev = next;
});

const layer = aggregate({ snapshot: snap, rides: [], surfaceKindOf: kind, version: 1 });
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'comfort-layer.json'), JSON.stringify(snap));
writeFileSync(join(out, 'comfort-layer.geojson'), JSON.stringify(comfortGeoJSON(layer, graph)));
writeFileSync(join(out, 'shock-zones.json'), JSON.stringify({ meta: { license: 'ODbL-1.0', attribution: '© OpenStreetMap contributors', processing_version: DEFAULT_CONFIG.processing_version }, zones: zoneRows(layer) }));
writeFileSync(join(out, 'shock-zones.geojson'), JSON.stringify(zonesGeoJSON(layer)));
const st = [...layer.edges.values()];
console.log(`\nStrat: ${rides.length} ture, ${snap.edges.length} muchii (${st.filter((e) => e.status === 'MEASURED').length} MEASURED, ${st.filter((e) => e.status === 'LOW_CONFIDENCE').length} LOW_CONFIDENCE, ${st.filter((e) => e.status === 'UNKNOWN' && e.explore).length} doar explorate), ${snap.shocks.length} șocuri (${shocks}), ${layer.zones.length} zone.`);
console.log(`Praguri: ${JSON.stringify(thresholds)} (${thSrc})`);
console.log(`Scris în ${out}/. ${out.replace(/\\/g, '/').startsWith('public/') ? 'ATENȚIE: folder public, se publică la următorul deploy.' : 'Folder privat: nu se publică. Rulează npm run audit-layer -- ' + out + ' rides/*.zip'}`);
