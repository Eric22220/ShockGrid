# PROGRESS — ShockGrid (GropiTM v7)

Fișier de reluare: ce merge, ce a fost verificat și cum, ce nu merge. Cel mai nou sus.

## Decizii și abateri de la specificație
- **Nume:** aplicația se numește **ShockGrid** (numele repo-ului și al echipei). Specificația v7 o numește „GropiTM”; e același produs. Repo: `Eric22220/ShockGrid`, URL `https://eric22220.github.io/ShockGrid/` (spec. 0.0 cerea `gh repo create gropitm`; utilizatorul a cerut explicit folosirea repo-ului existent).
- **Promptul „final”:** în folder există un singur fișier Markdown de specificație, `GropiTM_Prompt_ClaudeCode_v7.md`; el e tratat ca specificația finală.
- **Overpass blocat local:** din mediul de dezvoltare (sandbox) nu se poate accesa overpass-api.de. Graful se construiește în GitHub Actions (`.github/workflows/build-graph.yml`, rulare manuală), care comite `data/raw/overpass-timisoara.json.gz` și `public/data/graph-timisoara.json`, apoi declanșează deploy-ul. Rezultatul brut e comis, ca în spec. 8.1 (comprimat gzip, ca să nu umfle repo-ul).
- **Geometria grafului** e codificată polyline (precizie 5, ~1 m) în loc de liste de coordonate: fișierul e de câteva ori mai mic pe telefon. Muchia are 3 câmpuri în plus față de 7.4: `surface_kind`, `bicycle`, `name`.
- **Map-matching în firul principal, DSP în Web Worker:** procesarea grea (ZIP, gravitație, filtre, ferestre, șocuri) rulează în worker; potrivirea pe străzi rulează în firul principal, ca graful să existe o singură dată în memorie (important pe iPhone). Potrivirea durează sub o secundă pe o tură obișnuită.
- **Snapshot cu eșantioane:** `comfort-layer.json` păstrează pe muchie valorile `rms_v` ale ferestrelor valide (rotunjite, fără timpi), nu doar mediana, ca reagregarea snapshot + ture locale să fie exactă și independentă de ordine. Fără timpi individuali, fără ID-uri de dispozitiv, fără primii/ultimii 200 m.
- **Reagregare:** la import/ștergere se recalculează tot stratul (rapid la zeci de ture), nu doar muchiile atinse; diferența înainte/după se calculează pe muchiile atinse. Versiunea stratului crește la fiecare recalculare; cache-ul de costuri al rutării e indexat după versiune.
- **Pragurile claselor:** fixe din snapshot dacă există; altfel percentilele 20/40/60/80 din toate ferestrele valide (≥ 30); altfel valori implicite [1,0; 1,6; 2,4; 3,6] m/s² [EXPERIMENTAL]. Se pot fixa manual în Setări (Developer).
- **Ambiguitate carosabil/trotuar:** conform spec, orice fereastră ambiguă face muchia cel mult LOW_CONFIDENCE (`measured_max_ambiguous = 0`, configurabil).
- **Zona cu șoc — „treceri”:** numărul de treceri al zonei = trecerile muchiei pe care stă (din agregarea RVI), minim numărul de detectări. Nu publicăm trasee, deci nu putem număra trecerile prin rază din snapshot.
- **Ghidul Primăriei:** nu contrazice specificația. Notat: „treat gaps as unknown”, „Romanian first”, WCAG 2.1 AA, „private by default”, Sesizări ca unic canal pentru probleme (nu trimitem sesizări, doar link), `/api/zones` e BROWSER OK (opțional, neimplementat încă).

## Acoperire GPS completă, detecție automată, rutare care ocolește problemele, reset demo (15.11.2026)
Checkpoint: tag `checkpoint-before-coverage-hazard-routing`. Detalii: `docs/DETECTIE-AUTOMATA.md`.
- **De ce doar 220 m:** tura de 41 min are viteza mediană ~1 m/s; 2 395 din 2 474 ferestre sunt sub 2,5 m/s, deci doar 70 intră în RVI; 168 din 184 de șocuri erau „de verificat” (viteză), deci nepublicate; explorarea lentă era oprită implicit.
- **Acoperire:** traseul GPS complet vizibil în Dev (implicit); „Parcurs, neevaluat” (neutru, niciodată verde) publicat implicit; raportul GPS → pe străzi → clasificat → public → exclus (confidențialitate).
- **Detecție automată** (`src/core/hazards.ts`) peste zonele existente (`rideRoughness`): slabă / posibilă / probabilă / confirmată / respinsă, fără verificare obligatorie; verificarea opțională în Dev (Zone și șocuri, Hartă tehnică): Confirmă (groapă / denivelare-prag / obstacol), Nu este o problemă, Nu sunt sigur.
- **Rutare:** alternativa „Ocolește problemele” (penalizare o singură dată, max cu clasa măsurată, legalitate neschimbată, limite de ocol, geometrie diferită); implicit confirmate + probabile, posibilele doar în modul experimental; „Actualizează traseul” la date noi, fără schimbare tăcută.
- **Publicare:** `hazards` agregate în `comfort-layer.json` (câmpuri minime, validate, audit de confidențialitate), compatibil cu straturile vechi; aplicația pentru bicicliști arată doar problemele publicate.
- **Reset demonstrație** (Dev → Strat public): local (ture, decizii, rapoarte, starea demo-ului; nu atinge harta publică, istoricul rutelor, setările, alte telefoane) separat de golirea hărții publice (set gol marcat `reset`, același mecanism auditat, confirmare separată; un set gol fără `reset` e refuzat).
- Teste: `test/coverage-hazards.test.ts` (16 cerințe pe date sintetice + 4 pe tura reală, locale).

## P0: publicarea din browser (iPhone) reparată (15.11.2026)
Checkpoint: tag `checkpoint-before-mobile-publish-fix`.
- **Cauza** (reprodusă în WebKit 18.2 și Chromium reale, contra api.github.com): `GitHubClient` apela `this.f(url)` cu `f = window.fetch`; fetch-ul nativ apelat ca metodă aruncă înainte de a trimite cererea („Can only call Window.fetch on instances of Window” / „Illegal invocation”), iar eroarea era afișată ca „fără internet”. Afecta orice browser; testul din terminal (Node) și testele cu fetch simulat nu o puteau prinde. CORS nu era cauza.
- **Reparat**: fetch apelat corect (`callableFetch`); fără opțiunea `cache` spre GitHub (URL unic); diagnostic pe etape cu cod HTTP (rețea / blocat de browser / 401 / 403 / 404 / 409 / 422 / limită / deploy / verificare); curățarea tokenului lipit (spații, caractere invizibile).
- **Testează conexiunea GitHub** (fără modificări; scrierea e verificată cu un blob gol respins cu 422). Tokenul rămâne în memorie după o eroare (reîncercare), se șterge la confirmare, la „Șterge tokenul” sau la ieșirea din pagină.
- Teste noi: `test/publish-mobile.test.ts` (fetch care se comportă ca cel nativ, fetch global implicit, antete CORS, token, diagnostic). Detalii: `docs/PUBLICARE.md`.

