"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

const navItems = [
  ["Home", "/"],
  ["Team", "/team"],
  ["Gallery", "/gallery"],
  ["Partners", "/partners"],
  ["League Center", "/#league-center"],
];
const facebookUrl = "https://web.facebook.com/KlongSamWaLawyers";
const storageKey = "ksw-admin-authenticated";

export function SiteHeader() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [adminAuthenticated, setAdminAuthenticated] = useState(false);
  const visibleNavItems = useMemo(
    () => (adminAuthenticated ? [...navItems, ["Admin", "/admin"]] : navItems),
    [adminAuthenticated],
  );

  useEffect(() => {
    try {
      setAdminAuthenticated(window.localStorage.getItem(storageKey) === "true");
    } catch {
      setAdminAuthenticated(false);
    }
  }, []);

  const isActive = (href: string) => {
    if (href === "/#league-center") {
      return false;
    }

    return pathname === href;
  };

  return (
    <header className="sticky top-0 z-50 border-b border-[#d8ad45]/20 bg-[radial-gradient(circle_at_top_right,rgba(216,173,69,0.16),transparent_34%),linear-gradient(135deg,#061426,#091f39)] text-white shadow-lg shadow-black/20">
      <div className="mx-auto flex min-h-16 w-full max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-10">
        <Link className="flex items-center gap-3" href="/" onClick={() => setOpen(false)}>
          <span className="flex size-12 items-center justify-center drop-shadow-[0_10px_24px_rgba(216,173,69,0.18)]">
            <img alt="KSW L.C. logo" className="max-h-full max-w-full object-contain" src="/team-logos/ksw-lc.png" />
          </span>
          <span className="text-sm font-black tracking-wide text-[#f4d58a]">KSW L.C.</span>
        </Link>

        <nav className="hidden items-center gap-1 md:flex">
          {visibleNavItems.map(([label, href]) => (
            <Link
              className={`rounded-md px-3 py-2 text-sm font-bold transition-colors ${
                isActive(href)
                  ? "bg-[#d8ad45]/15 text-[#f4d58a]"
                  : "text-slate-200 hover:bg-white/10 hover:text-white"
              }`}
              href={href}
              key={href}
            >
              {label}
            </Link>
          ))}
        </nav>

        <button
          aria-expanded={open}
          aria-label="Toggle navigation"
          className="inline-flex size-10 items-center justify-center rounded-md border border-[#d8ad45]/35 text-[#f4d58a] md:hidden"
          onClick={() => setOpen((value) => !value)}
          type="button"
        >
          <span className="grid gap-1">
            <span className={`block h-0.5 w-5 bg-current transition-transform ${open ? "translate-y-1.5 rotate-45" : ""}`} />
            <span className={`block h-0.5 w-5 bg-current transition-opacity ${open ? "opacity-0" : ""}`} />
            <span className={`block h-0.5 w-5 bg-current transition-transform ${open ? "-translate-y-1.5 -rotate-45" : ""}`} />
          </span>
        </button>
      </div>

      {open ? (
        <nav className="border-t border-[#d8ad45]/15 px-4 pb-4 md:hidden">
          <div className="mx-auto grid w-full max-w-7xl gap-2 pt-3">
            {visibleNavItems.map(([label, href]) => (
              <Link
                className={`rounded-md px-3 py-3 text-sm font-bold transition-colors ${
                  isActive(href)
                    ? "bg-[#d8ad45]/15 text-[#f4d58a]"
                    : "text-slate-200 hover:bg-white/10 hover:text-white"
                }`}
                href={href}
                key={href}
                onClick={() => setOpen(false)}
              >
                {label}
              </Link>
            ))}
            <a
              className="mt-2 rounded-md border border-[#d8ad45]/25 px-3 py-3 text-sm font-black text-[#f4d58a] transition-colors hover:bg-white/10 hover:text-white"
              href={facebookUrl}
              onClick={() => setOpen(false)}
              rel="noopener noreferrer"
              target="_blank"
            >
              KSW Facebook
            </a>
          </div>
        </nav>
      ) : null}
    </header>
  );
}
