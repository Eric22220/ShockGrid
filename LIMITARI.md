# Limitări (ce NU știm și ce NU promitem)

## Despre măsurătoare
- **RVI e relativ.** E valabil pentru combinația telefon + bicicletă + suport + presiune în roți + viteză din calibrare. Valorile nu sunt comparabile între telefoane, biciclete sau suporturi diferite fără calibrare.
- **Viteza contează.** Vibrația crește cu viteza; indicele se compară doar între ferestre din banda 2,5–9 m/s, iar viteza mediană apare lângă fiecare valoare. Normalizarea după viteză (lege de putere) nu e implementată.
- **Doza de vibrații** e inspirată din ISO 2631-1, dar **neponderată** în frecvență: nu e „conform ISO”.
- **Parametrii marcați [EXPERIMENTAL]** (filtru trece-sus 4 Hz, τ = 1 s, ferestre 2 s, praguri de viteză, giroscop 300 °/s, mount_shift 15°, praguri de șoc, P_confort) sunt puncte de plecare care trebuie verificate pe turele reale; nu sunt constante dovedite.
- **Clasele A–E** sunt percentilele 20/40/60/80 ale ferestrelor valide ale echipei (sau valori implicite până există ≥ 30 de ferestre). Se verifică pe segmentele de referință (neted vs pavaj).
- **Fără limită superioară de bandă.** Indicele e RMS-ul componentei verticale peste 4 Hz, până la jumătatea frecvenței de eșantionare: 50 Hz la Sensor Logger pe iPhone (100 Hz), ~29 Hz la exportul Samsung (58,5 Hz), ~30 Hz la tura live din browser (~60 Hz). Aceeași stradă dă deci valori diferite după telefon **și după metoda de înregistrare**. Harta trebuie alimentată de un singur telefon și o singură metodă (recomandat Sensor Logger la 100 Hz); amestecul nu e corectat și nu e semnalat automat.
- **Clasele A–E sunt relative, nu absolute.** Cu ≥ 30 de ferestre valide (≈ 30 s de mers), pragurile devin percentilele 20/40/60/80 ale propriilor date: după o singură tură pe asfalt bun, o parte din segmente apar D–E, iar pragurile se mută la fiecare import. „Denivelat (D–E)” înseamnă „printre cele mai zdruncinate 40% din ce s-a măsurat”, nu o valoare fizică. Culorile au sens abia când datele conțin atât asfalt bun, cât și pavaj; pentru publicare, pragurile se îngheață în snapshot (`build-layer`).
- **Doar componenta verticală.** Loviturile longitudinale (muchia unei gropi) contează doar prin partea lor verticală.
- **O singură tură reală, nicio validare.** Prima tură reală pe bicicletă (iPhone 14, 41 min) a fost procesată, dar o tură nu validează nimic: 97% din ferestre sunt sub 2,5 m/s, deci doar 70 de secunde intră în RVI. Testele automate folosesc în rest semnale sintetice: verifică unitățile, filtrele și logica, nu faptul că RVI corespunde confortului resimțit. De verificat doar cu ture reale: repetabilitatea între treceri, separarea asfalt/pavaj, dependența de viteză, rezonanța suportului, pragurile de șoc, eroarea laterală a GPS-ului (procedura: `docs/VERIFICARE-TEREN.md`).
- **Exporturile de test din `sample-data/`** sunt staționare (iPhone, 238 s) și un test scurt pe jos (Samsung, 49 s): **nu sunt măsurători de drum** și nu produc segmente măsurate.

