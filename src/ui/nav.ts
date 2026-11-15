// Navigarea cu hash (#/...), comună celor două aplicații (ShockGrid și ShockGrid Dev).
import { useEffect, useState } from 'react';

export function go(path: string) { location.hash = path; }

export function useHash() {
  const [h, setH] = useState(() => location.hash.slice(1) || '/');
  useEffect(() => {
    const on = () => setH(location.hash.slice(1) || '/');
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  return h;
}

/** `/ride/abc/street?name=x` → părțile căii și parametrii */
export function parseHash(path: string) {
  const [pathname, query = ''] = path.split('?');
  const [, base = '', arg, arg2] = pathname.split('/');
  return { pathname, base, arg, arg2, params: new URLSearchParams(query) };
}
