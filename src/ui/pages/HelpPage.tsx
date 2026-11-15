// „Cum funcționează”, pe scurt, pentru bicicliști. Fără formule; detaliile tehnice sunt în ShockGrid Dev.
import { snapshotRideCount } from '../../core/aggregate';
import { useApp } from '../../state/store';
import { EXPLORE_COLOR, GREY_COLOR, ROUGH_STYLE } from '../map/draw';
import { Banner, Header } from '../kit';

export function HelpPage() {
  const snapshot = useApp((s) => s.snapshot);
  const pub = snapshotRideCount(snapshot);
  return (
    <main className="screen"><div className="wrap stack">
      <Header title="Cum funcționează" back="#/more" />
      <p>Un telefon fixat pe ghidon simte zdruncinăturile drumului. Din aceste măsurători, ShockGrid colorează porțiunile de stradă unde a mers cineva din echipă.</p>
      <div className="card stack small">
        <div className="legend-row"><span className="legend-line" style={{ background: ROUGH_STYLE.green.color, height: ROUGH_STYLE.green.weight }} /><span><b>Verde</b>: vibrații reduse</span></div>
        <div className="legend-row"><span className="legend-line" style={{ background: ROUGH_STYLE.yellow.color, height: ROUGH_STYLE.yellow.weight }} /><span><b>Galben</b>: denivelări moderate</span></div>
        <div className="legend-row"><span className="legend-line" style={{ background: ROUGH_STYLE.red.color, height: ROUGH_STYLE.red.weight }} /><span><b>Roșu</b>: drum accentuat denivelat</span></div>
        <div className="legend-row"><span className="legend-line" style={{ height: 3, background: `repeating-linear-gradient(90deg,${GREY_COLOR} 0 2px,transparent 2px 7px)` }} /><span><b>Gri punctat</b>: prea puține date</span></div>
        <div className="legend-row"><span className="legend-line" style={{ background: `repeating-linear-gradient(90deg,${EXPLORE_COLOR} 0 3px,transparent 3px 8px)` }} /><span><b>Violet punctat</b>: parcurs doar încet, fără culoare</span></div>
        <div className="legend-row"><span className="legend-line" style={{ background: 'var(--surface-3)' }} /><span><b>Fără culoare</b>: nemăsurat. Nu înseamnă că strada e netedă.</span></div>
      </div>
      <Banner kind={pub ? 'info' : 'warn'}>{pub ? `Datele publicate de echipă provin din ${pub} ${pub === 1 ? 'tură' : 'ture'} (actualizate ${snapshot!.meta.generated_at.slice(0, 10)}).` : 'Încă nu există măsurători publicate de echipă. Harta arată culori doar pentru turele făcute pe acest telefon.'} Culorile sunt provizorii și nu sunt o clasificare oficială a siguranței.</Banner>
      <h2>Rute</h2>
      <p className="small">Îți arătăm cea mai scurtă rută pe căi permise bicicletelor. O alternativă mai confortabilă apare doar unde avem destule măsurători pe ambele variante; altfel scrie „Confort necunoscut”. Confortul nu înseamnă siguranță.</p>
      <h2>Raportare</h2>
      <p className="small">Apasă <b>Raportează</b>, apoi tipul problemei. Dacă GPS-ul e precis, raportul se salvează imediat; altfel alegi locul pe hartă. Rapoartele rămân pe telefonul tău. Pentru Primărie folosește canalul oficial Sesizări, din pagina raportului.</p>
      <h2>Măsurători în timpul navigării</h2>
      <p className="small">Doar dacă activezi „Contribuie cu măsurători în timpul navigării”. Telefonul măsoară cât timp aplicația e deschisă și ecranul aprins; la final te întreabă, pe scurt, despre locurile cu șocuri. Un șoc poate fi și o bordură sau o mișcare a ghidonului, de aceea întrebăm.</p>
    </div></main>
  );
}
