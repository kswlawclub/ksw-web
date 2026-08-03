import Link from "next/link";
import { LiveCountdown } from "@/components/live-countdown";
import { homeText, type HomeChampion, type HomeCompetitionData } from "@/lib/home-competition-data";
import { getCompetitionTypeEnglishLabel, normalizeCompetitionType } from "@/lib/competition-format";

export function FeaturedCompetitionHero({ data }: { data: HomeCompetitionData }) {
  const competition = data.currentCompetition;
  if (!competition) {
    return (
      <section className="bg-[#061426] text-white"><div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-10"><p className="text-[#f4d58a]">KSW Digital Headquarters</p><h1 className="mt-3 text-4xl font-black">ติดตามทุกจังหวะของ KSW</h1><Link className="mt-7 inline-flex rounded-md bg-[#d8ad45] px-5 py-3 font-black text-[#061426]" href="/competitions">ดูรายการแข่งขัน</Link></div></section>
    );
  }
  const status = homeText(competition, ["season_status"], "active").toLowerCase();
  const champions = data.latestChampions.filter((champion) => champion.competitionId === homeText(competition, ["id"], ""));
  const startDate = homeText(competition, ["start_date"], "");
  const slug = homeText(competition, ["slug"], "");
  const type = normalizeCompetitionType(competition.competition_type);
  const statusText = status === "completed" ? "จบการแข่งขัน" : status === "upcoming" ? "กำลังจะเริ่ม" : "กำลังแข่งขัน";
  const phase = data.featuredFixtures[0] ? homeText(data.featuredFixtures[0], ["round_label", "effective_matchweek"], "กำลังจัดโปรแกรม") : status === "completed" ? champions.map((champion: HomeChampion) => `${champion.label}: ${champion.teamName}`).join(" · ") : data.featuredTemplateKey === "council_two_division" ? "2 Divisions · 2 Champions" : "กำลังดำเนินการแข่งขัน";

  return (
    <section className="overflow-hidden bg-[#061426] text-white">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-14 sm:px-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-end lg:px-10 lg:py-20">
        <div className="min-w-0">
          <p className="text-xs font-black uppercase tracking-[0.22em] text-[#f4d58a]">KSW Digital Headquarters</p>
          <div className="mt-5 flex flex-wrap gap-2"><span className="rounded-full border border-[#d8ad45]/40 px-3 py-1 text-xs font-black text-[#f4d58a]">{statusText}</span><span className="rounded-full border border-white/20 px-3 py-1 text-xs font-bold text-slate-200">{getCompetitionTypeEnglishLabel(type)}</span></div>
          <h1 className="mt-5 max-w-4xl text-4xl font-black leading-tight sm:text-5xl">{homeText(competition, ["name"], "KSW Competition")}</h1>
          <p className="mt-4 text-base font-semibold text-slate-300">{phase}</p>
          <div className="mt-7 flex flex-wrap gap-x-7 gap-y-3 text-sm text-slate-200"><span>{data.allParticipants.length} ทีม</span><span>{startDate ? `เริ่ม ${new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Bangkok" }).format(new Date(startDate))}` : "วันแข่งขันรอกำหนด"}</span></div>
          <Link className="mt-8 inline-flex items-center rounded-md bg-[#d8ad45] px-5 py-3 text-sm font-black text-[#061426] transition-colors hover:bg-[#f4d58a]" href={slug ? `/competitions/${slug}` : "/competitions"}>ดูรายละเอียดการแข่งขัน</Link>
        </div>
        {status === "upcoming" && startDate ? <div className="border-t border-[#d8ad45]/25 pt-6 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0"><p className="mb-4 text-xs font-black uppercase tracking-[0.2em] text-[#f4d58a]">นับถอยหลัง</p><LiveCountdown targetDate={startDate} /></div> : null}
      </div>
    </section>
  );
}
