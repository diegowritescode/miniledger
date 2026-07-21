export function Logo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      className={className}
      role="img"
      aria-label="MiniLedger"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect x="1" y="1" width="30" height="30" rx="8" className="fill-brand" />
      <path
        d="M16 6v20M11 24h10"
        stroke="currentColor"
        className="text-ink"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M16 9 8.5 11.5l2.6 4.6c-.6 1.2-2 1.7-3.1 1.2M16 9l7.5 2.5-2.6 4.6c.6 1.2 2 1.7 3.1 1.2"
        stroke="currentColor"
        className="text-ink"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