## Publicare Dev → ShockGrid dintr-un clic și „Rute recente” (15.11.2026)
Checkpoint: tag `checkpoint-before-publication`.
- **Publicarea reală** din ShockGrid Dev → Strat public: date → generare + audit → previzualizare pe hartă cu diferența → aprobare explicită → „Publică pe ShockGrid” (commit atomic prin API-ul GitHub, token doar în memorie) → urmărirea deploy-ului → verificare pe site-ul live. Detalii și autorizare: `docs/PUBLICARE.md`.
- Verificat cap-coadă pe site-urile reale cu un set SINTETIC marcat TEST (commit `4042e54`, live în ~47 s, vizibil pe hartă), apoi eliminat (revert `7f01d8c`). Tura reală nu e publicată (așteaptă acordul).
- Aplicația pentru bicicliști citește stratul tolerant (un fișier stricat sau lipsa rețelei nu șterg datele) și verifică o versiune nouă la revenirea în aplicație; linkul „Deschide ShockGrid” din Dev duce la segmentele publicate (`#/?at=lat,lon&uncertain=1`).
- **Rute recente** (iconița cu ceas de lângă „Unde mergi?”): pornire / oprire / sosire / întreruptă, max. 20, „Folosește din nou” de la poziția curentă, ștergere; doar în IndexedDB (`route-history`).
- Teste: 240 publice + 6 locale; noi: `test/publication.test.ts` (14), `test/route-history.test.ts` (7).

## Aplicația pentru bicicliști redusă la esențial (15.11.2026, ShockGrid_task.md)
Checkpoint: tag `checkpoint-before-citizen-ux`.
- **ShockGrid (bicicliști)** = un singur ecran: harta reală pe tot ecranul, „Unde mergi?” (căutarea se deschide mereu), locația, Straturi, Informații, „Raportează”. Fără bară de meniu: au dispărut „Mai mult”, „Ture”, „Traseu” ca tab, înregistrarea, importul, întrebările de după tură, contribuția cu măsurători, setările tehnice. Componente noi în `src/ui/citizen/` (CitizenMap, PlaceReport, InfoSheet).
- **Raportare**: trei categorii mari cu pictograme distincte (Groapă și Denivelare / Prag desenate în `HazardIcons.tsx`, Obstacol = bariera Lucide); cu GPS bun se salvează la a doua atingere, „Salvat pe acest telefon” + Anulează; altfel corectarea locului pe hartă (fără precizie GPS inventată).
- **Harta**: legenda Neted / Denivelat / Foarte denivelat; implicit doar tronsoanele măsurate sigur; datele incerte și explorarea lentă sunt sub „Straturi”. „Nu avem încă date de confort în această zonă.” apare o singură dată, doar pe hartă, doar când zona vizibilă nu are date.
- **Traseu**: buton „Înapoi la hartă”, panou compact (timp, distanță, confort cunoscut/necunoscut, Pornește); în navigare: distanța rămasă, timpul, Raportează, Oprește.
- **ShockGrid Dev** păstrează tot: navigarea cu măsurare (injectată prin `src/dev/NavTech.tsx`, ca aplicația pentru bicicliști să nu conțină înregistratorul), înregistrarea live, întrebările de după tură, rapoartele cu editare, plus meniul nou Panou · Import & Ture · Analiză · Hartă tehnică · Zone și șocuri · Strat public · Instrumente. Panoul arată lanțul SMARTPHONE → SENZORI → RVI → POTRIVIRE GPS → SEGMENTE → VERIFICARE → STRAT PUBLIC cu cifrele turelor încărcate. Copierea din aplicația pentru bicicliști include acum și rapoartele (doar citire).
- Bundle-ul pentru bicicliști: 398 KB (de la 498 KB), fără înregistrator, grafice, pagini de analiză (verificat de `check-bundles.mjs` și `test/two-sites.test.ts`).

## Două site-uri: ShockGrid și ShockGrid Dev (15.11.2026)
Checkpoint: tag `checkpoint-before-two-sites`.
- **https://eric22220.github.io/ShockGrid/** (repo ShockGrid, `deploy.yml`): aplicația pentru bicicliști, intrarea `src/main.tsx` → `src/ui/App.tsx`. Hartă, traseu, raportare, ture proprii (pagină simplă), întrebările de după tură, Mai mult = rapoarte, măsurători (consimțământ), cum funcționează, date și surse, confidențialitate, actualizări. Fără import, diagnostic, parametri, grafice, evenimente brute, publicare.
- **https://eric22220.github.io/ShockGridDev/** (repo ShockGridDev): build `vite build --mode devapp` din același cod (`src/main-dev.tsx` → `src/dev/DevApp.tsx`, `dist-dev/`, bază `/ShockGridDev/`, manifest și service worker proprii). Panou cu lanțul de procesare și pașii demo-ului, import ZIP, ture și analiză (calitatea datelor, accelerație/giroscop/RVI, zone, evenimente brute, analiză pe stradă), hartă tehnică (`src/dev/MapTech.tsx`), rutare, diagnostic, parametri, validare, simulare, metodologie, **strat public: generare + audit în browser** (`src/dev/PublishPage.tsx`, fără publicare), exporturi.
- Un singur nucleu: `src/core` e folosit de ambele site-uri și de scripturi; generarea și auditul stratului public au fost mutate din scripturi în `src/core/publiclayer.ts` (ieșirile `build-layer`/`audit-layer` pe tura reală sunt identice cu cele de dinainte, în afară de data generării).
- Stocare: aceeași origine (eric22220.github.io) → baze IndexedDB separate (`shockgrid` pentru bicicliști, neschimbată; `shockgrid-dev` pentru Dev) și cache-uri runtime cu nume diferite. Dev poate **copia** turele din baza bicicliștilor (doar citire, nu creează baza dacă nu există, nu suprascrie; `src/storage/migrate.ts`).
- Verificări: `scripts/check-bundles.mjs` (bundle-ul bicicliștilor nu conține texte/componente tehnice, Dev e sub /ShockGridDev/), `test/two-sites.test.ts` (graful de importuri al aplicației pentru bicicliști nu atinge `src/dev`, paginile de analiză sau graficele; copierea nedistructivă).

