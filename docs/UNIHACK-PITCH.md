# ShockGrid la UniHack 2026: pitch, întrebări grele, poziționare, demo

Document public. Nu conține trasee, capete de tură, ore sau identificatori. Analiza detaliată a turei reale e privată (`eval/private/`).

## Poziționare (o frază)
ShockGrid transformă vibrațiile măsurate cu telefonul fixat pe ghidonul bicicletei în **dovezi explicabile, cu nivel de încredere**, despre infrastructura urbană, și le folosește ca oamenii să compare confortul a două rute. Ce nu e măsurat rămâne „necunoscut”.

Nu spunem „am inventat detectarea gropilor” și nici „colorăm străzile”. Cele trei puncte tari:
1. **Măsurare:** accelerometru 100 Hz + GPS, lanț de procesare documentat (`README.md`, Metodologie în aplicație), nu doar păreri sau valori ghicite.
2. **Dovezi și incertitudine:** fiecare segment are valoare, stare (Măsurat / Încredere redusă / Explorat la viteză redusă / Nemăsurat), treceri independente, viteză, precizie GPS, sursă și dată. Observațiile umane sunt marcate separat.
3. **Decizie:** comparația a două rute cu distanța în plus, acoperirea măsurată a fiecăreia și diferența de metri denivelați; nicio recomandare din porțiuni nemăsurate (reguli testate automat).

