import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CompetitionDetailPage } from "@/components/competition-detail-page";
import {
  loadCompetitionBySlug,
  loadCompetitionDetailData,
  text,
} from "@/lib/competition-data";
import { loadPublicCupV2Data } from "@/lib/public-cup-v2-loader";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type PageProps = {
  params: Promise<{ slug: string }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const competition = await loadCompetitionBySlug(slug);

  if (!competition) {
    return {
      title: "Competition Not Found | KSW L.C.",
    };
  }

  return {
    title: `${text(competition, ["name"], "Competition")} | KSW L.C.`,
    description: text(
      competition,
      ["short_description", "description"],
      "KSW L.C. competition archive and match history.",
    ),
  };
}

export default async function CompetitionPage({ params }: PageProps) {
  const { slug } = await params;
  const competition = await loadCompetitionBySlug(slug);

  if (!competition) {
    notFound();
  }

  const [data] = await Promise.all([
    loadCompetitionDetailData(competition),
    loadPublicCupV2Data(competition),
  ]);

  return <CompetitionDetailPage data={data} />;
}
