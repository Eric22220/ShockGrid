# Verificarea pe teren — iPhone 14 și Samsung S26 Ultra

Procedură cu criterii **ADMIS / RESPINS**. Tot ce e mai jos e nevalidat până nu îl faci fizic: testele automate folosesc date sintetice și dovedesc doar că logica e consecventă, nu că indicele descrie corect drumul.

Durată: ~30 min acasă + ~90 min pe bicicletă. Notează rezultatul fiecărui pas (A/R) și fă o captură de ecran la orice R.

**Unde citești cifrele:** Ture → tura → **Analiză tehnică** → „Rezumat” (frecvență, goluri, fixuri GPS, precizie, ferestre valide, potrivire pe străzi, motivele ferestrelor).

**Reguli pentru toată ziua**
- **Un singur telefon alimentează harta.** RVI nu e comparabil între telefoane, nici între Sensor Logger (100 Hz) și tura live din browser (~60 Hz). Alege telefonul principal (recomandat: iPhone + Sensor Logger). Al doilea telefon e doar pentru testele T1–T5 și T11.
- **Nu importa pe același telefon două înregistrări simultane ale aceleiași treceri** (de ex. ambele telefoane pe ghidon): s-ar număra ca două treceri.
- La fiecare import alege **„Pe ce ai mers mai ales?”** (carosabil / pistă). Fără asta, străzile cu pistă sau trotuar desenat alături rămân „încredere scăzută”.
- Șterge turele importate înainte de actualizarea din 14.11 (Ture → tura → Șterge) și reimportă ZIP-urile: regulile de potrivire pe străzi s-au schimbat.

---

## A. Acasă (ambele telefoane)

### T1 — Versiunea și permisiunile
1. Deschide ShockGrid de pe ecranul principal → Mai mult → **Caută actualizări**.
2. Ture → Pornește o tură → **Pornește tura** → apasă **Permite** la mișcare (iPhone) și la locație.

| | ADMIS | RESPINS |
|---|---|---|
| Versiune | „Ai cea mai nouă versiune” | rămâne pe versiunea veche după închidere completă + redeschidere |
| Stare, în ≤ 10 s afară / la geam | „Se înregistrează” | „doar traseul”, „fără GPS”, „Nu se înregistrează nimic” după ce ai urmat „Cum repari” |
| Ecran | rămâne aprins 2 min fără atingere | se stinge singur |

Oprește tura (Stop → Termină tura) și șterge-o.

### T2 — Setările Sensor Logger
Accelerometer, Gyroscope, **versiunile Uncalibrated**, Location: pornite. Frecvența: **100 Hz** (pe Samsung verifică explicit: exportul de test a ieșit la 58,5 Hz).

### T3 — Sensor Logger cu ecranul blocat (2 min, pe jos, afară)
Pornește înregistrarea, **blochează ecranul**, mergi 2 minute, deblochează, oprește, Export → ZIP → importă în ShockGrid.

| Cifră din „Rezumat” | ADMIS | RESPINS |
|---|---|---|
| durata | 110–130 s | sub 100 s (înregistrarea s-a oprit la blocare) |
| frecvență mediană | iPhone ≥ 95 Hz; Samsung ≥ 50 Hz (ideal ≥ 95) | sub 40 Hz |
| goluri > 100 ms | 0–2, maxim sub 500 ms | zeci de goluri sau un gol > 2 s |
| fixuri GPS | ≥ 0,8 Hz, precizie mediană ≤ 10 m | sub 0,5 Hz sau precizie > 20 m |
| unitate detectată | iPhone: g; Samsung: m/s² | eroare „Unitatea accelerației nu poate fi detectată” |
| gravitație estimată | 9,6–10,0 m/s² | în afara intervalului |

„Nu putem estima confortul” e normal la mers pe jos. Șterge tura.
**Dacă T3 e RESPINS pe un telefon, nu folosi acel telefon pentru turele de teren.**

### T4 — Importul ZIP
iPhone: Sensor Logger → Export → ZIP → **Salvează în Fișiere** → ShockGrid → Ture → Importă. Samsung: Descărcări.

