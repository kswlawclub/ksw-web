import Link from "next/link";
import { readdir } from "node:fs/promises";
import path from "node:path";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const teamMembersDir = path.join(process.cwd(), "public/images/team-members");
const coachBio = [
  "อดีตเยาวชนทีมชาติไทย",
  "อดีตนักฟุตบอลทีมทนายไทย",
  "อดีตนักฟุตบอลโรงเรียนเทพศิรินทร์",
];
const coachExperience = [
  "ผู้ช่วยผู้ฝึกสอน ลพบุรี UTD",
  "ผู้ช่วยผู้ฝึกสอน BFB พัทยาซิตี้ T3",
];
const coachLicenses = ["AFC C License", "กำลังศึกษา AFC B License", "AFC G License"];
const coachAchievements = [
  "แชมป์ Asia Lawyer 2019–2023",
  "Assistant Coach – Lawyer All Star 2019–2024",
  "แชมป์ Lawyers Cup",
  "แชมป์ Thai Lawyers League 2022–2025",
];
const assistantPlayerExperience = [
  "BEC Tero 2009–2011",
  "Bangkok FC 2012–2015",
  "Trat FC 2016",
  "Yala FC 2017",
  "Samut Sakhon City 2018",
];
const assistantCoachingExperience = [
  "Assistant Coach – Samut Sakhon City 2019",
  "Assistant Coach – Rayong FC 2020",
  "Assistant Coach – Kabin United / Kabinburi City 2021–2022",
];
const teamStaff = [
  ["เฟี๊ยต", "/images/staff/pied.png"],
  ["เหงี่ยม", "/images/staff/ngiam.png"],
  ["พาสต้า", "/images/staff/pasta.png"],
  ["โก้", "/images/staff/ko.png"],
  ["หม่อมโจอี้", "/images/staff/mhomchoei.png"],
  ["เด่น", "/images/staff/den.png"],
];

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
        <div className="mx-auto w-full max-w-7xl px-4 py-12 sm:px-6 lg:px-10">
          <p className="text-xs font-black uppercase tracking-[0.22em] text-[#9b1c1f]">
            CLUB OPERATIONS
          </p>
          <h2 className="mt-3 text-3xl font-black text-[#061426]">Coaching Staff</h2>

          <article className="mt-7 overflow-hidden rounded-lg border border-[#d8ad45]/35 bg-white shadow-2xl shadow-slate-900/10 md:grid md:grid-cols-[0.9fr_1.1fr]">
            <div className="relative min-h-[280px] overflow-hidden md:min-h-full">
              <img
                alt="Coach Nat"
                className="absolute inset-0 size-full object-cover"
                src="/images/staff/head-coach.jpg"
                style={{
                  objectPosition: "center 25%",
                }}
              />
              <div className="absolute inset-0 bg-gradient-to-t from-[#061426]/75 via-transparent to-transparent md:bg-gradient-to-r" />
            </div>
            <div className="p-5 sm:p-7">
              <div className="h-0.5 w-14 rounded-full bg-[#d8ad45]" />
              <div className="mt-5 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-black text-[#9b1c1f]">
                    กวีวัฒน์ รัตนหนูพงศ์
                  </p>
                  <h3 className="mt-1 text-2xl font-black text-[#061426]">
                    COACH NAT (แนท)
                  </h3>
                </div>
                <span className="rounded-full border border-[#d8ad45]/45 bg-[#fff8e3] px-3 py-1 text-xs font-black uppercase tracking-wide text-[#061426]">
                  AFC C License
                </span>
              </div>

              <div className="mt-6 grid gap-5 sm:grid-cols-2">
                {[
                  ["Bio", coachBio],
                  ["Club Coaching Experience", coachExperience],
                  ["Coaching License", coachLicenses],
                  ["Achievements", coachAchievements],
                ].map(([title, items]) => (
                  <div key={title as string}>
                    <h4 className="text-xs font-black uppercase tracking-[0.18em] text-[#d8ad45]">
                      {title as string}
                    </h4>
                    <ul className="mt-3 space-y-2">
                      {(items as string[]).map((item) => (
                        <li className="flex gap-2 text-sm font-semibold leading-6 text-slate-700" key={item}>
                          <span className="mt-2 size-1.5 shrink-0 rounded-full bg-[#9b1c1f]" />
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
              <div className="mt-6 rounded-lg border border-[#d8ad45]/25 bg-[#fffdf7] p-4">
                <p className="text-xs font-black uppercase tracking-[0.18em] text-[#9b1c1f]">
                  Current
                </p>
                <p className="mt-2 text-sm font-bold text-[#061426]">
                  Coach ผู้ฝึกสอน – ชมรมทนายความคลองสามวา
                </p>
              </div>
            </div>
          </article>

          <article className="mt-14 overflow-hidden rounded-lg border border-[#d8ad45]/30 border-t-[#d8ad45]/45 bg-white pt-8 shadow-xl shadow-slate-900/10 sm:grid sm:grid-cols-[40%_60%]">
            <div className="relative min-h-[260px] overflow-hidden bg-white sm:min-h-full">
              <img
                alt="Solomon Ukutu"
                className="absolute inset-0 size-full object-contain object-center"
                src="/images/staff/assistant-coach.jpg"
              />
            </div>
            <div className="p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-2xl font-black uppercase tracking-wide text-[#061426]">
                    Solomon Ukutu
                  </h3>
                  <p className="mt-1 text-sm font-black text-[#9b1c1f]">
                    Assistant Coach
                  </p>
                </div>
                <span className="rounded-full border border-[#d8ad45]/45 bg-[#fff8e3] px-3 py-1 text-xs font-black uppercase tracking-wide text-[#061426]">
                  AFC C License
                </span>
              </div>
              <p className="mt-4 max-w-3xl text-sm font-semibold leading-7 text-slate-700">
                Solomon Ukutu เป็นอดีตนักฟุตบอลอาชีพที่มีประสบการณ์ในลีกไทยหลายสโมสร
                ทั้งในฐานะผู้เล่นและผู้ช่วยผู้ฝึกสอน
              </p>
              <div className="mt-5 grid gap-5 md:grid-cols-2">
                {[
                  ["Player Experience", assistantPlayerExperience],
                  ["Coaching Experience", assistantCoachingExperience],
                ].map(([title, items]) => (
                  <div key={title as string}>
                    <h4 className="text-xs font-black uppercase tracking-[0.18em] text-[#d8ad45]">
                      {title as string}
                    </h4>
                    <ul className="mt-3 space-y-2">
                      {(items as string[]).map((item) => (
                        <li className="flex gap-2 text-sm font-semibold leading-6 text-slate-700" key={item}>
                          <span className="mt-2 size-1.5 shrink-0 rounded-full bg-[#9b1c1f]" />
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
              <div className="mt-5 rounded-lg border border-[#d8ad45]/25 bg-[#fffdf7] p-4">
                <p className="text-xs font-black uppercase tracking-[0.18em] text-[#9b1c1f]">
                  Current
                </p>
                <p className="mt-2 text-sm font-bold text-[#061426]">
                  Assistant Coach – ชมรมทนายความคลองสามวา
                </p>
              </div>
            </div>
          </article>

          <div className="mt-12 border-t border-[#d8ad45]/25 pt-8">
            <h3 className="text-2xl font-black text-[#061426]">Team Staff</h3>
            <div className="mt-7 grid grid-cols-2 gap-x-4 gap-y-7 sm:grid-cols-3 sm:gap-x-5 lg:grid-cols-6">
              {teamStaff.map(([name, src]) => (
                <article
                  className="flex flex-col items-center justify-start px-2 py-2 text-center"
                  key={name}
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
                      src={src}
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
                  <h4 className="mt-4 min-h-10 text-sm font-black leading-5 text-[#061426] sm:text-base">
                    {name}
                  </h4>
                </article>
              ))}
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
