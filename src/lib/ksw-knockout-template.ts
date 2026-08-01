import type { CompetitionTreeSource } from "@/lib/competition-tree";

export type KswQualificationSource = CompetitionTreeSource & {
  label?: string;
  teamName?: string;
};

export type KswStandardPair = {
  away: KswQualificationSource;
  home: KswQualificationSource;
  reason: string;
};

function groupKey(source: KswQualificationSource) {
  return source.groupId ?? "";
}

function sourceLabel(source: KswQualificationSource) {
  return source.label ?? (source.type === "best_ranked" ? `Best Ranked #${source.bestOrder ?? "?"}` : `${source.groupId ?? "?"}${source.rank ?? "?"}`);
}

export function kswSourceLabel(source: KswQualificationSource) {
  return sourceLabel(source);
}

function pairRemaining(sources: KswQualificationSource[]) {
  const remaining = [...sources];
  const pairs: KswStandardPair[] = [];
  while (remaining.length > 1) {
    const home = remaining.shift()!;
    const awayIndex = remaining.findIndex((candidate) => groupKey(candidate) !== groupKey(home));
    const away = remaining.splice(awayIndex >= 0 ? awayIndex : 0, 1)[0];
    pairs.push({ away, home, reason: "จัดคู่ข้ามกลุ่ม" });
  }
  return { pairs, unpaired: remaining };
}

export function explainKswStandardPair(home: KswQualificationSource, away: KswQualificationSource) {
  if (away.type === "bye" || home.type === "bye") return "ผ่านรอบนี้อัตโนมัติตามขนาดสายแข่งขัน";
  if ((home.type === "group_rank" && home.rank === 1 && away.type === "best_ranked")
    || (away.type === "group_rank" && away.rank === 1 && home.type === "best_ranked")) {
    return "Wild Card พบแชมป์กลุ่ม";
  }
  if ((home.type === "group_rank" && home.rank === 1 && away.type === "group_rank" && away.rank === 2)
    || (away.type === "group_rank" && away.rank === 1 && home.type === "group_rank" && home.rank === 2)) {
    return "ไขว้กลุ่ม";
  }
  return "จัดคู่ข้ามกลุ่ม";
}

function firstDifferentGroup<T extends KswQualificationSource>(sources: T[], groupId: string, used: Set<KswQualificationSource>) {
  return sources.find((source) => !used.has(source) && groupKey(source) !== groupId);
}

// KSW Standard gives group winners priority over Wild Cards, then pairs every
// remaining winner with a runner-up from a different group.
export function buildKswStandardPairing(entries: KswQualificationSource[]) {
  const champions = entries.filter((entry) => entry.type === "group_rank" && entry.rank === 1);
  const runnersUp = entries.filter((entry) => entry.type === "group_rank" && entry.rank === 2);
  const bestRanked = entries.filter((entry) => entry.type === "best_ranked").sort((a, b) => (a.bestOrder ?? 0) - (b.bestOrder ?? 0));
  const remaining = entries.filter((entry) => !champions.includes(entry) && !runnersUp.includes(entry) && !bestRanked.includes(entry));
  const pairs: KswStandardPair[] = [];
  const used = new Set<KswQualificationSource>();

  // Best-ranked qualifiers are Wild Cards. Begin with the lowest seed and
  // move upward only when its group would collide with that Wild Card.
  bestRanked.forEach((wildCard) => {
    const champion = [...champions].reverse().find((candidate) => !used.has(candidate) && groupKey(candidate) !== groupKey(wildCard));
    if (!champion) return;
    pairs.push({ away: wildCard, home: champion, reason: "Wild Card พบแชมป์กลุ่ม" });
    used.add(champion);
    used.add(wildCard);
  });

  champions.forEach((champion, index) => {
    if (used.has(champion)) return;
    const partnerGroup = champions.length % 2 === 0
      ? groupKey(champions[index ^ 1])
      : groupKey(champions[(index + 1) % champions.length]);
    const runner = runnersUp.find((candidate) => !used.has(candidate) && groupKey(candidate) === partnerGroup && groupKey(candidate) !== groupKey(champion))
      ?? firstDifferentGroup(runnersUp, groupKey(champion), used);
    if (runner) {
      pairs.push({ away: runner, home: champion, reason: "ไขว้กลุ่ม" });
      used.add(champion);
      used.add(runner);
    }
  });

  const tail = pairRemaining([...runnersUp, ...bestRanked, ...remaining, ...champions].filter((entry) => !used.has(entry)));
  pairs.push(...tail.pairs);

  return {
    pairs,
    sources: pairs.flatMap((pair) => [pair.home, pair.away]).concat(tail.unpaired),
    template: "KSW Standard" as const,
  };
}
