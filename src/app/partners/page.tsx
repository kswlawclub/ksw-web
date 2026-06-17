import Link from "next/link";
import { getSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Sponsor = {
  id?: string;
  name?: string;
  logo_url?: string;
  website_url?: string;
  tier?: string;
};

const valueCards = [
  [
    "Brand Visibility",
    "โลโก้และแบรนด์ของท่านปรากฏบนเว็บไซต์ทางการ สื่อกิจกรรม และพื้นที่ประชาสัมพันธ์ของทีม",
  ],
  [
    "Legal Community Network",
    "เข้าถึงเครือข่ายนักกฎหมาย ผู้บริหาร ผู้ประกอบการ และผู้สนับสนุนในแวดวงวิชาชีพ",
  ],
  [
    "Matchday & Community Presence",
    "เชื่อมแบรนด์เข้ากับกิจกรรมการแข่งขัน การพบปะ และกิจกรรมเพื่อสังคมของชมรม",
  ],
];

const tiers = [
  {
    name: "Main Partner",
    accent: "from-[#d8ad45] to-[#f4d58a]",
    benefits: [
      "ตำแหน่งโลโก้เด่นที่สุด",
      "พื้นที่ผู้สนับสนุนขนาดใหญ่ที่สุด",
      "แสดงโลโก้บน Sponsor Wall หน้าแรก",
      "กล่าวถึงผู้สนับสนุนในข่าวสารสำคัญของชมรม",
      "ปรากฏในกิจกรรมแข่งขันและกิจกรรมของชมรม",
    ],
  },
  {
    name: "Official Partner",
    accent: "from-[#9b1c1f] to-[#d8ad45]",
    benefits: [
      "แสดงโลโก้บน Sponsor Wall",
      "ปรากฏบนหน้า Gallery และหน้ากิจกรรม",
      "กล่าวถึงผู้สนับสนุนในข่าวสารที่เกี่ยวข้อง",
      "ได้รับการมองเห็นในกิจกรรมและชุมชนของชมรม",
    ],
  },
  {
    name: "Matchday Partner",
    accent: "from-[#0b2745] to-[#d8ad45]",
    benefits: [
      "ปรากฏในคอนเทนต์วันแข่งขัน",
      "กล่าวถึงในโพสต์โปรแกรมและผลการแข่งขัน",
      "เครดิตผู้สนับสนุนตามกิจกรรมที่เกี่ยวข้อง",
      "แสดงในพื้นที่ผู้สนับสนุนของเว็บไซต์",
    ],
  },
  {
    name: "Community Supporter",
    accent: "from-slate-500 to-[#d8ad45]",
    benefits: [
      "พื้นที่แสดงโลโก้ผู้สนับสนุน",
      "ได้รับการกล่าวถึงในกิจกรรมชุมชน",
      "แสดงบนพื้นที่ผู้สนับสนุนของเว็บไซต์",
      "กล่าวขอบคุณในข่าวสารของชมรม",
    ],
  },
];

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 3)
    .toUpperCase();
}