## Raportare în 2 atingeri și măsurare în timpul navigării (15.11.2026)
Checkpoint: tag `checkpoint-before-waze-reporting` (commit ed09862).
- **Raportează → Groapă** pe hartă, în navigare și în tură: salvat local cu poziție, precizie, moment, tip, sursă manuală, neverificat; „Anulează” și „Detalii” în confirmare. GPS vechi/imprecis/refuzat → alegerea locului pe hartă, cu explicație (`src/services/hazard.ts`, `src/ui/components/QuickReport.tsx`).
- **Navigare + măsurare**: un singur buton „Pornește”; cu „Contribuie cu măsurători” activat, aceeași înregistrare ca la „Ture” pornește odată cu navigarea; panoul arată doar starea măsurării, timpul, „Raportează” și „Oprește”. Șocurile nu mai apar în timpul mersului.
- **Starea măsurării** (`src/capture/health.ts`): din frecvența reală a senzorilor, ultima mostră, GPS și vizibilitatea paginii.
- **După tură** (`#/after/<id>`): rezumat și „Ai întâlnit o problemă pe drum?” (Da → Groapă / Denivelare / Alt obstacol; Nu; Mai târziu), o întrebare pe zonă, cel mult 5. Pe tura reală, primele întrebări sunt pe Ion Vidu și Petre Râmneanțu.
- Partea tehnică a fost mutată ulterior pe site-ul separat ShockGrid Dev (vezi secțiunea de mai sus).
- Leaflet: redesenarea canvasului după eliminarea hărții e ignorată (eroarea „clearRect of undefined” la schimbarea rapidă a ecranelor).
- Teste: 214 publice + 6 locale pe tura reală = 220/220; 12 noi în `test/hazard-reporting.test.ts`. Browser (dev, 375×812, GPS și senzori simulați): 2 atingeri → raport, Anulează, GPS ±60 m → alegere pe hartă, navigare cu măsurare → senzori opriți → avertisment → Oprește → întrebări, fără erori în consolă. **Netestat pe telefoane fizice.**

## Tronsoane și zone în loc de 184 de verificări (14.11.2026, noaptea)
Checkpoint: tag `checkpoint-before-roughness-segmentation` (commit eb00efd). `processing_version` = `sg-1.2.0` (detecția neschimbată; evenimentele primesc rotația ±0,5 s, schimbarea orientării și distanța pe traseu; ferestrele primesc poziția pe muchie).

**Tura reală (privată), cu pragurile existente, fără ajustări pe ea**
- 184 de evenimente brute → 12 manevrarea telefonului (rotație > 300 °/s sau orientare schimbată > 15°), 0 cu bicicleta oprită (deja excluse la detecție), 13 slabe izolate (rămân în diagnostic), **159 grupate în 36 de zone**: 10 cu prioritate mare (evenimente în treceri separate), 12 medie (cel puțin un șoc puternic), 14 mică. **De verificat: 22 de zone**, nu 184 de vârfuri. 32 de evenimente sunt „puternice”, dar niciunul nu are context bun (toate sunt la viteză mică sau pe o cale ambiguă).
- Ion Vidu: 38 de evenimente → 0 manevrare, 1 slab izolat, 30 slabe și 7 puternice în 8 zone (toate cu prioritate mare: atinse în ambele treceri); toate 38 cu încredere redusă (viteză ~4 km/h), 5 cu GPS slab, 0 ambigue.
- Tronsoane: pe porțiunile la 9–32 km/h, o stradă se împarte acum în bucăți (ex. un segment de 64 m de pe Strada Cluj: 0–16 m vibrații reduse, 16–32 m moderate, 32–64 m accentuate, toate cu încredere redusă); restul turei apare violet (explorare lentă) sau gri.

**Implementat**
- `src/core/roughness.ts`: triajul evenimentelor (manevrare / oprit / slab / puternic + motivele încrederii reduse), gruparea după incertitudinea GPS, treceri separate, prioritate, vibrația continuă din zonă față de restul turei la aceeași viteză. `tiltAround` în `vibration.ts`.
- Tronsoane pe muchie (`segmentEdge`, `EdgeAgg.segments`), poziția ferestrelor pe muchie (`assignOffsets`, calculată și pentru turele vechi la pornire), hartă în verde/galben/roșu + gri (insuficient) + violet punctat (lent), cu grosimi diferite și legendă; A–E rămâne în detaliile tehnice. Fișa segmentului listează tronsoanele.
- Verificarea după tură pe zone (`ReviewScreen`): rezumat cu numerele reale, hartă, carduri pe zone (stradă, întindere, evenimente, treceri, viteză, GPS, cel mai puternic +mm:ss, vibrație continuă), Confirmă / Nu e o problemă / Nu sunt sigur / Vezi dovezile; un singur raport local pe zonă confirmată. Diagnostic: toate evenimentele brute cu filtre (clasă, încredere, grupare, interval de timp, ordine) în `#/ride/<id>/events`.
- Zonele de pe hartă folosesc același triaj și aceeași grupare (manevrarea și evenimentele slabe izolate nu mai apar ca zone).
- Banner „Reprocesează” pentru turele procesate cu o versiune mai veche (verificat în aplicație pe tura reală: sg-1.1.0 → sg-1.2.0).
- Stratul public poate conține poziția ferestrelor pe muchie (m, rotunjit) și indexul trecerii, fără timpi; auditul arată tronsoanele și zonele care s-ar publica.

**Verificat**
- Teste: **202/202** publice (+ 6 locale pe tura reală cu `SG_REAL_RIDE`: 208/208). Noi (`test/roughness.test.ts`): șoc izolat slab ≠ stradă roșie; rugozitate moderată fără vârfuri recunoscută; stradă împărțită bun/denivelat/bun; porțiunea netedă dintre două denivelate păstrată; tronsoane limitate de GPS; lentul rămâne explorare; treceri repetate fără dublare; vârfurile unui obstacol = un eveniment; două zone separate; bicicleta oprită; rotație și orientare schimbată = manevrare; prioritate din treceri repetate; grupare după incertitudine; șocurile/zonele/tronsoanele nu schimbă costul rutei; tronsoane publice fără ID-uri sau timpi, separate de cele locale; evenimentele brute recuperabile.
- Browser (dev server, 375×812, tura reală): pagina turei („36 zone cu șocuri grupate · 22 de verificat · din 184”), reprocesarea, verificarea pe zone (Nu e o problemă → 16 evenimente respinse; Confirmă + tip → un singur raport), dovezile zonei (ambele treceri), diagnosticul (184 / 12 manevrare / 13 izolate / 0 puternice cu context bun), fișa tronsoanelor pe hartă; 0 erori, fără derulare orizontală.
- Previzualizarea publicării (privat, nepublicat): varianta „doar RVI” = 83 m verde (încredere redusă) + 22 m insuficient pe Petre Râmneanțu și 2 zone; varianta „+ explorare” adaugă ~1,1 km violet; Ion Vidu rămâne exclus de raza de confidențialitate.
- **Neverificat:** telefoane fizice; potrivirea zonelor cu filmarea; orice calibrare a culorilor.

