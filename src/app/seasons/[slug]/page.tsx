import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { CompetitionDetailPage } from "@/components/competition-detail-page";
import {
  legacySeasonSlug,
  loadCompetitionDetailData,
  loadLegacySeasonCompetition,
  text,
} from "@/lib/competition-data";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Thai Lawyers League Season 6 Results & Final Table | KSW L.C.",
  description:
    "Season archive for Thai Lawyers League Season 6, including final standings, KSW results, match history, participating teams, and full season results.",
};

export default async function LegacySeasonArchivePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  if (slug !== legacySeasonSlug) {
    notFound();
  }

  const competition = await loadLegacySeasonCompetition();

  if (!competition) {
    notFound();
  }

  const canonicalSlug = text(competition, ["slug"], "");

  if (canonicalSlug) {
    permanentRedirect(`/competitions/${canonicalSlug}`);
  }

  const data = await loadCompetitionDetailData(competition);

  return <CompetitionDetailPage data={data} />;
}
