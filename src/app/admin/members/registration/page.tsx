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
type ExportColumnKey =
  | "number"
  | "fullName"
  | "firstName"
  | "lastName"
  | "lawyerLicenseNo"
  | "birthDate"
  | "birthDay"
  | "birthMonth"
  | "birthYearBe"
  | "exactAge"
  | "displayAge"
  | "shirtNo"
  | "nickname"
  | "publicDisplay"
  | "phone"
  | "status";

type ExportColumn = {
  key: ExportColumnKey;
  label: string;
  value: (member: ClubMember, index: number) => string | number;
};

const defaultExportColumns: ExportColumnKey[] = [
  "number",
  "fullName",
  "lawyerLicenseNo",
  "birthDate",
  "displayAge",
  "shirtNo",
  "nickname",
  "phone",
];

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

function shirtNumberDisplay(value: number | null) {
  return value ? `#${value}` : "-";
}

function publicMemberName(nickname: string) {
  const value = nickname.trim();

  if (!value) {
    return "ทนาย";
  }

  return value.startsWith("ทนาย") ? value : `ทนาย${value}`;
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

function csvCell(value: string | number) {
  const text = String(value);

  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }

  return text;
}

function exportFileName() {
  return `ksw-members-registration-${new Date().toISOString().slice(0, 10)}.csv`;
}

export default function MemberRegistrationPage() {
  const [members, setMembers] = useState<ClubMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [exportError, setExportError] = useState("");
  const [activeOnly, setActiveOnly] = useState(true);
  const [sortMode, setSortMode] = useState<SortMode>("oldest");
  const [selectedExportColumns, setSelectedExportColumns] =
    useState<ExportColumnKey[]>(defaultExportColumns);

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

  const exportColumns: ExportColumn[] = useMemo(
    () => [
      { key: "number", label: "No.", value: (_member, index) => index + 1 },
      { key: "fullName", label: "Full Name", value: (member) => fullName(member) },
      { key: "firstName", label: "First Name", value: (member) => member.first_name ?? "-" },
      { key: "lastName", label: "Last Name", value: (member) => member.last_name ?? "-" },
      {
        key: "lawyerLicenseNo",
        label: "Lawyer License No.",
        value: (member) => member.lawyer_license_no ?? "-",
      },
      { key: "birthDate", label: "Birth Date (B.E.)", value: (member) => birthDateDisplay(member) },
      { key: "birthDay", label: "Birth Day", value: (member) => member.birth_day ?? "-" },
      { key: "birthMonth", label: "Birth Month", value: (member) => member.birth_month ?? "-" },
      {
        key: "birthYearBe",
        label: "Birth Year (B.E.)",
        value: (member) => member.birth_year_be ?? "-",
      },
      { key: "exactAge", label: "Exact Age", value: (member) => calculatedAge(member) },
      { key: "displayAge", label: "Display Age", value: (member) => displayAge(member) },
      { key: "shirtNo", label: "Shirt No.", value: (member) => member.shirt_number ?? "-" },
      { key: "nickname", label: "Nickname", value: (member) => member.nickname },
      { key: "publicDisplay", label: "Public Display", value: (member) => publicMemberName(member.nickname) },
      { key: "phone", label: "Phone", value: (member) => member.phone ?? "-" },
      { key: "status", label: "Status", value: (member) => (member.is_active ? "Active" : "Inactive") },
    ],
    [],
  );

  function toggleExportColumn(key: ExportColumnKey) {
    setExportError("");
    setSelectedExportColumns((current) =>
      current.includes(key) ? current.filter((columnKey) => columnKey !== key) : [...current, key],
    );
  }

  function setDefaultExportColumns() {
    setExportError("");
    setSelectedExportColumns(defaultExportColumns);
  }

  function exportCsv() {
    const columns = exportColumns.filter((column) => selectedExportColumns.includes(column.key));

    if (!columns.length) {
      setExportError("Please select at least one column to export.");
      return;
    }

    setExportError("");

    const rows = [
      columns.map((column) => csvCell(column.label)).join(","),
      ...visibleMembers.map((member, index) =>
        columns.map((column) => csvCell(column.value(member, index))).join(","),
      ),
    ];
    const blob = new Blob([`\uFEFF${rows.join("\r\n")}`], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = exportFileName();
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

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

        <div className="mb-5 rounded-lg border border-slate-200 bg-white p-4 shadow-xl shadow-slate-900/10">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="mb-3 h-0.5 w-12 rounded-full bg-[#d8ad45]" />
              <h2 className="text-xl font-black">Excel Export</h2>
              <p className="mt-1 text-sm font-bold text-slate-500">
                Export the currently filtered and sorted registration table as UTF-8 CSV.
              </p>
            </div>
            <button
              className="rounded-md bg-gradient-to-r from-[#d8ad45] to-[#f4d58a] px-5 py-3 text-sm font-black text-[#061426] shadow-lg shadow-[#d8ad45]/20 transition-transform hover:scale-[1.01]"
              onClick={exportCsv}
              type="button"
            >
              Export Excel
            </button>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              className="rounded-md border border-[#061426]/15 px-3 py-2 text-xs font-black text-[#061426] hover:bg-slate-50"
              onClick={() => {
                setExportError("");
                setSelectedExportColumns(exportColumns.map((column) => column.key));
              }}
              type="button"
            >
              Select All
            </button>
            <button
              className="rounded-md border border-[#061426]/15 px-3 py-2 text-xs font-black text-[#061426] hover:bg-slate-50"
              onClick={() => {
                setExportError("");
                setSelectedExportColumns([]);
              }}
              type="button"
            >
              Clear All
            </button>
            <button
              className="rounded-md border border-[#d8ad45]/50 bg-[#fff8e3] px-3 py-2 text-xs font-black text-[#061426] hover:bg-[#f4d58a]/30"
              onClick={setDefaultExportColumns}
              type="button"
            >
              Default Registration Fields
            </button>
          </div>

          <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {exportColumns.map((column) => (
              <label
                className="flex items-center gap-3 rounded-md border border-slate-200 px-3 py-2 text-sm font-bold text-[#061426]"
                key={column.key}
              >
                <input
                  checked={selectedExportColumns.includes(column.key)}
                  className="size-4 accent-[#d8ad45]"
                  onChange={() => toggleExportColumn(column.key)}
                  type="checkbox"
                />
                {column.label}
              </label>
            ))}
          </div>

          {exportError ? (
            <p className="mt-4 rounded-md border border-[#9b1c1f]/25 bg-[#9b1c1f]/10 px-3 py-2 text-sm font-bold text-[#9b1c1f]">
              {exportError}
            </p>
          ) : null}
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
                    <th className="min-w-[110px] border-l border-[#d8ad45]/20 px-4 py-3 text-center">
                      Exact Age
                    </th>
                    <th className="min-w-[120px] border-l border-[#d8ad45]/20 px-4 py-3 text-center">
                      Display Age
                    </th>
                    <th className="min-w-[100px] border-l border-[#d8ad45]/20 px-4 py-3 text-center">
                      Shirt No.
                    </th>
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
                      <td className="min-w-[110px] border-l border-slate-200 px-4 py-3 text-center">
                        {calculatedAge(member)}
                      </td>
                      <td className="min-w-[120px] border-l border-slate-200 px-4 py-3 text-center">
                        {displayAge(member)}
                      </td>
                      <td className="min-w-[100px] border-l border-slate-200 px-4 py-3 text-center font-bold">
                        {shirtNumberDisplay(member.shirt_number)}
                      </td>
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
