import Image from "next/image";
import Link from "next/link";

// Supplied logo, used as-is (transparent PNG; trimmed of empty margin only).
export function Logo({ className = "h-12 w-auto", priority = false }: { className?: string; priority?: boolean }) {
  return (
    <Link href="/" className="inline-flex shrink-0 items-center" aria-label="Sloka Academy home">
      <Image
        src="/brand/sloka-academy-logo-sm.png"
        alt="Sloka Academy"
        width={360}
        height={287}
        priority={priority}
        className={className}
      />
    </Link>
  );
}
