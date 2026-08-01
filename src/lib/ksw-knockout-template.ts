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
    pairs.push({ away, home, reason: `${sourceLabel(home)} พบ ${sourceLabel(away)}` });
  }
  return { pairs, unpaired: remaining };
}

// KSW Standard seeds group winners, keeps same-group teams apart in round one,
// and assigns the strongest seed to the lowest remaining best-ranked qualifier.
export function buildKswStandardPairing(entries: KswQualificationSource[]) {
  const champions = entries.filter((entry) => entry.type === "group_rank" && entry.rank === 1);
  const runnersUp = entries.filter((entry) => entry.type === "group_rank" && entry.rank === 2);
  const bestRanked = entries.filter((entry) => entry.type === "best_ranked").sort((a, b) => (a.bestOrder ?? 0) - (b.bestOrder ?? 0));
  const remaining = entries.filter((entry) => !champions.includes(entry) && !runnersUp.includes(entry) && !bestRanked.includes(entry));
  const pairs: KswStandardPair[] = [];
  const used = new Set<KswQualificationSource>();

  champions.forEach((champion, index) => {
    const best = bestRanked[bestRanked.length - index - 1];
    if (best) {
      pairs.push({ away: best, home: champion, reason: `${sourceLabel(champion)} พบ ${sourceLabel(best)}` });
      used.add(champion);
      used.add(best);
      return;
    }
    const partnerGroup = champions.length % 2 === 0
      ? groupKey(champions[index ^ 1])
      : groupKey(champions[(index + 1) % champions.length]);
    const runner = runnersUp.find((candidate) => !used.has(candidate) && groupKey(candidate) === partnerGroup)
      ?? runnersUp.find((candidate) => !used.has(candidate) && groupKey(candidate) !== groupKey(champion));
    if (runner) {
      pairs.push({ away: runner, home: champion, reason: `${sourceLabel(champion)} พบ ${sourceLabel(runner)}` });
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