## Prima tură reală și sprintul UniHack (14.11.2026, seara)
Checkpoint: tag `checkpoint-before-unihack-sprint` (commit 04d529d, 170/170 teste, verificat la început).

**Tura reală (iPhone 14, Sensor Logger, 41 min, bicicletă cu suport fix; fișier privat, gitignored)**
- Exportul iOS: date în `AccelerometerUncalibrated.csv` / `GyroscopeUncalibrated.csv` (fișierele standard goale), unitate g detectată corect, 248 006 mostre la 100,2 Hz, 0 goluri; 2 479 fixuri GPS, precizie mediană 9,4 m. Importul și procesarea merg fără modificări (3,7 s în Node).
- Viteză: 74% din fixuri la 0,5–1,5 m/s, doar ~78 s la ≥ 2,5 m/s; viteza din poziții confirmă viteza raportată. **70 de ferestre valide pentru RVI din 2 474**; 2 395 excluse pentru viteză mică (pragul NU a fost coborât), 7 pentru rotații.
- Vibrația depinde puternic de viteză (mediana RMS ~1,1 → ~3,0 → ~8,6 m/s² la 0,5–1,5 / 2,5–4 / 4–6 m/s): justifică stratificarea, nu o normalizare inventată.
- Studiu de caz Ioan Vidu: ~12 min pe stradă la ~0,9 m/s, 0 ferestre RVI. La aceeași viteză, vibrația pe stradă e de ×1,32 (IÎ 90% 1,08–1,51) la 0,5–1 m/s și ×1,23 (1,00–1,45) la 1–1,5 m/s față de restul turei; 38 de șocuri candidate, toate „de verificat”. OSM nu are trotuarele desenate separat, deci latura nu se poate stabili din GPS; comparația între laturi cere intervale declarate din filmare. Detalii (private): `eval/private/ANALIZA-TURA-REALA.md`.

**Implementat**
- `src/core/quality.ts` + cardul „Calitatea datelor” pe pagina turei: categorie (RVI_OK / PARTIAL_RVI / LOW_SPEED_EXPLORATORY / STATIONARY / NO_GPS / NO_MOTION), timp pe benzi de viteză, ferestre excluse pe motive, potrivire/ambiguitate, șocuri, eligibilitate publică. Cu o singură tură, bara A–E (20% pe clasă prin construcție) nu se mai afișează.
- Explorare la viteză redusă: `EdgeAgg.explore` (separat de status/clasă/rutare), linie punctată violet pe hartă.
- Fișa segmentului (dovezi): RVI, stare, treceri, GPS, viteze p10–p90, șocuri pe segment, observații manuale, sursa publică/locală, data.
- „Analiză pe stradă” (`#/ride/<id>/street`): strada vs restul turei pe benzi de viteză cu IÎ bootstrap pe blocuri, harta vibrației relative, șocuri cu +mm:ss și ora (sortare după intensitate), avertismentul despre căile paralele, intervale declarate din filmare și comparația lor. Verificarea unui șoc se deschide direct (`?shock=`); tipuri noi: trecere denivelată, fisură.
- Stratul public: fără `ride_ids` (chei de deduplicare), fără numele telefonului (nota implicită = număr de ture + platformă), raza de 250 m în jurul capetelor (și pentru geometria segmentelor), șocurile „de verificat” și explorarea excluse implicit; `build-layer` scrie implicit în `eval/private/propunere`, `audit-layer` nou. „Date și surse” arată versiunea stratului (dată și oră UTC, segmente) pentru verificarea pe două telefoane.
- SIMULARE rutare (Instrumente avansate): strat inventat doar în memorie, router separat, insignă roșie.
- Fix: eroare Leaflet `clearRect` la navigare rapidă (animațiile hărții se opresc înainte de eliminare).

**Verificat**
- Teste: **189/189** (19 noi în `test/unihack-evidence.test.ts`; 4 rulează pe tura reală doar local, cu `SG_REAL_RIDE`, altfel sunt sărite). `tsc` și build curate.
- Browser (Chromium din panou, 375×812, dev server; tura reală importată local prin `<input type=file>`): pagina turei („Tură lentă · explorator”, 70/2 474), analiza pe Ion Vidu (×1,32 / ×1,23, 38 de șocuri), fișa unui segment explorat și a unuia cu încredere redusă, SIMULARE (nodata → same → better, +785 m), 0 erori în consolă la navigare rapidă prin 9 ecrane, fără derulare orizontală.
- Auditul stratului propus: variantele „doar RVI” și „+ explorare” trec toate verificările automate; **nepublicate** (așteaptă aprobarea echipei). Ce intră și ce e exclus de raza de confidențialitate e detaliat doar în raportul privat.
- **Neverificat:** telefoane fizice (import, analiză pe stradă, fișe), potrivirea cu filmarea, orice validare a claselor.

## Audit independent (14.11.2026, după-amiaza)
Checkpoint: tag `checkpoint-before-independent-audit` (commit 6a56cf6, 145/145 teste). Auditul a citit tot nucleul, înregistratorul, store-ul și testele; defectele de rutare și de ceas au fost întâi reproduse prin teste care picau pe codul vechi, cel de potrivire pe străzi printr-o simulare pe graful real.

