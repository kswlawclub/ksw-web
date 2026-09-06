import Image from "next/image";
import { footballRadarPoint, footballStats, type MemberFootballRating } from "@/lib/member-football-rating";

export function MemberFootballCard({ name, photoUrl, rating }: { name: string; photoUrl: string | null; rating: MemberFootballRating }) {
  const stats = footballStats[rating.rating_type];
  const polygon = (scale: number) => stats.map((_, index) => {
    const point = footballRadarPoint(index, scale);
    return `${point.x},${point.y}`;
  }).join(" ");
  const points = stats.map(({ field }, index) => {
    const point = footballRadarPoint(index, rating[field] ?? 0);
    return `${point.x},${point.y}`;
  }).join(" ");
  return (
    <div className="min-w-0 text-left text-white">
      <p className="border-b border-white/15 pb-3 text-xs font-bold text-[#f4d58a]">KSW L.C. / FOOTBALL</p>
      <div className="mt-4 flex items-center gap-4">
        <div className="size-16 shrink-0 overflow-hidden rounded-full border border-[#d8ad45] bg-white/10">
          {photoUrl ? <Image unoptimized src={photoUrl} alt="" width={64} height={64} className="h-full w-full object-cover" /> : <span className="flex h-full items-center justify-center text-sm font-black">KSW</span>}
        </div>
        <div className="min-w-0 flex-1"><h2 className="break-words text-xl font-black leading-tight">{name}</h2><p className="mt-1 text-sm text-slate-300">{rating.rating_type === "player" ? "Player" : "Goalkeeper"}</p></div>
        <div className="shrink-0 text-center text-[#f4d58a]"><p className="text-4xl font-black tabular-nums">{rating.overall}</p><p className="text-xs font-bold">OVR</p></div>
      </div>
      <svg aria-hidden="true" viewBox="0 0 240 220" className="mx-auto mt-3 block w-full max-w-[260px]">
        {[33, 66, 99].map((scale) => <polygon key={scale} points={polygon(scale)} fill="none" stroke="#ffffff" strokeOpacity="0.2" />)}
        {stats.map(({ label }, index) => {
          const point = footballRadarPoint(index, 99);
          const x = 120 + (point.x - 120) * 1.3;
          const y = 110 + (point.y - 110) * 1.3;
          return <g key={label}><line x1="120" y1="110" x2={point.x} y2={point.y} stroke="#ffffff" strokeOpacity="0.15" /><text x={x} y={y} textAnchor="middle" dominantBaseline="central" fill="#f4d58a" fontSize="12" fontWeight="700">{label}</text></g>;
        })}
        <polygon data-rating-radar="true" points={points} fill="#d8ad45" fillOpacity="0.3" stroke="#f4d58a" strokeWidth="2" />
      </svg>
      <dl className="grid grid-cols-3 gap-x-4 gap-y-3 border-t border-white/15 pt-4">
        {stats.map(({ field, label, name: statName }) => <div key={field} className="flex items-baseline justify-between gap-2"><dt className="text-xs font-bold text-slate-300" title={statName}>{label}</dt><dd className="text-xl font-black tabular-nums">{rating[field]}</dd></div>)}
      </dl>
    </div>
  );
}