| | ADMIS | RESPINS |
|---|---|---|
| Import | pagina turei apare în ≤ 10 s, cu traseul pe mini-hartă | eroare sau aplicația se blochează |
| Reimport al aceluiași ZIP | „Tura e deja importată…” cu „Deschide tura” | apare a doua oară în listă |

### T5 — Suportul
Telefonul prins pe ghidon. Apucă ghidonul și scutură-l scurt, apoi ridică roata din față 5 cm și las-o să cadă.

| | ADMIS | RESPINS |
|---|---|---|
| Telefonul | nu se rotește și nu alunecă în suport | se mișcă vizibil → strânge sau schimbă suportul |

Ține aceeași poziție a suportului și aceeași presiune în roți toată ziua.

---

## B. Pe bicicletă (telefonul principal, Sensor Logger, ecran blocat)

Viteză constantă **~15–20 km/h**, fără atingerea telefonului în mers. Fiecare înregistrare se pornește și se oprește **din oprire**. Nume clare (`ref-neted-1`, `ref-pavaj-1`, `AB-traseu1-dus` …).

### T6 — Precizia GPS pe o stradă cunoscută
O stradă dreaptă, deschisă, ~300 m, dus-întors. Importă (suprafața declarată) → Ture → tura → **Pe hartă**.

| | ADMIS | RESPINS |
|---|---|---|
| precizie mediană | ≤ 10 m | > 10 m (segmentele nu pot deveni „măsurat sigur”) |
| traseul desenat | pe strada parcursă, la sub ~10 m lateral | sare pe străzi paralele sau prin clădiri |
| potrivire pe străzi | ≥ 80% din ferestrele cu poziție | sub 50% |
| ferestre valide | ≥ 60% din ferestre (restul: porniri, opriri) | sub 30% → citește „Motivele ferestrelor” |

Dacă domină „goluri” → T3; „viteză prea mică/mare” → ține 9–32 km/h; „rotație” / „suport mișcat” → T5.

### T7 — Asfalt neted, de 2 ori
Segment de asfalt bun, ~200 m, două treceri în același sens (înregistrări separate sau una singură, cu > 30 s între treceri).

### T8 — Pavaj / piatră cubică, de 2 ori
Segment de ~150 m, la fel.

**Citește în Compară** (Ture → Compară, câte două ture):

| Comparație | ADMIS | RESPINS |
|---|---|---|
| neted-1 vs neted-2 (repetabilitate) | RVI diferă cu ≤ 20%; verdict „Diferență neconcludentă” | diferă cu > 35% → măsurătoarea nu e repetabilă (suport, viteză, GPS) |
| pavaj-1 vs pavaj-2 | la fel, ≤ 20% | > 35% |
| neted vs pavaj | RVI pe pavaj ≥ 1,5× cel de pe asfalt; verdict cu câștigător | sub 1,3× sau „neconcludentă” → **indicele nu separă suprafețele; nu prezenta clasele A–E ca dovadă** |
| viteza mediană | diferă cu ≤ 20% între ture | „Comparație afectată de diferența de viteză” → repetă la aceeași viteză |

**Pe hartă, după T7 + T8:**

| | ADMIS | RESPINS |
|---|---|---|
| culori | asfaltul în clasele A–B, pavajul în D–E | amestecate sau inversate |
| segmente colorate | doar pe străzile parcurse | culoare pe o stradă paralelă neparcursă |
| după a 2-a trecere, cu suprafața declarată | linie plină („Măsurat în 2 treceri”) pe segmentele ≥ ~30 m | toate rămân întrerupte → atinge segmentul și citește motivul |

Clasele sunt **relative la turele tale** (percentile). Până nu ai și asfalt, și pavaj în date, culorile nu înseamnă nimic: nu le interpreta după o singură tură.

### T9 — Denivelări de referință
3–5 obstacole sigure (capac de canal, rost, bordură coborâtă), notate dinainte. Treci peste fiecare de 2 ori, la viteză normală.

| | ADMIS | RESPINS |
|---|---|---|
| detectate | ≥ 60% din treceri apar ca „posibilă denivelare” la ≤ 15 m de loc | sub 30% |
| false pe asfalt neted (T7) | cel mult 1 la 200 m | mai multe → pragurile de șoc sunt prea joase pentru suportul tău |
| la semafor / în oprire | **nicio** „posibilă denivelare” când atingi telefonul stând pe loc | apar denivelări în locul unde ai stat |

