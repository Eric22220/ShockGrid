# Acoperire, detecție automată și rutare care ocolește problemele

## Patru noțiuni separate
| | Ce înseamnă | Unde se vede |
|---|---|---|
| **Traseu GPS** | pe unde a mers bicicleta, la orice viteză | doar în ShockGrid Dev (privat): Hartă tehnică, „Traseele turelor mele” (pornit implicit) |
| **Parcurs, neevaluat** | străzi parcurse (ferestre potrivite pe hartă, ≥ 0,5 m/s), dar fără dovezi pentru o culoare: încet, o trecere, prea puține ferestre | Dev și, după publicare, aplicația pentru bicicliști: linie neutră gri-albastru întreruptă. **Niciodată verde.** |
| **Confort măsurat** (Neted / Denivelat / Foarte denivelat) | ferestre RVI valide (2,5–9 m/s, GPS ≤ 20 m), mediana pe tronsoane de 15–40 m | culorile; doar „măsurat sigur” e colorat implicit în aplicația pentru bicicliști |
| **Problemă pe drum** | zone cu șocuri grupate (vezi mai jos) | tronson pe strada reală, ± raza zonei |

Viteza mică nu șterge strada (apare „Parcurs, neevaluat”) și nici nu o face netedă. Capetele turei rămân private: primii/ultimii 200 m pe traseu și tot ce e la mai puțin de 250 m de pornire/sosire. Dev arată diferența (Strat public → Acoperire: GPS → pe străzi → clasificat → public → exclus).

## Detecția automată (src/core/hazards.ts)
Nu e un al doilea detector. Pornește de la zonele din `rideRoughness`, care folosesc același filtru (trece-sus 4 Hz), aceleași șocuri (z ≥ 6, ≥ 4 m/s²), aceeași excludere a manevrării telefonului (giroscop > 300 °/s sau orientare schimbată > 15°) și a bicicletei oprite, și aceeași grupare după incertitudinea GPS. Zonele aceluiași loc din ture diferite se unesc. Nivelul se stabilește fără verificare manuală:

- **slabă**: doar șocuri slabe, într-o singură trecere. Rămâne în Dev; nu se publică și nu schimbă rutarea.
- **posibilă**: șocuri în ≥ 2 treceri separate sau cel puțin un șoc puternic (≥ 2× pragurile de detecție). Poate fi o groapă, un capac, o bordură sau o frânare.
- **probabilă**: evenimente cu context bun (viteză în banda RVI, GPS ≤ 10 m, fără ambiguitate carosabil/trotuar) în ≥ 2 treceri **separate**. La viteză mică nu se ajunge niciodată aici.
- **confirmată**: „Confirmă problemă” în Dev, cu tipul ales (groapă / denivelare-prag / obstacol).
- **respinsă**: „Nu este o problemă”. Nu mai influențează rutarea și dispare din stratul public la următoarea publicare.

„Nu sunt sigur” lasă nivelul automat. Pragurile sunt cele existente din `VibrationConfig`; nu am introdus praguri noi pentru detecție.

## Rutarea
- **Cea mai rapidă**: doar distanța și legalitatea (fără trotuare, `bicycle=no/dismount/use_sidepath`, trepte). Nu e penalizată niciodată.
- **Ocolește problemele**: cea mai scurtă rută legală cu o penalizare pe muchiile problemelor (metri echivalenți, `HAZARD_PENALTY_M`): confirmată 300, probabilă 200, posibilă 80. Implicit contează confirmatele și probabilele; posibilele contează doar cu opțiunea „Ocolește și problemele posibile (experimental, neconfirmate)”.
  - O problemă se aplică o singură dată pe muchie. Pe o muchie cu clasă măsurată se ia **maximul** dintre penalizarea clasei și cea a problemei, nu suma, ca aceeași vibrație să nu fie numărată de două ori.
- **Alternativa apare doar dacă**:
  - evită cel puțin o problemă de pe ruta cea mai rapidă și trece prin mai puține;
  - ocolul e de cel mult +50% din lungime și cel mult +1 km;
  - diferă cu cel puțin 30 m și cu cel puțin 10% din lungime.

  Altfel se afișează doar ruta cea mai rapidă, cu un text („trece prin N zone…; nu există o variantă legală pe bicicletă care să le ocolească cu un ocol rezonabil”).
- **Necunoscutul** nu e niciodată „neted”: costul lui e `p_unknown = 0,3` în profilurile de confort.
- **Comparația de confort** (verdictul „mai puține vibrații măsurate”) rămâne separată și cere ≥ 50% acoperire măsurată pe porțiunile care diferă.
- **Date noi pe hartă**: un strat publicat nou nu schimbă în tăcere o rută afișată sau pornită. Apare „Date noi pe hartă · Actualizează traseul”, iar o rută nouă (alt A sau B) folosește mereu ultimele date.

## Ce se publică
`comfort-layer.json` primește `hazards`: `lat`, `lon` (rotunjite la ~1 m), `r`, `level` (`possible`/`likely`/`confirmed`), `type` (doar la confirmate), `edges`, `date` (fără oră). Nu se publică detectări individuale, timpi, treceri, ID-uri sau semnal. Validarea refuză orice alt câmp. O problemă nu se publică dacă vreun eveniment al ei e în zona de confidențialitate a turei sau dacă zona (± raza ei) atinge raza de 250 m. Straturile vechi (cu `shocks`) se citesc în continuare.

## Pe tura reală de 41 min (15.11.2026, local)
- **Acoperire:**
  - 2 468 m traseu GPS și ~2,4 km de străzi parcurse, la viteza mediană de ~1 m/s;
  - 211 m clasificat confort, din care 11 m „măsurat sigur”: doar 70 din 2 474 de ferestre sunt în banda RVI;
  - stratul public propus: 30 de segmente, 1 482 m (2 incerte, 28 „Parcurs, neevaluat”).
- **Probleme:** 19 posibile, 13 slabe, 0 probabile (toate sunt la viteză mică). 12 sunt publicabile; 7 sunt excluse pentru confidențialitate (prea aproape de capetele turei).
- **Rutare:**
  - implicit, fără confirmări: nicio alternativă, ceea ce e corect (nu există probleme probabile sau confirmate);
  - cu modul experimental, pe stratul public propus: 21 din 33 de rute de test care trec prin probleme primesc o alternativă validă;
  - după confirmarea manuală a 3 zone (în Dev), o rută de 513 m care trecea prin ele primește o alternativă legală de 541 m, pe altă stradă și pe o pistă de biciclete marcată.

Nimic din toate acestea nu e validat pe teren: nivelurile automate sunt încredere în dovezi, nu certitudini.
