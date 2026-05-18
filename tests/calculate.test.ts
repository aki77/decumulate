import { test } from "node:test";
import assert from "node:assert/strict";
import {
  TAX_RATE,
  withdrawFromBucket,
  splitProportional,
  needsRebalance,
  rebalanceBuckets,
  calculateCompound,
  type CalculateParams,
} from "../src/calculate.ts";

const BASE_PARAMS: CalculateParams = {
  initialAmount: 1000000,
  monthlyContribution: 0,
  annualReturnRate: 5,
  expenseRatio: 0,
  inflationRate: 0,
  contributionYears: 0,
  withdrawalStartYear: 0,
  withdrawalYears: 10,
  withdrawalMode: "amount",
  fixedMonthlyWithdrawal: 5000,
  withdrawalRate: 4,
  inflationAdjustedWithdrawal: false,
  taxFree: true,
  basePension: 0,
  pensionStartAge: 65,
  currentAge: null,
  monthlyOtherIncome: 0,
  defenseRatio: 0,
  defenseAnnualReturnRate: 0,
  rebalanceThresholdPoint: 5,
};

// --- withdrawFromBucket ---

test("withdrawFromBucket - 残高ゼロは変化なし", () => {
  const [t, p] = withdrawFromBucket(0, 0, 1000, TAX_RATE);
  assert.strictEqual(t, 0);
  assert.strictEqual(p, 0);
});

test("withdrawFromBucket - 取り崩し額ゼロは変化なし", () => {
  const [t, p] = withdrawFromBucket(10000, 8000, 0, TAX_RATE);
  assert.strictEqual(t, 10000);
  assert.strictEqual(p, 8000);
});

test("withdrawFromBucket - 含み益なし（total==principal）は税ゼロ", () => {
  const [t, p] = withdrawFromBucket(10000, 10000, 1000, TAX_RATE);
  assert.strictEqual(t, 9000);
  assert.strictEqual(p, 9000);
});

test("withdrawFromBucket - 含み益ありの場合は税を控除", () => {
  // total=20000, principal=10000 → gainRatio=0.5
  // tax = 1000 * 0.5 * TAX_RATE
  const amount = 1000;
  const [t] = withdrawFromBucket(20000, 10000, amount, TAX_RATE);
  const expectedTax = amount * 0.5 * TAX_RATE;
  assert.ok(Math.abs(t - (20000 - amount - expectedTax)) < 0.001);
});

test("withdrawFromBucket - 取り崩し額が残高以上の場合は0になる", () => {
  const [t, p] = withdrawFromBucket(1000, 1000, 2000, TAX_RATE);
  assert.strictEqual(t, 0);
  assert.ok(p >= 0);
});

// --- splitProportional ---

test("splitProportional - 均等配分", () => {
  const [r, d] = splitProportional(1000, 1000, 1000);
  assert.strictEqual(r, 500);
  assert.strictEqual(d, 500);
});

test("splitProportional - リスク比率が高い場合", () => {
  const [r, d] = splitProportional(1000, 3000, 1000);
  assert.ok(Math.abs(r - 750) < 0.001);
  assert.ok(Math.abs(d - 250) < 0.001);
});

test("splitProportional - 片方が枯渇した場合は他方で補う", () => {
  // amount=1000, riskTotal=300 → リスク側不足分700を防衛側で補う
  const [r, d] = splitProportional(1000, 300, 700);
  assert.strictEqual(r, 300);
  assert.strictEqual(d, 700);
});

test("splitProportional - 金額ゼロは[0,0]", () => {
  const [r, d] = splitProportional(0, 1000, 1000);
  assert.strictEqual(r, 0);
  assert.strictEqual(d, 0);
});

test("splitProportional - 残高合計ゼロは[0,0]", () => {
  const [r, d] = splitProportional(100, 0, 0);
  assert.strictEqual(r, 0);
  assert.strictEqual(d, 0);
});

// --- needsRebalance ---

test("needsRebalance - 乖離なし（目標比率ちょうど）", () => {
  assert.strictEqual(needsRebalance(700, 300, 0.3, 5), false);
});

test("needsRebalance - 乖離が閾値以下", () => {
  // riskTotal=750, defenseTotal=250, target=0.3 → current=0.25 → 乖離5pt → 閾値ちょうどなのでfalse
  assert.strictEqual(needsRebalance(750, 250, 0.3, 5), false);
});

