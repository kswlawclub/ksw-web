"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

const storageKey = "ksw-admin-authenticated";
const modules = [
  { title: "Manage Matches", href: "/admin/matches", status: "Open module" },
  { title: "Manage Competitions", href: "/admin/competitions", status: "Open module" },
  { title: "Manage Teams", href: "/admin/teams", status: "Open module" },
  { title: "Manage Gallery", href: "/admin/gallery", status: "Open module" },
  { title: "Manage Sponsors", href: "/admin/sponsors", status: "Open module" },
];

export default function AdminDashboardPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (window.localStorage.getItem(storageKey) !== "true") {
      router.replace("/admin/login");
      return;
    }

    setReady(true);
  }, [router]);

  function logout() {
    window.localStorage.removeItem(storageKey);
    router.replace("/admin/login");
  }

  if (!ready) {
    return (
      <main className="min-h-screen bg-[radial-gradient(circle_at_top_right,rgba(216,173,69,0.16),transparent_34%),linear-gradient(135deg,#061426,#091f39)] px-4 py-12 text-white">
        <div className="mx-auto w-full max-w-7xl">Loading admin...</div>
      </main>
    );
  }

  return (
    <main className="min-h-screen overflow-x-hidden bg-[#f6f2ea] text-[#061426]">
      <section className="bg-[radial-gradient(circle_at_top_right,rgba(216,173,69,0.16),transparent_34%),linear-gradient(135deg,#061426,#091f39)] px-4 py-12 text-white sm:px-6 lg:px-10">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.24em] text-[#d8ad45]">
              KSW L.C.
            </p>
            <h1 className="mt-3 text-4xl font-black tracking-tight">KSW Admin</h1>
            <p className="mt-4 max-w-2xl text-base leading-7 text-slate-300">
              Website and league management dashboard
            </p>
          </div>
          <button
            className="inline-flex items-center justify-center rounded-md border border-[#d8ad45]/50 bg-white/[0.03] px-5 py-3 text-sm font-black text-[#f4d58a] transition-colors hover:bg-[#d8ad45]/10"
            onClick={logout}
            type="button"
          >
            Logout
          </button>
        </div>
      </section>

      <section className="mx-auto grid w-full max-w-7xl gap-4 px-4 py-10 sm:px-6 md:grid-cols-2 lg:px-10">
        {modules.map((module) => (
          <article className="rounded-lg border border-slate-200 bg-white p-6 shadow-xl shadow-slate-900/10" key={module.title}>
            <div className="mb-4 h-0.5 w-12 rounded-full bg-[#d8ad45]" />
            <h2 className="text-2xl font-black text-[#061426]">{module.title}</h2>
            {module.href ? (
              <Link
                className="mt-4 inline-flex rounded-md bg-[#061426] px-4 py-2 text-sm font-black text-[#f4d58a] transition-colors hover:bg-[#091f39]"
                href={module.href}
              >
                {module.status}
              </Link>
            ) : (
              <p className="mt-3 text-sm font-semibold text-slate-600">{module.status}</p>
            )}
          </article>
        ))}
      </section>
    </main>
  );
}