## Despre turele lente și explorare
- **Sub 2,5 m/s nu există RVI și nici clase.** Vibrația crește puternic cu viteza (în tura reală: mediana RMS ~1,1 m/s² la 0,5–1,5 m/s, ~3 m/s² la 2,5–4 m/s, ~8,6 m/s² la 4–6 m/s). Nu există o normalizare după viteză validată, deci nu inventăm una.
- **Explorarea lentă (0,5–2,5 m/s)** e o dovadă separată: pe hartă e o linie punctată neutră, „Explorat la viteză redusă”, fără clasă, fără efect asupra statusului, a rutării sau a verdictului. Valorile se compară doar în aceeași bandă de viteză (0,5–1 / 1–1,5 / 1,5–2,5 m/s).
- **Comparația „strada față de restul turei”** (Analiză pe stradă) e descriptivă, într-o singură tură: raportul medianelor cu interval de încredere 90% prin bootstrap pe blocuri de 10 s. „Mai mare” înseamnă o diferență consistentă în acea tură, nu o dovadă generală despre stradă.
- Datele nu pot deosebi mersul lent pe bicicletă de mersul pe lângă bicicletă; categoria turei se bazează pe declarația celui care a înregistrat.
- **Ora din numele fișierului Sensor Logger** a ieșit în UTC în tura reală (cu 2 ore în urma orei României din ceasul înregistrării și din GPS). Pentru potrivirea cu filmarea folosiți +mm:ss de la începutul turei.

## Despre stratul public
- Nimic nu se publică automat. `npm run build-layer` scrie într-un folder privat (`eval/private/propunere`), `npm run audit-layer` verifică identificatorii, timpii și distanța față de capetele turelor; publicarea (copiere în `public/data/`) cere acordul celor care au înregistrat.
- Stratul public nu conține ID-uri de tură (doar chei de deduplicare nereversibile), nume de telefon, nume de fișier sau timpi; nimic în primii/ultimii 200 m și nimic la < 250 m în linie dreaptă de capetele turei (nici geometria segmentelor). Asta nu garantează anonimatul: un lanț lung de segmente explorate arată o bucată de traseu, iar data turei rămâne (ziua). Auditul raportează lungimea lanțurilor.
- Șocurile „de verificat” și explorarea lentă nu se publică implicit (`--shocks`, `--exploratory`).

## Despre hartă și GPS
- **Un segment nemăsurat nu e neted.** Starea `UNKNOWN` nu primește RVI, clasă sau culoare.
- Cu GPS de ~4–6 m, **trotuarul, pista și carosabilul paralel nu se pot separa** sigur: potrivirea ambiguă face segmentul cel mult `LOW_CONFIDENCE`, cu motivul afișat. O cale paralelă de alt tip e considerată rival dacă e cu cel mult max(6 m, 1,5 × precizia GPS) mai departe decât cea mai apropiată (înainte: max(3 m, precizia/2), prag la care o eroare laterală de 6 m punea 62–73% din fixuri pe calea greșită fără niciun semn; acum 0–1%, simulare pe graful real). Consecința: pe străzile cu pistă sau trotuar desenat la 4–12 m, aproape totul e „încredere scăzută” până când declari suprafața la import. Cu suprafața declarată, la aceeași eroare de 6 m, 89–98% din fixuri ajung pe calea corectă.
- **Două sensuri desenate separat** (bulevard cu două carosabile) nu sunt tratate ca ambiguitate: măsurătoarea poate ajunge pe sensul opus.
- Dacă declari greșit suprafața, datele ajung sigur pe calea greșită: declarația nu e verificată.
- Unde OSM nu desenează trotuarul separat (doar eticheta `sidewalk=*` pe stradă), trotuarul și carosabilul sunt o singură linie și nu pot fi separate.
- Completitudinea pistelor din OpenStreetMap în Timișoara nu e verificată: o lipsă înseamnă „necunoscut”, nu „fără pistă”.
- Harta are nevoie de internet pentru tile-urile OSM (cele văzute rămân în cache); procesarea, importul și rutarea merg și fără.

## Despre șocuri
- Sunt „șoc posibil”, nu „groapă”: **nu identificăm tipul obstacolului**.
- Cu GPS de ~5 m nu putem separa două obstacole aflate la câțiva metri; punctul se numește „zonă cu șoc”, cu raza vizibilă.
- `double_hit` (roata față + spate la ampatamentul ~1,05 m) e o ipoteză de verificat pe date, nu o dovadă.
- Șocurile nu intră în costul rutării (sunt deja parțial în RVI).
- Un șoc cu viteză GPS cunoscută sub 1 m/s e ignorat (bicicleta stă pe loc: e manevrarea telefonului). Un obstacol lovit în prima secundă după pornire poate fi astfel pierdut.
- Rata de alarme false pe drum real e necunoscută (pragurile: vârf > 4 m/s² și > 6 abateri robuste față de ultimele 20 s).

