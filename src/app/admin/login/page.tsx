"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { verifyAdminPassword } from "../actions";

const storageKey = "ksw-admin-authenticated";

export default function AdminLoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (window.localStorage.getItem(storageKey) === "true") {
      router.replace("/admin");
    }
  }, [router]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const result = await verifyAdminPassword(password);

    if (!result.configured) {
      setError("Admin password is not configured.");
      return;
    }

    if (result.valid) {
      window.localStorage.setItem(storageKey, "true");
      router.replace("/admin");
      return;
    }

    setError("Wrong password. Please try again.");
  }

  return (
    <main className="min-h-screen overflow-x-auto bg-[radial-gradient(circle_at_top_right,rgba(216,173,69,0.16),transparent_34%),linear-gradient(135deg,#061426,#091f39)] px-4 py-12 text-white sm:px-6">
      <section className="mx-auto flex min-h-[70vh] w-full max-w-md flex-col justify-center">
        <div className="rounded-lg border border-[#d8ad45]/25 bg-white/[0.08] p-6 shadow-2xl shadow-black/30 sm:p-8">
          <div className="mx-auto flex size-24 items-center justify-center">
            <img
              alt="KSW L.C. logo"
              className="max-h-full max-w-full object-contain drop-shadow-[0_18px_36px_rgba(216,173,69,0.24)]"
              src="/team-logos/ksw-lc.png"
            />
          </div>
          <h1 className="mt-6 text-center text-3xl font-black tracking-tight text-white">
            KSW Admin Login
          </h1>
          <form className="mt-7 grid gap-4" onSubmit={handleSubmit}>
            <label className="grid gap-2 text-sm font-bold text-slate-200">
              Password
              <input
                className="rounded-md border border-[#d8ad45]/25 bg-white px-4 py-3 text-[#061426] outline-none transition focus:border-[#d8ad45] focus:ring-2 focus:ring-[#d8ad45]/25"
                onChange={(event) => {
                  setPassword(event.target.value);
                  setError("");
                }}
                type="password"
                value={password}
              />
            </label>
            {error ? (
              <p className="rounded-md border border-[#9b1c1f]/30 bg-[#9b1c1f]/15 px-3 py-2 text-sm font-bold text-red-100">
                {error}
              </p>
            ) : null}
            <button
              className="rounded-md bg-gradient-to-r from-[#d8ad45] to-[#f4d58a] px-5 py-3 text-sm font-black text-[#061426] shadow-lg shadow-[#d8ad45]/20 transition-transform hover:scale-[1.02]"
              type="submit"
            >
              Login
            </button>
          </form>
        </div>
      </section>
    </main>
  );
}
