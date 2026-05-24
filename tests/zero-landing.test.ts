// findZeroLandingMonthly は MC（simulateMonteCarlo）の p50 経路で二分探索する。
// MC ノイズで判定がフリップしないよう、ソルバー内では同一 seed を使い回す。
// テストでも seed を明示渡して再現性を担保する。
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildZeroLandingSchedule,
  findZeroLandingMonthly,
  type ZeroLandingCurve,
} from "../src/zero-landing.ts";
import { simulateMonteCarlo, type MonteCarloParams } from "../src/monte-carlo.ts";

const TEST_SEED = 42;

const BASE_PARAMS: MonteCarloParams = {
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
  // MC 固有
  volatility: 15,
  defenseVolatility: 0,
  drawdownThresholdPercent: 10,
  skipRebalanceOnDrawdown: false,
  enableJumpDiffusion: false,
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

test("findZeroLandingMonthly - 床=0 / 係数=1.0（フラット）/ target=0 で found、最終 p50 残高は枯渇手前", () => {
  const result = findZeroLandingMonthly(BASE_PARAMS, {
    finalTarget: 0,
    curve: FLAT_CURVE,
    seed: TEST_SEED,
  });
  assert.strictEqual(result.boundary, "found");
  assert.ok(result.finalTotal >= 0);
  // MC ノイズで多少ぶれるが、target=0 直上で止まっているはず。
  assert.ok(result.finalTotal < 10_000_000, `finalTotal=${result.finalTotal} should be < 1000万`);
  assert.ok(result.monthlyAmount > 0);
});

test("findZeroLandingMonthly - 床あり（15万）/ target=0 で Go-Go 月額が床より高い値で逆算", () => {
  const result = findZeroLandingMonthly(BASE_PARAMS, {
    finalTarget: 0,
    curve: DEFAULT_CURVE,
    seed: TEST_SEED,
  });
  assert.strictEqual(result.boundary, "found");
  // 床 15 万、Go-Go は床より大きいはず（カーブが単調減なので Go-Go > Slow-Go > No-Go）
  assert.ok(
    result.monthlyAmount > DEFAULT_CURVE.noGoMonthly,
    `Go-Go monthly=${result.monthlyAmount} should be > 床 ${DEFAULT_CURVE.noGoMonthly}`,
  );
});

test("findZeroLandingMonthly - 床あり / target=2000万 で found、最終 p50 残高が約 2000 万に着地", () => {
  const finalTarget = 20_000_000;
  const result = findZeroLandingMonthly(BASE_PARAMS, {
    finalTarget,
    curve: DEFAULT_CURVE,
    seed: TEST_SEED,
  });
  assert.strictEqual(result.boundary, "found");
  assert.ok(
    result.finalTotal >= finalTarget,
    `finalTotal=${result.finalTotal} should be >= ${finalTarget}`,
  );
  // MC + 25 反復の精度で実質値スケール ~300 万円程度のスラック。
  assert.ok(
    result.finalTotal - finalTarget < 3_000_000,
    `finalTotal=${result.finalTotal} should be within +300万 of ${finalTarget}`,
  );
});

test("findZeroLandingMonthly - 床高すぎ（50万）で below-min", () => {
  const highFloorCurve: ZeroLandingCurve = {
    ...DEFAULT_CURVE,
    noGoMonthly: 50 * 10_000,
  };
  // 元本 5000 万 / 30 年で No-Go 期に月 50 万を維持できないはず
  const result = findZeroLandingMonthly(BASE_PARAMS, {
    finalTarget: 0,
    curve: highFloorCurve,
    seed: TEST_SEED,
  });
  assert.strictEqual(result.boundary, "below-min");
});

test("findZeroLandingMonthly - 元本巨大・期間短で above-max", () => {
  const params: MonteCarloParams = {
    ...BASE_PARAMS,
    initialNisa: 1_000_000_000,
    withdrawalYears: 1,
  };
  const result = findZeroLandingMonthly(params, {
    finalTarget: 0,
    curve: DEFAULT_CURVE,
    seed: TEST_SEED,
  });
  assert.strictEqual(result.boundary, "above-max");
});

test("findZeroLandingMonthly - 再現性: 同じ seed で 2 回呼ぶと完全一致", () => {
  const a = findZeroLandingMonthly(BASE_PARAMS, {
    finalTarget: 0,
    curve: DEFAULT_CURVE,
    seed: TEST_SEED,
  });
  const b = findZeroLandingMonthly(BASE_PARAMS, {
    finalTarget: 0,
    curve: DEFAULT_CURVE,
    seed: TEST_SEED,
  });
  assert.strictEqual(a.monthlyAmount, b.monthlyAmount);
  assert.strictEqual(a.boundary, b.boundary);
  assert.strictEqual(a.seed, b.seed);
});

test("findZeroLandingMonthly - seed を省略しても result.seed に実使用シードが入り、その seed で再現可能", () => {
  const a = findZeroLandingMonthly(BASE_PARAMS, { finalTarget: 0, curve: DEFAULT_CURVE });
  const b = findZeroLandingMonthly(BASE_PARAMS, {
    finalTarget: 0,
    curve: DEFAULT_CURVE,
    seed: a.seed,
  });
  assert.strictEqual(b.monthlyAmount, a.monthlyAmount);
});

test("findZeroLandingMonthly - インフレ下でも実質購買力固定で月額を逆算", () => {
  const params: MonteCarloParams = { ...BASE_PARAMS, inflationRate: 2 };
  const result = findZeroLandingMonthly(params, {
    finalTarget: 0,
    curve: DEFAULT_CURVE,
    seed: TEST_SEED,
  });
  assert.strictEqual(result.boundary, "found");
  assert.ok(result.monthlyAmount > 0);
});

test("findZeroLandingMonthly - 入力 schedule や withdrawalMode は結果に影響しない", () => {
  // ソルバーは内部で withdrawalMode='zero-landing' を強制し schedule をカーブから再構築する。
  // 呼び出し側の指定は無視されるはず。
  const withSchedule: MonteCarloParams = {
    ...BASE_PARAMS,
    withdrawalMode: "rate",
    withdrawalRate: 4,
    withdrawalLimitSchedule: [
      { untilAge: 74, floor: 200_000, ceiling: 200_000 },
      { untilAge: 84, floor: 160_000, ceiling: 160_000 },
      { untilAge: null, floor: 120_000, ceiling: 120_000 },
    ],
  };
  const a = findZeroLandingMonthly(BASE_PARAMS, {
    finalTarget: 0,
    curve: DEFAULT_CURVE,
    seed: TEST_SEED,
  });
  const b = findZeroLandingMonthly(withSchedule, {
    finalTarget: 0,
    curve: DEFAULT_CURVE,
    seed: TEST_SEED,
  });
  assert.strictEqual(a.boundary, b.boundary);
  // seed が同じなら MC の経路も完全一致するため monthlyAmount も完全一致するはず。
  assert.strictEqual(a.monthlyAmount, b.monthlyAmount);
});

test("findZeroLandingMonthly - Slow-Go 係数を 0.5 にすると Go-Go 月額は係数 0.8 より大きくなる", () => {
  // Slow-Go 期支出が減るぶん、Go-Go 期にもっと使える。
  // 取り崩しが Slow-Go 期（75〜）まで届くよう currentAge=65 に設定。
  const params: MonteCarloParams = { ...BASE_PARAMS, currentAge: 65 };
  const lowCoefCurve: ZeroLandingCurve = { ...DEFAULT_CURVE, slowGoCoef: 0.5 };
  const a = findZeroLandingMonthly(params, {
    finalTarget: 0,
    curve: DEFAULT_CURVE,
    seed: TEST_SEED,
  });
  const b = findZeroLandingMonthly(params, {
    finalTarget: 0,
    curve: lowCoefCurve,
    seed: TEST_SEED,
  });
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
  const params: MonteCarloParams = { ...BASE_PARAMS, currentAge: 65 };
  const earlySlowGo: ZeroLandingCurve = { ...DEFAULT_CURVE, slowGoStartAge: 70 };
  const a = findZeroLandingMonthly(params, {
    finalTarget: 0,
    curve: DEFAULT_CURVE,
    seed: TEST_SEED,
  });
  const b = findZeroLandingMonthly(params, {
    finalTarget: 0,
    curve: earlySlowGo,
    seed: TEST_SEED,
  });
  assert.strictEqual(a.boundary, "found");
  assert.strictEqual(b.boundary, "found");
  assert.ok(
    Math.abs(a.monthlyAmount - b.monthlyAmount) > 5000,
    `Go-Go monthly should differ by >5000円 (slowGoStartAge 75 vs 70): default=${a.monthlyAmount} early=${b.monthlyAmount}`,
  );
});

test("findZeroLandingMonthly - ソルバー結果から withdrawalLimitSteps 3段が正しく生成される", () => {
  const result = findZeroLandingMonthly(BASE_PARAMS, {
    finalTarget: 0,
    curve: DEFAULT_CURVE,
    seed: TEST_SEED,
  });
  assert.strictEqual(result.boundary, "found");

  const MAN = 10000;
  const goGoMonthly = Math.round(result.monthlyAmount / 1000) * 1000;
  const schedule = buildZeroLandingSchedule(goGoMonthly, DEFAULT_CURVE);
  const steps = schedule.map((s) => ({
    untilAge: s.untilAge,
    floorMan: s.floor != null ? s.floor / MAN : null,
    ceilingMan: s.ceiling != null ? s.ceiling / MAN : null,
  }));

  assert.strictEqual(steps.length, 3);
  assert.ok(steps[0]!.floorMan! > 0, "GoGo floor should be positive");
  assert.strictEqual(steps[0]!.floorMan, steps[0]!.ceilingMan, "GoGo: floor === ceiling");
  assert.strictEqual(steps[0]!.untilAge, DEFAULT_CURVE.slowGoStartAge - 1);
  assert.ok(
    Math.abs(steps[1]!.floorMan! - (goGoMonthly / MAN) * DEFAULT_CURVE.slowGoCoef) < 0.01,
    `SlowGo floor should be goGoMan × coef but got ${steps[1]!.floorMan}`,
  );
  assert.strictEqual(steps[1]!.floorMan, steps[1]!.ceilingMan, "SlowGo: floor === ceiling");
  assert.strictEqual(steps[1]!.untilAge, DEFAULT_CURVE.noGoStartAge - 1);
  assert.strictEqual(steps[2]!.floorMan, DEFAULT_CURVE.noGoMonthly / MAN, "NoGo floor should match noGoMonthly");
  assert.strictEqual(steps[2]!.ceilingMan, DEFAULT_CURVE.noGoMonthly / MAN, "NoGo ceiling should match noGoMonthly");
  assert.strictEqual(steps[2]!.untilAge, null, "NoGo row should have untilAge=null");
});

test("findZeroLandingMonthly - 計算層との整合: ソルバー結果を simulateMonteCarlo に投げ直すと同じ p50 最終残高", () => {
  const result = findZeroLandingMonthly(BASE_PARAMS, {
    finalTarget: 0,
    curve: DEFAULT_CURVE,
    seed: TEST_SEED,
  });
  assert.strictEqual(result.boundary, "found");
  const mc = simulateMonteCarlo(
    {
      ...BASE_PARAMS,
      withdrawalMode: "zero-landing",
      inflationAdjustedWithdrawal: true,
      fixedMonthlyWithdrawal: result.monthlyAmount,
      withdrawalLimitSchedule: buildZeroLandingSchedule(result.monthlyAmount, DEFAULT_CURVE),
      zeroLandingCurve: DEFAULT_CURVE,
    },
    result.seed,
  );
  const finalP50 = mc.yearly[mc.yearly.length - 1]!.p50;
  // seed 一致なら完全一致するはず
  assert.strictEqual(finalP50, result.finalTotal);
});

test("findZeroLandingMonthly - zeroLandingCurve あり: 動的ロジックで p50 が最終目標に着地する", () => {
  const finalTarget = 5_000_000;
  const result = findZeroLandingMonthly(
    { ...BASE_PARAMS, zeroLandingCurve: DEFAULT_CURVE },
    { finalTarget, curve: DEFAULT_CURVE, seed: TEST_SEED },
  );
  assert.strictEqual(result.boundary, "found");
  assert.ok(
    Math.abs(result.finalTotal - finalTarget) < 500_000,
    `finalTotal=${result.finalTotal} が目標 ${finalTarget} の ±50万以内に着地しない`,
  );
});
