import Link from "next/link";
import { readdir } from "node:fs/promises";
import path from "node:path";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const teamMembersDir = path.join(process.cwd(), "public/images/team-members");
const staffRoles = ["Coaching Staff", "Assistant Coach", "Team Staff"];

function displayName(fileName: string) {
  const name = fileName
    .replace(/\.[^.]+$/, "")
    .replace(/[-_]+/g, " ")
    .trim();

  return `ทนาย${name.replace(/\b[a-z]/gi, (letter) => letter.toUpperCase())}`;
}

function imagePath(fileName: string) {
  return `/images/team-members/${encodeURIComponent(fileName)}`;
}

async function getMemberFiles() {
  const files = await readdir(teamMembersDir);

  return files.filter((fileName) => /\.(png|jpe?g|webp|avif)$/i.test(fileName));
}

function shuffle<T>(items: T[]) {
  const shuffled = [...items];

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }

  return shuffled;
}

export default async function TeamPage() {
  const members = shuffle(await getMemberFiles());

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
        </div>
      </section>

      <section className="bg-[#FFFFFF]">
        <div className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6 lg:px-10">
          <div className="mb-7">
            <p className="text-xs font-black uppercase tracking-[0.22em] text-[#9b1c1f]">
              KSW Community
            </p>
            <h2 className="mt-3 text-3xl font-black text-[#061426]">Team Members</h2>
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-7 sm:gap-x-5 md:grid-cols-3 lg:grid-cols-4">
            {members.map((fileName) => {
              const name = displayName(fileName);

              return (
                <article
                  className="flex flex-col items-center justify-start px-2 py-2 text-center"
                  key={fileName}
                >
                  <div
                    className="mx-auto shadow-lg shadow-slate-900/15"
                    style={{
                      width: "130px",
                      height: "130px",
                      borderRadius: "50%",
                      overflow: "hidden",
                      border: "2px solid #d8ad45",
                    }}
                  >
                    <img
                      alt={name}
                      className="block"
                      src={imagePath(fileName)}
                      style={{
                        width: "100%",
                        height: "100%",
                        objectFit: "cover",
                        objectPosition: "center 30%",
                        transform: "scale(1.9)",
                        transformOrigin: "center center",
                      }}
                    />
                  </div>
                  <h3 className="mt-4 min-h-10 text-sm font-black leading-5 text-[#061426] sm:text-base">
                    {name}
                  </h3>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      <section className="bg-[#f6f2ea]">
        <div className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6 lg:px-10">
          <p className="text-xs font-black uppercase tracking-[0.22em] text-[#9b1c1f]">
            Club Operations
          </p>
          <h2 className="mt-3 text-3xl font-black text-[#061426]">Team Staff</h2>
          <div className="mt-6 grid gap-4 md:grid-cols-3">
            {staffRoles.map((role) => (
              <article
                className="rounded-lg border border-[#d8ad45]/35 bg-white p-5 text-center shadow-xl shadow-slate-900/10"
                key={role}
              >
                <div className="mx-auto flex size-24 items-center justify-center rounded-full border border-[#d8ad45]/40 bg-[#061426] p-3 shadow-lg shadow-[#061426]/20">
                  <img
                    alt="KSW L.C. logo"
                    className="max-h-full max-w-full object-contain"
                    src="/team-logos/ksw-lc.png"
                  />
                </div>
                <h3 className="mt-4 text-lg font-black text-[#061426]">{role}</h3>
              </article>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
