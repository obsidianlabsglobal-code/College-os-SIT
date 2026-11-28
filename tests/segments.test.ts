import { test } from "node:test";
import assert from "node:assert/strict";
import { segmentWidths } from "../lib/segments";

test("segment widths are exact shares of the total", () => {
  assert.deepEqual(segmentWidths([{ label: "a", value: 1, tone: 1 }, { label: "b", value: 3, tone: 2 }], 8), [12.5, 37.5]);
  assert.deepEqual(segmentWidths([{ label: "a", value: 0, tone: 1 }], 0), [0]);
});

test("segment widths reject impossible data", () => {
  assert.throws(() => segmentWidths([{ label: "a", value: 5, tone: 1 }], 4), RangeError);
  assert.throws(() => segmentWidths([{ label: "a", value: -1, tone: 1 }], 4), RangeError);
  assert.throws(() => segmentWidths([{ label: "a", value: 1.5, tone: 1 }], 4), RangeError);
  assert.throws(() => segmentWidths([], -1), RangeError);
});