**Defecte confirmate și reparate**
- **P0 — ocol nemăsurat „recomandat”** (`src/core/routeplan.ts`). Acoperirea de 50% se calcula pe toată ruta. Cu 900 m comuni măsurați + 100 m direcți măsurați E + un ocol de 160 m niciodată parcurs, alternativa era „măsurată 85%” și primea insigna verde, deși singura parte care diferea era necunoscută (rutarea preferă necunoscutul, P = 0,3, claselor C–E). Acum și ocolul, și porțiunea ocolită trebuie măsurate ≥ 50% (`differenceCovered`).
- **P0 — ceasul turei live** (`src/capture/recorder.ts`). Mostrele erau datate cu `performance.timeOrigin + event.timeStamp`, ceas care nu avansează cât timp telefonul doarme (iOS Safari, Chrome pe Android), iar GPS-ul e în timp epoch. Pagină deschisă + telefon blocat 3 minute înainte de tură ⇒ toate mostrele cu 180 s în urmă: ferestre fără GPS sau, mai rău, vibrații puse pe strada de acum 3 minute. Toate testele vechi țineau cele două ceasuri identice. Acum ceasul e ancorat la `Date.now()` (decalaj = cea mai mică întârziere de livrare; salt > 2 s = reancorare, eveniment `clock_resync`). **Verificat doar prin simulare.**
- **P0 — cale paralelă greșită fără semn de ambiguitate** (`src/core/mapmatch.ts`). Pragul max(3 m, precizie/2) era sub eroarea laterală obișnuită. Simulare pe graful real (400 de muchii cu o cale de alt tip la 4–12 m, precizie raportată 5 m): la o eroare laterală de 4 m, 17–19% din fixuri ajungeau pe calea greșită fără semn; la 6 m, 62–73%; la 8 m, 78–90%. Cu pragul nou max(6 m, 1,5 × precizia): 0%, 0–1%, 11–12%. Suprafața declarată, care înainte nu ajuta tocmai în aceste cazuri (24–35% corect la 6 m), dă acum 89–98% corect. Preț: fără suprafață declarată, mai multe segmente rămân „încredere scăzută” (în testul pe străzi reale: MEASURED 16 → 10, LOW 43 → 49).
- **P1 — „Ai ajuns” la sute de metri de destinație** (`src/core/navprogress.ts`, nou). Sosirea era „sub 30 m rămași pe proiecția pe rută”, fără distanța reală până la destinație și fără precizia GPS: dincolo de capătul rutei apărea „Ai ajuns” împreună cu „Ești în afara rutei”. Acum: sub 30 m pe rută, sub 45 m în linie dreaptă și precizie ≤ 30 m; altfel „GPS imprecis”.
- **P1 — „posibile denivelări” la semafor** (`src/core/vibration.ts`). Loviturile în telefon cu bicicleta oprită apăreau la verificarea de după tură. Acum un șoc cu viteză GPS cunoscută sub 1 m/s e ignorat.
- **P1 — încrederea scăzută nedeclarată**. „Măsurat X%” includea segmentele cu o singură trecere; verdictul și eticheta spun acum „încredere redusă” când acestea sunt majoritare (`RouteStats.low_m`).
- `processing_version` = `sg-1.1.0`; nu mai e suprascris de setările salvate.

**Verificat, fără defect găsit:** conversia g ↔ m/s² cap-coadă (același semnal ca export iOS și Android: RMS identic, test nou), timpii ns peste 2^53, proiecția pe gravitație, filtrul trece-sus, RMS-ul, excluderea ferestrelor, șocurile nu intră în costul rutei (test nou), aceeași tură nu se numără de două ori (local sau snapshot), sensurile unice pe 300 de rute reale (test nou), excluderea trotuarelor, căutarea de adrese nu trimite poziția utilizatorului, niciun fișier de tură în istoricul git.

**Suspectat, neconfirmat (cere ture reale):** rata de alarme false a șocurilor; pragurile claselor; comparabilitatea între telefoane și între Sensor Logger și tura live (benzi de frecvență diferite); pragul de 10 m pentru „diferență reală”; `position.timestamp` pe iOS (presupus epoch); memoria la oprirea unei ture live de peste o oră pe iPhone.

**Teste:** 170/170 în 17 fișiere (25 noi, în `test/audit-*.test.ts`). `tsc` și build curate. În browser (Chromium, 375×812, GPS simulat): „Confort necunoscut · nemăsurat” pe ruta nemăsurată; „Urmărește-mă”: 946 m la start → „Ești în afara rutei” la 300 m dincolo de destinație (fără „Ai ajuns”) → „~6 m · GPS imprecis (±80 m)” → „Ai ajuns” la 8 m cu precizie 6 m; consolă fără erori.

**Nevalidat fizic:** tot. Procedura cu criterii admis/respins: `docs/VERIFICARE-TEREN.md`.

## Corecturi critice înainte de demo (14.11.2026, ziua)
Checkpoint: tag `checkpoint-before-critical-fixes`.

**Bug-uri reparate**
- **Verdictul „cea mai scurtă e și cea mai confortabilă (0% măsurat)”**: cauza era o scădere în `routeStats` (`lungime − necunoscut − OSM`) care lăsa reziduuri de virgulă mobilă (±9·10⁻¹³ m), deci o rută nemăsurată părea „măsurată” și intra pe ramura „same”. Acum metrii măsurați se însumează direct. Verdictele au fost rescrise (`src/core/routeplan.ts`): sub 50% măsurat = „Confort necunoscut” (nodata / insufficient), cea mai scurtă necunoscută + alternativă măsurată = „partial” (informăm, nu recomandăm), „same” și „better” doar cu ambele rute măsurate ≥ 50% și o diferență reală. Insigna verde apare doar pe ruta recomandată; „Confort maxim” a devenit „Alternativă”; procentele sub 1% se afișează „sub 1%”, nu „0%”.
- **Legalitatea rutelor pe bicicletă**: opțiunea „Permite trotuarele fără marcaj” a fost eliminată (și ignorată în setările salvate). `bikeBlockReason()` exclude trotuarele fără `bicycle=yes/designated`, zonele pietonale / path / track fără drept, treptele, `bicycle=no/dismount/use_sidepath/private`. Înainte, 11,2% din lungimea rutelor aleatorii trecea pe carosabil `use_sidepath` (obligatorie pista alăturată). După: 0%, aceleași 289/300 rute găsite, +4% lungime medie.
- **Tura live**: stări explicite ale surselor (`both`, `gps_only`, `imu_only`, `none`, `waiting`) în `Recorder.stats()`. Starea „Nu se înregistrează nimic” are pași de recuperare (iPhone / Android), „Reîncearcă” (repornește GPS-ul, recere permisiunea de mișcare) și „Renunță”. O tură fără date nu se mai salvează („Nu s-a înregistrat nimic”), iar cu ambele permisiuni refuzate tura nu pornește. Turele doar cu senzori (fără GPS) se păstrează, cu explicație pe pagina turei.
- **P1**: exporturile GeoJSON pentru instituții s-au mutat în Instrumente avansate. Rapoartele sunt etichetate „doar pe acest telefon” (formular, listă, hartă). Panoul rutei e mai scurt (explicațiile tehnice au fost condensate). Țintele tactile mici au fost mărite la 44 px. Harta întunecată e puțin mai luminoasă.

**Verificat**
- Teste: **145/145** în 13 fișiere (de la 109). Noi: verdictele de rută (0%, sub 1%, 40%, parțial, suficient, „same”, alternativă mai proastă); 21 de reguli de acces pe bicicletă; 150 de rute aleatorii pe graful real fără muchii interzise și fără „măsurat fantomă”; 7 teste ale surselor turei live; scenariul demo în store (două rute A→B × 2 ture: fără date → „same” → „better” → ștergere exactă → „same”, reimport refuzat). `tsc` și build curate.
- Browser (Chromium din panou, GPS simulat; 390×844, 412×915, desktop): panoul rutei fără date arată „Confort necunoscut · nemăsurat” (portocaliu); refuzul locației + senzori opriți blochează pornirea, cu pași de recuperare; „Nu se înregistrează nimic” → Stop → „Nu s-a înregistrat nimic”, nicio tură salvată; „doar traseul” cu GPS simulat; exporturile apar în Instrumente avansate.
- **Neverificat pe telefon fizic** (senzori, permisiuni iOS, Wake Lock, selectorul de fișiere iOS). Nicio tură reală pe bicicletă încă; niciun parametru recalibrat.

