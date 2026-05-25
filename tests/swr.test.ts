// SWR は MC の確率指標を逆算するため、決定論版に寄せる CLAUDE.md 方針の例外。
// findSafeWithdrawalRate / simulateMonteCarlo に SEED を明示渡しして再現性を担保する。
import { test } from "node:test";
import assert from "node:assert/strict";
import { findSafeWithdrawalRate } from "../src/swr.ts";
import { simulateMonteCarlo, SEED, type MonteCarloParams } from "../src/monte-carlo.ts";

const BASE_PARAMS: MonteCarloParams = {
  initialNisa: 30_000_000,
  initialNisaGain: 0,
  initialTaxableRisk: 0,
  initialTaxableRiskGain: 0,
  initialDefense: 0,
  initialDefenseGain: 0,
  monthlyContribution: 0,
  annualReturnRate: 5,
  expenseRatio: 0,
  inflationRate: 0,
  volatility: 15,
  contributionYears: 0,
  withdrawalStartYear: 0,
  withdrawalYears: 30,
  withdrawalMode: "rate",
  fixedMonthlyWithdrawal: 0,
  withdrawalRate: 4,
  withdrawalLimitSchedule: [{ untilAge: null, floor: null, ceiling: null }],
  inflationAdjustedWithdrawal: false,
  basePension: 0,
  pensionStartAge: 65,
  currentAge: 40,
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
  enableJumpDiffusion: false,
  lifeEvents: [],
};

test("findSafeWithdrawalRate - 典型 params で found を返し、採用 rate での再 MC が 95% 成功", () => {
  const result = findSafeWithdrawalRate(BASE_PARAMS, { seed: SEED });
  assert.strictEqual(result.boundary, "found");
  assert.ok(result.rate >= 0.5 && result.rate <= 10.0);
  // 採用された rate で再度 MC を回しても depletionProbability ≤ 5%
  const verify = simulateMonteCarlo({ ...BASE_PARAMS, withdrawalRate: result.rate }, SEED);
  assert.ok(
    verify.depletionProbability <= 0.05,
    `depletionProbability=${verify.depletionProbability} should be ≤ 0.05`,
  );
});

test("findSafeWithdrawalRate - 達成不能（巨額の長期取り崩し）で below-min を返す", () => {
  const harsh: MonteCarloParams = {
    ...BASE_PARAMS,
    initialNisa: 1000,
    withdrawalYears: 50,
    withdrawalLimitSchedule: [{ untilAge: null, floor: 100_000, ceiling: null }],
  };
  const result = findSafeWithdrawalRate(harsh, { seed: SEED });
  assert.strictEqual(result.boundary, "below-min");
  assert.strictEqual(result.rate, 0.5);
});

test("findSafeWithdrawalRate - 過剰に安全（短期 + 巨額元本）で above-max を返す", () => {
  const safe: MonteCarloParams = {
    ...BASE_PARAMS,
    initialNisa: 1_000_000_000,
    withdrawalYears: 1,
  };
  const result = findSafeWithdrawalRate(safe, { seed: SEED });
  assert.strictEqual(result.boundary, "above-max");
  assert.strictEqual(result.rate, 10.0);
});

test("findSafeWithdrawalRate - 再現性: 同じ params で同じ rate を返す", () => {
  const a = findSafeWithdrawalRate(BASE_PARAMS, { seed: SEED });
  const b = findSafeWithdrawalRate(BASE_PARAMS, { seed: SEED });
  assert.strictEqual(a.rate, b.rate);
  assert.strictEqual(a.boundary, b.boundary);
});

test("findSafeWithdrawalRate - targetSuccessRate を緩めると同等以上の rate を返す", () => {
  const strict = findSafeWithdrawalRate(BASE_PARAMS, { targetSuccessRate: 0.95, seed: SEED });
  const loose = findSafeWithdrawalRate(BASE_PARAMS, { targetSuccessRate: 0.8, seed: SEED });
  assert.ok(
    loose.rate >= strict.rate,
    `loose(${loose.rate}) should be ≥ strict(${strict.rate})`,
  );
});
