import Link from "next/link";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const memberFiles = [
  "อเล็กซ์.png",
  "บอสกราน.png",
  "ไอซ์.png",
  "เบิร์ด.png",
  "โก้มีสทีน.png",
  "บาสเล็ก.png",
  "จ เจ๋ง.png",
  "เทพปั๊ก.png",
  "พี่ชีคของน้องๆ.png",
  "อาร์ทหล่อ.png",
  "พี่แขก.png",
  "ดำ.png",
  "ฟงหวิน.png",
  "นัทสายคลอง.png",
  "ภพ.png",
  "กบบินได้.png",
  "เด่น.png",
  "พร.png",
  "โอ๊ต.png",
  "ป๋าหรั่ง.png",
  "ปอเป๊ก.png",
  "อ๋อน.png",
  "จอร์นวุฒิ.png",
  "เก่ง.png",
  "อาร์ทสายสังสรรค์.png",
  "พัฒน์.png",
  "sugar daddy.png",
  "จักรวาล.png",
  "เมสซี่น้อย.png",
  "พงษ์.png",
  "เทพเป้า.png",
  "พี่โอเว่น.png",
  "เอ๋ สารคาม.png",
  "พี่ปรีดี.png",
  "เสี่ยบอย.png",
  "โจ.png",
  "เทพบั้มสายคลอง.png",
  "บี.png",
  "บู๊ซาวน์.png",
  "บาสสูง.png",
  "โอ.png",
  "วุฒิ.png",
  "เทพวิท.png",
  "ยศ.png",
  "วิน.png",
  "โชคน้อย.png",
  "เอกจิวยี่.png",
  "แตง.png",
  "ป๋าซ้ง.png",
];

const staffRoles = ["Team Manager", "Coaching Staff", "Team Staff"];

function displayName(fileName: string) {
  return fileName
    .replace(/\.[^.]+$/, "")
    .replace(/[-_]+/g, " ")
    .trim();
}

function imagePath(fileName: string) {
  return `/images/team-members/${encodeURIComponent(fileName)}`;
}

function shuffle<T>(items: T[]) {
  const shuffled = [...items];

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }

  return shuffled;
}

export default function TeamPage() {
  const members = shuffle(memberFiles);

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

      <section className="bg-[#f6f2ea]">
        <div className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6 lg:px-10">
          <p className="text-xs font-black uppercase tracking-[0.22em] text-[#9b1c1f]">
            Club Operations
          </p>
          <h2 className="mt-3 text-3xl font-black text-[#061426]">Team Staff</h2>
          <div className="mt-6 grid gap-4 md:grid-cols-3">
            {staffRoles.map((role) => (
              <article
                className="rounded-lg border border-slate-200 bg-white p-5 text-center shadow-xl shadow-slate-900/10"
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
                <p className="mt-2 text-sm font-semibold text-slate-600">Coming Soon</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-gradient-to-br from-[#071b31] via-[#0b2745] to-[#061426]">
        <div className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6 lg:px-10">
          <div className="mb-7">
            <p className="text-xs font-black uppercase tracking-[0.22em] text-[#d8ad45]">
              KSW Community
            </p>
            <h2 className="mt-3 text-3xl font-black text-white">Team Members</h2>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4">
            {members.map((fileName) => {
              const name = displayName(fileName);

              return (
                <article
                  className="rounded-lg border border-white/10 bg-white/[0.06] p-4 text-center shadow-xl shadow-black/20 backdrop-blur transition duration-300 hover:border-[#d8ad45]/55 hover:bg-white/[0.09] hover:shadow-[#d8ad45]/10"
                  key={fileName}
                >
                  <img
                    alt={name}
                    className="mx-auto size-24 rounded-full border-2 border-[#d8ad45]/45 object-cover shadow-lg shadow-black/25 sm:size-28"
                    src={imagePath(fileName)}
                  />
                  <h3 className="mt-4 min-h-10 text-sm font-black leading-5 text-white sm:text-base">
                    {name}
                  </h3>
                  <p className="mt-2 text-xs font-bold uppercase tracking-wide text-[#f4d58a]">
                    Coming Soon
                  </p>
                </article>
              );
            })}
          </div>
        </div>
      </section>
    </main>
  );
}