## Despre rutare
- Nu promitem rute „mai sigure”: nu avem date de accidente. Recomandăm doar rute cu vibrații măsurate mai mici.
- Dacă sub 50% din lungimea unei rute e măsurat, confortul ei e **„necunoscut”**. O alternativă e recomandată doar când ambele rute sunt măsurate ≥ 50% și diferența măsurată e reală (≥ 10 m mai puțin în clasele D–E sau ≥ 10 puncte procentuale mai mult în A–B). Nu spunem niciodată „cea mai confortabilă” sau „la fel de confortabilă” fără aceste date.
- **Recomandarea privește doar porțiunea care diferă.** Pe lângă regula de 50% pe fiecare rută, ocolul propus și porțiunea ocolită trebuie să fie fiecare măsurate ≥ 50%. (Înainte, un ocol complet nemăsurat putea fi „recomandat” dacă restul rutei, comun cu cea mai scurtă, era măsurat: rutarea preferă străzile necunoscute celor măsurate C–E.)
- **„Măsurat” include încrederea scăzută** (o singură trecere, sub 3 ferestre, GPS slab sau ambiguu), cu penalizare înjumătățită în cost. Când peste jumătate din metrii măsurați ai unei rute au doar încredere scăzută, verdictul și eticheta spun explicit „încredere redusă”.
- Pragul unei diferențe „reale” (10 m în D–E sau 10 puncte procentuale în A–B) e mic și nevalidat: un singur segment scurt poate decide recomandarea. Verdictul afișează întotdeauna metrii, ca să poți judeca.
- **Doar căi permise bicicletelor, după etichetele OSM:** trotuarele obișnuite (fără `bicycle=yes/designated`), zonele pietonale, potecile și drumurile de câmp fără drept pentru biciclete, treptele, drumurile private și carosabilul cu `bicycle=no/dismount/use_sidepath` sunt excluse. Nu există opțiune de a permite trotuarele; mersul pe jos cu bicicleta de mână nu e un mod de rutare. Pe 300 de rute aleatorii, conectivitatea a rămas aceeași (289/300 găsite înainte și după), cu rute în medie cu 4% mai lungi.
- Graful nu păstrează etichetele `vehicle=*`, restricțiile orare sau `access=no` + `bicycle=yes` (căile cu `access=no/private` sunt eliminate la construirea grafului). Etichetele OSM pot fi greșite sau incomplete: **nu e o verificare juridică**; urmează semnalizarea de pe teren.
- Fără navigație pas cu pas.

