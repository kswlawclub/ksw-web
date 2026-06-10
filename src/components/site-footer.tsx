import Link from "next/link";

const footerLinks = [
  ["Home", "/"],
  ["Team", "/team"],
  ["Gallery", "/gallery"],
  ["Partners", "/partners"],
  ["League Center", "/#league-center"],
];

export function SiteFooter() {
  return (
    <footer className="border-t border-[#d8ad45]/20 bg-[radial-gradient(circle_at_top_right,rgba(216,173,69,0.2),transparent_34%),linear-gradient(135deg,rgba(6,20,38,0.96),rgba(9,31,57,0.88))] text-slate-300">
      <div className="mx-auto grid w-full max-w-7xl gap-6 px-4 py-8 sm:px-6 md:grid-cols-[1fr_auto] md:items-center lg:px-10">
        <div>
          <p className="text-lg font-black text-white">KSW L.C.</p>
          <a
            className="mt-2 inline-flex text-sm font-bold text-[#f4d58a] hover:text-white"
            href="mailto:kswlawclub@gmail.com"
          >
            kswlawclub@gmail.com
          </a>
        </div>
        <nav className="flex flex-wrap gap-x-4 gap-y-2">
          {footerLinks.map(([label, href]) => (
            <Link
              className="text-sm font-bold text-slate-300 transition-colors hover:text-[#f4d58a]"
              href={href}
              key={href}
            >
              {label}
            </Link>
          ))}
        </nav>
      </div>
    </footer>
  );
}
