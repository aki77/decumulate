import { test } from "node:test";
import assert from "node:assert/strict";
import {
  simulateMonteCarlo,
  computeSecurityScore,
  scoreLabel,
  PERCENTILE_KEYS,
  type MonteCarloParams,
  type PercentileKey,
} from "../src/monte-carlo.ts";
import type { WithdrawalLimitStep } from "../src/calculate.ts";

// 旧 monthlyWithdrawalFloor/Ceiling テストを移行しやすくするヘルパー（終端 1 行の schedule）。
function limit(floor: number | null, ceiling: number | null): WithdrawalLimitStep[] {
  return [{ untilAge: null, floor, ceiling }];
}

const BASE_PARAMS: MonteCarloParams = {
  // 既存テストは「単一バケット・非課税」相当を想定するため、初期値はNISA一本にする。
  initialNisa: 1000000,
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
  withdrawalYears: 10,
  withdrawalMode: "amount",
  fixedMonthlyWithdrawal: 5000,
  withdrawalRate: 4,
  withdrawalLimitSchedule: [{ untilAge: null, floor: null, ceiling: null }],
  inflationAdjustedWithdrawal: false,
  basePension: 0,
  pensionStartAge: 65,
  currentAge: 40,
  otherIncomes: [],
  defenseAnnualReturnRate: 0,
  defenseVolatility: 0,
  targetDefenseRatio: 0,
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

// initialAmount + defenseRatio(%) を新シグネチャに変換するヘルパ。
// targetDefenseRatio も初期残高比と同じ値を渡して旧挙動を再現する。
function withBuckets(initialAmount: number, defenseRatioPercent = 0): Partial<MonteCarloParams> {
  const dr = defenseRatioPercent / 100;
  return {
    initialNisa: initialAmount * (1 - dr),
    initialTaxableRisk: 0,
    initialDefense: initialAmount * dr,
    targetDefenseRatio: defenseRatioPercent,
  };
}

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

test("simulateMonteCarlo - currentAge を起点に age が year ごとに加算される", () => {
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
    ...withBuckets(1000000, 30),
    withdrawalMode: "rate-risk",
    withdrawalRate: 4,
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

// --- pivotMonthlies (5パーセンタイル) ---

test("simulateMonteCarlo - pivotMonthlies の各キーが存在し長さが 12 × totalYears", () => {
  const params: MonteCarloParams = {
    ...BASE_PARAMS,
    contributionYears: 3,
    withdrawalStartYear: 3,
    withdrawalYears: 5,
  };
  const result = simulateMonteCarlo(params);
  for (const k of PERCENTILE_KEYS) {
    assert.strictEqual(result.pivotMonthlies[k].length, 12 * 8, `${k} の長さが不正`);
  }
});

test("simulateMonteCarlo - 各 pivot 最終 total はそれぞれのパーセンタイル値に十分近い", () => {
  const params: MonteCarloParams = {
    ...BASE_PARAMS,
    ...withBuckets(1000000),
    monthlyContribution: 0,
    contributionYears: 0,
    withdrawalStartYear: 0,
    withdrawalYears: 5,
    fixedMonthlyWithdrawal: 1000,
    volatility: 15,
  };
  const result = simulateMonteCarlo(params);
  const last = result.yearly[result.yearly.length - 1]!;
  const targets: Record<PercentileKey, number> = {
    p10: last.p10,
    p25: last.p25,
    p50: last.p50,
    p75: last.p75,
    p90: last.p90,
  };
  for (const k of PERCENTILE_KEYS) {
    const monthly = result.pivotMonthlies[k];
    const finalTotal = monthly[monthly.length - 1]!.total;
    const denom = Math.max(Math.abs(targets[k]), 1);
    const ratio = Math.abs(finalTotal - targets[k]) / denom;
    assert.ok(
      ratio < 0.05,
      `${k}: pivot最終total=${finalTotal} と target=${targets[k]} の相対差=${ratio} が大きすぎる`,
    );
  }
});

test("simulateMonteCarlo - 5パスの最終 total は p10 ≤ p25 ≤ p50 ≤ p75 ≤ p90 の順", () => {
  const params: MonteCarloParams = {
    ...BASE_PARAMS,
    ...withBuckets(1000000),
    contributionYears: 0,
    withdrawalStartYear: 0,
    withdrawalYears: 10,
    fixedMonthlyWithdrawal: 500,
    volatility: 15,
  };
  const result = simulateMonteCarlo(params);
  const finals = PERCENTILE_KEYS.map((k) => {
    const arr = result.pivotMonthlies[k];
    return arr[arr.length - 1]!.total;
  });
  for (let i = 0; i < finals.length - 1; i++) {
    assert.ok(
      finals[i]! <= finals[i + 1]!,
      `順序違反: ${PERCENTILE_KEYS[i]}=${finals[i]} > ${PERCENTILE_KEYS[i + 1]}=${finals[i + 1]}`,
    );
  }
});

test("simulateMonteCarlo - 2 回呼び出しで pivotMonthlies の全系列が完全一致（再現性）", () => {
  const params: MonteCarloParams = { ...BASE_PARAMS, withdrawalYears: 5 };
  const r1 = simulateMonteCarlo(params);
  const r2 = simulateMonteCarlo(params);
  for (const k of PERCENTILE_KEYS) {
    const a = r1.pivotMonthlies[k];
    const b = r2.pivotMonthlies[k];
    assert.strictEqual(a.length, b.length, `${k} の長さが一致しない`);
    for (let i = 0; i < a.length; i++) {
      assert.strictEqual(a[i]!.total, b[i]!.total, `${k}[${i}].total`);
      assert.strictEqual(a[i]!.monthlyGain, b[i]!.monthlyGain, `${k}[${i}].monthlyGain`);
      assert.strictEqual(a[i]!.monthlyRate, b[i]!.monthlyRate, `${k}[${i}].monthlyRate`);
    }
  }
});

test("simulateMonteCarlo - pivotMonthlies の全行で monthlyRate が有限値", () => {
  const result = simulateMonteCarlo(BASE_PARAMS);
  for (const k of PERCENTILE_KEYS) {
    for (const row of result.pivotMonthlies[k]) {
      assert.ok(Number.isFinite(row.monthlyRate), `${k} 行の monthlyRate が有限ではない`);
    }
  }
});

// --- defensePriorityOnDrawdown 新挙動 ---

test("simulateMonteCarlo - defensePriorityOnDrawdown=true は平時にリスク優先で防衛資産を温存", () => {
  // ボラ0・利回り0・閾値99%（実質下落判定が発火しない設定）にすると
  // 全月「平時扱い」になり、リスク資産から優先取り崩しされて防衛資産がほぼ温存される
  const params: MonteCarloParams = {
    ...BASE_PARAMS,
    ...withBuckets(10000000, 50),
    monthlyContribution: 0,
    annualReturnRate: 0,
    expenseRatio: 0,
    volatility: 0,
    defenseAnnualReturnRate: 0,
    defenseVolatility: 0,
    contributionYears: 0,
    withdrawalStartYear: 0,
    withdrawalYears: 3,
    fixedMonthlyWithdrawal: 100000,
    rebalanceThresholdPoint: 100,
    drawdownThresholdPercent: 99,
    defensePriorityOnDrawdown: true,
    skipRebalanceOnDrawdown: false,
  };
  const result = simulateMonteCarlo(params);
  const p50 = result.pivotMonthlies.p50;
  const last = p50[p50.length - 1]!;
  // 初期防衛500万 - ほぼ未消費 → 防衛は500万近い、リスクが先に減る
  assert.ok(last.defenseTotal > 4500000, `defenseTotal=${last.defenseTotal} 期待: ~500万`);
});

test("simulateMonteCarlo - defensePriorityOnDrawdown=false は時価比率按分で両資産が減る（回帰）", () => {
  const params: MonteCarloParams = {
    ...BASE_PARAMS,
    ...withBuckets(10000000, 50),
    monthlyContribution: 0,
    annualReturnRate: 0,
    expenseRatio: 0,
    volatility: 0,
    defenseAnnualReturnRate: 0,
    defenseVolatility: 0,
    contributionYears: 0,
    withdrawalStartYear: 0,
    withdrawalYears: 3,
    fixedMonthlyWithdrawal: 100000,
    rebalanceThresholdPoint: 100,
    defensePriorityOnDrawdown: false,
  };
  const result = simulateMonteCarlo(params);
  const p50 = result.pivotMonthlies.p50;
  const last = p50[p50.length - 1]!;
  // 按分なら防衛も比率分減る
  assert.ok(last.defenseTotal < 4500000, `defenseTotal=${last.defenseTotal}`);
});

test("simulateMonteCarlo - defensePriorityOnDrawdown=true 高ボラでも完走し p10≤p50≤p90", () => {
  const params: MonteCarloParams = {
    ...BASE_PARAMS,
    ...withBuckets(10000000, 30),
    volatility: 30,
    defenseAnnualReturnRate: 0,
    contributionYears: 0,
    withdrawalStartYear: 0,
    withdrawalYears: 10,
    fixedMonthlyWithdrawal: 50000,
    drawdownThresholdPercent: 5,
    defensePriorityOnDrawdown: true,
    skipRebalanceOnDrawdown: true,
  };
  const result = simulateMonteCarlo(params);
  for (const y of result.yearly) {
    assert.ok(Number.isFinite(y.p50));
    assert.ok(y.p10 <= y.p50 && y.p50 <= y.p90, `年${y.year}で順序崩れ`);
  }
});

// --- 月額下限/上限のクランプ（モンテカルロ）---

test("simulateMonteCarlo (rate) - 下限/上限指定で完走し全パーセンタイルが finite", () => {
  const result = simulateMonteCarlo({
    ...BASE_PARAMS,
    ...withBuckets(10000000),
    inflationRate: 2,
    volatility: 15,
    withdrawalRate: 4,
    withdrawalMode: "rate",
    withdrawalStartYear: 0,
    withdrawalYears: 20,
    withdrawalLimitSchedule: limit(30000, 80000),
  });
  for (const y of result.yearly) {
    assert.ok(Number.isFinite(y.p10));
    assert.ok(Number.isFinite(y.p50));
    assert.ok(Number.isFinite(y.p90));
  }
});

test("simulateMonteCarlo (rate) - シード固定で下限/上限指定時も再現性あり", () => {
  const params: MonteCarloParams = {
    ...BASE_PARAMS,
    ...withBuckets(10000000),
    volatility: 15,
    withdrawalRate: 4,
    withdrawalMode: "rate",
    withdrawalStartYear: 0,
    withdrawalYears: 10,
    withdrawalLimitSchedule: limit(40000, 60000),
  };
  const a = simulateMonteCarlo(params);
  const b = simulateMonteCarlo(params);
  assert.strictEqual(a.finalP50, b.finalP50);
  assert.strictEqual(a.depletionProbability, b.depletionProbability);
  for (let i = 0; i < a.yearly.length; i++) {
    assert.strictEqual(a.yearly[i]!.p50, b.yearly[i]!.p50);
    assert.strictEqual(a.yearly[i]!.medianYearlyWithdrawal, b.yearly[i]!.medianYearlyWithdrawal);
  }
});

test("simulateMonteCarlo (rate) - 下限を上げると枯渇確率が上がる", () => {
  const base = {
    ...BASE_PARAMS,
    ...withBuckets(10000000),
    volatility: 15,
    inflationRate: 0,
    withdrawalRate: 2,
    withdrawalMode: "rate" as const,
    withdrawalStartYear: 0,
    withdrawalYears: 20,
  };
  const low = simulateMonteCarlo({
    ...base,
    withdrawalLimitSchedule: limit(null, null),
  });
  const high = simulateMonteCarlo({
    ...base,
    withdrawalLimitSchedule: limit(100000, null),
  });
  assert.ok(
    high.depletionProbability >= low.depletionProbability,
    `下限ありで枯渇確率が下がっている (low=${low.depletionProbability}, high=${high.depletionProbability})`,
  );
});

test("simulateMonteCarlo (rate) - 上限を下げると最終 P50 が大きくなる", () => {
  const base = {
    ...BASE_PARAMS,
    ...withBuckets(10000000),
    volatility: 15,
    inflationRate: 0,
    withdrawalRate: 8, // 高率にして上限が効きやすくする
    withdrawalMode: "rate" as const,
    withdrawalStartYear: 0,
    withdrawalYears: 10,
  };
  const noCeiling = simulateMonteCarlo({
    ...base,
    withdrawalLimitSchedule: limit(null, null),
  });
  const withCeiling = simulateMonteCarlo({
    ...base,
    withdrawalLimitSchedule: limit(null, 30000),
  });
  assert.ok(
    withCeiling.finalP50 >= noCeiling.finalP50,
    `上限ありで最終 P50 が小さい (no=${noCeiling.finalP50}, with=${withCeiling.finalP50})`,
  );
});

test("simulateMonteCarlo (rate-risk) - 下限/上限指定でも2バケット経路で完走", () => {
  const result = simulateMonteCarlo({
    ...BASE_PARAMS,
    ...withBuckets(10000000, 30),
    volatility: 15,
    defenseAnnualReturnRate: 1,
    defenseVolatility: 3,
    inflationRate: 1,
    withdrawalRate: 4,
    withdrawalMode: "rate-risk",
    withdrawalStartYear: 0,
    withdrawalYears: 10,
    withdrawalLimitSchedule: limit(20000, 80000),
  });
  for (const y of result.yearly) {
    assert.ok(Number.isFinite(y.p50));
  }
});

test("simulateMonteCarlo (rate) - 下限>上限のとき上限が優先（medianYearlyWithdrawal が上限×12を超えない）", () => {
  const result = simulateMonteCarlo({
    ...BASE_PARAMS,
    ...withBuckets(100000000),
    volatility: 15,
    inflationRate: 0,
    withdrawalRate: 10,
    withdrawalMode: "rate",
    withdrawalStartYear: 0,
    withdrawalYears: 5,
    withdrawalLimitSchedule: limit(500000, 100000),
  });
  for (const y of result.yearly.slice(1)) {
    assert.ok(
      y.medianYearlyWithdrawal <= 100000 * 12 + 1,
      `年${y.year}: medianYearlyWithdrawal=${y.medianYearlyWithdrawal} > 上限×12`,
    );
  }
});

test("simulateMonteCarlo (amount) - 下限/上限指定は無視される（回帰）", () => {
  const base: MonteCarloParams = {
    ...BASE_PARAMS,
    ...withBuckets(10000000),
    volatility: 10,
    inflationRate: 0,
    withdrawalMode: "amount",
    fixedMonthlyWithdrawal: 50000,
    withdrawalStartYear: 0,
    withdrawalYears: 5,
  };
  const withClamp = simulateMonteCarlo({
    ...base,
    withdrawalLimitSchedule: limit(500000, 10000),
  });
  const withoutClamp = simulateMonteCarlo({
    ...base,
    withdrawalLimitSchedule: limit(null, null),
  });
  assert.strictEqual(withClamp.finalP50, withoutClamp.finalP50);
  assert.strictEqual(withClamp.depletionProbability, withoutClamp.depletionProbability);
});

test("simulateMonteCarlo - NISA振替ONかつ特定リスクに残高ありなら pivot 月次の1月に nisaTransferInfo が記録される", () => {
  const params: MonteCarloParams = {
    ...BASE_PARAMS,
    initialNisa: 0,
    initialTaxableRisk: 50000000,
    initialTaxableRiskGain: 5000000,
    nisaTransferEnabled: true,
    monthlyContribution: 0,
    contributionYears: 0,
    withdrawalStartYear: 5,
    withdrawalYears: 5,
    fixedMonthlyWithdrawal: 0,
    volatility: 0,
    inflationRate: 0,
  };
  const result = simulateMonteCarlo(params);
  for (const k of PERCENTILE_KEYS) {
    const rows = result.pivotMonthlies[k as PercentileKey];
    const jan1 = rows.find((r) => r.year === 1 && r.month === 1);
    assert.ok(jan1, `${k}: 1年目1月の行が見つからない`);
    assert.ok(
      jan1.nisaTransferInfo !== null,
      `${k}: 1年目1月の nisaTransferInfo が null になっている`,
    );
    assert.ok(
      jan1.nisaTransferInfo!.proceeds > 0,
      `${k}: proceeds が 0 以下 (${jan1.nisaTransferInfo!.proceeds})`,
    );
    // 1月以外の月では null であること
    const feb1 = rows.find((r) => r.year === 1 && r.month === 2);
    assert.ok(feb1, `${k}: 1年目2月の行が見つからない`);
    assert.strictEqual(
      feb1.nisaTransferInfo,
      null,
      `${k}: 1年目2月の nisaTransferInfo は null であるべき`,
    );
  }
});

test("simulateMonteCarlo - NISA振替OFF なら pivot 月次の nisaTransferInfo は常に null", () => {
  const params: MonteCarloParams = {
    ...BASE_PARAMS,
    initialNisa: 0,
    initialTaxableRisk: 50000000,
    initialTaxableRiskGain: 5000000,
    nisaTransferEnabled: false,
    withdrawalYears: 3,
  };
  const result = simulateMonteCarlo(params);
  for (const k of PERCENTILE_KEYS) {
    const rows = result.pivotMonthlies[k as PercentileKey];
    for (const row of rows) {
      assert.strictEqual(
        row.nisaTransferInfo,
        null,
        `${k}: 年${row.year}月${row.month} で nisaTransferInfo が null でない`,
      );
    }
  }
});

// --- monthlyWithdrawal 内訳 ---

test("simulateMonteCarlo - pivot 月次の monthlyWithdrawal は内訳3バケットの和に等しい", () => {
  const params: MonteCarloParams = {
    ...BASE_PARAMS,
    initialNisa: 1000000,
    initialNisaGain: 100000,
    initialTaxableRisk: 1000000,
    initialTaxableRiskGain: 200000,
    initialDefense: 500000,
    initialDefenseGain: 50000,
    targetDefenseRatio: 25,
    withdrawalStartYear: 0,
    withdrawalYears: 3,
    fixedMonthlyWithdrawal: 30000,
    defensePriorityOnDrawdown: false,
  };
  const result = simulateMonteCarlo(params);
  for (const k of PERCENTILE_KEYS) {
    const rows = result.pivotMonthlies[k as PercentileKey];
    for (const row of rows) {
      if (row.monthlyWithdrawal <= 0) continue;
      const sum =
        row.monthlyWithdrawalNisa +
        row.monthlyWithdrawalTaxableRisk +
        row.monthlyWithdrawalDefense;
      assert.ok(
        Math.abs(row.monthlyWithdrawal - sum) <= 1,
        `${k} year=${row.year}month=${row.month}: total=${row.monthlyWithdrawal} sum=${sum}`,
      );
    }
  }
});

test("simulateMonteCarlo - maxDrawdown は [0,1] 範囲かつ p10 ≤ p50 ≤ p90 の順（ソート昇順）", () => {
  const params: MonteCarloParams = {
    ...BASE_PARAMS,
    withdrawalYears: 10,
    volatility: 20,
  };
  const result = simulateMonteCarlo(params);
  assert.ok(
    result.maxDrawdownP10 >= 0 && result.maxDrawdownP10 <= 1,
    `maxDrawdownP10=${result.maxDrawdownP10} が [0,1] 外`,
  );
  assert.ok(
    result.maxDrawdownP90 >= 0 && result.maxDrawdownP90 <= 1,
    `maxDrawdownP90=${result.maxDrawdownP90} が [0,1] 外`,
  );
  assert.ok(
    result.maxDrawdownP10 <= result.maxDrawdownP50,
    `順序違反: p10=${result.maxDrawdownP10} > p50=${result.maxDrawdownP50}`,
  );
  assert.ok(
    result.maxDrawdownP50 <= result.maxDrawdownP90,
    `順序違反: p50=${result.maxDrawdownP50} > p90=${result.maxDrawdownP90}`,
  );
});

test("simulateMonteCarlo - withdrawalYears=0 では maxDrawdown は 0（フォールバック）", () => {
  const params: MonteCarloParams = {
    ...BASE_PARAMS,
    withdrawalYears: 0,
  };
  const result = simulateMonteCarlo(params);
  assert.strictEqual(result.maxDrawdownP10, 0);
  assert.strictEqual(result.maxDrawdownP50, 0);
  assert.strictEqual(result.maxDrawdownP90, 0);
});
