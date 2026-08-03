import Link from "next/link";
import { HomeMatchRow, homeNumber, matchPhase } from "@/components/home/home-display";
import { homeText, type HomeCompetitionData } from "@/lib/home-competition-data";

export function CompetitionCenter({ data }: { data: HomeCompetitionData }) {
  const competition = data.currentCompetition;
  if (!competition) return null;
  const template = data.featuredTemplateKey;
  const isLeague = template === "standard_league";
  const isCouncil = template === "council_two_division";
  const isKsw = template === "ksw_standard";
  const matches = data.allMappedMatches.filter((match) => homeText(match, ["competition_id"], "") === homeText(competition, ["id"], ""));
  const divisions = ["Division 1", "Division 2"];
  const slug = homeText(competition, ["slug"], "");
  const finished = data.featuredResults.length;

  return <section className="bg-[#f7f5ef]"><div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-10"><div className="flex items-end justify-between gap-5"><div><p className="text-xs font-black uppercase tracking-[0.2em] text-[#8a641c]">Competition Center</p><h2 className="mt-2 text-3xl font-black text-[#061426]">ความเคลื่อนไหวของรายการเด่น</h2></div><Link className="text-sm font-black text-[#8a641c]" href={slug ? `/competitions/${slug}` : "/competitions"}>ดูทั้งหมด</Link></div>
    <div className="mt-7 grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(18rem,.65fr)]">
      <div className="min-w-0 border-y border-[#d8ad45]/35 bg-white px-5 py-2 sm:px-7">
        {isLeague ? <><div className="flex flex-wrap items-center justify-between gap-3 py-5"><div><p className="text-sm font-black text-[#061426]">ตารางคะแนน Top 5</p><p className="mt-1 text-sm text-slate-500">{data.featuredFixtures[0] ? `Matchweek ${homeText(data.featuredFixtures[0], ["effective_matchweek"], "")}` : "สรุปฤดูกาล"}</p></div><p className="text-sm font-bold text-slate-500">แข่งแล้ว {data.featuredResults.length} · เหลือ {data.featuredFixtures.length}</p></div><div>{data.standings.slice(0, 5).map((row, index) => <div className="grid grid-cols-[2rem_minmax(0,1fr)_auto] gap-3 border-t border-slate-100 py-3 text-sm" key={homeText(row, ["team_id"], String(index))}><span className="font-black text-[#8a641c]">{index + 1}</span><span className="truncate font-bold text-[#061426]">{homeText(row, ["team_name"], "ทีม")}</span><span className="font-black text-[#061426]">{homeNumber(row, "points")} pts</span></div>)}</div></> : isCouncil ? <div className="grid gap-5 py-5 sm:grid-cols-2">{divisions.map((division) => { const match = matches.find((item) => homeText(item, ["partition_label"], "") === division); return <div className="border-l-2 border-[#d8ad45] pl-4" key={division}><p className="font-black text-[#061426]">{division}</p><p className="mt-1 text-sm text-slate-500">{match ? matchPhase(match) : "กำลังจัดสายแข่งขัน"}</p>{match ? <p className="mt-4 text-sm font-bold text-[#8a641c]">นัดถัดไป: {homeText(match, ["home_team_name"], "รอทีม")} พบ {homeText(match, ["away_team_name"], "รอทีม")}</p> : null}</div>; })}</div> : <div className="py-5"><p className="font-black text-[#061426]">{isKsw ? "Bracket Snapshot" : "ข้อมูลการแข่งขัน"}</p><p className="mt-2 text-sm text-slate-500">{matches[0] ? matchPhase(matches[0]) : "กำลังเตรียมโปรแกรมการแข่งขัน"}</p>{matches[0] ? <div className="mt-3"><HomeMatchRow match={matches[0]} result={data.featuredResults.includes(matches[0])} /></div> : null}</div>}
      </div>
      <aside className="border border-[#061426]/10 bg-[#061426] p-6 text-white"><p className="text-xs font-black uppercase tracking-[0.2em] text-[#f4d58a]">Today at KSW</p><p className="mt-4 text-lg font-black">{isCouncil ? "2 Divisions · 2 Champions" : isLeague ? "Standard League" : isKsw ? "KSW Standard Knockout" : "รายการแข่งขัน"}</p><p className="mt-3 text-sm leading-6 text-slate-300">มีผลการแข่งขันแล้ว {finished} นัด และโปรแกรมถัดไป {data.featuredFixtures.length} นัด</p></aside>
    </div></div></section>;
}
