export const entryKinds = ["student", "faculty", "staff"] as const;
type EntryKind = (typeof entryKinds)[number];

export function onboardingPreviewEnabled() {
  return process.env.NEXUS_ONBOARDING_PREVIEW === "true";
}

export function onboardingEntryKind(value: unknown): EntryKind | null {
  return entryKinds.find(kind => kind === value) ?? null;
}
