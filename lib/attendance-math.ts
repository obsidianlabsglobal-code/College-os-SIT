// Deterministic attendance arithmetic shared by every surface (no model, no floating rounding in decisions).

// Consecutive future classes a student must attend to reach `target` percent:
// smallest n >= 0 with 100*(present+n) >= target*(recorded+n). null when the target can never be met.
export function classesNeeded(present: number, recorded: number, target: number) {
  if (!Number.isInteger(present) || !Number.isInteger(recorded) || present < 0 || present > recorded) throw new RangeError("Invalid attendance counts.");
  if (!(target > 0 && target <= 100)) throw new RangeError("Target must be in (0, 100].");
  const deficit = target * recorded - 100 * present;
  if (deficit <= 0) return 0;
  if (target === 100) return null;
  return Math.ceil(deficit / (100 - target));
}

// Classes that can still be missed while staying at or above `target`: largest m with 100*present >= target*(recorded+m).
export function classesSpare(present: number, recorded: number, target: number) {
  if (classesNeeded(present, recorded, target) !== 0) return 0;
  return Math.floor((100 * present - target * recorded) / target);
}
