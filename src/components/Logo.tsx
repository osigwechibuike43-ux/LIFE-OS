import { cn } from '@/lib/utils';

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn('h-8 w-8', className)} aria-hidden>
      <defs>
        <linearGradient id="lm" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="rgb(129 122 255)" />
          <stop offset="1" stopColor="rgb(99 91 255)" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill="rgb(16 17 22)" />
      <circle cx="16" cy="16" r="8.2" fill="none" stroke="url(#lm)" strokeWidth="2.6" />
      <circle cx="16" cy="16" r="2.6" fill="#F5B544" />
    </svg>
  );
}

export function Logo({ className, showText = true }: { className?: string; showText?: boolean }) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <LogoMark />
      {showText && <span className="font-display text-[15px] font-semibold tracking-[0.14em]">LIFE OS</span>}
    </span>
  );
}
