export function isReleaseRevision(value: unknown): value is string {
  return typeof value === "string" && value.length === 40 && /^[0-9a-f]+$/.test(value);
}

export function assertReleaseHealth(status: number, payload: unknown, expected?: string): void {
  const health = payload as { status?: unknown; revision?: unknown } | null;
  if (status !== 200 || health?.status !== "ok") throw new Error("The release health check failed.");
  if (expected !== undefined && (!isReleaseRevision(expected) || health.revision !== expected)) {
    throw new Error("The staging alias is not serving the expected NEXUS revision.");
  }
}
