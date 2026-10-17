/** Geometric wordmark glyph. Decorative: the adjacent text carries the name. */
export function BrandMark({ className }: { readonly className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      strokeWidth="1.25"
      stroke="currentColor"
      aria-hidden="true"
      className={className}
    >
      <rect x="1.5" y="1.5" width="13" height="13" />
      <path d="M1.5 8.5h13" />
      <path d="M8 1.5v13" strokeDasharray="2 2" />
    </svg>
  );
}
