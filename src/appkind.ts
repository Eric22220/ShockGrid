// Două site-uri din același cod: aplicația pentru bicicliști (/ShockGrid/) și platforma tehnică (/ShockGridDev/).
// Valoarea e fixată la build (vite --mode devapp), deci ramurile celeilalte aplicații dispar din bundle.
// `import.meta.env` scris literal: Vite îl înlocuiește la build; în scripturile Node (tsx) e undefined
const env = import.meta.env as { MODE?: string } | undefined;
export const IS_DEV_APP = env?.MODE === 'devapp';

/** Bazele IndexedDB sunt separate: ambele site-uri sunt pe aceeași origine (eric22220.github.io). */
export const DB_NAME = IS_DEV_APP ? 'shockgrid-dev' : 'shockgrid';
/** baza aplicației pentru bicicliști, citită (doar citire) de Dev la copierea turelor existente */
export const CITIZEN_DB_NAME = 'shockgrid';
