import Link from "next/link";
import { HomeMatchRow } from "@/components/home/home-display";
import { homeText, type HomeCompetitionData } from "@/lib/home-competition-data";

export function FeaturedFixtures({ data }: { data: HomeCompetitionData }) {
  if (!data.currentCompetition || !data.featuredFixtures.length) return null;
  const slug = homeText(data.currentCompetition, ["slug"], "");
  return <section className="bg-white"><div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-10"><div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-xs font-black uppercase tracking-[.2em] text-[#8a641c]">Next Fixtures</p><h2 className="mt-2 text-3xl font-black text-[#061426]">โปรแกรมถัดไป</h2><p className="mt-2 text-sm text-slate-500">จาก {homeText(data.currentCompetition, ["name"], "รายการเด่น")}</p></div><Link className="rounded-md border border-[#d8ad45]/50 px-4 py-2 text-sm font-black text-[#8a641c]" href={slug ? `/competitions/${slug}` : "/competitions"}>ดูโปรแกรมทั้งหมด</Link></div><div className="mt-7 grid gap-4 md:grid-cols-2">{data.featuredFixtures.map((match, index) => <div className={`${index === 0 ? "border-[#d8ad45]/60 bg-[#fffaf0]" : "border-slate-200 bg-white"} rounded-lg border px-5 shadow-lg shadow-[#061426]/[.07]`} key={homeText(match, ["id"], "")}><HomeMatchRow match={match} /></div>)}</div></div></section>;
}
