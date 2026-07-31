"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

const visibilityThreshold = 500;

export function BackToTop() {
  const pathname = usePathname();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setVisible(window.scrollY > visibilityThreshold);
    };

    handleScroll();
    window.addEventListener("scroll", handleScroll, { passive: true });

    return () => {
      window.removeEventListener("scroll", handleScroll);
    };
  }, [pathname]);

  function scrollToTop() {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, behavior: reducedMotion ? "auto" : "smooth" });
  }

  return (
    <button
      aria-label="Back to top"
      aria-hidden={!visible}
      className={`fixed right-4 z-40 inline-flex size-12 items-center justify-center rounded-full border border-[#d8ad45]/55 bg-[#061426] text-[#f4d58a] shadow-2xl shadow-[#d8ad45]/20 transition-all duration-300 ease-out hover:-translate-y-1 hover:border-[#f4d58a] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#f4d58a] motion-reduce:transition-none sm:right-6 ${
        visible
          ? "pointer-events-auto translate-y-0 opacity-100"
          : "pointer-events-none translate-y-4 opacity-0"
      }`}
      onClick={scrollToTop}
      style={{ bottom: "calc(1.5rem + env(safe-area-inset-bottom))" }}
      tabIndex={visible ? 0 : -1}
      type="button"
    >
      <svg
        aria-hidden="true"
        className="size-5"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2.5"
        viewBox="0 0 24 24"
      >
        <path d="m6 15 6-6 6 6" />
      </svg>
    </button>
  );
}
