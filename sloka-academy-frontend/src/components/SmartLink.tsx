import Link from "next/link";
import type { ComponentProps } from "react";

/** Renders a Next.js Link for internal paths and a plain anchor for external URLs. */
export function SmartLink({
  href,
  external,
  children,
  ...rest
}: Omit<ComponentProps<"a">, "href"> & { href: string; external?: boolean }) {
  const isExternal = external ?? /^(https?:|mailto:|tel:)/.test(href);
  if (isExternal) {
    const newTab = href.startsWith("http");
    return (
      <a href={href} {...(newTab ? { target: "_blank", rel: "noopener noreferrer" } : {})} {...rest}>
        {children}
        {newTab && <span className="sr-only"> (opens in a new tab)</span>}
      </a>
    );
  }
  return (
    <Link href={href} {...rest}>
      {children}
    </Link>
  );
}