async function loadSponsors() {
  const supabase = getSupabase();

  if (!supabase) {
    return [];
  }

  try {
    const { data, error } = await supabase
      .from("sponsors")
      .select("id, name, logo_url, website_url, tier, sort_order, is_active")
      .order("sort_order", { ascending: true, nullsFirst: false });

    if (error) {
      console.error("Partners page sponsors query failed", {
        message: error.message,
        code: error.code,
      });
      return [];
    }

    return (data ?? []).filter((sponsor) => sponsor.is_active !== false) as Sponsor[];
  } catch (error) {
    console.error("Partners page sponsors fetch failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

export default async function PartnersPage() {
  const sponsors = await loadSponsors();

  return (
    <main className="min-h-screen overflow-x-hidden bg-[#061426] text-slate-100">
      <section className="relative overflow-hidden border-b border-[#d8ad45]/25">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(216,173,69,0.2),transparent_34%),linear-gradient(135deg,#061426,#0b2745_58%,#071b31)]" />
        <div className="relative mx-auto grid w-full max-w-7xl gap-10 px-4 py-14 sm:px-6 sm:py-18 lg:grid-cols-[1.02fr_0.98fr] lg:items-center lg:px-10">
          <div>
            <Link className="text-sm font-black text-[#f4d58a] hover:text-white" href="/">
              Home {">"} Partners
            </Link>
            <p className="mt-8 text-xs font-black uppercase tracking-[0.24em] text-[#d8ad45]">
              KSW Partnership
            </p>
            <h1 className="mt-3 max-w-4xl text-4xl font-black tracking-tight text-white sm:text-6xl">
              Partner With KSW L.C.
            </h1>
            <p className="mt-4 text-xl font-black uppercase tracking-wide text-[#f4d58a]">
              Support the lawyers football community
            </p>
            <p className="mt-5 max-w-3xl text-base leading-8 text-slate-300 sm:text-lg">
              ร่วมสนับสนุนชมรมทนายความคลองสามวา และเป็นส่วนหนึ่งของชุมชนฟุตบอลนักกฎหมายที่เชื่อมโยงมิตรภาพ
              เครือข่ายวิชาชีพ และกิจกรรมการแข่งขันตลอดฤดูกาล
            </p>
            <a
              className="mt-8 inline-flex rounded-md bg-gradient-to-r from-[#d8ad45] to-[#f4d58a] px-5 py-3 text-sm font-black text-[#061426] shadow-lg shadow-[#d8ad45]/20 transition-transform hover:scale-[1.02]"
              href="mailto:kswlawclub@gmail.com"
            >
              Become a KSW Partner
            </a>
          </div>
          <div className="relative">
            <div className="absolute -inset-4 rounded-2xl bg-[#d8ad45]/20 blur-2xl" />
            <div className="relative overflow-hidden rounded-xl border border-[#d8ad45]/35 bg-[#061426] shadow-2xl shadow-black/40">
              <img
                alt="KSW team partnership visual"
                className="aspect-[4/3] w-full object-cover"
                src="/images/ksw-highlights/hero-team-main.jpg"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-[#061426] via-[#061426]/45 to-[#061426]/10" />
              <div className="absolute inset-x-0 bottom-0 p-5 sm:p-7">
                <div className="mb-4 h-0.5 w-14 rounded-full bg-[#d8ad45]" />
                <p className="text-2xl font-black text-white">Official KSW Partnership</p>
                <p className="mt-2 max-w-sm text-sm font-semibold leading-6 text-slate-200">
                  Build visibility with the lawyers football community
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-7xl px-4 py-12 sm:px-6 lg:px-10">
        <p className="text-xs font-black uppercase tracking-[0.22em] text-[#d8ad45]">
          Why Partner With KSW
        </p>
        <div className="mt-5 grid gap-4 md:grid-cols-3">
          {valueCards.map(([title, body]) => (
            <article
              className="rounded-lg border border-white/10 bg-white/[0.07] p-5 shadow-xl shadow-black/20 backdrop-blur"
              key={title}
            >
              <div className="mb-4 h-0.5 w-12 rounded-full bg-[#d8ad45]" />
              <h2 className="text-xl font-black text-white">{title}</h2>
              <p className="mt-3 text-sm leading-7 text-slate-300">{body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="bg-[#f6f2ea]">
        <div className="mx-auto w-full max-w-7xl px-4 py-12 sm:px-6 lg:px-10">
          <h2 className="text-3xl font-black text-[#061426]">Partnership Opportunities</h2>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-700">
            Select a partnership level that fits your brand presence across club media,
            matchdays, and legal community activities. Prices are discussed privately.
          </p>
          <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {tiers.map((tier) => (
              <article
                className="rounded-lg border border-slate-200 bg-white p-5 shadow-xl shadow-slate-900/10"
                key={tier.name}
              >
                <div className={`mb-4 h-0.5 w-12 rounded-full bg-gradient-to-r ${tier.accent}`} />
                <h3 className="text-xl font-black text-[#061426]">{tier.name}</h3>
                <ul className="mt-5 space-y-3">
                  {tier.benefits.map((benefit) => (
                    <li className="flex gap-2 text-sm font-semibold text-slate-700" key={benefit}>
                      <span className="mt-1 size-1.5 shrink-0 rounded-full bg-[#d8ad45]" />
                      {benefit}
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-gradient-to-br from-[#071b31] via-[#0b2745] to-[#061426]">
        <div className="mx-auto w-full max-w-7xl px-4 py-12 sm:px-6 lg:px-10">
          <h2 className="text-3xl font-black text-white">Sponsor Wall</h2>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-300">
            พื้นที่แสดงโลโก้ผู้สนับสนุนของชมรม แบ่งระดับการมองเห็นตามรูปแบบความร่วมมือ
          </p>
          <div className="mt-8 grid grid-cols-3 items-center justify-items-center gap-4 sm:grid-cols-4 sm:gap-5 lg:grid-cols-6">
            {Array.from({ length: 12 }).map((_, index) => {
              const sponsor = sponsors[index];
              const name = sponsor?.name ?? "YOUR LOGO";
              const logoUrl = sponsor?.logo_url;
              const websiteUrl = sponsor?.website_url;
              const tierLabel =
                index === 0 ? "Main Partner" : index < 4 ? "Official Partner" : "Supporter";
              const logoSlotSize =
                index === 0
                  ? "h-20 w-32 sm:h-24 sm:w-40"
                  : index < 4
                    ? "h-16 w-28 sm:h-20 sm:w-36"
                    : "h-14 w-24 sm:h-16 sm:w-32";
              const sponsorMark = (
                <div
                  className={`flex ${logoSlotSize} items-center justify-center text-center transition duration-300 hover:scale-105`}
                >
                  {logoUrl ? (
                    <img alt={`${name} logo`} className="ksw-sponsor-logo-fit" src={logoUrl} />
                  ) : (
                    <span className="text-[10px] font-black uppercase tracking-wide text-[#f4d58a]/75 sm:text-xs">
                      {sponsor ? initials(name) || "YOUR LOGO" : "YOUR LOGO"}
                    </span>
                  )}
                </div>
              );

              return (
                <div className="flex flex-col items-center gap-2" key={sponsor?.id ?? index}>
                  {websiteUrl ? (
                    <a
                      aria-label={`Visit ${name} website`}
                      className="cursor-pointer"
                      href={websiteUrl}
                      rel="noopener noreferrer"
                      target="_blank"
                    >
                      {sponsorMark}
                    </a>
                  ) : (
                    sponsorMark
                  )}
                  <span className="text-center text-[10px] font-black uppercase tracking-wide text-[#f4d58a]/80">
                    {tierLabel}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section className="bg-[#f6f2ea]">
        <div className="mx-auto w-full max-w-7xl px-4 py-12 sm:px-6 lg:px-10">
          <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-2xl shadow-slate-900/10 sm:p-8">
            <h2 className="text-3xl font-black text-[#061426]">
              ร่วมเป็นส่วนหนึ่งของ KSW L.C.
            </h2>
            <p className="mt-4 max-w-3xl text-base leading-8 text-slate-700">
              หากท่านหรือองค์กรของท่านต้องการสนับสนุนกิจกรรมของชมรม สามารถติดต่อทีมงาน KSW
              เพื่อหารือรูปแบบความร่วมมือที่เหมาะสม
            </p>
            <a
              className="mt-7 inline-flex rounded-md bg-[#061426] px-5 py-3 text-sm font-black text-[#f4d58a] transition-colors hover:bg-[#0b2745]"
              href="mailto:kswlawclub@gmail.com"
            >
              Email KSW
            </a>
            <div className="mt-4 flex flex-col gap-3 sm:flex-row">
              <Link
                className="inline-flex items-center justify-center rounded-md border border-[#061426]/20 px-5 py-3 text-sm font-black text-[#061426] transition-colors hover:bg-slate-100"
                href="/team"
              >
                Meet The Team
              </Link>
              <Link
                className="inline-flex items-center justify-center rounded-md border border-[#061426]/20 px-5 py-3 text-sm font-black text-[#061426] transition-colors hover:bg-slate-100"
                href="/gallery"
              >
                View Gallery
              </Link>
            </div>
            <p className="mt-3 text-sm font-bold text-slate-700">kswlawclub@gmail.com</p>
          </div>
        </div>
      </section>
    </main>
  );
}
