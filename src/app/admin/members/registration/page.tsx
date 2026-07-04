"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { listMembers } from "../actions";

type ClubMember = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  nickname: string;
  birth_day: number | null;
  birth_month: number | null;
  birth_year_be: number | null;
  shirt_number: number | null;
  lawyer_license_no: string | null;
  phone: string | null;
  is_active: boolean;
};

type SortMode = "oldest" | "youngest";

function currentBuddhistYear() {
  return new Date().getFullYear() + 543;
}

function validBirthYear(value: number | null) {
  return Boolean(value && !Number.isNaN(value) && value >= 2400 && value <= currentBuddhistYear());
}

function calculatedAge(member: Pick<ClubMember, "birth_day" | "birth_month" | "birth_year_be">) {
  const birthYear = member.birth_year_be;
  const birthMonth = member.birth_month;
  const birthDay = member.birth_day;
  const now = new Date();
  const year = currentBuddhistYear();
  const month = now.getMonth() + 1;
  const day = now.getDate();

  if (!validBirthYear(birthYear)) {
    return "-";
  }

  let age = year - birthYear!;

  if (birthMonth && birthDay) {
    if (month < birthMonth || (month === birthMonth && day < birthDay)) {
      age -= 1;
    }
  }

  return age >= 0 ? String(age) : "-";
}

function displayAge(member: Pick<ClubMember, "birth_year_be">) {
  if (!validBirthYear(member.birth_year_be)) {
    return "-";
  }

  return String(currentBuddhistYear() - member.birth_year_be!);
}

function fullName(member: Pick<ClubMember, "first_name" | "last_name">) {
  return [member.first_name, member.last_name].filter(Boolean).join(" ") || "-";
}

function birthDateDisplay(member: Pick<ClubMember, "birth_day" | "birth_month" | "birth_year_be">) {
  if (member.birth_year_be && member.birth_month && member.birth_day) {
    return `${String(member.birth_day).padStart(2, "0")}/${String(member.birth_month).padStart(2, "0")}/${member.birth_year_be}`;
  }

  return member.birth_year_be ? String(member.birth_year_be) : "-";
}

function compareBirthDate(a: ClubMember, b: ClubMember, mode: SortMode) {
  const aHasYear = validBirthYear(a.birth_year_be);
  const bHasYear = validBirthYear(b.birth_year_be);

  if (!aHasYear && !bHasYear) return 0;
  if (!aHasYear) return 1;
  if (!bHasYear) return -1;

  const aMonth = a.birth_month ?? (mode === "oldest" ? 99 : -1);
  const bMonth = b.birth_month ?? (mode === "oldest" ? 99 : -1);
  const aDay = a.birth_day ?? (mode === "oldest" ? 99 : -1);
  const bDay = b.birth_day ?? (mode === "oldest" ? 99 : -1);

  if (mode === "oldest") {
    return a.birth_year_be! - b.birth_year_be! || aMonth - bMonth || aDay - bDay;
  }

  return b.birth_year_be! - a.birth_year_be! || bMonth - aMonth || bDay - aDay;
}

