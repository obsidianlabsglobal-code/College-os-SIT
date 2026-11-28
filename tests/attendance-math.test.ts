// covers: SA-008
import assert from "node:assert/strict";
import { test } from "node:test";
import { classesNeeded, classesSpare } from "../lib/attendance-math";

test("classes needed matches the founder contract and exact boundaries", () => {
  assert.equal(classesNeeded(130, 150, 90), 50); // Design Bible: 130/150 needs 50 consecutive classes for 90%
  assert.equal(classesNeeded(135, 150, 90), 0);
  assert.equal(classesNeeded(134, 150, 90), 10);
  assert.equal(classesNeeded(0, 0, 75), 0);
  assert.equal(classesNeeded(2, 4, 75), 4);
  assert.equal(classesNeeded(9, 10, 100), null);
  assert.equal(classesNeeded(10, 10, 100), 0);
  for (let present = 0; present <= 40; present++) for (let recorded = present; recorded <= 40; recorded++) for (const target of [50, 75, 85, 90, 99]) {
    const n = classesNeeded(present, recorded, target)!;
    assert.ok(100 * (present + n) >= target * (recorded + n));
    if (n > 0) assert.ok(100 * (present + n - 1) < target * (recorded + n - 1));
  }
  assert.throws(() => classesNeeded(5, 4, 75), RangeError);
  assert.throws(() => classesNeeded(1, 4, 0), RangeError);
});

test("spare classes keep the target and one more would breach it", () => {
  assert.equal(classesSpare(135, 150, 90), 0);
  assert.equal(classesSpare(140, 150, 90), 5);
  assert.equal(classesSpare(130, 150, 90), 0);
  const m = classesSpare(140, 150, 90);
  assert.ok(100 * 140 >= 90 * (150 + m) && 100 * 140 < 90 * (150 + m + 1));
});
