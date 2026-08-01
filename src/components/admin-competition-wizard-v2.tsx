"use client";

import { useMemo, useState, useTransition } from "react";
import {
  saveCompetitionEngineV2Config,
  type CompetitionEngineV2Config,
} from "@/app/admin/competitions/[id]/competition-engine-v2-actions";
import {
  calculateCompetitionStructure,
  type CompetitionStructurePreview,
} from "@/lib/competition-structure";
import {
  canEditQualification,
  competitionEngineV2StatusLabel,
  type CompetitionEngineV2Integrity,
} from "@/lib/competition-engine-v2-state";

type CompetitionType = "cup" | "friendly" | "league" | "tournament";

export type AdminCompetitionWizardV2Props = {
  competitionId: string;
  competitionType: CompetitionType;
  existingConfig?: CompetitionEngineV2Config | null;
  groupCount: number;
  groups: Array<{ id: string; name: string; qualifiers_count: number }>;
  participantCount: number;
  workflow: CompetitionEngineV2Integrity | null;
};

const competitionTypes: Array<{ label: string; sublabel: string; value: CompetitionType }> = [
  { label: "League", sublabel: "ลีก", value: "league" },
  { label: "Cup", sublabel: "ถ้วย", value: "cup" },
  { label: "Friendly", sublabel: "กระชับมิตร", value: "friendly" },
  { label: "Tournament", sublabel: "ทัวร์นาเมนต์", value: "tournament" },
];

const entrantOptions = [8, 12, 13, 20, 24, 30, 32, 64];

function fieldNumber(value: string, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : fallback;
}

function PreviewStat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="min-w-0 rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
      <p className="text-[10px] font-black uppercase tracking-[0.12em] text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-black text-[#061426]">{value}</p>
    </div>
  );
}

