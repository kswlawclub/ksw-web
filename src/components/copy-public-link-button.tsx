"use client";

import { useEffect, useState } from "react";

type CopyPublicLinkButtonProps = {
  path: string;
  variant?: "dark" | "light";
};

export function CopyPublicLinkButton({ path, variant = "light" }: CopyPublicLinkButtonProps) {
  const [message, setMessage] = useState("");
  const isDark = variant === "dark";

  useEffect(() => {
    if (!message) return;

    const timeout = window.setTimeout(() => setMessage(""), 1800);
    return () => window.clearTimeout(timeout);
  }, [message]);

  async function copyUrl() {
    const url = new URL(path, window.location.origin).toString();

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
      } else {
        const input = document.createElement("textarea");
        input.value = url;
        input.setAttribute("readonly", "");
        input.style.position = "fixed";
        input.style.opacity = "0";
        document.body.appendChild(input);
        input.select();
        document.execCommand("copy");
        document.body.removeChild(input);
      }

      setMessage("Copied");
    } catch (error) {
      console.error("copy public competition url failed", error);
      setMessage("Copy failed");
    }
  }

  return (
    <span className="inline-flex flex-col gap-1">
      <button
        className={`inline-flex items-center justify-center rounded-md border px-4 py-2 text-sm font-black shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d8ad45] ${
          isDark
            ? "border-white/20 bg-white/[0.08] text-white hover:bg-white/[0.14]"
            : "border-[#d8ad45]/45 bg-white text-[#061426] hover:bg-[#fff4dc]"
        }`}
        onClick={copyUrl}
        type="button"
      >
        Copy Public URL
      </button>
      <span aria-live="polite" className={`min-h-4 text-xs font-bold ${isDark ? "text-slate-300" : "text-slate-500"}`}>
        {message}
      </span>
    </span>
  );
}
