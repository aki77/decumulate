import { test } from "node:test";
import assert from "node:assert/strict";
import {
  simulateMonteCarlo,
  computeSecurityScore,
  scoreLabel,
  type MonteCarloParams,
} from "../src/monte-carlo.ts";

const BASE_PARAMS: MonteCarloParams = {
  initialAmount: 1000000,
  monthlyContribution: 0,
  annualReturnRate: 5,
  expenseRatio: 0,
  inflationRate: 0,
  volatility: 15,
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
  defenseVolatility: 0,
  defensePriorityOnDrawdown: false,
  drawdownThresholdPercent: 10,
  rebalanceThresholdPoint: 5,
  skipRebalanceOnDrawdown: false,
};

// --- scoreLabel ---

test("scoreLabel - 95以上は非常に安心", () => {
  const result = scoreLabel(95);
  assert.strictEqual(result.label, "非常に安心");
  assert.strictEqual(result.className, "score-excellent");
});

test("scoreLabel - 100も非常に安心", () => {
  assert.strictEqual(scoreLabel(100).label, "非常に安心");
});

test("scoreLabel - 80は安心", () => {
  assert.strictEqual(scoreLabel(80).label, "安心");
});

test("scoreLabel - 94は安心", () => {
  assert.strictEqual(scoreLabel(94).label, "安心");
});

test("scoreLabel - 60はやや注意", () => {
  assert.strictEqual(scoreLabel(60).label, "やや注意");
});

test("scoreLabel - 79はやや注意", () => {
  assert.strictEqual(scoreLabel(79).label, "やや注意");
});

test("scoreLabel - 40は注意", () => {
  assert.strictEqual(scoreLabel(40).label, "注意");
});

test("scoreLabel - 59は注意", () => {
  assert.strictEqual(scoreLabel(59).label, "注意");
});

test("scoreLabel - 39は要見直し", () => {
  assert.strictEqual(scoreLabel(39).label, "要見直し");
});

test("scoreLabel - 0は要見直し", () => {
  assert.strictEqual(scoreLabel(0).label, "要見直し");
});

// --- computeSecurityScore ---

test("computeSecurityScore - 枯渇確率0・元本割れ0・残高あり は100点", () => {
  const score = computeSecurityScore({
    depletionProbability: 0,
    failureProbability: 0,
    medianFinal: 1000000,
  });
  assert.strictEqual(score, 100);
});

test("computeSecurityScore - 枯渇確率100%は0点", () => {
  const score = computeSecurityScore({
    depletionProbability: 1,
    failureProbability: 1,
    medianFinal: 0,
  });
  assert.strictEqual(score, 0);
});

test("computeSecurityScore - medianFinalがゼロの場合スコアは10以下", () => {
  const score = computeSecurityScore({
    depletionProbability: 0,
    failureProbability: 0,
    medianFinal: 0,
  });
  assert.ok(score <= 10);
});

test("computeSecurityScore - 枯渇確率が高いほどスコアが下がる", () => {
  const high = computeSecurityScore({
    depletionProbability: 0.1,
    failureProbability: 0,
    medianFinal: 1000000,
  });
  const low = computeSecurityScore({
    depletionProbability: 0.5,
    failureProbability: 0,
    medianFinal: 1000000,
  });
  assert.ok(high > low);
});

// --- simulateMonteCarlo ---

test("simulateMonteCarlo - シード固定で再現性あり", () => {
  const r1 = simulateMonteCarlo(BASE_PARAMS);
  const r2 = simulateMonteCarlo(BASE_PARAMS);
  assert.strictEqual(r1.finalP50, r2.finalP50);
  assert.strictEqual(r1.finalP10, r2.finalP10);
  assert.strictEqual(r1.finalP90, r2.finalP90);
});

test("simulateMonteCarlo - yearly の長さはtotalYears+1", () => {
  const params = { ...BASE_PARAMS, withdrawalStartYear: 5, withdrawalYears: 10 };
  const result = simulateMonteCarlo(params);
  // totalYears = max(0, 5+10) = 15
  assert.strictEqual(result.yearly.length, 16); // 0..15
});

test("simulateMonteCarlo - 年齢未指定の場合ageはnull", () => {
  const result = simulateMonteCarlo({ ...BASE_PARAMS, currentAge: null });
  assert.strictEqual(result.yearly[0]!.age, null);
});

test("simulateMonteCarlo - 年齢指定の場合ageが計算される", () => {
  const result = simulateMonteCarlo({ ...BASE_PARAMS, currentAge: 40 });
  assert.strictEqual(result.yearly[0]!.age, 40);
  assert.strictEqual(result.yearly[1]!.age, 41);
});

test("simulateMonteCarlo - p10 <= p50 <= p90 の関係を満たす", () => {
  const result = simulateMonteCarlo(BASE_PARAMS);
  for (const y of result.yearly) {
    assert.ok(y.p10 <= y.p50, `year ${y.year}: p10=${y.p10} > p50=${y.p50}`);
    assert.ok(y.p50 <= y.p90, `year ${y.year}: p50=${y.p50} > p90=${y.p90}`);
  }
});

