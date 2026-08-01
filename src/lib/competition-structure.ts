export type CompetitionStructureEntryMode = "bye" | "preliminary";

export type CompetitionStructureInput = {
  entrantCount: number;
  entryMode?: CompetitionStructureEntryMode;
  groupCount?: number | null;
  groupStageEnabled: boolean;
  qualifiersPerGroup?: number | null;
  totalParticipantCount?: number | null;
};

export type CompetitionStructurePreview = {
  bracketCapacity: number;
  byeNeeded: number;
  entryMode: CompetitionStructureEntryMode;
  groupCount: number | null;
  groupStageEnabled: boolean;
  knockoutEntrants: number;
  preliminaryNeeded: number;
  qualifiedTeams: number;
  roundCount: number;
  totalMatches: number;
};

const supportedCapacities = [2, 4, 8, 16, 32, 64] as const;

function assertWholeNumber(value: number, label: string) {
  if (!Number.isInteger(value)) {
    throw new Error(`${label} must be a whole number.`);
  }
}

function nextPowerCapacity(value: number) {
  return supportedCapacities.find((capacity) => capacity >= value) ?? 64;
}

function previousPowerCapacity(value: number) {
  return [...supportedCapacities].reverse().find((capacity) => capacity <= value) ?? 2;
}

export function calculateCompetitionStructure(input: CompetitionStructureInput): CompetitionStructurePreview {
  const entrantCount = Number(input.entrantCount);
  const groupCount = input.groupCount == null ? null : Number(input.groupCount);
  const qualifiersPerGroup = input.qualifiersPerGroup == null ? null : Number(input.qualifiersPerGroup);
  const totalParticipantCount = input.totalParticipantCount == null ? entrantCount : Number(input.totalParticipantCount);
  const entryMode = input.entryMode ?? "bye";

  assertWholeNumber(entrantCount, "Entrant count");
  if (entrantCount < 2 || entrantCount > 64) {
    throw new Error("Knockout entrants must be between 2 and 64.");
  }

  assertWholeNumber(totalParticipantCount, "Total participants");
  if (totalParticipantCount < 2 || totalParticipantCount > 64) {
    throw new Error("Total participants must be between 2 and 64.");
  }

  if (groupCount != null) {
    assertWholeNumber(groupCount, "Group count");
    if (groupCount < 1 || groupCount > 64) throw new Error("Group count must be between 1 and 64.");
  }

  if (qualifiersPerGroup != null) {
    assertWholeNumber(qualifiersPerGroup, "Qualifiers per group");
    if (qualifiersPerGroup < 0 || qualifiersPerGroup > 64) {
      throw new Error("Qualifiers per group must be between 0 and 64.");
    }
  }

  if (entryMode !== "bye" && entryMode !== "preliminary") {
    throw new Error("Entry mode is not supported.");
  }

  const qualifiedTeams = entrantCount;

  if (qualifiedTeams < 2 || qualifiedTeams > 64) {
    throw new Error("Qualified teams must be between 2 and 64.");
  }

  const bracketCapacity = entryMode === "preliminary"
    ? previousPowerCapacity(qualifiedTeams)
    : nextPowerCapacity(qualifiedTeams);
  const preliminaryNeeded = entryMode === "preliminary" ? Math.max(qualifiedTeams - bracketCapacity, 0) : 0;
  const byeNeeded = entryMode === "bye" ? Math.max(bracketCapacity - qualifiedTeams, 0) : 0;
  const roundCount = Math.log2(bracketCapacity);
  const knockoutEntrants = entryMode === "preliminary" ? bracketCapacity : qualifiedTeams;
  const groupStageMatches = input.groupStageEnabled && groupCount && groupCount > 0
    ? Array.from({ length: groupCount }, (_, index) => {
        const baseSize = Math.floor(totalParticipantCount / groupCount);
        const extra = index < totalParticipantCount % groupCount ? 1 : 0;
        const groupSize = baseSize + extra;
        return (groupSize * (groupSize - 1)) / 2;
      }).reduce((sum, matches) => sum + matches, 0)
    : 0;
  const totalMatches = groupStageMatches + (bracketCapacity - 1) + preliminaryNeeded;

  return {
    bracketCapacity,
    byeNeeded,
    entryMode,
    groupCount,
    groupStageEnabled: input.groupStageEnabled,
    knockoutEntrants,
    preliminaryNeeded,
    qualifiedTeams,
    roundCount,
    totalMatches,
  };
}
