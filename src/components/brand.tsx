import Link from "next/link";

/** Compact SOLME monogram (text only): used where the full wordmark does not fit. */
export function LogoMark({ size = 28, className = "" }: { size?: number; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-flex items-center justify-center rounded-md border border-up/50 font-display font-bold text-up ${className}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.55) }}
    >
      S
    </span>
  );
}

/** SOLME wordmark: text only, "SOL" in white and "ME" in the accent purple. */
export function Logo({ href = "/", compact = false }: { href?: string; compact?: boolean }) {
  return (
    <Link href={href} className="flex items-center font-display font-bold tracking-tight" aria-label="SOLME home">
      {compact ? (
        <LogoMark />
      ) : (
        <span className="text-[19px] leading-none text-fg">
          SOL<span className="text-up">ME</span>
        </span>
      )}
    </Link>
  );
}