## Despre tura live, locație și căutare (versiunea 2)
- **Sursele de date ale turei live sunt afișate explicit:** „Se înregistrează” (GPS + senzori), „doar traseul” (fără senzori de mișcare: fără confort), „fără GPS” (vibrațiile nu apar pe hartă) sau „Nu se înregistrează nimic” (cu pașii de recuperare). O tură fără nicio dată nu se salvează; dacă atât locația cât și senzorii sunt refuzați, tura nu pornește.
- **Ecranul trebuie să rămână aprins.** O aplicație web nu poate citi accelerometrul cu ecranul blocat sau aplicația în fundal; ShockGrid cere Wake Lock unde există și arată un banner dacă se pierd date. Pentru ture cu ecranul blocat rămâne Sensor Logger (importul se face după export; nu există integrare live cu Sensor Logger).
- **Ceasul senzorilor e ancorat la ora telefonului.** Evenimentele de mișcare folosesc ceasul intern al paginii, care se oprește cât timp telefonul doarme; aplicația îl corectează la fiecare mostră și marchează reancorările (`clock_resync`). Corecția e testată doar prin simulare: testul T11 din `docs/VERIFICARE-TEREN.md` o verifică pe telefon. O abatere sub 2 s (≈ 10 m la 18 km/h) nu e corectată.
- **„Ai ajuns”** apare doar la sub 30 m rămași pe rută, sub 45 m în linie dreaptă de destinație și cu precizie GPS ≤ 30 m; altfel apare distanța rămasă sau „GPS imprecis”. Pe o rută care trece de două ori prin același loc, distanța rămasă poate sări.
- **Turele live lungi consumă memorie la oprire** (aprox. 300 MB pentru o oră la 60 Hz, măsurat pe laptop). Pentru ture de peste o oră folosește Sensor Logger.
- **Cifrele live sunt informative.** În timpul turei rulăm aceleași funcții din nucleu pe ultimele ~30 s; rezultatul final vine din procesarea completă după oprire.
- **Posibilele denivelări nu sunt gropi.** Sunt șocuri puternice ale accelerometrului (giroscopul doar exclude mișcările mâinii). Tipul problemei îl spune utilizatorul, după tură. Confirmările nu schimbă costul rutelor (șocurile sunt deja parțial în RVI).
- **Locația:** precizia GPS (cercul albastru) nu garantează poziția exactă; viteza și direcția se afișează doar când sunt credibile. „Pornește” arată poziția pe rută și distanța rămasă, fără navigație pas cu pas sau indicații vocale.
- **Căutarea de adrese** prin Photon (komoot) e un serviciu public gratuit, fără garanție de disponibilitate; textul căutat ajunge la el. Fără rețea rămân străzile din indexul local și alegerea pe hartă. Adresele cu număr depind de completitudinea OpenStreetMap.
- **Rapoartele sunt doar locale.** Nu există o bază comună; nimeni altcineva nu le vede (vezi `docs/BACKEND-COMUNITAR.md`).
- **Nu a fost testat pe iPhone/Samsung fizic** (senzori, Wake Lock, permisiuni, fotografie, tastatura iOS, modul instalat): toate verificările de interfață sunt în Chromium, la dimensiunile ecranelor, cu GPS și senzori simulați.
- **Fără senzori de mișcare** (permisiune refuzată), tura live păstrează doar traseul GPS: nu se calculează confort și nu se detectează denivelări.
- **Actualizări:** o versiune nouă se aplică automat doar când nu e o tură, un import sau un raport în curs; altfel apare „Versiune nouă instalată · Reîncarcă”. Pe iPhone, dacă aplicația pare veche: Mai mult → Caută actualizări, sau închide complet aplicația și redeschide-o.
- **Harta în modul întunecat** e harta OpenStreetMap estompată (nu un stil întunecat dedicat); stilul „Întunecată” e o inversare a culorilor, cu etichete mai puțin fidele.

## Despre colectare
- Un site web **nu poate citi senzorii cu ecranul stins**. Înregistratorul propriu (P1) cere ecranul aprins (Screen Wake Lock); pentru turele de teren folosim **Sensor Logger**.
- Chrome pe Android rotunjește accelerația din browser la 0,1 m/s²; Sensor Logger nu.
- Înregistrarea cu ecranul blocat în Sensor Logger nu e considerată verificată până la testul din `docs/TEREN.md` (9.2d).

## Despre agregare
- Două înregistrări simultane ale aceleiași treceri (două telefoane pe ghidon) importate pe același telefon se numără ca două treceri și pot face un segment „măsurat sigur” dintr-o singură trecere reală. Importă doar una.
- Turele importate înainte de versiunea `sg-1.1.0` păstrează potrivirea veche pe străzi: șterge-le și reimportă ZIP-ul.

## Tehnice
- La pornire, aplicația citește toate turele din IndexedDB împreună cu fișierele ZIP originale; cu zeci de ture mari, pornirea pe telefon devine lentă.
- Graful străzilor se construiește din Overpass în GitHub Actions (mediul de dezvoltare local nu are acces la Overpass).
- Datele din IndexedDB sunt legate de origine: turele importate pe GitHub Pages nu apar pe alt URL (tunel, localhost) și invers; ștergerea datelor site-ului din browser le șterge.
- Pe iPhone, Safari poate șterge datele site-urilor neinstalate nefolosite 7 zile; instalează aplicația pe ecranul principal și exportă turele importante.
