import Image from "next/image";
import Link from "next/link";
import type { Metadata } from "next";
import { loadPublishedCompetitions, Row, text } from "@/lib/competition-data";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "KSW Chronicle | KSW L.C.",
  description:
    "League seasons, Lawyer's Cup records, special matches, club stories, and history from KSW L.C.",
};

const statusPriority: Record<string, number> = {
  active: 0,
  upcoming: 1,
  completed: 2,
};

function typeLabel(type: string) {
  if (type === "cup") return "Cup";
  if (type === "tournament") return "Tournament";
  if (type === "friendly") return "Special Match";
  return "League";
}

function dateLabel(competition: Row) {
  const startDate = text(competition, ["start_date"], "");
  const endDate = text(competition, ["end_date"], "");

  if (startDate && endDate && startDate !== endDate) return `${startDate} - ${endDate}`;
  return startDate || endDate;
}

function sortDateValue(competition: Row) {
  const value = text(competition, ["start_date", "end_date"], "");
  const time = value ? new Date(value).getTime() : Number.NaN;
  return Number.isNaN(time) ? 0 : time;
}

function createdAtValue(competition: Row) {
  const value = text(competition, ["created_at"], "");
  const time = value ? new Date(value).getTime() : Number.NaN;
  return Number.isNaN(time) ? 0 : time;
}

function displayOrderValue(competition: Row) {
  const value = competition.display_order;

  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim() && !Number.isNaN(Number(value))) {
    return Number(value);
  }

  return 0;
}

function sortCompetitions(rows: Row[]) {
  return [...rows].sort((a, b) => {
    const statusDiff =
      (statusPriority[text(a, ["season_status"], "active")] ?? 3) -
      (statusPriority[text(b, ["season_status"], "active")] ?? 3);
    if (statusDiff) return statusDiff;

    const featuredDiff = Number(b.is_featured === true) - Number(a.is_featured === true);
    if (featuredDiff) return featuredDiff;

    const displayOrderDiff = displayOrderValue(a) - displayOrderValue(b);
    if (displayOrderDiff) return displayOrderDiff;

    const dateDiff = sortDateValue(b) - sortDateValue(a);
    if (dateDiff) return dateDiff;

    return createdAtValue(b) - createdAtValue(a);
  });
}

function CompetitionCard({ competition }: { competition: Row }) {
  const slug = text(competition, ["slug"], "");
  const coverImageUrl = text(competition, ["cover_image_url"], "");
  const competitionType = text(competition, ["competition_type"], "league");
  const description = text(
    competition,
    ["short_description"],
    slug ? "Open this competition archive for fixtures, results, teams, and partners." : "Archive details are being prepared.",
  );
  const metadata = [
    text(competition, ["season"], ""),
    text(competition, ["edition_number"], "") ? `Edition ${text(competition, ["edition_number"], "")}` : "",
    dateLabel(competition),
    text(competition, ["location"], ""),
  ].filter(Boolean);

  const cardContent = (
    <>
      <div className="relative aspect-[16/9] overflow-hidden bg-[radial-gradient(circle_at_top,rgba(216,173,69,0.2),transparent_35%),linear-gradient(135deg,#071b31,#061426)]">
        {coverImageUrl ? (
          <Image
            alt=""
            className="object-cover opacity-85 transition-transform duration-500 group-hover:scale-105"
            fill
            sizes="(max-width: 768px) 100vw, 33vw"
            src={coverImageUrl}
            unoptimized
          />
        ) : null}
        <div className="absolute inset-0 bg-gradient-to-t from-[#061426]/88 via-[#061426]/20 to-transparent" />
        <div className="absolute bottom-4 left-4 flex flex-wrap gap-2">
          <span className="rounded-full border border-[#d8ad45]/35 bg-[#d8ad45]/15 px-3 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-[#f4d58a]">
            {typeLabel(competitionType)}
          </span>
          <span className="rounded-full border border-white/20 bg-white/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-white">
            {text(competition, ["season_status"], "active")}
          </span>
        </div>
      </div>
      <div className="grid gap-4 p-5">
        <div>
          <h2 className="text-xl font-black leading-tight text-[#061426]">{text(competition, ["name"], "Competition")}</h2>
          {metadata.length ? (
            <p className="mt-2 text-sm font-bold text-slate-500">{metadata.join(" • ")}</p>
          ) : null}
          <p className="mt-3 text-sm leading-6 text-slate-600">{description}</p>
        </div>
        {slug ? (
          <span className="inline-flex items-center justify-center rounded-md bg-[#061426] px-4 py-2.5 text-sm font-black text-[#f4d58a] shadow-lg shadow-slate-900/10 transition-colors group-hover:bg-[#0b2745]">
            View Archive
          </span>
        ) : (
          <p className="rounded-md border border-slate-200 bg-slate-50 px-4 py-2.5 text-center text-sm font-black text-slate-500">
            Archive details are being prepared.
          </p>
        )}
      </div>
    </>
  );

  if (slug) {
    return (
      <Link
        className="group block min-w-0 overflow-hidden rounded-2xl border border-[#d8ad45]/25 bg-white shadow-xl shadow-slate-900/10 transition-transform hover:-translate-y-0.5"
        href={`/competitions/${slug}`}
      >
        {cardContent}
      </Link>
    );
  }

  return (
    <article className="group min-w-0 overflow-hidden rounded-2xl border border-[#d8ad45]/25 bg-white shadow-xl shadow-slate-900/10">
      {cardContent}
    </article>
  );
}

