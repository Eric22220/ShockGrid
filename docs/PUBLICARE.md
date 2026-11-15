# Publicarea stratului public: ShockGrid Dev → ShockGrid

Din site-ul tehnic (https://eric22220.github.io/ShockGridDev/) direct în aplicația pentru bicicliști (https://eric22220.github.io/ShockGrid/), fără descărcări, VS Code sau git.

## Cum funcționează
1. **ShockGrid Dev → Strat public**: turele active din browser → **Generează și auditează** (același generator și audit ca `npm run build-layer` / `audit-layer`, `src/core/publiclayer.ts`) + validarea structurii (`src/core/publication.ts`). La FAIL, publicarea e blocată și motivele sunt listate.
2. **Previzualizare** pe harta reală: segmentele propuse (culoare = confort, întrerupt = incert), stratul publicat acum, segmentele excluse; diferența: noi / actualizate / neschimbate / dispar.
3. **Aprobare**: lista exactă de fișiere și versiunea; bifa „Confirm că am dreptul să public…” și, dacă există date incerte, un acord separat.
4. **Publică pe ShockGrid**: un singur commit în `Eric22220/ShockGrid` (`public/data/`: `comfort-layer.json`, `.geojson`, `shock-zones.json`, `.geojson`, `publication.json`), prin API-ul GitHub: blob-uri → tree → commit → actualizarea ramurii `main` **fără force** (`src/core/github.ts`).
5. **Deploy**: push-ul pornește `deploy.yml` (teste + build + GitHub Pages).
6. **Verificare live**: pagina citește `https://eric22220.github.io/ShockGrid/data/comfort-layer.json` ocolind cache-urile și arată „Publicat” doar când versiunea (`publication_id`) și numărul de segmente coincid.

Siguranță: versiunea = amprenta conținutului, deci o a doua publicare cu același conținut nu creează alt commit. Dacă stratul publicat s-a schimbat după previzualizare, publicarea e refuzată (conflict) și nu suprascrie nimic. Toate fișierele poartă aceeași versiune, iar aplicația pentru bicicliști citește doar `comfort-layer.json`; nu poate vedea o combinație de versiuni. Revenire: `git revert <commit>` (fiecare publicare e un commit cu versiunea în mesaj).

## Autorizarea (token GitHub)
Site-ul Dev e public și nu are autentificare proprie: doar cine are un token GitHub valid poate publica.
1. https://github.com/settings/personal-access-tokens/new: **Fine-grained token**, expirare **1 zi**.
2. **Repository access → Only select repositories → Eric22220/ShockGrid**.
3. **Permissions → Repository → Contents: Read and write**. Nimic altceva (Metadata: Read se adaugă automat).
4. Copiază tokenul în câmpul de la pasul 5 și apasă **Testează conexiunea GitHub**. Testul nu modifică nimic: verifică rețeaua, tokenul, accesul la repo, ramura `main`, permisiunea de scriere (un blob gol, respins de GitHub cu 422, deci nu se creează nimic) și stratul publicat acum. Fiecare etapă apare cu codul HTTP.
5. Apasă **Publică pe ShockGrid**.

Tokenul stă doar în memoria paginii (starea componentei). Nu e salvat (fără localStorage, sessionStorage, IndexedDB sau cookie), nu apare în URL sau în mesajele de eroare și nu e trimis nicăieri în afară de `api.github.com`. După o eroare **rămâne în câmp**, ca să poți reîncerca; se șterge după publicarea confirmată pe site-ul live, la **Șterge tokenul** sau când părăsești pagina. Revocă-l după demo (aceeași pagină din setările GitHub).

## Mesaje de eroare (etapa + codul HTTP)
- **Conexiunea la api.github.com**, fără cod HTTP: telefonul nu are internet sau un VPN/filtru blochează GitHub.
- **„browserul a blocat cererea cu token”**: GitHub răspunde la o cerere simplă, dar nu la cea autentificată (blocator de conținut, VPN/filtru care modifică cererile sau CORS).
- **HTTP 401**: token greșit, incomplet sau expirat. **HTTP 403**: lipsește „Contents: Read and write”. **HTTP 404**: tokenul nu are acces la Eric22220/ShockGrid.
- **HTTP 409** sau „not a fast forward”: ramura `main` s-a schimbat în timpul publicării; nu se suprascrie nimic, se poate reîncerca. **HTTP 422**: cerere nevalidă (cu mesajul GitHub).
- **Deploy (GitHub Pages)** / **Verificarea pe site-ul live**: commitul există, dar site-ul nu arată (încă) versiunea; o nouă apăsare pe Publică nu creează alt commit.

## Cauza eșecului de pe iPhone (15.11.2026)
Publicarea din browser eșua cu „Nu am putut contacta GitHub (fără internet?)” pe **orice** browser, nu doar pe iPhone. `GitHubClient` apela `this.f(url)` cu `f = window.fetch`; un `fetch` nativ apelat ca metodă a altui obiect aruncă înainte de a trimite cererea („Can only call Window.fetch on instances of Window” în Safari/WebKit, „Illegal invocation” în Chrome). Codul prindea orice excepție și o afișa ca lipsă de internet. Verificarea din terminal (Node) și testele cu `fetch` simulat nu verifică `this`, deci nu au prins eroarea. Am reprodus-o în WebKit 18.2 (Playwright, user-agent de iPhone) și în Chromium, contra api.github.com real, cu un token fals. Codul vechi a dat „fără internet”, iar codul corectat primește răspunsul real de la GitHub (HTTP 401). Tot atunci am verificat că GitHub acceptă CORS pentru GET, POST și PATCH cu `Authorization`, `X-GitHub-Api-Version` și `Content-Type`. Ipoteza CORS/`Cache-Control` **nu** era cauza (WebKit 18.2 a primit 401 și cu `cache: 'no-store'`); opțiunea `cache` a fost totuși scoasă din cererile către GitHub, iar prospețimea e asigurată prin URL unic. Testele de regresie (`test/publish-mobile.test.ts`) folosesc acum un `fetch` care se comportă ca cel nativ și `fetch`-ul global implicit.

## Ce se publică și ce nu
- Da: valori agregate pe segmente de stradă (RMS, viteză, precizie GPS, treceri, poziția pe segment rotunjită), data fără oră, zone cu șocuri **neverificate** (doar cele cu context bun, dacă e bifat), numărul de ture, platformele.
- Nu: fișiere ZIP, trasee, ore, ID-uri de tură sau de telefon, nume de fișiere sau de dispozitive, primii/ultimii 200 m ai turei și nimic la mai puțin de 250 m de capete.
- Rapoartele făcute în aplicația pentru bicicliști rămân pe telefonul fiecăruia; nu se publică.

## Verificare cap-coadă (făcută pe 15.11.2026)
`GH_TOKEN=… npx tsx scripts/e2e-publish.ts`: un set **SINTETIC** marcat „TEST” (2 segmente pe Bulevardul Revoluției din 1989), publicat cu același cod. Commit `4042e54`; site-ul live a servit versiunea `pub-d72bcbabe6398088aa27` după ~47 s, iar harta aplicației a afișat cele 2 segmente. Setul a fost eliminat apoi prin revert (`7f01d8c`). Tura reală **nu** a fost publicată.

## Ce conține acum setul publicat (din 15.11.2026)
- Traseul parcurs eligibil: segmentele cu culoare de confort și cele „Parcurs, neevaluat” (neutru, fără culoare). Opțiunea e pornită implicit.
- Problemele de pe drum: posibile și probabile (detectate automat) și confirmate (verificate în Dev), cu câmpurile minime. Vezi `docs/DETECTIE-AUTOMATA.md`. „Nu este o problemă” scoate zona din următoarea publicare.
- Straturile publicate înainte (cu `shocks`) rămân citibile; aplicația le afișează ca înainte.

## Reset demonstrație (Dev → Strat public, jos)
1. **Date locale**: șterge din acest browser (ShockGrid Dev) turele importate, analizele, deciziile de verificare, rapoartele locale și traseul A–B al demo-ului.
   - Nu publică nimic, deci nu poate goli harta publică.
   - Rămân: harta publică, setările, istoricul rutelor, fișierele ZIP din telefon, aplicația ShockGrid de pe acest telefon și de pe orice alt telefon.
   - Înainte: „Copie de siguranță” (deciziile + stratul publicat acum).
2. **Harta publică**: confirmare separată și token. Publică prin același mecanism (commit atomic, verificare live) un set gol marcat `reset`.
   - Un set gol fără `reset` e refuzat la validare, deci golirea nu se poate întâmpla din greșeală.
   - Versiunea anterioară rămâne în git (`git revert <commit>`) și se poate descărca înainte.
   - Pe fiecare telefon, aplicația afișează harta goală la următoarea deschidere cu internet; datele de hartă nu sunt în precache, iar service worker-ul cere întâi rețeaua.
   - Rapoartele personale și istoricul rutelor de pe telefoane nu se șterg niciodată de la distanță.
