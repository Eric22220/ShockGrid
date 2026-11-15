// Etichetele pentru bicicliști (scurte). Aceleași categorii ca în Dev (verde/galben/roșu), alt text.
import type { RoughCat } from '../../core/aggregate';

export const CITIZEN_ROUGH: Record<RoughCat, string> = { green: 'Neted', yellow: 'Denivelat', red: 'Foarte denivelat' };
export const NO_DATA_TEXT = 'Nu avem încă date de confort în această zonă.';