## Finisare finală (14.11.2026, noaptea)
Checkpoint: tag `checkpoint-before-final-polish` (commit 492c3ec; arborele identic cu HEAD de atunci, verificat cu `git archive`). Restaurare: `git checkout checkpoint-before-final-polish`.

**Probleme raportate de pe iPhone 14 și rezolvate:**
- **Harta întunecată prea întunecată:** în modul întunecat, harta nu mai e inversată, ci estompată (`brightness .8, contrast 1.06, saturate .78`): străzile rămân deschise, etichetele lizibile, culorile A–E și ruta albastră ies în evidență. Stil „Întunecată” opțional (inversare mai deschisă) și „Luminoasă” în Hartă → Straturi. Punctul „Locația mea” mai mare, cu halou pulsatil; marcajele rapoartelor mai mari, deasupra altor straturi.
- **Panoul de rută acoperea prea mult:** `SnapSheet` cu 3 poziții (compact ~186 px pe 390×844, extins ~56%, complet), tragere cu viteză, apăsare pe mâner, săgeți din tastatură, derulare internă, `safe-area`. La fiecare schimbare, traseul A→B e reîncadrat între planificator și panou (verificat: ambele ace vizibile, 470 px de hartă liberă pe iPhone 14).
- **Prezentarea rutei:** în poziția compactă: destinația, minute, km, problemele cunoscute, disponibilitatea măsurătorilor („Fără măsurători de confort pe această rută” / „Măsurat X% · Y% confortabil”), „Recomandată” doar când datele o susțin. Extins: verdictul onest, alternativele, „Ce poți face” (Vezi ruta / Urmărește-mă / Înregistrează, fără promisiuni de navigație pas cu pas), opțiuni de rutare (trotuare, pavaj OSM).

**Audit de fluxuri (Chromium, 390×844 / 412×915 / 1440×900 / 844×390 landscape; GPS simulat prin suprascrierea `navigator.geolocation`, pentru că browserul de test nu are GPS):** Locația mea → punct + con de direcție + urmărire; căutare „Bulevardul Eroilor” (index local) și „Strada Paris 2” (Photon, rezultate reale din Cetate); selectare → rută 583 m cu „Fără măsurători…”; extins/complet/compact prin apăsare și prin tragere reală; „Urmărește-mă” (558 m · 2 min, fără indicații de viraj) și Oprește; raport nou → marcaj pe hartă → editare → ștergere; import prin `<input type=file>` real cu exportul iPhone → pagina turei „nu putem estima confortul” (staționar); reimport → mesaj informativ cu „Deschide tura”; ștergerea turei → listă goală și toast; tură live pornită → Hartă/Traseu/Mai mult/Ture → înregistrarea continuă (15 m → 55 m) → Stop/Termină → procesată, watcher-ele GPS oprite; GPS refuzat → „Nu avem locația ta” + „Alege punctul de plecare”; desktop: panoul devine flotant în stânga; landscape: butoanele panoului rămân vizibile, fără derulare orizontală.

**Bug-uri găsite în audit și reparate:**
- O tură fără date de la senzorii de mișcare (permisiune refuzată pe iPhone sau browser fără IMU) eșua la procesare („motion.csv nu conține date”). Acum se importă cu traseul GPS, durata din GPS și mesajul „tura are doar traseul GPS… nu putem măsura vibrațiile”.
- Chrome pe desktop trimite evenimente `devicemotion` goale: erau numărate ca date și apărea „senzorii s-au oprit”. Acum sunt ignorate („senzorii nu trimit date”).
- Căutarea locală nu găsea strada când textul avea număr („Strada Paris 2”).
- Două butoane de localizare suprapuse → un singur buton (urmărește / oprește urmărirea), reținut în sesiune.
- Două benzi roșii simultane în tură → doar cea mai importantă.
- „Harta s-a actualizat” apărea și când nu se schimba nimic → mesaj explicit „Harta nu s-a schimbat: …”.
- Reimportul apărea ca eroare → informare cu link spre tura existentă.
- Titluri goale pe Compară/Grafic; acțiune duplicată „Șterge toate datele” în Parametri (rămâne în Confidențialitate).
- Leaflet: straturi adăugate pe o hartă deja eliminată (vizibil la reîncărcarea modulelor în dezvoltare) → gardă `alive(map)`; ErrorBoundary prinde orice altă eroare de ecran.

**Actualizări pentru utilizatorii existenți:** service worker-ul nou se activează imediat (`skipWaiting` + `clientsClaim`), deci și instalările vechi îl primesc; reîncărcarea paginii se face automat doar când e sigur — nu în timpul unei ture, al unui raport deschis sau al unui import; altfel apare „Versiune nouă instalată · Reîncarcă”. Verificare la revenirea în aplicație și la 30 min; buton „Caută actualizări” în Mai mult (cu versiunea și ora build-ului). Worker-ul de procesare se încarcă la pornire, ca o actualizare în timpul turei să nu-l facă indisponibil.

**Bug critic de actualizare găsit în producție și reparat (commit 9217718):** service worker-ul generat nu se activa singur (doar la mesajul `SKIP_WAITING`, pe care nici clientul vechi, nici cel nou nu îl trimitea): în browserul de test, versiunea nouă stătea „waiting”, deci un iPhone cu aplicația instalată ar fi rămas pe versiunea veche. Acum `workbox.skipWaiting/clientsClaim` sunt explicite, clientul trimite și `SKIP_WAITING`, iar un test verifică `dist/sw.js`. **Verificat în producție:** tab-ul blocat pe build-ul vechi (index-BRTfJElK.js) s-a reîncărcat singur pe cel nou (index-Cf-GyosL.js); „Caută actualizări” → „Ai cea mai nouă versiune”; consolă fără erori; căutare reală „Strada Paris 2” → rută 434 m cu „Fără măsurători de confort”.

**Teste:** 109/109 (13 fișiere). Noi: import → hartă actualizată → reimport refuzat → ștergerea scoate exact contribuția (muchiile identice cu starea dinainte) prin store; staționar → zero RVI, zero străzi colorate; GPS > 20 m → zero potriviri; tură doar GPS; logica panoului (poziție după tragere); numărul casei în căutarea locală.

**Nevalidat:** nimic din această etapă nu a fost testat pe iPhone/Samsung fizic (senzori, Wake Lock, cameră, instalare, tastatura iOS). Nicio calibrare a claselor: nu există încă o tură reală pe bicicletă.