### T10 — Două rute A→B
A și B la 1,5–2,5 km, două trasee legale alese **dinainte**, diferite ca suprafață. Fiecare parcurs de 2 ori, același sens. Importă toate cele 4 ture cu suprafața declarată. Apoi **Traseu**, cu aceleași A și B.

| Moment | ADMIS | RESPINS |
|---|---|---|
| înainte de orice tură | „Confort necunoscut · nemăsurat” | orice afirmație despre confort |
| după turele pe un singur traseu | „Nu am găsit o alternativă măsurată…” sau „Nu le putem compara” | alternativa nemăsurată apare „recomandată” |
| după toate cele 4 ture | fie „recomandată” cu metrii D–E în minus, fie „Nu am găsit o alternativă…”; rezultatul coincide cu ce ai simțit | recomandă traseul pe care l-ai simțit clar mai rău |
| ocol nemăsurat | niciodată recomandat | ruta recomandată trece pe străzi fără culoare pe porțiunea care diferă |
| traseul desenat | nu folosește trotuare și nu intră pe sens interzis | trotuar sau contrasens → captură de ecran + numele străzii |

„Încredere redusă” în verdict = cele mai multe segmente au o singură trecere sau GPS ambiguu: corect, nu e o eroare.
Notează imediat confortul perceput (1–5) pentru fiecare tură (Ture → tura → Detalii).

---

## C. Tura live din browser (ambele telefoane, ~10 min)

### T11 — Înregistrare live, cu ecranul blocat intenționat
1. Ture → Pornește o tură. Mergi 2 minute pe o stradă.
2. **Blochează ecranul 30–60 s în mers**, pe o porțiune pe care o ții minte (schimbă strada în acest timp, dacă poți).
3. Deblochează, mai mergi 2 minute pe o stradă **diferită**, Stop → Termină tura.

| | ADMIS | RESPINS |
|---|---|---|
| în timpul blocării | după deblocare apare un mesaj despre ecran / senzori opriți | niciun mesaj |
| harta turei | porțiunea blocată **nu** are culoare; strada de după deblocare e colorată **pe locul ei** | culoarea de după deblocare apare pe strada dinainte (decalaj) → raportează imediat, nu folosi tura live |
| „Rezumat” | frecvență ≥ 50 Hz, goluri: câteva | frecvență sub 40 Hz sau sute de goluri |
| pagină închisă forțat în timpul turei (opțional) | Ture → „O tură a fost întreruptă” → Recuperează → tura apare | datele s-au pierdut |

Tura live e pentru demonstrație; pentru hartă folosește Sensor Logger.

### T12 — „Urmărește-mă” și sosirea
Traseu → alege o destinație la ~200 m → **Urmărește-mă**, mergi până acolo.

| | ADMIS | RESPINS |
|---|---|---|
| distanța rămasă | scade pe măsură ce înaintezi | sare sau crește |
| „Ai ajuns” | apare la ≤ ~30 m de destinație | apare la start, la > 50 m de destinație, sau deloc când ești la destinație |
| cu GPS slab (interior) | „Aproape de destinație · GPS imprecis” în loc de „Ai ajuns” | „Ai ajuns” cu cerc de precizie de zeci de metri |

---

## Decizia pentru demo

- **T3, T4, T6, T7–T8 (repetabilitate și neted vs pavaj), T10 ADMISE** → poți prezenta harta și comparația celor două rute, cu mențiunea că RVI e relativ la telefonul și bicicleta ta.
- **„Neted vs pavaj” RESPINS** → prezintă doar fluxul (import → segmente → comparație), fără afirmații despre confort.
- **T10 RESPINS pe legalitate** (trotuar / contrasens) → alege alte A și B pentru demo și notează strada.
- **T11 RESPINS** → nu demonstra tura live; folosește doar importul din Sensor Logger.

Nu publica ZIP-urile: rămân în `rides/` (ignorat de git). Se publică doar stratul agregat din `npm run build-layer`, fără primii și ultimii 200 m ai fiecărei ture.