test("needsRebalance - 乖離が閾値超過", () => {
  // riskTotal=800, defenseTotal=200, target=0.3 → current=0.2 → 乖離10pt > 5
  assert.strictEqual(needsRebalance(800, 200, 0.3, 5), true);
});

test("needsRebalance - 残高合計ゼロはfalse", () => {
  assert.strictEqual(needsRebalance(0, 0, 0.3, 5), false);
});

// --- rebalanceBuckets ---

test("rebalanceBuckets - 残高ゼロは変化なし", () => {
  const [rt, rp, dt, dp] = rebalanceBuckets(0, 0, 0, 0, 0.3, TAX_RATE);
  assert.strictEqual(rt, 0);
  assert.strictEqual(rp, 0);
  assert.strictEqual(dt, 0);
  assert.strictEqual(dp, 0);
});

test("rebalanceBuckets - 目標比率ちょうどは変化なし", () => {
  const [rt, rp, dt, dp] = rebalanceBuckets(700, 700, 300, 300, 0.3, TAX_RATE);
  assert.strictEqual(rt, 700);
  assert.strictEqual(rp, 700);
  assert.strictEqual(dt, 300);
  assert.strictEqual(dp, 300);
});

test("rebalanceBuckets - リスク売却ケース（防衛が目標より少ない）", () => {
  // total=1000, defenseRatio=0.3, currentDefense=200 → 100分リスクを売って防衛に回す
  const [rt, , dt] = rebalanceBuckets(800, 800, 200, 200, 0.3, 0);
  assert.ok(rt < 800); // リスク減
  assert.ok(dt > 200); // 防衛増
});

test("rebalanceBuckets - 防衛売却ケース（防衛が目標より多い）", () => {
  const [rt, , dt] = rebalanceBuckets(500, 500, 500, 500, 0.3, 0);
  assert.ok(rt > 500); // リスク増
  assert.ok(dt < 500); // 防衛減
});

// --- calculateCompound ---

test("calculateCompound - year=0は初期値", () => {
  const result = calculateCompound(BASE_PARAMS);
  assert.strictEqual(result[0]!.year, 0);
  assert.strictEqual(result[0]!.yearlyWithdrawal, 0);
  assert.strictEqual(result[0]!.yearlyPension, 0);
  assert.strictEqual(result[0]!.total, 1000000);
});

test("calculateCompound - 配列長はtotalYears+1", () => {
  const params = { ...BASE_PARAMS, withdrawalStartYear: 5, withdrawalYears: 10 };
  const result = calculateCompound(params);
  assert.strictEqual(result.length, 16); // 0..15
});

test("calculateCompound - 非課税口座ではtax=0", () => {
  const params = { ...BASE_PARAMS, taxFree: true };
  const result = calculateCompound(params);
  for (const row of result) {
    assert.strictEqual(row.tax, 0);
  }
});

test("calculateCompound - 利回り0で元本が積立通りに増える", () => {
  const params: CalculateParams = {
    ...BASE_PARAMS,
    initialAmount: 100000,
    monthlyContribution: 10000,
    annualReturnRate: 0,
    expenseRatio: 0,
    contributionYears: 1,
    withdrawalStartYear: 1,
    withdrawalYears: 0,
    taxFree: true,
  };
  const result = calculateCompound(params);
  const year1 = result[1]!;
  // 100000 + 10000*12 = 220000
  assert.strictEqual(year1.total, 220000);
});

test("calculateCompound - 年齢がnullの場合ageはnull", () => {
  const params = { ...BASE_PARAMS, currentAge: null };
  const result = calculateCompound(params);
  assert.strictEqual(result[0]!.age, null);
  assert.strictEqual(result[1]!.age, null);
});

test("calculateCompound - 年齢が指定された場合ageが計算される", () => {
  const params = { ...BASE_PARAMS, currentAge: 40 };
  const result = calculateCompound(params);
  assert.strictEqual(result[0]!.age, 40);
  assert.strictEqual(result[1]!.age, 41);
});

// --- calculateCompound: rate-risk モード ---

test("calculateCompound (rate-risk) - 初年度は年初リスク資産×率の概算で取り崩される", () => {
  // 利回り0・防衛なし・無税で、1,000,000 × 4% = 40,000 ぴったりが取れる
  const params: CalculateParams = {
    ...BASE_PARAMS,
    initialAmount: 1000000,
    annualReturnRate: 0,
    withdrawalStartYear: 1,
    withdrawalYears: 5,
    withdrawalMode: "rate-risk",
    withdrawalRate: 4,
  };
  const result = calculateCompound(params);
  assert.ok(Math.abs(result[2]!.yearlyWithdrawal - 40000) < 1);
});

