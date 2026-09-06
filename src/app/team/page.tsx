import Link from "next/link";
import { FacebookIcon } from "@/components/facebook-icon";
import { clubRoleLabel, getMemberDisplayName } from "@/lib/club-members";
import { groupPublicTeamMembers, staticTeamStaff, type PublicTeamMember, type PublicTeamProfile } from "@/lib/public-team-members";
import { getSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const facebookUrl = "https://web.facebook.com/KlongSamWaLawyers";

function shuffle<T>(items: T[]) {
  const shuffled = [...items];

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }

  return shuffled;
}

function MemberGrid({ profiles, compact = false, showRole = false }: {
  profiles: PublicTeamProfile[];
  compact?: boolean;
  showRole?: boolean;
}) {
  return (
    <div className={`grid grid-cols-2 gap-x-4 gap-y-7 sm:gap-x-5 ${compact ? "sm:grid-cols-3 lg:grid-cols-6" : "md:grid-cols-3 lg:grid-cols-4"}`}>
      {profiles.map((member) => {
        const displayName = getMemberDisplayName(member);
        const isStaticPortrait = staticTeamStaff.some((staff) => staff.photo_url === member.photo_url);
        return (
          <article className="flex min-w-0 flex-col items-center justify-start px-2 py-2 text-center" key={member.id}>
            <div className="mx-auto size-[130px] shrink-0 overflow-hidden rounded-full border-2 border-[#d8ad45] shadow-lg shadow-slate-900/15">
              {member.photo_url ? (
                <img
                  alt={displayName}
                  className="block h-full w-full object-cover"
                  height={130}
                  loading={isStaticPortrait ? "eager" : "lazy"}
                  src={member.photo_url}
                  style={{
                    objectPosition: isStaticPortrait ? "center 30%" : "center center",
                    transform: isStaticPortrait ? "scale(1.9)" : undefined,
                    transformOrigin: "center center",
                  }}
                  width={130}
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-[#f8f3e7] text-xl font-black text-[#061426]">KSW</div>
              )}
            </div>
            <h3 className="mt-4 min-h-10 max-w-full break-words text-sm font-black leading-5 text-[#061426] sm:text-base">{displayName}</h3>
            {showRole ? <p className="mt-1 text-sm font-semibold text-slate-600">{clubRoleLabel(member.club_role)}</p> : null}
          </article>
        );
      })}
    </div>
  );
}

async function getClubMembers() {
  const supabase = getSupabase();

  if (!supabase) {
    return [];
  }

  const result = await supabase
    .from("club_members")
    .select("id, nickname, photo_url, membership_type, club_role, is_active")
    .eq("is_active", true)
    .order("created_at", { ascending: false });

  if (result.error) {
    console.error("public club members query failed", result.error.message);
    return [];
  }

  return (result.data ?? []) as PublicTeamMember[];
}

export default async function TeamPage() {
  const groups = groupPublicTeamMembers(await getClubMembers());
  const members = shuffle(groups.ordinary);

  return (
    <main className="min-h-screen overflow-x-hidden bg-[#061426] text-slate-100">
      <section className="relative overflow-hidden border-b border-[#d8ad45]/25">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(216,173,69,0.2),transparent_34%),linear-gradient(135deg,#061426,#0b2745_58%,#071b31)]" />
        <div className="relative mx-auto w-full max-w-7xl px-4 py-12 sm:px-6 sm:py-16 lg:px-10">
          <Link
            className="inline-flex text-sm font-black text-[#f4d58a] transition-colors hover:text-white"
            href="/"
          >
            Home {">"} Team
          </Link>
          <p className="mt-8 text-xs font-black uppercase tracking-[0.24em] text-[#d8ad45]">
            KSW L.C.
          </p>
          <h1 className="mt-3 text-4xl font-black tracking-tight text-white sm:text-6xl">
            KSW Team Members
          </h1>
          <p className="mt-4 text-xl font-black uppercase tracking-wide text-[#f4d58a]">
            Different roles. One club.
          </p>
          <p className="mt-5 max-w-2xl text-base leading-7 text-slate-300 sm:text-lg">
            สมาชิกชมรมทนายความคลองสามวา ผู้ร่วมสร้างมิตรภาพ เครือข่าย
            และชีวิตฟุตบอลของ KSW L.C.
          </p>
          <div className="mt-7 flex flex-col gap-3 sm:flex-row">
            <Link
              className="inline-flex items-center justify-center rounded-md bg-gradient-to-r from-[#d8ad45] to-[#f4d58a] px-5 py-3 text-sm font-black text-[#061426] shadow-lg shadow-[#d8ad45]/15 transition-transform hover:scale-[1.02]"
              href="/gallery"
            >
              View Gallery
            </Link>
            <Link
              className="inline-flex items-center justify-center rounded-md border border-[#d8ad45]/50 bg-white/[0.03] px-5 py-3 text-sm font-black text-[#f4d58a] backdrop-blur transition-colors hover:bg-[#d8ad45]/10"
              href="/partners"
            >
              Partner With KSW
            </Link>
            <a
              className="inline-flex items-center justify-center gap-2 rounded-md border border-[#d8ad45]/50 bg-white/[0.03] px-5 py-3 text-sm font-black text-[#f4d58a] backdrop-blur transition-colors hover:bg-[#d8ad45]/10"
              href={facebookUrl}
              rel="noopener noreferrer"
              target="_blank"
            >
              <FacebookIcon className="size-4" />
              Facebook
            </a>
          </div>
        </div>
      </section>

      <section className="bg-[#FFFFFF]">
        <div className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6 lg:px-10">
          <div className="mb-7">
            <p className="text-xs font-black uppercase tracking-[0.22em] text-[#9b1c1f]">
              KSW Community
            </p>
            <h2 className="mt-3 text-3xl font-black text-[#061426]">สมาชิกสามัญ</h2>
          </div>
          {members.length ? (
            <MemberGrid profiles={members} />
          ) : (
            <div className="rounded-lg border border-[#d8ad45]/25 bg-[#fffaf0] p-6 text-sm font-bold leading-6 text-[#061426]">
              Team member profiles will be updated soon.
            </div>
          )}
        </div>
      </section>

      <section className="bg-[#f6f2ea]">
        <div className="mx-auto w-full max-w-7xl px-4 py-12 sm:px-6 lg:px-10">
          <p className="text-xs font-black uppercase tracking-[0.22em] text-[#9b1c1f]">KSW Community</p>
          <h2 className="mt-3 text-3xl font-black text-[#061426]">สมาชิกวิสามัญ</h2>
          <div className="mt-7">
            {groups.extraordinary.length ? (
              <MemberGrid compact profiles={groups.extraordinary} />
            ) : (
              <p className="text-sm font-bold leading-6 text-[#061426]">ข้อมูลสมาชิกวิสามัญจะอัปเดตเร็ว ๆ นี้</p>
            )}
          </div>
        </div>
      </section>

      <section className="bg-[#f6f2ea]">
        <div className="mx-auto w-full max-w-7xl px-4 py-12 sm:px-6 lg:px-10">
          <p className="text-xs font-black uppercase tracking-[0.22em] text-[#9b1c1f]">
            CLUB OPERATIONS
          </p>
          <h2 className="mt-3 text-3xl font-black text-[#061426]">Coaching Staff</h2>

          {groups.coaching.length ? (
            <div className="mt-7"><MemberGrid profiles={groups.coaching} showRole /></div>
          ) : (
          <article className="relative mt-7 overflow-hidden rounded-2xl border border-[#d8ad45]/35 bg-[#061426] px-5 py-10 text-white shadow-2xl shadow-slate-900/15 sm:px-8 sm:py-12">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(216,173,69,0.24),transparent_32%),linear-gradient(135deg,#061426,#0b2745_62%,#071b31)]" />
            <div className="absolute -right-16 -top-16 size-56 rounded-full border border-[#d8ad45]/15 sm:size-72" />
            <div className="absolute bottom-8 left-6 right-6 h-px bg-white/10" />
            <div className="absolute bottom-16 left-1/2 size-28 -translate-x-1/2 rounded-full border border-white/10 sm:size-36" />
            <div className="absolute inset-y-8 left-1/2 w-px bg-white/10" />
            <div className="relative mx-auto flex max-w-4xl flex-col items-center text-center">
              <div className="flex flex-wrap justify-center gap-2">
                {["KSW L.C.", "Team Operations", "Season 6"].map((badge) => (
                  <span
                    className="rounded-full border border-[#d8ad45]/35 bg-white/[0.06] px-3 py-1 text-[11px] font-black uppercase tracking-[0.14em] text-[#f4d58a]"
                    key={badge}
                  >
                    {badge}
                  </span>
                ))}
              </div>
              <div className="mt-8 flex size-20 items-center justify-center rounded-full border border-[#d8ad45]/35 bg-[#d8ad45]/10 text-sm font-black tracking-[0.16em] text-[#f4d58a] shadow-lg shadow-[#d8ad45]/15">
                KSW
              </div>
              <p className="mt-8 text-xs font-black uppercase tracking-[0.26em] text-[#d8ad45]">
                CLUB OPERATIONS
              </p>
              <h3 className="mt-3 text-4xl font-black tracking-tight text-white sm:text-6xl">
                Coming Soon
              </h3>
              <p className="mt-4 text-lg font-black text-[#f4d58a] sm:text-xl">
                Coaching staff information is being updated.
              </p>
              <p className="mt-4 max-w-2xl text-sm font-semibold leading-7 text-slate-300 sm:text-base">
                Stay tuned for the official KSW L.C. coaching profile and team operations update.
              </p>
            </div>
          </article>
          )}
        </div>
      </section>
    </main>
  );
}