**Următorii pași:** tura reală (lista rapidă din `docs/TEREN.md`); pe iPhone: instalare, import Sensor Logger din Fișiere, tură live de 2 minute cu ecranul aprins, o fotografie într-un raport; apoi `inspect` / `build-layer` / `validate` pe laptop și calibrarea pe segmentele de referință.

## Phase 2 — produs mobil (14.11.2026, seara)
Checkpoint înainte de redesign: tag `checkpoint-pre-redesign` (commit 64697a0), 40/40 teste.

**Implementat (P0–P2):**
- Design system nou (`src/ui/styles.css`): Inter auto-găzduit (OFL), tokeni, albastru electric / turcoaz / portocaliu / roșu, mod întunecat cu tile-uri OSM atenuate, bottom sheets, ținte ≥ 44 px; iconițe lucide (ISC). Contrastul AA e **testat** (`test/contrast.test.ts`, 28 perechi în ambele teme; a corectat turcoazul și albastrul din modul întunecat).
- Navigare în 4 zone (Hartă, Traseu, Ture, Mai mult); detaliile tehnice (RVI brut, parametri, OSM, validare, diagnostic) mutate în „Instrumente avansate”. ErrorBoundary pe ecrane.
- Traseu prin adrese: `src/services/geocode.ts` — index local de străzi din graful OSM (offline) + Photon (komoot) cu debounce 350 ms, anulare, cache, timeout 6 s, filtrare pe zona Timișoarei; recente locale; alegere pe hartă; inversare; conectare la graf prin `snapNode`; sensuri unice/trotuare ca înainte. **Justificare:** Photon e făcut pentru autocomplete (Nominatim interzice); indexul local acoperă străzile fără rețea.
- Alternative de rută: `src/core/routeplan.ts` — scurtă/echilibrată/confort, fără duplicate, ascunde rutele „de confort” majoritar necunoscute, verdict onest (`nodata` / `insufficient` / `same` / `better`), probleme cunoscute pe rută (zone cu șoc + rapoarte locale). „Pornește” = urmărirea poziției pe rută și distanța rămasă.
- Locația mea: `src/services/location.ts` — un singur `watchPosition` partajat, oprit la ultima eliberare; cerc de precizie, mod urmărire (se oprește la tragerea hărții), direcție/viteză doar când sunt credibile; mesaje pentru refuz/expirare/fără semnal/HTTP.
- Tură live: `src/capture/live.ts` rulează **aceleași** funcții din nucleu pe o fereastră glisantă de ~30 s la fiecare 5 s; `Recorder` cu dependențe injectabile, sesiune globală (`src/services/ride.ts`) care continuă la schimbarea ecranului; afișează doar viteză, distanță, durată, GPS, stare, denivelări candidate; detectarea opririi; „Marchează” pentru un raport ulterior; la oprire procesare completă ca la import.
- Verificarea după tură (`ReviewScreen`): „Am observat N posibile denivelări…”, mini-hartă, ora, strada aproximativă, intensitate; Da (+ tip) → raport local legat de șoc; Nu → detectarea respinsă; Nu știu → rămâne neverificată. Confirmările nu intră în costul rutei.
- Rapoarte manuale: IndexedDB v2 (migrare testată de la v1), marcaj rapid, tip, fotografie micșorată și re-encodată (fără EXIF/GPS), descriere, editare, ștergere, export GeoJSON, text și link pentru Sesizări. Eticheta „Salvat doar pe acest telefon” peste tot; nicio afirmație de publicare.
- Descrierea repo-ului actualizată (fără „GropiTM” și fără promisiuni de real-time); topics adăugate. Analiză backend comunitar: `docs/BACKEND-COMUNITAR.md` (neimplementat, intenționat).

**Verificat:** 102/102 teste (11 fișiere; 62 noi: geocoding cu Photon simulat — rezultate, cache, HTTP/offline/timeout/anulare; locație — refuz, expirare, oprirea watcher-ului; rute 100% necunoscute; tură start/pauză/oprire cu IMU simulat la 100 Hz; analiza live = procesarea completă; șoc candidat; confirmare/respingere; rapoarte CRUD + ștergerea tuturor datelor; local vs public; migrarea IndexedDB; compatibilitatea GitHub Pages pe `dist/`). În Chromium (dev server) la 390×844 și 412×915, temă luminoasă și întunecată: căutare reală Photon („iulius” → Iulius Town/Mall, Lipovei), stradă locală „victoriei”, rută Piața Victoriei → Iulius Town 1,72 km cu mesajul „Nu avem încă suficiente măsurători…”; raport creat/listat/editat cu text Sesizări; tură sintetică (generată în consolă, apoi ștearsă) → verificare 2 denivelări → Da/Groapă + Nu; GPS refuzat de browserul de test → mesaj corect. Audit ținte < 44 px: doar un link inline (excepție WCAG).
**Nu a fost testat pe telefoane fizice:** senzori, Wake Lock, permisiunea iOS, camera, instalarea PWA.
**Bug-uri găsite și reparate:** harta ecranului Traseu nu se inițializa când ecranul se deschidea direct în căutare; contrast insuficient la butonul turcoaz (4,0:1) și la tab-ul activ în modul întunecat (4,3:1).

## Stare (14.11.2026)

### Faza 0 — import Sensor Logger, schelet, deploy: GATA
- Ramura `prototip-vechi` publicată (vechiul `index.html`, commit 5499550); aplicația nouă pe `main`, fără force push. `sample-data/`, `rides/`, PDF-ul ghidului: în `.gitignore`, necomise.
- GitHub Pages trecut de pe „legacy (branch)” pe „GitHub Actions”. Workflow `deploy.yml`: `npm ci → npm test → npm run build → deploy`. **Verificat:** rulările 43546834469, 43547092995, 43547344661 = success; `https://eric22220.github.io/ShockGrid/` răspunde 200 (index, manifest, sw.js).
- `npm run inspect` pe exporturile reale (verificat local):
  - iPhone 14: ios, unitate g, AccelerometerUncalibrated + GyroscopeUncalibrated, 238,4 s, 23877 mostre, **100,2 Hz, 0 goluri > 100 ms**, **237 fixuri**, precizie mediană 6,8 m, 169 fixuri ≤ 20 m, 6,0 m, gravitație estimată 9,810 m/s². → criteriul fazei 0 îndeplinit.
  - Samsung SM-S948B: android, m/s², TotalAcceleration + Gyroscope, 49,5 s, 58,5 Hz, 0 goluri, 72 fixuri, precizie 4,0 m, distanță 0,0 m (toate vitezele < 0,5 m/s; spec. 2.2 estima ~16 m deplasare pe jos, sub pragul de integrare), gravitație 9,766.
