import { AnalyticsPageView } from "@/components/analytics-page-view";
import { ChronicleHighlights } from "@/components/home/chronicle-highlights";
import { CompetitionCenter } from "@/components/home/competition-center";
import { FeaturedCompetitionHero } from "@/components/home/featured-competition-hero";
import { FeaturedFixtures } from "@/components/home/featured-fixtures";
import { FeaturedResults } from "@/components/home/featured-results";
import { HomeAboutAndMoments, HomeSponsors } from "@/components/home/home-static-sections";
import { loadHomeCompetitionData } from "@/lib/home-competition-data";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function Home() {
  const data = await loadHomeCompetitionData();

  return (
    <main className="min-w-0 overflow-x-clip bg-white">
      <AnalyticsPageView />
      <FeaturedCompetitionHero data={data} />
      <CompetitionCenter data={data} />
      <FeaturedFixtures data={data} />
      <FeaturedResults data={data} />
      <ChronicleHighlights highlights={data.chronicleHighlights} />
      <HomeAboutAndMoments />
      <HomeSponsors sponsors={data.sponsors} />
    </main>
  );
}