function CompetitionSection({ items, showAccent = true, title }: { items: Row[]; showAccent?: boolean; title: string }) {
  if (!items.length) return null;

  return (
    <section className="mx-auto w-full max-w-7xl px-4 pb-10 sm:px-6 lg:px-10">
      <div className="mb-5 flex items-end justify-between gap-4">
        <div>
          {showAccent ? <div className="mb-3 h-0.5 w-12 rounded-full bg-[#d8ad45]" /> : null}
          <h2 className="text-2xl font-black text-[#061426]">{title}</h2>
        </div>
      </div>
      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {items.map((competition) => (
          <CompetitionCard competition={competition} key={text(competition, ["id", "slug", "name"])} />
        ))}
      </div>
    </section>
  );
}

export default async function CompetitionsPage() {
  const competitions = sortCompetitions(await loadPublishedCompetitions());
  const currentOrFeatured = competitions.filter(
    (competition) => competition.is_featured === true || text(competition, ["season_status"], "active") === "active",
  );
  const featuredIds = new Set(currentOrFeatured.map((competition) => text(competition, ["id"], "")).filter(Boolean));
  const categoryCompetitions = competitions.filter((competition) => !featuredIds.has(text(competition, ["id"], "")));
  const leagues = categoryCompetitions.filter((competition) => text(competition, ["competition_type"], "league") === "league");
  const cupsAndTournaments = categoryCompetitions.filter((competition) =>
    ["cup", "tournament"].includes(text(competition, ["competition_type"], "league")),
  );
  const specialMatches = categoryCompetitions.filter(
    (competition) => text(competition, ["competition_type"], "league") === "friendly",
  );

  return (
    <main className="min-h-screen overflow-x-hidden bg-slate-100 text-[#061426]">
      <section className="bg-[radial-gradient(circle_at_top_right,rgba(216,173,69,0.2),transparent_34%),linear-gradient(135deg,#061426,#091f39)] text-white">
        <div className="mx-auto w-full max-w-7xl px-4 py-14 sm:px-6 lg:px-10">
          <p className="text-xs font-black uppercase tracking-[0.24em] text-[#d8ad45]">KSW Digital Club Chronicle</p>
          <h1 className="mt-4 max-w-4xl text-4xl font-black tracking-tight sm:text-6xl">
            KSW Chronicle
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-7 text-slate-300 sm:text-lg">
            Competitions, special matches, stories, and memories from the history of KSW L.C.
          </p>
        </div>
      </section>

      {competitions.length ? (
        <>
          <CompetitionSection items={currentOrFeatured} showAccent={false} title="Current / Featured" />
          <CompetitionSection items={leagues} title="League Seasons" />
          <CompetitionSection items={cupsAndTournaments} title="Cups & Tournaments" />
          <CompetitionSection items={specialMatches} title="Special Matches" />
        </>
      ) : (
        <section className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6 lg:px-10">
          <div className="rounded-2xl border border-slate-200 bg-white px-5 py-10 text-center shadow-xl shadow-slate-900/10">
            <h2 className="text-2xl font-black">Competition archive is being prepared.</h2>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              Published competitions will appear here after the competition metadata migration is applied and records are configured.
            </p>
          </div>
        </section>
      )}
    </main>
  );
}
