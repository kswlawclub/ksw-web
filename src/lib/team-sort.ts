const teamNameCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

export type NamedTeam = {
  id: string;
  name: string;
};

export function compareTeamsByName<T extends NamedTeam>(left: T, right: T) {
  return teamNameCollator.compare(left.name, right.name) || left.id.localeCompare(right.id);
}

export function sortTeamsByName<T extends NamedTeam>(teams: T[]) {
  return [...teams].sort(compareTeamsByName);
}
