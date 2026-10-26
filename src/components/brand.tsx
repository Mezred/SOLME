import Link from "next/link";

/** NEXALPHA mark: a hexagonal scanner frame enclosing a rising alpha chevron with a signal node. */
export function LogoMark({ size = 28, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true" className={className}>
      <path d="M16 2.5 27.7 9.25v13.5L16 29.5 4.3 22.75V9.25L16 2.5Z" stroke="url(#nx-g)" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M9.5 21.5 16 9.5l6.5 12" stroke="#E7EAF3" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12.4 17.4h7.2" stroke="#E7EAF3" strokeWidth="1.6" strokeLinecap="round" opacity=".55" />
      <circle cx="22.5" cy="21.5" r="2.1" fill="#1FE08A" />
      <defs>
        <linearGradient id="nx-g" x1="4" y1="3" x2="28" y2="29" gradientUnits="userSpaceOnUse">
          <stop stopColor="#1FE08A" />
          <stop offset="1" stopColor="#8F7CFF" />
        </linearGradient>
      </defs>
    </svg>
  );
}

export function Logo({ href = "/", compact = false }: { href?: string; compact?: boolean }) {
  return (
    <Link href={href} className="flex items-center gap-2 font-semibold tracking-tight" aria-label="NEXALPHA home">
      <LogoMark />
      {!compact && (
        <span className="text-[15px]">
          NEX<span className="text-up">ALPHA</span>
        </span>
      )}
    </Link>
  );
}