- **Bug critic găsit și reparat:** exporturile Sensor Logger sunt ZIP64 (dimensiuni 0xFFFFFFFF în antete). `unzipSync` din fflate cerea un buffer de 4 GB în browser („Array buffer allocation failed”), deși în Node mergea. Cititor propriu de director central ZIP64 (`src/core/io/zip.ts`) + test. **Verificat în browser** (Chromium, dev server): import iPhone 192 ms, Samsung 53 ms, prin Web Worker; reimportul aceleiași ture e refuzat cu mesaj.
- Ecranul Import: alegere ZIP, progres, rezumat (cifrele de mai sus), traseul pe hartă, diferența înainte/după pe strat.

### Faza 2 — graful străzilor și nucleul de vibrație: GATA (de calibrat pe date reale)
- Graful: GitHub Actions, relația OSM 6927733 (Timișoara, admin_level=8). Prima rulare: **23460 noduri, 32981 muchii, 1689,8 km; `footway=sidewalk` desenat separat: 228,6 km; piste (`highway=cycleway`): 37,7 km; 90 de componente, cea principală 98,5% din noduri.** (Prima rulare n-a putut face push din cauza unui commit paralel; workflow-ul face acum `pull --rebase`.)
- Nucleul (`src/core/`): validare mostre, fs local, gravitație LP τ=1 s, a_v = d·u, HP Butterworth 4 Hz cu coeficienți recalculați la ±10% fs, ferestre 2 s/1 s cu motivele de excludere, șocuri cu prag adaptiv MAD, grupare roată față/spate, double_hit, NEEDS_REVIEW, distanță (viteză / poziții), VDV.
- **Nevalidat încă pe tură reală:** filtrul de 4 Hz pe spectrul unui segment neted, pragurile claselor, pragurile de șoc (lipsesc turele de teren).

### Fazele 3–4 — map-matching, hartă, replay, rutare, comparație: IMPLEMENTATE
- Map-matching cu index pe grilă (60 m), cost distanță + direcție + adiacență, salturi imposibile ignorate (confirmare după 3 fixuri), ambiguitate carosabil/trotuar/pistă, suprafață declarată.
- Harta: MEASURED pe clase (paletă pentru daltoniști + literă), LOW_CONFIDENCE întrerupt, UNKNOWN fără culoare; panou pe segment cu toate câmpurile 8.3; zone cu șoc comutabile, cu semnalul de ±3 s.
- Rutarea: A* + heap binar, profiluri 0/1/3, P_unknown reglabil, trotuare opționale, estimare OSM opțională, metri pe clase măsurat/estimat/necunoscut, regula de 50%.
- Comparația: RVI ponderat cu distanța, bootstrap pe blocuri de 10, VDV, timp pe clase, avertisment viteză > 20%, grafic rms_v vs distanță, porțiuni.
- Actualizare reactivă (8.6): strat = agregare(snapshot, ture locale) cu versiune; cache rutare indexat după versiune; diferența înainte/după + dacă ruta recomandată s-a schimbat și de ce.

### Faza 0b — înregistratorul propriu (P1): IMPLEMENTAT, netestat pe telefon
- devicemotion (permisiunea iOS cerută sincron în click), watchPosition, Wake Lock, loturi de 1 s în IndexedDB, recuperare după reîncărcare, banner roșu, Pauză/Stop/Reper, export ZIP (7.1) prin Web Share. Diagnostic (5.3) cu pașii pentru PERMISSION_DENIED pe iPhone.

### Teste (Vitest)
36 trecute, 2 sărite până la graful real (schema + A* vs Dijkstra pe 100 de perechi). Acoperă: CSV/BOM/null, ns epoch, unitate, Sensor Logger sintetic + ambele exporturi reale, ZIP64, format vechi, refuz .xlsx, export ShockGrid, biquad la 100/58,5/40 Hz, invarianța la rotire, RMS, excluderi (viteză, gol, giroscop, fs), VDV, distanță (staționar < 5 m; 5 m/s ±10% ambele metode), șocuri + double_hit, A* (drum minim, sens unic, trotuare), regula 50%, 8.6 (schimbarea rutei după import și revenirea după ștergere, dublura, ordinea, versiunea/cache-ul), monotonia Σ length·P, map-matching (ambiguitate, suprafață declarată, precizie > 20 m).

### Verificări cap-coadă (14.11, după graful real)
- Graful comis (commit 9802683 de la GitHub Actions): `graph-timisoara.json` 4,3 MB, servit de Pages comprimat **1,05 MB**; `data/raw/overpass-timisoara.json.gz` 1,2 MB.
- Teste: **40/40** (inclusiv schema grafului real, A* = Dijkstra pe 100 de perechi aleatoare, tură sintetică pe străzi reale: 100% ferestre potrivite, 86% pe muchiile rutei).
- Browser (dev server, viewport mobil 375–420 px, Chromium): 3 ture SINTETICE (generate în consolă, șterse apoi) pe ruta Piața Victoriei → nord, cu vibrații diferite pe porțiuni + un impuls: import 116–196 ms fiecare; după a 2-a trecere 27 muchii MEASURED noi, după a 3-a 42 MEASURED; zona cu șoc REPEATED 3/3; „ruta recomandată s-a schimbat” / „a rămas aceeași: segmentele atinse sunt pe rută…”; panoul segmentului cu toate câmpurile 8.3; rutarea curier ocolește segmentul E pe străzi nemăsurate → regula de 50% afișează „Prea puține date…” (corect); Compară pe trecerile identice → „Diferență neconcludentă”.
- Exporturile reale `sample-data`: fixurile sunt la ~43 m de cea mai apropiată muchie (înregistrate în interior) → 0 potriviri, corect (raza 15–20 m).
- Producție (`https://eric22220.github.io/ShockGrid/`, Chromium): pagina se încarcă, graful devine „ready”, fără erori JS (doar 404 pentru fișierele de date încă nepublicate, acum înlocuite cu un snapshot gol valid).
- Performanță: tură sintetică de 30 min la 100 Hz (ZIP 2,6 MB) — parsare 0,3 s + procesare 0,3 s pe laptop, heap +12 MB (după trecerea la parsarea în flux a fișierelor mari).
- Licențe producție (citite din node_modules): fflate MIT, idb ISC, leaflet BSD-2-Clause, react/react-dom/scheduler/loose-envify/js-tokens MIT, uplot MIT. (`npx license-checker` n-a putut fi rulat în mediul local.)
- `build-layer` și `validate` rulate pe exporturile de test: funcționează, 0 muchii (staționar); ieșirile au fost șterse, nu se publică.

### Ce lipsește / următorii pași
- Turele de teren (Faza 1) și calibrarea pe ele: `npm run inspect`, `build-layer`, `validate` pe `rides/`. Snapshotul publicat e gol până atunci (harta arată doar turele importate pe telefon).
- Test pe telefoanele reale (iPhone Safari, Samsung Chrome): import, instalare PWA, înregistrator.
- Testul cu utilizatori: neefectuat.