test("simulateMonteCarlo - failureProbability は 0以上1以下", () => {
  const result = simulateMonteCarlo(BASE_PARAMS);
  assert.ok(result.failureProbability >= 0);
  assert.ok(result.failureProbability <= 1);
});

test("simulateMonteCarlo - depletionProbability は 0以上1以下", () => {
  const result = simulateMonteCarlo(BASE_PARAMS);
  assert.ok(result.depletionProbability >= 0);
  assert.ok(result.depletionProbability <= 1);
});

test("simulateMonteCarlo - 取り崩しゼロなら枯渇しない", () => {
  const params = {
    ...BASE_PARAMS,
    fixedMonthlyWithdrawal: 0,
    withdrawalYears: 10,
  };
  const result = simulateMonteCarlo(params);
  assert.strictEqual(result.depletionProbability, 0);
});

// --- simulateMonteCarlo: rate-risk モード ---

test("simulateMonteCarlo (rate-risk) - 単一バケットで完走しNaNが出ない", () => {
  const params: MonteCarloParams = {
    ...BASE_PARAMS,
    withdrawalMode: "rate-risk",
    withdrawalRate: 4,
    defenseRatio: 0,
  };
  const result = simulateMonteCarlo(params);
  for (const y of result.yearly) {
    assert.ok(Number.isFinite(y.p50), `year ${y.year}: p50 not finite`);
    assert.ok(Number.isFinite(y.medianYearlyWithdrawal));
    assert.ok(y.depletionRate >= 0 && y.depletionRate <= 1);
  }
});

test("simulateMonteCarlo (rate-risk) - 2バケットで完走しNaNが出ない", () => {
  const params: MonteCarloParams = {
    ...BASE_PARAMS,
    withdrawalMode: "rate-risk",
    withdrawalRate: 4,
    defenseRatio: 30,
    defenseAnnualReturnRate: 0.5,
    defenseVolatility: 1,
  };
  const result = simulateMonteCarlo(params);
  for (const y of result.yearly) {
    assert.ok(Number.isFinite(y.p50));
    assert.ok(Number.isFinite(y.medianYearlyWithdrawal));
  }
});

test("simulateMonteCarlo (rate-risk) - シード固定で再現性あり", () => {
  const params: MonteCarloParams = {
    ...BASE_PARAMS,
    withdrawalMode: "rate-risk",
    withdrawalRate: 4,
  };
  const r1 = simulateMonteCarlo(params);
  const r2 = simulateMonteCarlo(params);
  assert.strictEqual(r1.finalP50, r2.finalP50);
  assert.strictEqual(r1.depletionProbability, r2.depletionProbability);
});

// --- pivotMonthly ---

test("simulateMonteCarlo - pivotMonthly の長さは 12 × totalYears", () => {
  const params: MonteCarloParams = {
    ...BASE_PARAMS,
    contributionYears: 3,
    withdrawalStartYear: 3,
    withdrawalYears: 5,
  };
  const result = simulateMonteCarlo(params);
  assert.strictEqual(result.pivotMonthly.length, 12 * 8);
});

test("simulateMonteCarlo - pivotMonthly 最終 entry の total が finalP50 に十分近い", () => {
  const params: MonteCarloParams = {
    ...BASE_PARAMS,
    initialAmount: 1000000,
    monthlyContribution: 0,
    contributionYears: 0,
    withdrawalStartYear: 0,
    withdrawalYears: 5,
    fixedMonthlyWithdrawal: 1000,
    volatility: 15,
  };
  const result = simulateMonteCarlo(params);
  const last = result.pivotMonthly[result.pivotMonthly.length - 1]!;
  // p50 は q(0.5) で finalTotals.sort() 後の Math.floor(N*0.5) 番目の値。
  // 一方 pivot は |finalTotals[i] - finalP50| 最小の index なので、両者の差は finalP50 の数%以内に収まるはず。
  const ratio = Math.abs(last.total - result.finalP50) / Math.max(result.finalP50, 1);
  assert.ok(ratio < 0.01, `pivot最終total=${last.total} と finalP50=${result.finalP50} の差が大きすぎる`);
});

test("simulateMonteCarlo - 同パラメータでの 2 回呼び出しで pivotMonthly が完全一致", () => {
  const params: MonteCarloParams = { ...BASE_PARAMS, withdrawalYears: 5 };
  const r1 = simulateMonteCarlo(params);
  const r2 = simulateMonteCarlo(params);
  assert.strictEqual(r1.pivotMonthly.length, r2.pivotMonthly.length);
  for (let i = 0; i < r1.pivotMonthly.length; i++) {
    assert.strictEqual(r1.pivotMonthly[i]!.total, r2.pivotMonthly[i]!.total);
    assert.strictEqual(r1.pivotMonthly[i]!.monthlyGain, r2.pivotMonthly[i]!.monthlyGain);
  }
});