export function AdminCompetitionWizardV2({
  competitionId,
  competitionType,
  existingConfig,
  groupCount,
  groups,
  participantCount,
  workflow,
}: AdminCompetitionWizardV2Props) {
  const hasExistingGroups = groups.length > 0;
  const groupDerivedKnockoutEntrants = groups.reduce((sum, group) => sum + group.qualifiers_count, 0);
  const initialKnockoutEntrants = existingConfig?.entrantCount ?? (hasExistingGroups ? groupDerivedKnockoutEntrants : participantCount || 8);
  const [selectedType, setSelectedType] = useState<CompetitionType>(competitionType);
  const [groupStageEnabled, setGroupStageEnabled] = useState(existingConfig?.groupStageEnabled ?? hasExistingGroups);
  const [entrantCount, setEntrantCount] = useState(String(initialKnockoutEntrants));
  const [wizardGroupCount, setWizardGroupCount] = useState(String(groupCount || 2));
  const [qualifiersPerGroup, setQualifiersPerGroup] = useState("2");
  const [qualificationMode, setQualificationMode] = useState<"custom" | "standard">("standard");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();
  const qualificationLocked = Boolean(workflow?.status && !canEditQualification(workflow.status));

  const preview = useMemo<{ error: string; value: CompetitionStructurePreview | null }>(() => {
    if (selectedType !== "cup") return { error: "การตั้งค่ารอบน็อกเอาต์รองรับเฉพาะการแข่งขันแบบ Cup", value: null };
    if (qualificationMode === "custom") return { error: "Custom Rule เป็น placeholder สำหรับเฟสถัดไป", value: null };

    const knockoutEntrantCount = groupStageEnabled && hasExistingGroups
      ? groupDerivedKnockoutEntrants
      : fieldNumber(entrantCount, 0);
    const previewGroupCount = groupStageEnabled && hasExistingGroups
      ? groups.length
      : fieldNumber(wizardGroupCount, 0);

    if (!groupStageEnabled && participantCount > 0 && knockoutEntrantCount > participantCount) {
      return {
        error: "Knockout entrants cannot exceed total participants unless a custom rule is defined later.",
        value: null,
      };
    }

    try {
      return {
        error: "",
        value: calculateCompetitionStructure({
          entrantCount: knockoutEntrantCount,
          entryMode: "bye",
          groupCount: groupStageEnabled ? previewGroupCount : null,
          groupStageEnabled,
          qualifiersPerGroup: groupStageEnabled ? fieldNumber(qualifiersPerGroup, 0) : null,
          totalParticipantCount: participantCount || knockoutEntrantCount,
        }),
      };
    } catch (caught) {
      return { error: caught instanceof Error ? caught.message : "Preview could not be calculated.", value: null };
    }
  }, [
    entrantCount,
    groupDerivedKnockoutEntrants,
    groupStageEnabled,
    groups.length,
    hasExistingGroups,
    participantCount,
    qualificationMode,
    qualifiersPerGroup,
    selectedType,
    wizardGroupCount,
  ]);

  function saveConfig() {
    if (!preview.value) {
      setError(preview.error || "Preview is not ready.");
      setMessage("");
      return;
    }

    const validPreview = preview.value;
    setError("");
    setMessage("");
    startTransition(async () => {
      const result = await saveCompetitionEngineV2Config({
        competitionId,
        entrantCount: validPreview.knockoutEntrants,
        entryMode: "bye",
        groupCount: groupStageEnabled ? (hasExistingGroups ? groups.length : fieldNumber(wizardGroupCount, 0)) : null,
        groupStageEnabled,
        qualifiersPerGroup: groupStageEnabled ? fieldNumber(qualifiersPerGroup, 0) : null,
        totalParticipantCount: participantCount,
      });

      if (!result.ok) {
        setError(result.error ?? "ไม่สามารถบันทึกการตั้งค่าทีมเข้ารอบได้");
        return;
      }

      setMessage("บันทึกการตั้งค่าทีมเข้ารอบแล้ว ยังไม่ได้สร้างโครงสร้างหรือแมตช์");
    });
  }

  if (qualificationLocked && workflow?.status) {
    const statusLabel = competitionEngineV2StatusLabel(workflow.status);
    return (
      <section className="mx-auto w-full max-w-7xl scroll-mt-28 px-4 pb-10 sm:px-6 lg:px-10" id="competition-wizard-v2">
        <article className="min-w-0 rounded-lg border border-slate-200 bg-white p-5 shadow-xl shadow-slate-900/10">
          <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-2xl font-black text-[#061426]">ตั้งค่าทีมเข้ารอบน็อกเอาต์</h2>
              <p className="mt-1 text-sm font-semibold text-slate-600">ล็อกการตั้งค่าทีมเข้ารอบแล้วในสถานะ {statusLabel.th} / {statusLabel.en}</p>
            </div>
            <span className="inline-flex w-fit rounded-full bg-emerald-100 px-3 py-2 text-sm font-black text-emerald-800">{statusLabel.th}</span>
          </div>
          <p className="mt-4 rounded-md border border-slate-200 bg-slate-50 px-3 py-3 text-sm font-semibold text-slate-600">
            ใช้ “กลับไปแก้ไขโครงสร้าง” ในส่วนจัดการแข่งขันรอบน็อกเอาต์ก่อนแก้การตั้งค่า
          </p>
        </article>
      </section>
    );
  }

  return (
    <section className="mx-auto w-full max-w-7xl scroll-mt-28 px-4 pb-10 sm:px-6 lg:px-10" id="competition-wizard-v2">
      <article className="min-w-0 rounded-lg border border-slate-200 bg-white p-5 shadow-xl shadow-slate-900/10">
        <div className="mb-4 h-0.5 w-12 rounded-full bg-[#d8ad45]" />
        <div className="flex flex-col gap-2">
          <h2 className="text-2xl font-black text-[#061426]">ตั้งค่าทีมเข้ารอบน็อกเอาต์</h2>
          <p className="text-sm font-semibold text-slate-600">
            ตั้งค่าโครงสร้าง Cup ล่วงหน้าเท่านั้น ยังไม่สร้าง Bracket หรือ Match
          </p>
        </div>

        <div className="mt-6 grid gap-5">
          <section className="min-w-0 rounded-lg border border-slate-200 bg-slate-50 p-4">
            <p className="text-sm font-black text-[#061426]">Step 1 · ประเภทการแข่งขัน (Competition Type)</p>
            <div className="mt-3 grid gap-2 sm:grid-cols-4">
              {competitionTypes.map((type) => (
                <label
                  className="flex min-h-11 min-w-0 items-center gap-3 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-black text-[#061426]"
                  key={type.value}
                >
                  <input
                    checked={selectedType === type.value}
                    className="size-4 shrink-0"
                    onChange={() => setSelectedType(type.value)}
                    type="radio"
                  />
                  <span className="min-w-0">
                    {type.label}
                    <span className="block text-xs font-bold text-slate-500">{type.sublabel}</span>
                  </span>
                </label>
              ))}
            </div>
          </section>

          {selectedType === "cup" ? (
            <>
              <section className="min-w-0 rounded-lg border border-slate-200 bg-slate-50 p-4">
                <p className="text-sm font-black text-[#061426]">Step 2 · รอบแบ่งกลุ่ม (Group Stage?)</p>
                <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                  {[
                    { label: "Yes", value: true },
                    { label: "No", value: false },
                  ].map((option) => (
                    <label
                      className="flex min-h-11 min-w-0 items-center gap-3 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-black"
                      key={String(option.value)}
                    >
                      <input
                        checked={groupStageEnabled === option.value}
                        className="size-4 shrink-0"
                        onChange={() => setGroupStageEnabled(option.value)}
                        type="radio"
                      />
                      {option.label}
                    </label>
                  ))}
                </div>
              </section>

              <section className="grid min-w-0 gap-4 rounded-lg border border-slate-200 bg-slate-50 p-4 sm:grid-cols-2">
                <div className="grid min-w-0 gap-2 text-sm font-black text-[#061426]">
                  <span>Step 3 · ทีมทั้งหมดในรายการ / Total Participants</span>
                  <div className="min-h-11 rounded-md border border-slate-200 bg-white px-3 py-2 text-base font-black">
                    {participantCount || "Not set"}
                  </div>
                  <span className="text-xs font-bold text-slate-500">มาจากทีมที่ assign เข้า competition แล้ว</span>
                </div>

                {groupStageEnabled ? (
                  hasExistingGroups ? (
                    <div className="grid min-w-0 gap-2 text-sm font-black text-[#061426]">
                      <span>Step 4 · จำนวนกลุ่ม (Groups)</span>
                      <div className="min-h-11 rounded-md border border-slate-200 bg-white px-3 py-2 text-base font-black">
                        {groups.length}
                      </div>
                      <span className="text-xs font-bold text-slate-500">ใช้ groups ที่สร้างไว้จริงใน workspace</span>
                    </div>
                  ) : (
                    <label className="grid min-w-0 gap-2 text-sm font-black text-[#061426]">
                      Step 4 · จำนวนกลุ่ม (Groups)
                      <input
                        className="min-h-11 w-full min-w-0 rounded-md border border-slate-200 bg-white px-3 py-2 text-base font-black"
                        inputMode="numeric"
                        max={64}
                        min={1}
                        onChange={(event) => setWizardGroupCount(event.target.value)}
                        type="number"
                        value={wizardGroupCount}
                      />
                    </label>
                  )
                ) : (
                  <label className="grid min-w-0 gap-2 text-sm font-black text-[#061426]">
                    ทีมที่ผ่านเข้ารอบน็อกเอาต์ / Knockout Entrants
                    <input
                      className="min-h-11 w-full min-w-0 rounded-md border border-slate-200 bg-white px-3 py-2 text-base font-black"
                      inputMode="numeric"
                      max={64}
                      min={2}
                      onChange={(event) => setEntrantCount(event.target.value)}
                      type="number"
                      value={entrantCount}
                    />
                    <span className="text-xs font-bold text-slate-500">เช่น {entrantOptions.join(", ")} และไม่ควรเกินทีมทั้งหมด</span>
                  </label>
                )}
              </section>

              {groupStageEnabled ? (
                <section className="min-w-0 rounded-lg border border-slate-200 bg-slate-50 p-4">
                  <p className="text-sm font-black text-[#061426]">Step 5 · ทีมเข้ารอบ (Qualification)</p>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    {hasExistingGroups ? (
                      <div className="grid min-w-0 gap-2 text-sm font-black text-[#061426]">
                        <span>ทีมที่ผ่านเข้ารอบน็อกเอาต์ / Knockout Entrants</span>
                        <div className="min-h-11 rounded-md border border-slate-200 bg-white px-3 py-2 text-base font-black">
                          {groupDerivedKnockoutEntrants}
                        </div>
                        <span className="text-xs font-bold text-slate-500">
                          รวม qualifiers_count จริงจากทุกกลุ่ม: {groups.map((group) => `${group.name} ${group.qualifiers_count}`).join(" / ")}
                        </span>
                      </div>
                    ) : (
                      <label className="grid min-w-0 gap-2 text-sm font-black text-[#061426]">
                        ทีมเข้ารอบต่อกลุ่ม (Qualifiers)
                        <input
                          className="min-h-11 w-full min-w-0 rounded-md border border-slate-200 bg-white px-3 py-2 text-base font-black"
                          disabled={qualificationMode === "custom"}
                          inputMode="numeric"
                          min={0}
                          onChange={(event) => setQualifiersPerGroup(event.target.value)}
                          type="number"
                          value={qualifiersPerGroup}
                        />
                      </label>
                    )}
                    <label className="flex min-h-11 min-w-0 items-center gap-3 rounded-md border border-dashed border-slate-300 bg-white px-3 py-2 text-sm font-black text-slate-600">
                      <input
                        checked={qualificationMode === "custom"}
                        className="size-4 shrink-0"
                        onChange={(event) => setQualificationMode(event.target.checked ? "custom" : "standard")}
                        type="checkbox"
                      />
                      Custom Rule (placeholder)
                    </label>
                  </div>
                </section>
              ) : null}

              <section className="min-w-0 rounded-lg border border-[#d8ad45]/35 bg-[#fff7e6] p-4">
                <p className="text-sm font-black text-[#8a6418]">Step 6 · Preview</p>
                {preview.value ? (
                  <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <PreviewStat label="Knockout Entrants" value={preview.value.qualifiedTeams} />
                    <PreviewStat label="Bracket Capacity" value={preview.value.bracketCapacity} />
                    <PreviewStat label="Bye Needed" value={preview.value.byeNeeded} />
                    <PreviewStat label="Play-in" value={preview.value.preliminaryNeeded} />
                    <PreviewStat label="Rounds" value={preview.value.roundCount} />
                    <PreviewStat label="Total Matches" value={preview.value.totalMatches} />
                    <PreviewStat label="Entry Mode" value={preview.value.entryMode} />
                    <PreviewStat label="Total Participants" value={participantCount || "Not set"} />
                  </div>
                ) : (
                  <p className="mt-3 rounded-md border border-[#9b1c1f]/25 bg-white px-3 py-2 text-sm font-bold text-[#9b1c1f]">
                    {preview.error}
                  </p>
                )}
              </section>

              <section className="flex min-w-0 flex-col gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-black text-[#061426]">Step 7 · Confirm</p>
                  <p className="mt-1 text-xs font-bold text-slate-600">
                    บันทึกเฉพาะ configuration เท่านั้น ไม่สร้าง Bracket Node หรือ Match
                  </p>
                </div>
                <button
                  className="min-h-11 rounded-md bg-[#061426] px-5 py-3 text-sm font-black text-[#f4d58a] disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={!preview.value || isPending}
                  onClick={saveConfig}
                  type="button"
                >
                  {isPending ? "Saving..." : "Confirm Configuration"}
                </button>
              </section>
            </>
          ) : (
            <p className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-600">
              การตั้งค่ารอบน็อกเอาต์ใช้กับการแข่งขันแบบ Cup เท่านั้น
            </p>
          )}
        </div>

        {error ? <p className="mt-4 rounded-md border border-[#9b1c1f]/25 bg-[#9b1c1f]/10 px-3 py-2 text-sm font-bold text-[#9b1c1f]">{error}</p> : null}
        {message ? <p className="mt-4 rounded-md border border-emerald-700/20 bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-800">{message}</p> : null}
      </article>
    </section>
  );
}
