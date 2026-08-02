export type EffectiveMatchweekMatch = { id: string; originalMatchweek: number; scheduledMatchweek: number | null };
export function effectiveMatchweek(match: Pick<EffectiveMatchweekMatch, "originalMatchweek" | "scheduledMatchweek">) { return match.scheduledMatchweek ?? match.originalMatchweek; }
export function groupByEffectiveMatchweek<T extends EffectiveMatchweekMatch>(matches: T[]) { return matches.reduce((groups, match) => { const week = effectiveMatchweek(match); (groups.get(week) ?? groups.set(week, []).get(week)!).push(match); return groups; }, new Map<number, T[]>()); }
export function isRescheduledMatch(match: EffectiveMatchweekMatch) { return match.scheduledMatchweek !== null && match.scheduledMatchweek !== match.originalMatchweek; }
export function movedMatchweekCounts(matches: EffectiveMatchweekMatch[], week: number) { return { movedIn: matches.filter((match) => isRescheduledMatch(match) && effectiveMatchweek(match) === week).length, movedOut: matches.filter((match) => isRescheduledMatch(match) && match.originalMatchweek === week).length }; }
export function isSupplementalMatchweek(week: number, structuralMaximum: number) { return week > structuralMaximum; }