export default function MemberRegistrationPage() {
  const [members, setMembers] = useState<ClubMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeOnly, setActiveOnly] = useState(true);
  const [sortMode, setSortMode] = useState<SortMode>("oldest");

  useEffect(() => {
    async function loadData() {
      setLoading(true);
      setError("");

      const result = await listMembers();

      if (!result.ok) {
        setMembers([]);
        setError(result.error ?? "Could not load members.");
      } else {
        setMembers((result.members ?? []) as ClubMember[]);
      }

      setLoading(false);
    }

    void loadData();
  }, []);

  const visibleMembers = useMemo(() => {
    return members
      .filter((member) => (activeOnly ? member.is_active : true))
      .sort((a, b) => {
        const diff = compareBirthDate(a, b, sortMode);

        if (diff) return diff;

        return fullName(a).localeCompare(fullName(b));
      });
  }, [activeOnly, members, sortMode]);

  return (
    <main className="min-h-screen overflow-x-auto bg-[#f6f2ea] text-[#061426]">
      <section className="bg-[radial-gradient(circle_at_top_right,rgba(216,173,69,0.16),transparent_34%),linear-gradient(135deg,#061426,#091f39)] px-4 py-12 text-white sm:px-6 lg:px-10">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-5">
          <div className="flex flex-wrap gap-3">
            <Link className="text-sm font-bold text-[#f4d58a] hover:text-white" href="/admin">
              Back to Admin
            </Link>
            <Link className="text-sm font-bold text-[#f4d58a] hover:text-white" href="/admin/members">
              Manage Members
            </Link>
          </div>
          <div>
            <p className="text-xs font-black uppercase tracking-[0.24em] text-[#d8ad45]">
              KSW Admin
            </p>
            <h1 className="mt-3 text-4xl font-black tracking-tight">Member Registration</h1>
            <p className="mt-4 max-w-2xl text-base leading-7 text-slate-300">
              Internal registration view for competition records.
            </p>
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6 lg:px-10">
        <div className="mb-5 flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-xl shadow-slate-900/10 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-2">
            <button
              className={`rounded-md px-4 py-2 text-sm font-black ${
                activeOnly ? "bg-[#061426] text-[#f4d58a]" : "bg-slate-100 text-[#061426]"
              }`}
              onClick={() => setActiveOnly(true)}
              type="button"
            >
              Active Members
            </button>
            <button
              className={`rounded-md px-4 py-2 text-sm font-black ${
                !activeOnly ? "bg-[#061426] text-[#f4d58a]" : "bg-slate-100 text-[#061426]"
              }`}
              onClick={() => setActiveOnly(false)}
              type="button"
            >
              All Members
            </button>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              className={`rounded-md px-4 py-2 text-sm font-black ${
                sortMode === "oldest" ? "bg-[#d8ad45] text-[#061426]" : "bg-slate-100 text-[#061426]"
              }`}
              onClick={() => setSortMode("oldest")}
              type="button"
            >
              Oldest First
            </button>
            <button
              className={`rounded-md px-4 py-2 text-sm font-black ${
                sortMode === "youngest" ? "bg-[#d8ad45] text-[#061426]" : "bg-slate-100 text-[#061426]"
              }`}
              onClick={() => setSortMode("youngest")}
              type="button"
            >
              Youngest First
            </button>
          </div>
        </div>

        <div className="min-w-0 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl shadow-slate-900/10">
          {loading ? (
            <p className="p-5 text-sm font-bold text-slate-600">Loading registration data...</p>
          ) : error ? (
            <p className="p-5 text-sm font-bold text-[#9b1c1f]">{error}</p>
          ) : visibleMembers.length ? (
            <div className="w-full overflow-x-auto">
              <table className="w-full min-w-[1200px] border-collapse text-left text-sm">
                <thead className="bg-[#061426] text-xs uppercase tracking-[0.14em] text-[#f4d58a]">
                  <tr>
                    <th className="px-4 py-3">No.</th>
                    <th className="min-w-[220px] px-4 py-3">Full Name</th>
                    <th className="px-4 py-3">Lawyer License No.</th>
                    <th className="px-4 py-3">Birth Date (B.E.)</th>
                    <th className="px-4 py-3">Exact Age</th>
                    <th className="px-4 py-3">Display Age</th>
                    <th className="px-4 py-3">Shirt No.</th>
                    <th className="px-4 py-3">Nickname</th>
                    <th className="px-4 py-3">Phone</th>
                    <th className="px-4 py-3">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleMembers.map((member, index) => (
                    <tr className="border-b border-slate-100 last:border-b-0" key={member.id}>
                      <td className="px-4 py-3 font-black">{index + 1}</td>
                      <td className="min-w-[220px] whitespace-nowrap px-4 py-3 font-black">
                        {fullName(member)}
                      </td>
                      <td className="px-4 py-3">{member.lawyer_license_no ?? "-"}</td>
                      <td className="px-4 py-3">{birthDateDisplay(member)}</td>
                      <td className="px-4 py-3">{calculatedAge(member)}</td>
                      <td className="px-4 py-3">{displayAge(member)}</td>
                      <td className="px-4 py-3">{member.shirt_number ?? "-"}</td>
                      <td className="px-4 py-3">{member.nickname}</td>
                      <td className="px-4 py-3">{member.phone ?? "-"}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`rounded-full px-3 py-1 text-xs font-black ${
                            member.is_active
                              ? "bg-emerald-50 text-emerald-800"
                              : "bg-slate-100 text-slate-600"
                          }`}
                        >
                          {member.is_active ? "Active" : "Inactive"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="p-5 text-sm font-bold text-slate-600">No registration data found.</p>
          )}
        </div>
      </section>
    </main>
  );
}
