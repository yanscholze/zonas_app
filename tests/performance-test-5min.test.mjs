import assert from "node:assert/strict";
import test from "node:test";
import { calculateFiveMinuteTest, FIVE_MINUTE_TEST_EXPLANATION } from "../shared/five-minute-test.ts";

test("5-minute test reproduces the 800 m example without intermediate rounding", () => {
  const result = calculateFiveMinuteTest({
    distanceMeters: 800,
    completed: true,
    executionType: "continuous",
    effortClassification: "maximum_sustainable",
  });

  assert.equal(result.meanSpeedKmh, 9.6);
  assert.equal(result.meanPaceSecondsRaw, 375);
  assert.equal(result.meanPaceSeconds, 375);
  assert.equal(result.meanPaceLabel, "6:15/km");
  assert.equal(result.estimatedVamKmh, 9.6);
  assert.match(FIVE_MINUTE_TEST_EXPLANATION, /estimativa de campo, não uma medida direta/);
});

test("walking, non-maximum effort, and incomplete tests never classify as VAM", () => {
  const walking = calculateFiveMinuteTest({ distanceMeters: 800, completed: true, executionType: "run_walk", effortClassification: "maximum_sustainable" });
  const submaximal = calculateFiveMinuteTest({ distanceMeters: 800, completed: true, executionType: "continuous", effortClassification: "submaximal" });
  const incomplete = calculateFiveMinuteTest({ distanceMeters: 800, completed: false, executionType: "continuous", effortClassification: "maximum_sustainable" });

  assert.equal(walking.estimatedVamKmh, null);
  assert.equal(submaximal.estimatedVamKmh, null);
  assert.equal(incomplete.meanSpeedKmh, null);
  assert.equal(incomplete.meanPaceSeconds, null);
  assert.equal(incomplete.estimatedVamKmh, null);
});

test("empty, zero, negative, and non-finite distances are not calculated", () => {
  for (const distanceMeters of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(calculateFiveMinuteTest({ distanceMeters, completed: true, executionType: "continuous", effortClassification: "maximum_sustainable" }), null);
  }
});
