// Pictograme pentru cele trei categorii de raport. Lucide nu are groapă sau prag de viteză: desenate aici,
// în același stil (contur 2 px, 24×24). Obstacolul folosește bariera Lucide.
import { Construction } from 'lucide-react';
import type { ReportType } from '../../storage/idb';

type P = { size?: number; className?: string };
const svg = (size: number, className: string | undefined, children: JSX.Element) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">{children}</svg>
);

/** groapă: suprafața drumului întreruptă de o adâncitură, cu fisuri */
export function PotholeIcon({ size = 24, className }: P) {
  return svg(size, className, <>
    <path d="M2 13h5.5l1.2 3.6c.2.6.7.9 1.3.9h4c.6 0 1.1-.3 1.3-.9L16.5 13H22" />
    <path d="M9 9.5 10.5 11.5" />
    <path d="M15 9 13.8 11.3" />
    <path d="M12 6.5v2.5" />
    <path d="M2 20h20" />
  </>);
}

/** denivelare / prag: drumul se ridică într-o cocoașă, cu marcaje */
export function SpeedBumpIcon({ size = 24, className }: P) {
  return svg(size, className, <>
    <path d="M2 18h3.5c1.8 0 2.8-6 6.5-6s4.7 6 6.5 6H22" />
    <path d="m9.6 14.6 1-1.2" />
    <path d="m13.4 13.4 1 1.2" />
    <path d="M2 21h20" />
  </>);
}

export function HazardIcon({ type, size = 24, className }: P & { type: ReportType }) {
  if (type === 'groapa') return <PotholeIcon size={size} className={className} />;
  if (type === 'denivelare') return <SpeedBumpIcon size={size} className={className} />;
  return <Construction size={size} className={className} aria-hidden="true" />;
}