## Comparație (doar fapte verificabile)
| Aspect | ShockGrid | Prior art cunoscut | Echipa concurentă |
|---|---|---|---|
| Senzori telefon → rugozitate | da, telefon pe ghidonul bicicletei | **SmartRoadSense** (Univ. Urbino): accelerometrul telefonului în mașini, indice PPE, zeci de mii de km în Italia ([Sensors 2017](https://pmc.ncbi.nlm.nih.gov/articles/PMC5336061), [IEEE Access 2022](https://doaj.org/article/11d5251fc0e04d44b1e09f37af93e9a6)) | **neverificat** (raportat de echipa noastră: hartă colorată cu starea drumurilor / zone problematice; sursa datelor și algoritmul nu sunt cunoscute) |
| Detectarea gropilor din vibrații | șocuri candidate, nu „gropi”; confirmare/respingere manuală cu tip | Pothole Patrol (MIT, [MobiSys 2008](https://people.cs.rutgers.edu/~badri/553dir/papers/sensor/mobisys08.pdf)); **PavePatrol** (UniHack anterior, menționat de organizatori; nu am găsit o sursă publică) | neverificat |
| Dependența de viteză | **stratificare**: RVI doar la 2,5–9 m/s; sub 2,5 m/s doar comparații în aceeași bandă de viteză, fără clase | SmartRoadSense corectează viteza cu o lege putere estimată pe date mari ([studiu](https://libmast.utm.my/Record/doaj.art-348907b6b28147959b476c104a76ca6d)) | neverificat |
| Necunoscut vs. măsurat | explicit pe hartă, în fișa segmentului și în verdictul rutei | — | neverificat |
| Rutare după confort | A* cu cost = lungime·(1 + w·penalizare), doar căi permise bicicletelor, verdict onest | — | neverificat |
| Confidențialitate | ture doar pe telefon; stratul public = agregat auditat, fără ID-uri, fără nimic la < 250 m de capetele turei | — | neverificat |

**Ce e cu adevărat diferit (și ce nu):** ideea de a măsura rugozitatea cu telefonul nu e nouă. Diferența noastră e combinația, pentru bicicliști: stări de încredere explicite, „necunoscut” care rămâne necunoscut, explorarea lentă separată de RVI, comparația de rute care refuză să recomande fără date și auditul de confidențialitate înainte de publicare. Despre echipa concurentă nu facem afirmații: nu îi cunoaștem datele sau metoda.

## Pitch (~90 s, română)
> Pe bicicletă, în Timișoara, aceeași distanță poate însemna zece minute liniștite sau zece minute de gropi, borduri și pavaj spart. Hărțile îți arată cel mai scurt drum, nu și cât de denivelat e.
>
> ShockGrid măsoară asta. Telefonul fixat pe ghidon înregistrează vibrațiile de o sută de ori pe secundă, împreună cu GPS-ul. Le transformăm într-un indice pe fiecare segment de stradă, cu numărul de treceri, viteza și precizia GPS. Unde n-am măsurat, scrie „necunoscut”, nu verde.
>
> Am ieșit pe teren: 41 de minute reale pe bicicletă, aproape 250.000 de măsurători. Accelerometrul a produs 184 de vârfuri; aplicația a recunoscut 12 ca manevrarea telefonului, a grupat restul în 36 de zone și ne-a cerut să verificăm doar 22, cele observate în treceri separate sau cu un șoc puternic. Aplicația ne-a spus singură că o bună parte din tură a fost prea lentă pentru un indice de confort și a exclus-o, pentru că la 4 km/h vibrația nu se compară cu cea de la 15. Pe Strada Ioan Vidu, unde am observat trotuare cu gropi și denivelări, vibrația a fost totuși de circa 1,2–1,3 ori mai mare decât în restul turei, la aceeași viteză, și am găsit zeci de șocuri candidate pe care le verificăm cu filmarea. GPS-ul nu poate spune pe ce trotuar eram, așa că nu pretindem asta.
>
> Când alegi o rută, ShockGrid îți spune cât e mai lungă alternativa, cât din fiecare rută e măsurat și câți metri denivelați eviți. Dacă nu avem date, nu recomandăm nimic.
>
> Pentru cetățeni: rute alese pe date reale. Pentru primărie: o listă de segmente și puncte de verificat, cu dovezi și nivel de încredere, nu doar sesizări. Datele brute rămân pe telefon; publicăm doar agregate auditate.

(Cifrele din pitch vin din analiza turei reale. Dacă echipa nu aprobă publicarea datelor de pe Ioan Vidu, pitch-ul rămâne valabil, dar demo-ul arată analiza locală, de pe telefonul care a importat tura.)

## Întrebări grele (răspunsuri scurte)
1. **„Nu e la fel ca SmartRoadSense sau PavePatrol?”** Principiul (accelerometru + GPS) e același și îl recunoaștem. SmartRoadSense e pentru mașini și corectează viteza cu un model statistic pe date mari; noi suntem pe bicicletă, cu puține date, deci nu inventăm o corecție: comparăm doar în aceeași bandă de viteză. În plus: stări de încredere, „necunoscut” explicit, rutare care refuză recomandări fără date, audit de confidențialitate.
2. **„Altă echipă are o hartă colorată mai frumoasă. De ce a voastră?”** Nu le cunoaștem datele, deci nu le comentăm. A noastră arată de unde vine fiecare culoare: câte treceri, ce viteză, ce precizie GPS, când. Unde n-avem date, nu colorăm. O hartă frumoasă dar fără dovezi poate trimite bicicliștii pe o stradă pe care n-a măsurat-o nimeni.
3. **„De unde știți că scorul e valid științific?”** Nu pretindem o validare absolută. Indicele e RMS-ul accelerației verticale filtrate (procedură standard pentru vibrații), cu filtre de calitate documentate. Am testat lanțul pe semnale cu răspuns cunoscut (189 de teste automate) și am rulat o tură reală. Clasele A–E sunt relative la turele echipei; validarea cere ture repetate pe aceleași segmente (procedura e în `docs/VERIFICARE-TEREN.md`).
4. **„Cum deosebiți trotuarul, pista și carosabilul cu eroarea GPS?”** De cele mai multe ori nu putem, și aplicația o spune. Dacă în OpenStreetMap există o cale paralelă de alt tip la câțiva metri, fereastra e „ambiguă” și segmentul rămâne cel mult „încredere redusă”. Pe Ioan Vidu trotuarele nu sunt desenate separat, deci totul cade pe axa străzii. O comparație între laturi se face doar cu intervale declarate din filmare.
5. **„Ce se întâmplă pe străzile fără măsurători?”** Rămân „necunoscut”. Ruta afișată e cea mai scurtă, cu „Confort necunoscut”, fără insignă verde.
6. **„Cum ar folosi primăria sau cetățenii rezultatele?”** Cetățenii: aleg între două rute știind cât e măsurat. Primăria: exporturi GeoJSON (ShockGrid Dev) cu segmentele denivelate și zonele cu șocuri repetate, fiecare cu treceri, dată și încredere, ca listă de verificat pe teren. Nu înlocuiesc sesizările oficiale.
7. **„Telefoane diferite dau valori comparabile?”** Nu garantat. Suportul, bicicleta, anvelopele și telefonul schimbă valorile. De aceea clasele sunt relative la combinația din calibrare, iar comparabilitatea între telefoane e listată ca nevalidată (`LIMITARI.md`).
8. **„Ce oprește rapoartele false sau înregistrările falsificate?”** Acum: nu există încărcare publică. Turele rămân pe telefon, iar stratul public îl publică echipa după audit. Un șoc devine „repetat” doar din treceri diferite, iar unul confirmat de om rămâne marcat ca observație, nu ca măsurătoare. O versiune comunitară ar avea nevoie de autentificare și verificări de consistență (`docs/BACKEND-COMUNITAR.md`). Nu le avem încă.

Nu afirmăm reducerea accidentelor și nici măsurarea traficului.

## Două site-uri
- **https://eric22220.github.io/ShockGrid/**: „asta vede un biciclist” (hartă, traseu, raportare). Fără meniuri tehnice.
- **https://eric22220.github.io/ShockGridDev/**: „așa funcționează în spate” (import, analiză, audit, strat public). Site public, fără autentificare; datele importate rămân în browserul în care le importi.

Ambele vin din același cod (repo-ul ShockGrid); Dev e publicat din repo-ul ShockGridDev. Bazele de date din browser sunt separate (`shockgrid` și `shockgrid-dev`). Pe laptopul de demo: deschide Dev → Panou → „Ture din aplicația ShockGrid” → Copiază, sau Import ZIP.

## Demo pentru cetățeni (sub 30 s, fără explicații tehnice)
„Uitați aplicația pentru bicicliști.”
1. Deschide ShockGrid: harta reală a Timișoarei, pe tot ecranul.
2. **Unde mergi?** → alege destinația → ruta, cu timp, distanță și „Confort necunoscut” sau culorile unde există date.
3. **Pornește** → distanța rămasă; **Oprește**.
4. **Raportează → Groapă**: „Salvat pe acest telefon”, cu Anulează.
5. Măsurarea în timpul navigării și întrebările de după tură se arată în ShockGrid Dev (Instrumente → Navigare cu măsurare).
6. Al doilea site, **https://eric22220.github.io/ShockGridDev/**: „așa funcționează în spate” (import, accelerație și giroscop, RVI, zone, audit, strat public; scenariile de mai jos).

## Scenariul A: datele reale trec de filtre
1. 10 s de filmare cu bicicleta și suportul.
2. **ShockGrid Dev** (are tura importată): **Ture și analiză → tura → Calitatea datelor**: 41 min, 100 Hz, 70 de ferestre RVI valide, restul exclus pentru viteză mică, cu motivele.
3. **Zone de verificat**: „184 de evenimente → 36 de zone → 22 de verificat”; zonele de pe Ion Vidu au prioritate mare (atinse în ambele treceri) → Vezi dovezile (+mm:ss) → Confirmă / Nu e o problemă. Apoi **Analiză pe stradă → Strada Ion Vidu**: harta cu vibrația relativă și șocurile candidate; tabelul „strada față de restul turei” pe benzi de viteză; banner-ul „Latura nu se poate stabili din GPS”.
4. Un șoc puternic → ora +mm:ss → același moment în filmare (dacă există) → **Verifică șocul selectat** → Da + „Trecere denivelată” sau Nu.
5. **Hartă**: fișa unui segment (Măsurat / Încredere redusă / Explorat), cu treceri, viteză, GPS și sursă.
6. **Traseu A→B**: verdictul onest. Cu datele de azi, de obicei „Confort necunoscut”.
7. Telefonul B, fără niciun import, cu stratul public aprobat: aceleași segmente (Hartă → atinge segmentul → „date publicate de echipă”).

## Scenariul B: datele nu trec de filtre (sau publicarea nu e aprobată)
1. Aceiași pași 1–4 de mai sus, pe telefonul care are tura (analiză locală, nimic publicat).
2. Arătăm explicit de ce ferestrele au fost excluse (viteză, rotații, GPS).
3. **Traseu**: „Confort necunoscut”, fără recomandare.
4. **ShockGrid Dev → SIMULARE rutare**: insigna roșie „SIMULARE — date inventate”; cele trei scenarii (fără date → necunoscut; doar ruta scurtă → nicio alternativă măsurată; ambele → alternativa cu metri D–E evitați). Spunem clar: „asta e o simulare a regulilor, nu o îmbunătățire măsurată”.

## Demo pe două telefoane, cu același strat public
1. Pe laptop (nu pe telefoane): `npm run build-layer -- rides/*.zip --out eval/private/propunere [--exploratory]`, apoi `npm run audit-layer -- eval/private/propunere rides/*.zip`. Toate verificările trebuie să fie „OK”.
2. Doar cu aprobarea explicită a celor care au înregistrat turele: copiați cele 4 fișiere din propunere în `public/data/`, commit, push. Deploy-ul pornește singur.
3. Pe ambele telefoane: **Mai mult → Caută actualizări**, apoi **Mai mult → Date și surse**: aceeași dată „actualizat …” și același număr de ture.
4. **Hartă**: atingeți același segment pe ambele telefoane: aceleași valori, sursa „date publicate de echipă”.
5. Telefonul care are și tura locală nu o numără de două ori (cheie de deduplicare).
