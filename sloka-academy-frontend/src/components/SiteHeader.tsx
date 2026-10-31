"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { navLinks, preRegisterHref, preRegisterIsExternal, verifyLink } from "@/config/site";
import { Icon } from "./Icon";
import { Logo } from "./Logo";
import { SmartLink } from "./SmartLink";

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname.startsWith(href.replace(/\/$/, ""));
}

export function SiteHeader() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [lastPath, setLastPath] = useState(pathname);

  // Close the mobile menu after navigation.
  if (pathname !== lastPath) {
    setLastPath(pathname);
    setOpen(false);
  }

  // While the menu covers the screen, stop the page scrolling behind it. Close it if the
  // window widens to the desktop layout, where the panel is hidden.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const desktop = window.matchMedia("(min-width: 1024px)");
    const onWiden = () => desktop.matches && setOpen(false);
    const root = document.documentElement;
    const previousOverflow = root.style.overflow;
    root.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    desktop.addEventListener("change", onWiden);
    return () => {
      root.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKey);
      desktop.removeEventListener("change", onWiden);
    };
  }, [open]);

  return (
    <header className="sticky top-0 z-50 border-b border-line bg-bg/70 backdrop-blur-2xl backdrop-saturate-150">
      <a href="#main" className="skip-link absolute left-4 top-3 z-50 rounded-full bg-white px-4 py-2 text-sm font-semibold text-black">
        Skip to content
      </a>
      <div className="wrap flex h-[var(--header-h)] items-center justify-between gap-8">
        <Logo className="h-[48px] w-auto" priority />

        <nav aria-label="Main" className="hidden lg:block">
          <ul className="flex items-center gap-1 rounded-full border border-line bg-white/[0.03] p-1.5 text-[0.86rem]">
            {navLinks.map((link) => {
              const active = isActive(pathname, link.href);
              return (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    aria-current={active ? "page" : undefined}
                    className={`block rounded-full px-4 py-2 transition-all duration-300 ${
                      active
                        ? "bg-white/[0.08] text-text shadow-[inset_0_0_0_1px_rgb(255_255_255/0.1)]"
                        : "text-muted hover:text-text"
                    }`}
                  >
                    {link.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="hidden items-center gap-3 lg:flex">
          <Link
            href={verifyLink.href}
            aria-current={isActive(pathname, verifyLink.href) ? "page" : undefined}
            title={verifyLink.label}
            className="btn btn-glass !min-h-[44px] !px-3.5 !text-[0.84rem] xl:!px-5"
          >
            <Icon name="shield" size={16} />
            {/* Icon only until there is room for the words beside the menu. */}
            <span className="sr-only xl:not-sr-only">{verifyLink.label}</span>
          </Link>
          {/* One place for every sign-in: students to the LMS, staff to the admin portal. */}
          <Link
            href="/login/"
            aria-current={isActive(pathname, "/login/") ? "page" : undefined}
            className="btn btn-glass !min-h-[44px] !px-5 !text-[0.84rem]"
          >
            <Icon name="login" size={16} />
            Login
          </Link>
          <SmartLink href={preRegisterHref} external={preRegisterIsExternal} className="btn btn-red !min-h-[44px] !px-5 !text-[0.84rem]">
            Pre-register
          </SmartLink>
        </div>

        <button
          type="button"
          className="inline-flex h-11 items-center gap-2 rounded-full border border-line-2 px-4 text-sm font-medium lg:hidden"
          aria-expanded={open}
          aria-controls="mobile-menu"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "Close" : "Menu"}
          <Icon name={open ? "close" : "menu"} size={18} />
        </button>
      </div>

      <div
        id="mobile-menu"
        hidden={!open}
        className="h-[calc(100svh-var(--header-h))] overflow-y-auto overscroll-contain border-t border-line lg:hidden"
      >
        <nav aria-label="Mobile" className="wrap pb-8 pt-3">
          <ul>
            {navLinks.map((link) => {
              const active = isActive(pathname, link.href);
              return (
                <li key={link.href} className="border-b border-line">
                  <Link
                    href={link.href}
                    aria-current={active ? "page" : undefined}
                    className={`display flex items-center justify-between py-4 text-[1.6rem] ${active ? "text-text" : "text-muted"}`}
                  >
                    {link.label}
                    {active && <span className="h-2 w-2 rounded-full bg-red-hi shadow-[0_0_12px_var(--glow)]" aria-hidden="true" />}
                  </Link>
                </li>
              );
            })}
            <li className="border-b border-line">
              <Link
                href={verifyLink.href}
                aria-current={isActive(pathname, verifyLink.href) ? "page" : undefined}
                className={`display flex items-center justify-between py-4 text-[1.6rem] ${isActive(pathname, verifyLink.href) ? "text-text" : "text-muted"}`}
              >
                {verifyLink.label}
                <Icon name="shield" size={22} />
              </Link>
            </li>
            <li className="border-b border-line">
              <Link
                href="/login/"
                aria-current={isActive(pathname, "/login/") ? "page" : undefined}
                className={`display flex items-center justify-between py-4 text-[1.6rem] ${isActive(pathname, "/login/") ? "text-text" : "text-muted"}`}
              >
                Login
                <Icon name="login" size={22} />
              </Link>
            </li>
          </ul>
          <SmartLink href={preRegisterHref} external={preRegisterIsExternal} className="btn btn-red mt-7 w-full">
            Pre-register
          </SmartLink>
        </nav>
      </div>
    </header>
  );
}
