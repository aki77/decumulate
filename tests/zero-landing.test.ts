// 決定論版 calculateCompound を二分探索するため SEED 不要、毎回同じ結果。
// Phase 2: Go-Go 期月額の二分探索 + 床（No-Go 月額）+ Slow-Go 係数 + 境界年齢を反映。
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  findZeroLandingMonthly,
  type ZeroLandingCurve,
} from "../src/zero-landing.ts";
import { calculateCompound, type CalculateParams } from "../src/calculate.ts";

const BASE_PARAMS: CalculateParams = {
  initialNisa: 50_000_000,
  initialNisaGain: 0,
  initialTaxableRisk: 0,
  initialTaxableRiskGain: 0,
  initialDefense: 0,
  initialDefenseGain: 0,
  monthlyContribution: 0,
  annualReturnRate: 5,
  expenseRatio: 0,
  inflationRate: 0,
  contributionYears: 0,
  withdrawalStartYear: 0,
  withdrawalYears: 30,
  withdrawalMode: "amount",
  fixedMonthlyWithdrawal: 0,
  withdrawalRate: 0,
  guardrailUpperPercent: 20,
  guardrailLowerPercent: 20,
  guardrailAdjustmentPercent: 10,
  withdrawalLimitSchedule: [{ untilAge: null, floor: null, ceiling: null }],
  inflationAdjustedWithdrawal: false,
  basePension: 0,
  pensionStartAge: 65,
  currentAge: 40,
  otherIncomes: [],
  defenseAnnualReturnRate: 0,
  targetDefenseRatioStart: 0,
  targetDefenseRatioEnd: 0,
  glidePathEndAge: 65,
  rebalanceThresholdPoint: 5,
  defensePriorityOnDrawdown: false,
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

// 標準カーブ: Slow-Go=75歳開始、No-Go=85歳開始、Slow-Go係数=80%、No-Go月額=15万
const DEFAULT_CURVE: ZeroLandingCurve = {
  slowGoStartAge: 75,
  noGoStartAge: 85,
  slowGoCoef: 0.8,
  noGoMonthly: 15 * 10_000,
};

// 床なしのカーブ（床を実質ゼロ近くにして Phase 1 の挙動と比較するための補助）
const FLAT_CURVE: ZeroLandingCurve = {
  slowGoStartAge: 75,
  noGoStartAge: 85,
  slowGoCoef: 1.0,
  noGoMonthly: 0,
};

test("findZeroLandingMonthly - 床=0 / 係数=1.0（フラット）/ target=0 で found、最終残高は枯渇手前", () => {
  const result = findZeroLandingMonthly(BASE_PARAMS, { finalTarget: 0, curve: FLAT_CURVE });
  assert.strictEqual(result.boundary, "found");
  assert.ok(result.finalTotal >= 0);
  // 探索精度 1000 円/月 × 12 × 30年 = ~36万円。target=0 のとき loFinal は target 直上で止まる。
  assert.ok(result.finalTotal < 5_000_000, `finalTotal=${result.finalTotal} should be < 500万`);
  assert.ok(result.monthlyAmount > 0);
});

test("findZeroLandingMonthly - 床あり（15万）/ target=0 で Go-Go 月額が床より高い値で逆算", () => {
  const result = findZeroLandingMonthly(BASE_PARAMS, { finalTarget: 0, curve: DEFAULT_CURVE });
  assert.strictEqual(result.boundary, "found");
  // 床 15 万、Go-Go は床より大きいはず（カーブが単調減なので Go-Go > Slow-Go > No-Go）
  assert.ok(
    result.monthlyAmount > DEFAULT_CURVE.noGoMonthly,
    `Go-Go monthly=${result.monthlyAmount} should be > 床 ${DEFAULT_CURVE.noGoMonthly}`,
  );
});

test("findZeroLandingMonthly - 床あり / target=2000万 で found、最終残高が約 2000 万に着地", () => {
  const finalTarget = 20_000_000;
  const result = findZeroLandingMonthly(BASE_PARAMS, { finalTarget, curve: DEFAULT_CURVE });
  assert.strictEqual(result.boundary, "found");
  assert.ok(
    result.finalTotal >= finalTarget,
    `finalTotal=${result.finalTotal} should be >= ${finalTarget}`,
  );
  assert.ok(
    result.finalTotal - finalTarget < 1_000_000,
    `finalTotal=${result.finalTotal} should be within +100万 of ${finalTarget}`,
  );
});

test("findZeroLandingMonthly - 床高すぎ（50万）で below-min", () => {
  const highFloorCurve: ZeroLandingCurve = {
    ...DEFAULT_CURVE,
    noGoMonthly: 50 * 10_000,
  };
  // 元本 5000 万 / 30 年で No-Go 期に月 50 万を維持できないはず
  const result = findZeroLandingMonthly(BASE_PARAMS, { finalTarget: 0, curve: highFloorCurve });
  assert.strictEqual(result.boundary, "below-min");
});

test("findZeroLandingMonthly - 元本巨大・期間短で above-max", () => {
  const params: CalculateParams = {
    ...BASE_PARAMS,
    initialNisa: 1_000_000_000,
    withdrawalYears: 1,
  };
  const result = findZeroLandingMonthly(params, { finalTarget: 0, curve: DEFAULT_CURVE });
  assert.strictEqual(result.boundary, "above-max");
});

test("findZeroLandingMonthly - 再現性: 同じ params/curve で 2 回呼んで同じ monthlyAmount", () => {
  const a = findZeroLandingMonthly(BASE_PARAMS, { finalTarget: 0, curve: DEFAULT_CURVE });
  const b = findZeroLandingMonthly(BASE_PARAMS, { finalTarget: 0, curve: DEFAULT_CURVE });
  assert.strictEqual(a.monthlyAmount, b.monthlyAmount);
  assert.strictEqual(a.boundary, b.boundary);
});

test("findZeroLandingMonthly - インフレ下でも実質購買力固定で月額を逆算", () => {
  const params: CalculateParams = { ...BASE_PARAMS, inflationRate: 2 };
  const result = findZeroLandingMonthly(params, { finalTarget: 0, curve: DEFAULT_CURVE });
  assert.strictEqual(result.boundary, "found");
  assert.ok(result.monthlyAmount > 0);
});

test("findZeroLandingMonthly - 入力 schedule や withdrawalMode は結果に影響しない", () => {
  const withSchedule: CalculateParams = {
    ...BASE_PARAMS,
    withdrawalMode: "rate",
    withdrawalRate: 4,
    withdrawalLimitSchedule: [
      { untilAge: 74, floor: 200_000, ceiling: 200_000 },
      { untilAge: 84, floor: 160_000, ceiling: 160_000 },
      { untilAge: null, floor: 120_000, ceiling: 120_000 },
    ],
  };
  const a = findZeroLandingMonthly(BASE_PARAMS, { finalTarget: 0, curve: DEFAULT_CURVE });
  const b = findZeroLandingMonthly(withSchedule, { finalTarget: 0, curve: DEFAULT_CURVE });
  assert.strictEqual(a.boundary, b.boundary);
  assert.ok(
    Math.abs(a.monthlyAmount - b.monthlyAmount) < 1000,
    `monthlyAmount: a=${a.monthlyAmount} b=${b.monthlyAmount}`,
  );
});

test("findZeroLandingMonthly - Slow-Go 係数を 0.5 にすると Go-Go 月額は係数 0.8 より大きくなる", () => {
  // Slow-Go 期支出が減るぶん、Go-Go 期にもっと使える。
  // 取り崩しが Slow-Go 期（75〜）まで届くよう currentAge=65 に設定。
  const params: CalculateParams = { ...BASE_PARAMS, currentAge: 65 };
  const lowCoefCurve: ZeroLandingCurve = { ...DEFAULT_CURVE, slowGoCoef: 0.5 };
  const a = findZeroLandingMonthly(params, { finalTarget: 0, curve: DEFAULT_CURVE });
  const b = findZeroLandingMonthly(params, { finalTarget: 0, curve: lowCoefCurve });
  assert.strictEqual(a.boundary, "found");
  assert.strictEqual(b.boundary, "found");
  assert.ok(
    b.monthlyAmount > a.monthlyAmount,
    `lowCoef Go-Go=${b.monthlyAmount} should exceed default Go-Go=${a.monthlyAmount}`,
  );
});

test("findZeroLandingMonthly - Slow-Go 開始 70 歳にすると Go-Go 月額は 75 歳開始と異なる", () => {
  // 境界年齢を変えるとカーブの形が変わり、Go-Go 月額の逆算結果も変わる。
  // どちらが大きくなるかは元本/期間/床次第なので「異なる」ことだけ確認する。
  const params: CalculateParams = { ...BASE_PARAMS, currentAge: 65 };
  const earlySlowGo: ZeroLandingCurve = { ...DEFAULT_CURVE, slowGoStartAge: 70 };
  const a = findZeroLandingMonthly(params, { finalTarget: 0, curve: DEFAULT_CURVE });
  const b = findZeroLandingMonthly(params, { finalTarget: 0, curve: earlySlowGo });
  assert.strictEqual(a.boundary, "found");
  assert.strictEqual(b.boundary, "found");
  assert.ok(
    Math.abs(a.monthlyAmount - b.monthlyAmount) > 5000,
    `Go-Go monthly should differ by >5000円 (slowGoStartAge 75 vs 70): default=${a.monthlyAmount} early=${b.monthlyAmount}`,
  );
});

test("findZeroLandingMonthly - 計算層との整合: ソルバー結果を calculateCompound に投げ直すと同じ最終残高", () => {
  const result = findZeroLandingMonthly(BASE_PARAMS, { finalTarget: 0, curve: DEFAULT_CURVE });
  assert.strictEqual(result.boundary, "found");
  const schedule = [
    {
      untilAge: DEFAULT_CURVE.slowGoStartAge - 1,
      floor: result.monthlyAmount,
      ceiling: result.monthlyAmount,
    },
    {
      untilAge: DEFAULT_CURVE.noGoStartAge - 1,
      floor: result.monthlyAmount * DEFAULT_CURVE.slowGoCoef,
      ceiling: result.monthlyAmount * DEFAULT_CURVE.slowGoCoef,
    },
    { untilAge: null, floor: DEFAULT_CURVE.noGoMonthly, ceiling: DEFAULT_CURVE.noGoMonthly },
  ];
  const { yearly } = calculateCompound({
    ...BASE_PARAMS,
    withdrawalMode: "zero-landing",
    inflationAdjustedWithdrawal: true,
    fixedMonthlyWithdrawal: result.monthlyAmount,
    withdrawalLimitSchedule: schedule,
  });
  const finalTotal = yearly[yearly.length - 1]!.total;
  // 探索精度の範囲内で一致するはず
  assert.ok(
    Math.abs(finalTotal - result.finalTotal) < 100,
    `finalTotal mismatch: solver=${result.finalTotal} recalc=${finalTotal}`,
  );
});
