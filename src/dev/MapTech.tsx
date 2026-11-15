// Detaliile tehnice ale hărții, doar în ShockGrid Dev: RVI, GPS, viteze, ferestre, semnalul șocului.
import { useMemo } from 'react';
import type { EdgeAgg, ShockZone } from '../core/aggregate';
import { t } from '../i18n/ro';
import { useApp } from '../state/store';
import { UPlot } from '../ui/charts/UPlot';
import { fmt, fmtLen } from '../ui/format';
import { ClassBadge } from '../ui/kit';
import type { MapTech } from '../ui/pages/MapScreen';
import { DEV_REPORT_HOOKS } from './NavTech';
import { HazardCard } from './Hazards';

function EdgeTech({ e, len, osm, version, zones, manual }: Parameters<MapTech['edge']>[0]) {
  const layer = useApp((s) => s.layer);
  const measured = e.status !== 'UNKNOWN' && !!e.class;
  const x = e.explore;
  const accM = e.gps_acc_median ?? x?.acc_p50 ?? null;
  const gps = accM === null ? null : accM <= 6 ? 'bună' : accM <= 10 ? 'medie' : 'slabă';
  const kmh = (v: number | null) => (v === null ? '—' : `${Math.round(v * 3.6)}`);
  return (
    <details open>
      <summary>Date tehnice (Dev)</summary>
      <dl className="kv">
        <dt>RVI (mediana)</dt><dd>{measured ? fmt(e.rms_median, 2, 'm/s²') : '—'}{x ? ` · explorare: ${fmt(x.rms_p50, 2, 'm/s²')} la ~${fmt(x.speed_p50, 1, 'm/s')}` : ''}</dd>
        <dt>segment</dt><dd>{fmtLen(len)} · {e.surface_kind ?? '—'}</dd>
        <dt>treceri</dt><dd>{measured ? `${e.n_passes} (din ${e.n_rides} ${e.n_rides === 1 ? 'tură' : 'ture'})` : '—'}{x ? ` · lente: ${x.passes}` : ''}</dd>
        <dt>GPS</dt><dd>{gps ? `${gps} (±${fmt(accM, 0, 'm')})` : '—'}{e.ambiguous_ratio > 0 ? ` · ${fmt(e.ambiguous_ratio * 100, 0, '%')} ambiguu carosabil/trotuar/pistă` : ''}</dd>
        <dt>viteze măsurate</dt><dd>{measured ? `${kmh(e.speed_p10)}–${kmh(e.speed_p90)} km/h` : x ? `~${kmh(x.speed_p50)} km/h (lent)` : '—'}</dd>
        <dt>zone de șocuri</dt><dd>{zones.length ? `${zones.length}: ${zones.filter((z) => z.status === 'NEEDS_REVIEW').length} de verificat, ${zones.filter((z) => z.status === 'REPEATED').length} repetate, ${zones.filter((z) => (z.confirmed ?? 0) > 0).length} confirmate` : 'niciuna'}</dd>
        <dt>observații manuale</dt><dd>{manual ? `${manual} (nu sunt măsurători)` : 'niciuna'}</dd>
        {measured && <><dt>clasa detaliată</dt><dd><ClassBadge c={e.class!} /> {t.classShort[e.class!]}</dd></>}
        <dt>ferestre valide</dt><dd>{e.n_windows} din {e.n_windows_total}</dd>
        {e.reasons.length > 0 && <><dt>motive încredere</dt><dd>{e.reasons.join(', ')}</dd></>}
        {x && <><dt>explorare pe viteze</dt><dd>{x.bands.map((b) => `${b.label}: ${b.n} · ${fmt(b.rms_p50, 2)}`).join('; ')}</dd></>}
        <dt>OSM</dt><dd>{osm}</dd>
        <dt>surse</dt><dd>{e.sources.join(', ') || '—'}</dd>
        <dt>algoritm</dt><dd>{version}</dd>
      </dl>
      <p className="xs muted">RMS al accelerației verticale filtrate trece-sus 4 Hz, ferestre de 2 s la 2,5–9 m/s cu GPS; mediana pe segment. „Măsurat” cere ≥ 3 ferestre, ≥ 2 treceri, GPS ≤ 10 m și nicio ambiguitate. Clasele A–E = percentilele 20/40/60/80 ({layer.thresholds_source}).</p>
    </details>
  );
}

function ZoneTech({ z }: { z: ShockZone }) {
  const snip = z.strongest.snippet;
  const data = useMemo(() => (snip ? ([snip.v.map((_, i) => (i * snip.dt) / 1000 - 3), snip.v.map((v) => (Number.isFinite(v) ? v : null))] as [number[], (number | null)[]]) : null), [snip]);
  return (
    <details open>
      <summary>Date tehnice (Dev)</summary>
      <dl className="kv">
        <dt>membri</dt><dd>{z.members.length} ({z.n_strong} puternice) pe ~{Math.max(5, z.extent_m)} m</dd>
        <dt>treceri</dt><dd>detectări verificate în {z.detections} din {z.passes}</dd>
        <dt>vârf</dt><dd>{fmt(z.peak_max, 1, 'm/s²')} (mediana {fmt(z.peak_median, 1)})</dd>
        <dt>stare algoritm</dt><dd>{z.status}</dd>
        <dt>viteză</dt><dd>{fmt(z.speed_median, 1, 'm/s')}</dd>
        <dt>roată față + spate</dt><dd>{fmt(z.double_hit_ratio * 100, 0, '%')} (ipoteză)</dd>
        <dt>ultima detectare</dt><dd>{z.last_seen}</dd>
      </dl>
      {data && <UPlot data={data} series={[{ label: 'a_v filtrat (m/s²)', stroke: '#e8590c', width: 1 }]} height={140} xLabel="s față de vârf" ariaLabel="Semnalul de ±3 s în jurul detectării" />}
    </details>
  );
}

export const MAP_TECH: MapTech = {
  edge: (p) => <EdgeTech {...p} />,
  zone: (z) => <ZoneTech z={z} />,
  hazard: (h) => (h.detail ? <HazardCard h={h} open /> : <p className="small">Problemă din stratul publicat ({h.level}{h.type ? `, ${h.type}` : ''}). Decizia se ia pe tura locală.</p>),
  reportHooks: DEV_REPORT_HOOKS,
};
