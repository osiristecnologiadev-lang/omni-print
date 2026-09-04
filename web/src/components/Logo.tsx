// Four slightly offset dots standing in for a print shop's CMYK
// registration mark - the literal thing a press operator checks to see if
// the color plates are aligned. A deliberate, subject-specific mark rather
// than a generic monogram or an off-the-shelf icon.
export function LogoMark({ size = 20, keyColor = 'currentColor' }: { size?: number; keyColor?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden="true" className="shrink-0">
      <circle cx="8.2" cy="8.2" r="5" fill="#06b6d4" opacity="0.85" />
      <circle cx="11.8" cy="8.2" r="5" fill="#ec4899" opacity="0.85" />
      <circle cx="10" cy="11.3" r="5" fill="#eab308" opacity="0.85" />
      <circle cx="10" cy="9.2" r="2.1" fill={keyColor} />
    </svg>
  );
}

export function Logo({ size = 20 }: { size?: number }) {
  return (
    <span className="inline-flex items-center gap-2 font-semibold text-ink">
      <LogoMark size={size} />
      OmniPrint
    </span>
  );
}
