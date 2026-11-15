// Etichetele pentru bicicliști (scurte). Aceleași categorii ca în Dev (verde/galben/roșu), alt text.
import type { RoughCat } from '../../core/aggregate';

export const CITIZEN_ROUGH: Record<RoughCat, string> = { green: 'Neted', yellow: 'Denivelat', red: 'Foarte denivelat' };
export const NO_DATA_TEXT = 'Nu avem încă date de confort în această zonă.';
/** traseu parcurs fără dovezi pentru o culoare (încet, o trecere): neutru, niciodată verde */
export const UNRATED_TEXT = 'Parcurs, neevaluat';
export const HAZARD_TEXT: Record<'confirmed' | 'likely' | 'possible', { title: string; body: string }> = {
  confirmed: { title: 'Problemă confirmată', body: 'Echipa a verificat-o pe teren sau în filmare.' },
  likely: { title: 'Problemă probabilă', body: 'Detectată automat din vibrații, în mai multe treceri. Încă neconfirmată pe teren.' },
  possible: { title: 'Posibilă problemă', body: 'Detectată automat din vibrații, neconfirmată: poate fi o groapă, un capac, o bordură sau o frânare.' },
};
