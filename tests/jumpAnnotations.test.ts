import { test } from "node:test";
import assert from "node:assert/strict";
import {
  extractJumpYears,
  buildJumpPointConfig,
} from "../src/vue/composables/jumpAnnotations.ts";
import type { MonthlyProjection } from "../src/calculate.ts";

function makeMonth(year: number, jumpOccurred?: boolean): MonthlyProjection {
  return {
    year,
    month: 1,
    age: 40 + year,
    nisaTotal: 0,
    taxableRiskTotal: 0,
    riskTotal: 0,
    defenseTotal: 0,
    idecoTotal: 0,
    total: 0,
    monthlyWithdrawal: 0,
    monthlyWithdrawalNisa: 0,
    monthlyWithdrawalTaxableRisk: 0,
    monthlyWithdrawalDefense: 0,
    monthlyWithdrawalTaxTaxableRisk: 0,
    monthlyWithdrawalTaxDefense: 0,
    baseWithdrawal: 0,
    rateWithdrawalBasis: null,
    monthlyPension: 0,
    monthlyOtherIncome: 0,
    monthlyGainRisk: 0,
    monthlyGainNisa: 0,
    monthlyGainTaxableRisk: 0,
    monthlyGainDefense: 0,
    monthlyGainIdeco: 0,
    monthlyGain: 0,
    monthlyRate: 0,
    monthlyRateRisk: 0,
    rebalanceInfo: null,
    nisaTransferInfo: null,
    idecoLumpSumInfo: null,
    idecoPensionInfo: null,
    jumpOccurred,
  };
}

test("extractJumpYears: 同じ年の複数月ジャンプが1年に集約される", () => {
  const monthly = [
    makeMonth(2, true),
    makeMonth(2, true),
    makeMonth(5, true),
    makeMonth(5, false),
  ];
  const years = extractJumpYears(monthly);
  assert.deepStrictEqual(years, [2, 5]);
});

test("extractJumpYears: jumpOccurred が undefined/false の月は無視される", () => {
  const monthly = [makeMonth(1), makeMonth(2, false), makeMonth(3, true)];
  const years = extractJumpYears(monthly);
  assert.deepStrictEqual(years, [3]);
});

test("extractJumpYears: 空入力で空配列を返す", () => {
  assert.deepStrictEqual(extractJumpYears([]), []);
});

test("buildJumpPointConfig: ジャンプ年のインデックスにのみ radius と color が設定される", () => {
  const cfg = buildJumpPointConfig([2, 5], 8);
  assert.strictEqual(cfg.pointRadius[2], 6);
  assert.strictEqual(cfg.pointRadius[5], 6);
  assert.strictEqual(cfg.pointRadius[0], 0);
  assert.strictEqual(cfg.pointRadius[7], 0);
  assert.strictEqual(cfg.pointBackgroundColor[2], "rgba(127, 29, 29, 0.95)");
  assert.strictEqual(cfg.pointBackgroundColor[0], "transparent");
  assert.strictEqual(cfg.pointStyle, "triangle");
  assert.strictEqual(cfg.pointRotation[2], 180);
  assert.strictEqual(cfg.pointRotation[5], 180);
  assert.strictEqual(cfg.pointRotation[0], 0);
});

test("buildJumpPointConfig: yearlyLength を超える year は無視される", () => {
  const cfg = buildJumpPointConfig([3, 10], 5);
  assert.strictEqual(cfg.pointRadius.length, 5);
  assert.strictEqual(cfg.pointRadius[3], 6);
  assert.strictEqual(cfg.pointRadius[4], 0);
});

test("buildJumpPointConfig: options で radius と color を上書きできる", () => {
  const cfg = buildJumpPointConfig([1], 3, { radius: 10, color: "red" });
  assert.strictEqual(cfg.pointRadius[1], 10);
  assert.strictEqual(cfg.pointBackgroundColor[1], "red");
});
