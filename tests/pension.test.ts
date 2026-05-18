import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PENSION_NET_RATE,
  pensionMultiplier,
  adjustedMonthlyPension,
} from "../src/pension.ts";

test("pensionMultiplier - 65歳は1.0", () => {
  assert.strictEqual(pensionMultiplier(65), 1.0);
});

test("pensionMultiplier - 60歳は繰上げ最大（-24%）", () => {
  const expected = 1 + (-60 * 0.004); // 0.76
  assert.strictEqual(pensionMultiplier(60), expected);
});

test("pensionMultiplier - 70歳は繰下げ（+42%）", () => {
  const expected = 1 + (60 * 0.007); // 1.42
  assert.strictEqual(pensionMultiplier(70), expected);
});

test("pensionMultiplier - 75歳が上限クランプ", () => {
  assert.strictEqual(pensionMultiplier(75), pensionMultiplier(76));
  assert.strictEqual(pensionMultiplier(75), pensionMultiplier(80));
});

test("pensionMultiplier - 60歳が下限クランプ", () => {
  assert.strictEqual(pensionMultiplier(60), pensionMultiplier(59));
  assert.strictEqual(pensionMultiplier(60), pensionMultiplier(55));
});

test("adjustedMonthlyPension - 65歳基準で PENSION_NET_RATE を適用", () => {
  const base = 150000;
  const expected = Math.round(base * PENSION_NET_RATE);
  assert.strictEqual(adjustedMonthlyPension(base, 65), expected);
});

test("adjustedMonthlyPension - 60歳繰上げは係数×手取り率を適用", () => {
  const base = 100000;
  const multiplier = pensionMultiplier(60);
  const expected = Math.round(base * multiplier * PENSION_NET_RATE);
  assert.strictEqual(adjustedMonthlyPension(base, 60), expected);
});

test("adjustedMonthlyPension - 70歳繰下げは係数×手取り率を適用", () => {
  const base = 100000;
  const multiplier = pensionMultiplier(70);
  const expected = Math.round(base * multiplier * PENSION_NET_RATE);
  assert.strictEqual(adjustedMonthlyPension(base, 70), expected);
});
