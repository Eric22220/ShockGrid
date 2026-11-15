// Verifică separarea celor două build-uri: aplicația pentru bicicliști (dist/) nu conține componentele tehnice,
// iar ShockGrid Dev (dist-dev/) le conține și e servit sub /ShockGridDev/. Rulat în CI după ambele build-uri.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const text = (dir) => readdirSync(join(dir, 'assets')).filter((f) => f.endsWith('.js') || f.endsWith('.css')).map((f) => readFileSync(join(dir, 'assets', f), 'utf8')).join('\n');
// texte care există DOAR în paginile tehnice (src/dev și paginile de analiză folosite numai de Dev)
const DEV_ONLY = ['Generează și auditează', 'Lanțul de procesare', 'Parametri algoritm', 'Date tehnice (Dev)', 'SIMULARE rutare', 'Importă din Sensor Logger', 'Exporturi GeoJSON', 'Diagnostic senzori', 'u-over', 'uplot', 'Analiză tehnică', 'Mai mult', 'Turele mele', 'Contribuie cu măsurători', 'Măsoară vibrațiile', 'Pornește o tură', 'devicemotion', 'wakeLock', 'ShockGrid Lab', 'Zone de verificat', 'Publică pe ShockGrid', 'api.github.com', 'git/blobs'];
let fail = 0;
const ok = (c, m) => { console.log(`${c ? 'OK  ' : 'FAIL'} ${m}`); if (!c) fail++; };

const cit = text('dist');
for (const m of DEV_ONLY) ok(!cit.includes(m), `dist/ (bicicliști) nu conține „${m}”`);
ok(readFileSync('dist/index.html', 'utf8').includes('/ShockGrid/assets/'), 'dist/ servit sub /ShockGrid/');
ok(JSON.parse(readFileSync('dist/manifest.webmanifest', 'utf8')).scope === '/ShockGrid/', 'manifestul bicicliștilor are scope /ShockGrid/');

if (existsSync('dist-dev')) {
  const dev = text('dist-dev');
  for (const m of ['Generează și auditează', 'Parametri algoritm', 'Date tehnice (Dev)', 'Măsoară vibrațiile', 'devicemotion', 'Zone de verificat', 'Importă din Sensor Logger', 'Publică pe ShockGrid', 'api.github.com']) ok(dev.includes(m), `dist-dev/ conține „${m}”`);
  ok(dev.includes('Testează conexiunea GitHub') && !dev.includes("Nu am putut contacta GitHub (fără internet?)"), 'Dev are testul de conexiune GitHub și diagnosticul nou (fără vechiul „fără internet?”)');
  // cererile către api.github.com au doar antete permise de CORS (fără opțiunea cache: WebKit ar adăuga Cache-Control/Pragma)
  ok(!/api\.github\.com[^"`]{0,400}cache:"no-(store|cache)"/.test(dev) && !/cache:"no-(store|cache)"[^"`]{0,120}api\.github\.com/.test(dev), 'cererile către api.github.com nu folosesc opțiunea cache');
  const html = readFileSync('dist-dev/index.html', 'utf8');
  ok(html.includes('/ShockGridDev/assets/') && !html.includes('"/ShockGrid/assets/'), 'dist-dev/ servit sub /ShockGridDev/');
  ok(html.includes('ShockGrid Dev'), 'titlul ShockGrid Dev');
  const man = JSON.parse(readFileSync('dist-dev/manifest.webmanifest', 'utf8'));
  ok(man.scope === '/ShockGridDev/' && man.start_url === '/ShockGridDev/' && man.id === '/ShockGridDev/', 'manifestul Dev are scope, start_url și id /ShockGridDev/');
  ok(dev.includes('shockgrid-dev'), 'Dev folosește baza IndexedDB „shockgrid-dev”');
}
for (const d of ['dist', 'dist-dev']) if (existsSync(d)) {
  const walk = (x) => readdirSync(x, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(x, e.name)) : [join(x, e.name)]));
  ok(!walk(d).some((f) => /\.zip$|Location\.csv|Accelerometer/i.test(f)), `${d}/ fără înregistrări brute`);
}
if (fail) { console.error(`${fail} verificări au eșuat`); process.exit(1); }
