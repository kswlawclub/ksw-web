import Link from "next/link";
import { GalleryGrid, type GalleryImage } from "@/components/gallery-grid";
import { getSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const categoryLabels: Record<string, string> = {
  "team-photo": "Team Photo",
  matchday: "Matchday",
  "team-spirit": "Team Spirit",
  sideline: "Sideline",
  community: "Community",
  training: "Training",
  other: "Other",
};

const fallbackGalleryImages: GalleryImage[] = [
  {
    src: "/images/gallery/team-photo-01.jpg",
    title: "KSW Team Photo",
    category: "Team Photo",
  },
  {
    src: "/images/gallery/matchday-01.jpg",
    title: "Matchday Focus",
    category: "Matchday",
  },
  {
    src: "/images/gallery/matchday-02.jpg",
    title: "Game Tempo",
    category: "Matchday",
  },
  {
    src: "/images/gallery/matchday-03.jpg",
    title: "On The Ball",
    category: "Matchday",
  },
  {
    src: "/images/gallery/matchday-04.jpg",
    title: "Final Whistle",
    category: "Matchday",
  },
  {
    src: "/images/gallery/team-spirit-01.jpg",
    title: "Team Talk",
    category: "Team Spirit",
  },
  {
    src: "/images/gallery/team-spirit-02.jpg",
    title: "Together Before Kickoff",
    category: "Team Spirit",
  },
  {
    src: "/images/gallery/team-spirit-03.jpg",
    title: "Shared Standard",
    category: "Team Spirit",
  },
  {
    src: "/images/gallery/sideline-01.jpg",
    title: "Sideline Energy",
    category: "Sideline",
  },
  {
    src: "/images/gallery/community-01.jpg",
    title: "Legal Football Community",
    category: "Community",
  },
  {
    src: "/images/gallery/community-02.jpg",
    title: "Beyond The Pitch",
    category: "Community",
  },
  {
    src: "/images/gallery/community-03.jpg",
    title: "Club Connections",
    category: "Community",
  },
];

type GalleryItemRow = {
  image_url: string | null;
  title: string | null;
  category: string | null;
};

function mergeGalleryImages(primaryImages: GalleryImage[], secondaryImages: GalleryImage[]) {
  const seenSources = new Set<string>();

  return [...primaryImages, ...secondaryImages].filter((image) => {
    if (seenSources.has(image.src)) {
      return false;
    }

    seenSources.add(image.src);
    return true;
  });
}

async function getGalleryImages(): Promise<GalleryImage[]> {
  const supabase = getSupabase();

  if (!supabase) {
    return fallbackGalleryImages;
  }

  const result = await supabase
    .from("gallery_items")
    .select("image_url, title, category")
    .eq("is_active", true)
    .order("sort_order", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false });

  if (result.error) {
    console.error("public gallery query failed", result.error);
    return fallbackGalleryImages;
  }

  const supabaseImages = ((result.data ?? []) as GalleryItemRow[])
    .filter((item) => item.image_url && item.title)
    .map((item) => ({
      src: item.image_url ?? "",
      title: item.title ?? "KSW Gallery",
      category: categoryLabels[item.category ?? ""] ?? "Other",
    }));

  return mergeGalleryImages(supabaseImages, fallbackGalleryImages);
}

export default async function GalleryPage() {
  const galleryImages = await getGalleryImages();

  return (
    <main className="min-h-screen overflow-x-hidden bg-[#061426] text-slate-100">
      <section className="relative overflow-hidden border-b border-[#d8ad45]/25">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(216,173,69,0.18),transparent_34%),linear-gradient(135deg,#061426,#0b2745_58%,#071b31)]" />
        <div className="relative mx-auto w-full max-w-7xl px-4 py-12 sm:px-6 sm:py-16 lg:px-10">
          <Link
            className="inline-flex text-sm font-black text-[#f4d58a] transition-colors hover:text-white"
            href="/"
          >
            Home {">"} Gallery
          </Link>
          <p className="mt-8 text-xs font-black uppercase tracking-[0.24em] text-[#d8ad45]">
            KSW L.C.
          </p>
          <h1 className="mt-3 text-4xl font-black tracking-tight text-white sm:text-6xl">
            KSW Gallery
          </h1>
          <p className="mt-4 text-xl font-black uppercase tracking-wide text-[#f4d58a]">
            Moments On And Off The Pitch
          </p>
          <p className="mt-5 max-w-2xl text-base leading-7 text-slate-300 sm:text-lg">
            A collection of memorable moments from matches, team activities, and
            the KSW community.
          </p>
          <div className="mt-7 flex flex-col gap-3 sm:flex-row">
            <Link
              className="inline-flex items-center justify-center rounded-md bg-gradient-to-r from-[#d8ad45] to-[#f4d58a] px-5 py-3 text-sm font-black text-[#061426] shadow-lg shadow-[#d8ad45]/15 transition-transform hover:scale-[1.02]"
              href="/team"
            >
              Meet The Team
            </Link>
            <Link
              className="inline-flex items-center justify-center rounded-md border border-[#d8ad45]/50 bg-white/[0.03] px-5 py-3 text-sm font-black text-[#f4d58a] backdrop-blur transition-colors hover:bg-[#d8ad45]/10"
              href="/partners"
            >
              Partner With KSW
            </Link>
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6 lg:px-10">
        <GalleryGrid images={galleryImages} />
      </section>
    </main>
  );
}