test("calculateCompound (rate-risk) - 資産が減れば翌年の引出額も減る", () => {
  // 利回り0で毎年資産が減るので、引出額も逓減するはず
  const params: CalculateParams = {
    ...BASE_PARAMS,
    initialAmount: 1000000,
    monthlyContribution: 0,
    annualReturnRate: 0,
    expenseRatio: 0,
    inflationRate: 0,
    contributionYears: 0,
    withdrawalStartYear: 0,
    withdrawalYears: 5,
    withdrawalMode: "rate-risk",
    withdrawalRate: 10,
    taxFree: true,
  };
  const result = calculateCompound(params);
  // 取り崩し初年度（year=1）よりも、その翌年（year=2）の方が引出額が小さい
  assert.ok(result[2]!.yearlyWithdrawal < result[1]!.yearlyWithdrawal);
});

test("calculateCompound (rate-risk) - Trinity モードと違ってインフレ調整されない", () => {
  // インフレ率 > 0 でも、rate-risk モードはインフレ調整しない。
  // Trinity モードでは初年度月額が固定でインフレで増えるが、
  // rate-risk モードでは毎年再評価で実残高に追従する（インフレで自動的に増えるわけではない）。
  const base: CalculateParams = {
    ...BASE_PARAMS,
    initialAmount: 10000000,
    monthlyContribution: 0,
    annualReturnRate: 0,
    expenseRatio: 0,
    inflationRate: 3,
    contributionYears: 0,
    withdrawalStartYear: 0,
    withdrawalYears: 5,
    withdrawalRate: 4,
    taxFree: true,
  };
  const trinity = calculateCompound({ ...base, withdrawalMode: "rate" });
  const riskBased = calculateCompound({ ...base, withdrawalMode: "rate-risk" });
  // 初年度はほぼ同じ（基準が同じ＝総資産=リスク資産）はず
  assert.ok(Math.abs(trinity[1]!.yearlyWithdrawal - riskBased[1]!.yearlyWithdrawal) < 1000);
  // 2年目: Trinity はインフレ調整で増、rate-risk は減った資産で再評価して減
  assert.ok(trinity[2]!.yearlyWithdrawal > riskBased[2]!.yearlyWithdrawal);
});

test("calculateCompound (rate-risk) - 防衛資産は基準から除外される", () => {
  // 同じ総資産でも、防衛比率が高いほどリスク資産が少なくなり、引出額が小さくなる
  const base: CalculateParams = {
    ...BASE_PARAMS,
    initialAmount: 10000000,
    monthlyContribution: 0,
    annualReturnRate: 0,
    expenseRatio: 0,
    defenseAnnualReturnRate: 0,
    inflationRate: 0,
    contributionYears: 0,
    withdrawalStartYear: 0,
    withdrawalYears: 1,
    withdrawalMode: "rate-risk",
    withdrawalRate: 4,
    taxFree: true,
  };
  const noDefense = calculateCompound({ ...base, defenseRatio: 0 });
  const halfDefense = calculateCompound({ ...base, defenseRatio: 50 });
  // 防衛50%だとリスク資産は半分 → 引出額もおよそ半分
  assert.ok(noDefense[1]!.yearlyWithdrawal > halfDefense[1]!.yearlyWithdrawal);
  assert.ok(Math.abs(halfDefense[1]!.yearlyWithdrawal * 2 - noDefense[1]!.yearlyWithdrawal) < 1000);
});

test("calculateCompound (rate-risk) - defenseRatio=0 でも正常動作", () => {
  const params: CalculateParams = {
    ...BASE_PARAMS,
    initialAmount: 1000000,
    monthlyContribution: 0,
    contributionYears: 0,
    withdrawalStartYear: 0,
    withdrawalYears: 3,
    withdrawalMode: "rate-risk",
    withdrawalRate: 4,
    defenseRatio: 0,
    taxFree: true,
  };
  const result = calculateCompound(params);
  assert.strictEqual(result.length, 4);
  for (const row of result) {
    assert.ok(Number.isFinite(row.total));
    assert.ok(Number.isFinite(row.yearlyWithdrawal));
  }
});
