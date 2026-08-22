export interface ChipProps {
  value: number;
}

// text-brass-bright only clears WCAG AA against a dark surface (e.g. --surface) --
// callers must render this on top of a sufficiently dark background, not bare felt.
export function Chip({ value }: ChipProps) {
  return (
    <span className="inline-flex items-center gap-1 align-middle">
      <svg viewBox="0 0 40 40" className="h-5 w-5" aria-hidden="true">
        <circle cx="20" cy="20" r="18" fill="var(--brass)" stroke="var(--ink)" strokeWidth="1.5" />
        <circle cx="20" cy="20" r="12" fill="none" stroke="var(--ink)" strokeWidth="1" strokeDasharray="2 3" />
      </svg>
      <span className="font-utility text-sm text-brass-bright">{value}</span>
    </span>
  );
}
