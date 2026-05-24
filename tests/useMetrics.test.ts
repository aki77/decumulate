import { test } from "node:test";
import assert from "node:assert/strict";
import { computeMetrics, PLAN_RATING_THRESHOLDS } from "../src/vue/composables/useMetrics.ts";
import type { CalculateParams, YearlyProjection } from "../src/calculate.ts";

const dummyYear: YearlyProjection = {
  year: 1,
  age: 65,
  principal: 0,
  interest: 0,
  tax: 0,
  total: 50_000_000,
  yearlyWithdrawal: 0,
  yearlyPension: 0,
  yearlyOtherIncome: 0,
  nisaTotal: 50_000_000,
  taxableRiskTotal: 0,
  defenseTotal: 0,
  idecoTotal: 0,
  nisaLifetimeUsed: 0,
  yearlyIdecoLumpSum: 0,
  yearlyIdecoPension: 0,
};

const dummyParams: CalculateParams = {
  initialNisa: 0,
  initialNisaGain: 0,
  initialTaxableRisk: 0,
  initialTaxableRiskGain: 0,
  initialDefense: 0,
  initialDefenseGain: 0,
  monthlyContribution: 0,
  annualReturnRate: 0,
  expenseRatio: 0,
  inflationRate: 0,
  contributionYears: 0,
  withdrawalStartYear: 0,
  withdrawalYears: 1,
  withdrawalMode: "amount",
  fixedMonthlyWithdrawal: 0,
  withdrawalRate: 4,
  guardrailUpperPercent: 0,
  guardrailLowerPercent: 0,
  guardrailAdjustmentPercent: 0,
  withdrawalLimitSchedule: [{ untilAge: null, floor: null, ceiling: null }],
  inflationAdjustedWithdrawal: false,
  basePension: 0,
  pensionStartAge: 65,
  currentAge: 64,
  otherIncomes: [],
  defenseAnnualReturnRate: 0,
  defenseVolatility: 0,
  targetDefenseRatioStart: 0,
  targetDefenseRatioEnd: 0,
  glidePathEndAge: 65,
  defensePriorityOnDrawdown: false,
  drawdownThresholdPercent: 10,
  rebalanceThresholdPoint: 5,
  skipRebalanceOnDrawdown: false,
  isCoupled: false,
  nisaTransferEnabled: false,
  nisaInitialLifetimeUsed: 0,
  idecoEnabled: false,
  ideco: {
    initialIdeco: 0,
    initialIdecoGain: 0,
    idecoMonthlyContribution: 0,
    idecoContributionYears: 0,
    idecoReceiveStartAge: 65,
    idecoLumpSumRatio: 1,
    idecoPensionYears: 10,
  },
};

test("planRating - 確率未指定なら unknown", () => {
  const m = computeMetrics([dummyYear], dummyParams, 0, undefined, undefined);
  assert.strictEqual(m.planRating, "unknown");
  assert.strictEqual(m.finalAchievementProbability, undefined);
});

test("planRating - 確率 95% 以上は conservative", () => {
  const m = computeMetrics([dummyYear], dummyParams, 0, undefined, 0.95);
  assert.strictEqual(m.planRating, "conservative");
});

test("planRating - 確率 0.949 は realistic（境界下）", () => {
  const m = computeMetrics([dummyYear], dummyParams, 0, undefined, 0.949);
  assert.strictEqual(m.planRating, "realistic");
});

test("planRating - 確率 80% 上端は realistic（境界含む）", () => {
  const m = computeMetrics([dummyYear], dummyParams, 0, undefined, 0.8);
  assert.strictEqual(m.planRating, "realistic");
});

test("planRating - 確率 0.799 は marginal", () => {
  const m = computeMetrics([dummyYear], dummyParams, 0, undefined, 0.799);
  assert.strictEqual(m.planRating, "marginal");
});

test("planRating - 確率 50% 上端は marginal（境界含む）", () => {
  const m = computeMetrics([dummyYear], dummyParams, 0, undefined, 0.5);
  assert.strictEqual(m.planRating, "marginal");
});

test("planRating - 確率 0.499 は risky", () => {
  const m = computeMetrics([dummyYear], dummyParams, 0, undefined, 0.499);
  assert.strictEqual(m.planRating, "risky");
});

test("planRating - 確率 0 は risky", () => {
  const m = computeMetrics([dummyYear], dummyParams, 0, undefined, 0);
  assert.strictEqual(m.planRating, "risky");
});

test("PLAN_RATING_THRESHOLDS - 境界値が降順", () => {
  assert.ok(PLAN_RATING_THRESHOLDS.conservative > PLAN_RATING_THRESHOLDS.realistic);
  assert.ok(PLAN_RATING_THRESHOLDS.realistic > PLAN_RATING_THRESHOLDS.marginal);
  assert.ok(PLAN_RATING_THRESHOLDS.marginal > 0);
});

test("finalDelta - p50 残高 - 目標残高", () => {
  const m = computeMetrics([dummyYear], dummyParams, 30_000_000, 40_000_000, 0.85);
  assert.strictEqual(m.finalDelta, 10_000_000);
  assert.strictEqual(m.planRating, "realistic");
});
