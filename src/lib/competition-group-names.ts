function normalizedGroupName(name: string) {
  return name.trim().toUpperCase();
}

export function competitionGroupNameFromIndex(index: number) {
  if (!Number.isInteger(index) || index < 0) throw new Error("Group index must be a non-negative integer.");

  let value = index + 1;
  let name = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    value = Math.floor((value - 1) / 26);
  }
  return name;
}

export function competitionGroupLabel(name: string) {
  return `Group ${normalizedGroupName(name)}`;
}

export function nextAvailableCompetitionGroupNames(existingNames: string[], count: number) {
  const existing = new Set(existingNames.map(normalizedGroupName));
  const names: string[] = [];
  let index = 0;

  while (names.length < count) {
    const name = competitionGroupNameFromIndex(index);
    if (!existing.has(name)) names.push(name);
    index += 1;
  }

  return names;
}
