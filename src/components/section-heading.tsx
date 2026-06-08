type SectionHeadingProps = {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  description?: string;
  as?: "h1" | "h2";
  align?: "center" | "left";
  theme?: "dark" | "light";
  className?: string;
};

export function SectionHeading({
  eyebrow,
  title,
  subtitle,
  description,
  as = "h2",
  align = "center",
  theme = "dark",
  className = "",
}: SectionHeadingProps) {
  const Heading = as;
  const isCenter = align === "center";
  const isDark = theme === "dark";
  const headingColor = isDark ? "text-white" : "text-[#061426]";
  const eyebrowColor = isDark ? "text-[#d8ad45]" : "text-[#9b1c1f]";
  const subtitleColor = isDark ? "text-[#f4d58a]" : "text-[#9b1c1f]";
  const descriptionColor = isDark ? "text-slate-300" : "text-slate-700";

  return (
    <div className={`${isCenter ? "mx-auto text-center" : "text-left"} ${className}`}>
      {eyebrow ? (
        <p className={`text-xs font-black uppercase tracking-[0.24em] ${eyebrowColor}`}>
          {eyebrow}
        </p>
      ) : null}
      <Heading
        className={`mt-3 text-4xl font-black leading-tight tracking-tight ${headingColor} sm:text-5xl`}
      >
        {title}
      </Heading>
      {subtitle ? (
        <p className={`mt-4 text-lg font-black uppercase tracking-wide ${subtitleColor} sm:text-xl`}>
          {subtitle}
        </p>
      ) : null}
      {description ? (
        <p
          className={`mt-5 ${isCenter ? "mx-auto" : ""} max-w-3xl text-base leading-8 ${descriptionColor} sm:text-lg`}
        >
          {description}
        </p>
      ) : null}
    </div>
  );
}
