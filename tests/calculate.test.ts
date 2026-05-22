import { test } from "node:test";
import assert from "node:assert/strict";
import {
  TAX_RATE,
  NISA_ANNUAL_LIMIT,
  NISA_LIFETIME_LIMIT,
  withdrawFromBucket,
  splitProportional,
  splitRiskFirst,
  splitRiskSide,
  needsRebalance,
  rebalanceTriBuckets,
  executeNisaTransfer,
  findLimitForAge,
  calculateCompound,
  resolveDefenseRatio,
  type CalculateParams,
  type WithdrawalLimitStep,
} from "../src/calculate.ts";

// 終端のみ 1 行の schedule を作るヘルパー。「年齢ステップなし」相当のクランプ条件をシンプルに表現する。
function limit(floor: number | null, ceiling: number | null): WithdrawalLimitStep[] {
  return [{ untilAge: null, floor, ceiling }];
}

// 既存テストは「特定リスク 100万円 / NISA 0 / 防衛 0、非課税」相当の挙動を確認するため、
// taxFree=true 相当のケースは、含み益0かつ NISA=initialAmount で表現できる。
// しかし複雑になるので、ここでは BASE_PARAMS をシンプルに「特定リスク 100万」「課税」で組み、
// 「非課税相当」を必要とするテストだけ initialNisa=金額 / initialTaxableRisk=0 に差し替える。
const BASE_PARAMS: CalculateParams = {
  initialNisa: 0,
  initialNisaGain: 0,
  initialTaxableRisk: 1000000,
  initialTaxableRiskGain: 0,
  initialDefense: 0,
  initialDefenseGain: 0,
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
  withdrawalLimitSchedule: limit(null, null),
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

// 非課税で計算したい場合は、特定リスクの代わりにNISA1本にする
function nisaOnly(amount: number): Partial<CalculateParams> {
  return { initialNisa: amount, initialTaxableRisk: 0 };
}

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

// --- splitRiskFirst ---

test("splitRiskFirst - リスクで全額賄える場合は防衛から取らない", () => {
  const [r, d] = splitRiskFirst(500, 1000, 1000);
  assert.strictEqual(r, 500);
  assert.strictEqual(d, 0);
});

test("splitRiskFirst - リスク不足分を防衛から補う", () => {
  const [r, d] = splitRiskFirst(1500, 1000, 1000);
  assert.strictEqual(r, 1000);
  assert.strictEqual(d, 500);
});

test("splitRiskFirst - 両方不足の場合は両方枯渇額", () => {
  const [r, d] = splitRiskFirst(5000, 1000, 1000);
  assert.strictEqual(r, 1000);
  assert.strictEqual(d, 1000);
});

test("splitRiskFirst - 金額ゼロは[0,0]", () => {
  const [r, d] = splitRiskFirst(0, 1000, 1000);
  assert.strictEqual(r, 0);
  assert.strictEqual(d, 0);
});

test("splitRiskFirst - リスクゼロは全額防衛から", () => {
  const [r, d] = splitRiskFirst(500, 0, 1000);
  assert.strictEqual(r, 0);
  assert.strictEqual(d, 500);
});

// --- splitRiskSide ---

test("splitRiskSide - 特定リスクで全額賄える場合はNISAを温存", () => {
  const [tx, n] = splitRiskSide(500, 1000, 1000);
  assert.strictEqual(tx, 500);
  assert.strictEqual(n, 0);
});

test("splitRiskSide - 特定リスク不足分のみNISAから", () => {
  const [tx, n] = splitRiskSide(1500, 1000, 1000);
  assert.strictEqual(tx, 1000);
  assert.strictEqual(n, 500);
});

test("splitRiskSide - 特定ゼロでもNISAから全額", () => {
  const [tx, n] = splitRiskSide(500, 0, 1000);
  assert.strictEqual(tx, 0);
  assert.strictEqual(n, 500);
});

test("splitRiskSide - 金額ゼロは[0,0]", () => {
  const [tx, n] = splitRiskSide(0, 1000, 1000);
  assert.strictEqual(tx, 0);
  assert.strictEqual(n, 0);
});

// --- needsRebalance ---

test("needsRebalance - 乖離なし（目標比率ちょうど）", () => {
  assert.strictEqual(needsRebalance(700, 300, 0.3, 5), false);
});

test("needsRebalance - 乖離が閾値以下", () => {
  assert.strictEqual(needsRebalance(750, 250, 0.3, 5), false);
});

test("needsRebalance - 乖離が閾値超過", () => {
  assert.strictEqual(needsRebalance(800, 200, 0.3, 5), true);
});

test("needsRebalance - 残高合計ゼロはfalse", () => {
  assert.strictEqual(needsRebalance(0, 0, 0.3, 5), false);
});

// --- rebalanceTriBuckets ---

test("rebalanceTriBuckets - 残高ゼロは変化なし", () => {
  const r = rebalanceTriBuckets(
    {
      nisaTotal: 0,
      nisaPrincipal: 0,
      taxableRiskTotal: 0,
      taxableRiskPrincipal: 0,
      defenseTotal: 0,
      defensePrincipal: 0,
    },
    0.3,
    TAX_RATE,
    NISA_ANNUAL_LIMIT,
    NISA_LIFETIME_LIMIT,
  );
  assert.strictEqual(r.info, null);
});

test("rebalanceTriBuckets - リスク売却ケースは特定優先・NISA非課税", () => {
  // riskSide=800 (特定600 + NISA200), defense=200, target=0.3 → 100売却
  const r = rebalanceTriBuckets(
    {
      nisaTotal: 200,
      nisaPrincipal: 100, // 含み益あり、ただし非課税
      taxableRiskTotal: 600,
      taxableRiskPrincipal: 300, // 含み益あり
      defenseTotal: 200,
      defensePrincipal: 200,
    },
    0.3,
    TAX_RATE,
    NISA_ANNUAL_LIMIT,
    NISA_LIFETIME_LIMIT,
  );
  assert.ok(r.info != null);
  assert.strictEqual(r.info!.direction, "risk-to-defense");
  // 100は特定リスク内で賄える → NISAから売らない
  assert.ok(Math.abs(r.state.taxableRiskTotal - (600 - 100 - 100 * 0.5 * TAX_RATE)) < 1e-6);
  assert.strictEqual(r.state.nisaTotal, 200);
  assert.strictEqual(r.info!.nisaUsed, 0);
});

test("rebalanceTriBuckets - 特定リスク不足分はNISAから売却（非課税）", () => {
  // riskSide=1000 (特定50 + NISA950), defense=0, target=0.3 → 300売却 → 特定50枯渇後NISAから250
  const r = rebalanceTriBuckets(
    {
      nisaTotal: 950,
      nisaPrincipal: 500,
      taxableRiskTotal: 50,
      taxableRiskPrincipal: 50,
      defenseTotal: 0,
      defensePrincipal: 0,
    },
    0.3,
    TAX_RATE,
    NISA_ANNUAL_LIMIT,
    NISA_LIFETIME_LIMIT,
  );
  assert.ok(r.info != null);
  assert.ok(r.state.nisaTotal < 950, `nisa=${r.state.nisaTotal}`);
  assert.ok(r.state.taxableRiskTotal < 50, `taxable=${r.state.taxableRiskTotal}`);
  // 売却額300 ÷ NISAの含み益比率は計算に影響しない（非課税）
  // 特定リスクは50/50（含み益なし）なので税ゼロ
  assert.strictEqual(r.info!.taxAmount, 0);
});

test("rebalanceTriBuckets - 防衛売却→リスクサイド買付はNISA枠優先", () => {
  // riskSide=400, defense=600, target=0.3 → 300買付
  const r = rebalanceTriBuckets(
    {
      nisaTotal: 100,
      nisaPrincipal: 100,
      taxableRiskTotal: 300,
      taxableRiskPrincipal: 300,
      defenseTotal: 600,
      defensePrincipal: 600,
    },
    0.3,
    0, // 計算簡略化のため非課税
    NISA_ANNUAL_LIMIT,
    NISA_LIFETIME_LIMIT,
  );
  assert.ok(r.info != null);
  assert.strictEqual(r.info!.direction, "defense-to-risk");
  // 300全額NISAへ
  assert.strictEqual(r.info!.nisaUsed, 300);
  assert.strictEqual(r.state.nisaTotal, 400);
  assert.strictEqual(r.state.taxableRiskTotal, 300);
});

test("rebalanceTriBuckets - 買付時NISA枠なしなら全額特定リスクへ", () => {
  const r = rebalanceTriBuckets(
    {
      nisaTotal: 100,
      nisaPrincipal: 100,
      taxableRiskTotal: 300,
      taxableRiskPrincipal: 300,
      defenseTotal: 600,
      defensePrincipal: 600,
    },
    0.3,
    0,
    0, // 年枠なし
    0, // 生涯枠なし
  );
  assert.ok(r.info != null);
  assert.strictEqual(r.info!.nisaUsed, 0);
  assert.strictEqual(r.state.nisaTotal, 100);
  assert.strictEqual(r.state.taxableRiskTotal, 600);
});

// --- executeNisaTransfer ---

test("executeNisaTransfer - 特定残高ゼロは何もしない", () => {
  const r = executeNisaTransfer(0, 0, 0, 0, 1000, TAX_RATE);
  assert.strictEqual(r.info, null);
});

test("executeNisaTransfer - targetProceeds=0は何もしない", () => {
  const r = executeNisaTransfer(10000, 10000, 0, 0, 0, TAX_RATE);
  assert.strictEqual(r.info, null);
});

test("executeNisaTransfer - 含み益なしならsellAmount=proceeds", () => {
  // total=1000, principal=1000 → gainRatio=0 → sellAmount=proceeds
  const r = executeNisaTransfer(10000, 10000, 0, 0, 1000, TAX_RATE);
  assert.ok(r.info != null);
  assert.strictEqual(r.info!.taxAmount, 0);
  assert.strictEqual(r.info!.sellAmount, 1000);
  assert.strictEqual(r.info!.proceeds, 1000);
  assert.strictEqual(r.taxableRiskTotal, 9000);
  assert.strictEqual(r.nisaTotal, 1000);
});

test("executeNisaTransfer - 含み益ありはproceedsが枠ぴったり", () => {
  // total=20000, principal=10000 → gainRatio=0.5, denom=1-0.5*TAX_RATE
  // sellAmount = 1000/denom → proceeds = 1000 ぴったり
  const r = executeNisaTransfer(20000, 10000, 0, 0, 1000, TAX_RATE);
  assert.ok(r.info != null);
  assert.ok(Math.abs(r.info!.proceeds - 1000) < 1e-6);
  assert.ok(r.info!.taxAmount > 0);
});

// --- calculateCompound ---

test("calculateCompound - year=0は初期値", () => {
  const { yearly } = calculateCompound(BASE_PARAMS);
  assert.strictEqual(yearly[0]!.year, 0);
  assert.strictEqual(yearly[0]!.yearlyWithdrawal, 0);
  assert.strictEqual(yearly[0]!.yearlyPension, 0);
  assert.strictEqual(yearly[0]!.total, 1000000);
});

test("calculateCompound - 配列長はtotalYears+1", () => {
  const params = { ...BASE_PARAMS, withdrawalStartYear: 5, withdrawalYears: 10 };
  const { yearly } = calculateCompound(params);
  assert.strictEqual(yearly.length, 16); // 0..15
});

test("calculateCompound - 全額NISAではtax=0", () => {
  const params = { ...BASE_PARAMS, ...nisaOnly(1000000) };
  const { yearly } = calculateCompound(params);
  for (const row of yearly) {
    assert.strictEqual(row.tax, 0);
  }
});

test("calculateCompound - 利回り0で元本が積立通りに増える（NISA口座）", () => {
  const params: CalculateParams = {
    ...BASE_PARAMS,
    ...nisaOnly(100000),
    monthlyContribution: 10000,
    annualReturnRate: 0,
    expenseRatio: 0,
    contributionYears: 1,
    withdrawalStartYear: 1,
    withdrawalYears: 0,
  };
  const { yearly } = calculateCompound(params);
  const year1 = yearly[1]!;
  // 100000 + 10000*12 = 220000、全額NISAに入る（10000 * 12 = 120000は年枠360万以内）
  assert.strictEqual(year1.total, 220000);
});

test("calculateCompound - currentAge を起点に age が year ごとに加算される", () => {
  const params = { ...BASE_PARAMS, currentAge: 40 };
  const { yearly } = calculateCompound(params);
  assert.strictEqual(yearly[0]!.age, 40);
  assert.strictEqual(yearly[1]!.age, 41);
});

// --- calculateCompound: rate-risk モード ---

test("calculateCompound (rate-risk) - 初年度はリスクサイド×率の概算で取り崩される", () => {
  const params: CalculateParams = {
    ...BASE_PARAMS,
    ...nisaOnly(1000000),
    annualReturnRate: 0,
    withdrawalStartYear: 1,
    withdrawalYears: 5,
    withdrawalMode: "rate-risk",
    withdrawalRate: 4,
  };
  const { yearly } = calculateCompound(params);
  assert.ok(Math.abs(yearly[2]!.yearlyWithdrawal - 40000) < 1);
});

test("calculateCompound (rate-risk) - 資産が減れば翌年の引出額も減る", () => {
  const params: CalculateParams = {
    ...BASE_PARAMS,
    ...nisaOnly(1000000),
    monthlyContribution: 0,
    annualReturnRate: 0,
    expenseRatio: 0,
    inflationRate: 0,
    contributionYears: 0,
    withdrawalStartYear: 0,
    withdrawalYears: 5,
    withdrawalMode: "rate-risk",
    withdrawalRate: 10,
  };
  const { yearly } = calculateCompound(params);
  assert.ok(yearly[2]!.yearlyWithdrawal < yearly[1]!.yearlyWithdrawal);
});

test("calculateCompound (rate-risk) - Trinity モードと違ってインフレ調整されない", () => {
  const base: CalculateParams = {
    ...BASE_PARAMS,
    ...nisaOnly(10000000),
    monthlyContribution: 0,
    annualReturnRate: 0,
    expenseRatio: 0,
    inflationRate: 3,
    contributionYears: 0,
    withdrawalStartYear: 0,
    withdrawalYears: 5,
    withdrawalRate: 4,
  };
  const trinity = calculateCompound({ ...base, withdrawalMode: "rate" }).yearly;
  const riskBased = calculateCompound({ ...base, withdrawalMode: "rate-risk" }).yearly;
  assert.ok(Math.abs(trinity[1]!.yearlyWithdrawal - riskBased[1]!.yearlyWithdrawal) < 1000);
  assert.ok(trinity[2]!.yearlyWithdrawal > riskBased[2]!.yearlyWithdrawal);
});

test("calculateCompound (rate-risk) - 防衛資産は基準から除外される", () => {
  // 同じ総資産でも防衛が大きいほど引出額が小さい
  const noDefense: CalculateParams = {
    ...BASE_PARAMS,
    ...nisaOnly(10000000),
    initialDefense: 0,
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
  };
  const halfDefense: CalculateParams = {
    ...BASE_PARAMS,
    initialNisa: 5000000,
    initialTaxableRisk: 0,
    initialDefense: 5000000,
    targetDefenseRatioStart: 50,
    targetDefenseRatioEnd: 50,
    glidePathEndAge: 65,
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
  };
  const no = calculateCompound(noDefense).yearly;
  const half = calculateCompound(halfDefense).yearly;
  assert.ok(no[1]!.yearlyWithdrawal > half[1]!.yearlyWithdrawal);
  assert.ok(Math.abs(half[1]!.yearlyWithdrawal * 2 - no[1]!.yearlyWithdrawal) < 1000);
});

test("calculateCompound (rate-risk) - 防衛なしでも正常動作", () => {
  const params: CalculateParams = {
    ...BASE_PARAMS,
    ...nisaOnly(1000000),
    monthlyContribution: 0,
    contributionYears: 0,
    withdrawalStartYear: 0,
    withdrawalYears: 3,
    withdrawalMode: "rate-risk",
    withdrawalRate: 4,
  };
  const { yearly } = calculateCompound(params);
  assert.strictEqual(yearly.length, 4);
  for (const row of yearly) {
    assert.ok(Number.isFinite(row.total));
    assert.ok(Number.isFinite(row.yearlyWithdrawal));
  }
});

// --- monthly projection ---

test("calculateCompound - monthly の長さは 12 × totalYears", () => {
  const params: CalculateParams = {
    ...BASE_PARAMS,
    contributionYears: 5,
    withdrawalStartYear: 5,
    withdrawalYears: 10,
  };
  const result = calculateCompound(params);
  assert.strictEqual(result.monthly.length, 12 * 15);
});

test("calculateCompound - monthly[0] は year=1, month=1", () => {
  const result = calculateCompound(BASE_PARAMS);
  const first = result.monthly[0]!;
  assert.strictEqual(first.year, 1);
  assert.strictEqual(first.month, 1);
});

test("calculateCompound - monthly の年末12月の total は yearly.total と一致（NISA口座）", () => {
  // 全額NISAなら年末追加税0なので一致
  const params: CalculateParams = {
    ...BASE_PARAMS,
    ...nisaOnly(1000000),
    withdrawalYears: 3,
  };
  const result = calculateCompound(params);
  for (let y = 1; y <= 3; y++) {
    const monthEnd = result.monthly[y * 12 - 1]!;
    assert.strictEqual(monthEnd.year, y);
    assert.strictEqual(monthEnd.month, 12);
    assert.strictEqual(monthEnd.total, result.yearly[y]!.total);
  }
});

test("calculateCompound - 高乖離初期値で1ヶ月目に rebalanced=true が立つ", () => {
  // 特定リスク 700万 + 防衛 300万 → 防衛比率30%
  // defenseAnnualReturnRate を異常値にして1ヶ月で乖離を起こす
  const params: CalculateParams = {
    ...BASE_PARAMS,
    initialTaxableRisk: 700000,
    initialDefense: 300000,
    targetDefenseRatioStart: 30,
    targetDefenseRatioEnd: 30,
    glidePathEndAge: 65,
    annualReturnRate: 5,
    defenseAnnualReturnRate: 200,
    rebalanceThresholdPoint: 1,
    withdrawalYears: 1,
  };
  const result = calculateCompound(params);
  const rebalanced = result.monthly.some((m) => m.rebalanceInfo != null);
  assert.ok(rebalanced, "リバランスが発生する月が少なくとも1つ存在すべき");
});

test("calculateCompound - 利回り0なら monthlyGain は 0、正利回りなら正", () => {
  const zero = calculateCompound({ ...BASE_PARAMS, annualReturnRate: 0, expenseRatio: 0 });
  assert.ok(zero.monthly.every((m) => m.monthlyGain === 0));

  const positive = calculateCompound({ ...BASE_PARAMS, annualReturnRate: 5, expenseRatio: 0 });
  assert.ok(positive.monthly[0]!.monthlyGain > 0);
});

test("calculateCompound - 利回り0なら monthlyRate は 0", () => {
  const { monthly } = calculateCompound({
    ...BASE_PARAMS,
    annualReturnRate: 0,
    expenseRatio: 0,
  });
  assert.ok(monthly.every((m) => m.monthlyRate === 0));
});

test("calculateCompound - 単一バケット（特定のみ）では monthlyRate が月次換算レートに一致", () => {
  const { monthly } = calculateCompound({
    ...BASE_PARAMS,
    initialTaxableRisk: 10000000,
    monthlyContribution: 0,
    annualReturnRate: 12,
    expenseRatio: 0,
    contributionYears: 0,
    withdrawalStartYear: 1,
    withdrawalYears: 0,
  });
  const expected = Math.pow(1.12, 1 / 12) - 1;
  assert.ok(Math.abs(monthly[0]!.monthlyRate - expected) < 1e-9);
});

test("calculateCompound - 2バケット（特定リスク+防衛）では monthlyRate が両バケット月率の加重平均（取り崩し前）", () => {
  const { monthly } = calculateCompound({
    ...BASE_PARAMS,
    initialTaxableRisk: 5000000,
    initialDefense: 5000000,
    monthlyContribution: 0,
    annualReturnRate: 10,
    expenseRatio: 0,
    defenseAnnualReturnRate: 2,
    contributionYears: 0,
    withdrawalStartYear: 1,
    withdrawalYears: 0,
  });
  const rRisk = Math.pow(1.10, 1 / 12) - 1;
  const rDef = Math.pow(1.02, 1 / 12) - 1;
  const expected = 0.5 * rRisk + 0.5 * rDef;
  assert.ok(Math.abs(monthly[0]!.monthlyRate - expected) < 1e-9);
});

// --- defensePriorityOnDrawdown ---

test("calculateCompound - defensePriorityOnDrawdown=true は平時リスク優先で防衛資産を温存", () => {
  // NISA口座 700万 + 防衛 300万、月10万を1年取り崩し → リスク700-120=580万、防衛300万不変
  const { monthly } = calculateCompound({
    ...BASE_PARAMS,
    initialNisa: 7000000,
    initialTaxableRisk: 0,
    initialDefense: 3000000,
    targetDefenseRatioStart: 30,
    targetDefenseRatioEnd: 30,
    glidePathEndAge: 65,
    monthlyContribution: 0,
    annualReturnRate: 0,
    expenseRatio: 0,
    defenseAnnualReturnRate: 0,
    contributionYears: 0,
    withdrawalStartYear: 0,
    withdrawalYears: 5,
    fixedMonthlyWithdrawal: 100000,
    rebalanceThresholdPoint: 100,
    defensePriorityOnDrawdown: true,
  });
  const month12 = monthly[11]!;
  assert.ok(Math.abs(month12.riskTotal - 5800000) < 1, `risk=${month12.riskTotal}`);
  assert.strictEqual(month12.defenseTotal, 3000000);
});

test("calculateCompound - defensePriorityOnDrawdown=false は時価比率按分で両資産が減る", () => {
  const { monthly } = calculateCompound({
    ...BASE_PARAMS,
    initialNisa: 7000000,
    initialTaxableRisk: 0,
    initialDefense: 3000000,
    targetDefenseRatioStart: 30,
    targetDefenseRatioEnd: 30,
    glidePathEndAge: 65,
    monthlyContribution: 0,
    annualReturnRate: 0,
    expenseRatio: 0,
    defenseAnnualReturnRate: 0,
    contributionYears: 0,
    withdrawalStartYear: 0,
    withdrawalYears: 5,
    fixedMonthlyWithdrawal: 100000,
    rebalanceThresholdPoint: 100,
    defensePriorityOnDrawdown: false,
  });
  const month12 = monthly[11]!;
  assert.ok(month12.defenseTotal < 3000000, `defense=${month12.defenseTotal}`);
});

test("calculateCompound - defensePriorityOnDrawdown=true でリスク枯渇後は防衛から取り崩し", () => {
  const { monthly } = calculateCompound({
    ...BASE_PARAMS,
    initialNisa: 5000000,
    initialTaxableRisk: 0,
    initialDefense: 5000000,
    targetDefenseRatioStart: 50,
    targetDefenseRatioEnd: 50,
    glidePathEndAge: 65,
    monthlyContribution: 0,
    annualReturnRate: 0,
    expenseRatio: 0,
    defenseAnnualReturnRate: 0,
    contributionYears: 0,
    withdrawalStartYear: 0,
    withdrawalYears: 20,
    fixedMonthlyWithdrawal: 100000,
    rebalanceThresholdPoint: 100,
    defensePriorityOnDrawdown: true,
  });
  const last = monthly[monthly.length - 1]!;
  assert.strictEqual(last.riskTotal, 0);
  assert.ok(last.defenseTotal < 5000000);
});

test("calculateCompound - 防衛なしでも defensePriorityOnDrawdown=true で完走", () => {
  const result = calculateCompound({
    ...BASE_PARAMS,
    ...nisaOnly(1000000),
    initialDefense: 0,
    defensePriorityOnDrawdown: true,
    withdrawalStartYear: 0,
    withdrawalYears: 5,
  });
  for (const y of result.yearly) {
    assert.ok(Number.isFinite(y.total));
  }
});

// --- 月額下限/上限のクランプ ---

test("calculateCompound (rate) - 下限指定で計算月額が下限未満なら下限に持ち上がる", () => {
  const result = calculateCompound({
    ...BASE_PARAMS,
    ...nisaOnly(100000000),
    annualReturnRate: 0,
    inflationRate: 0,
    withdrawalRate: 0.1,
    withdrawalMode: "rate",
    withdrawalStartYear: 0,
    withdrawalYears: 5,
    withdrawalLimitSchedule: limit(100000, null),
  });
  assert.ok(Math.abs(result.yearly[1]!.yearlyWithdrawal - 100000 * 12) < 1);
});

test("calculateCompound (rate) - 上限指定で計算月額が上限超過なら上限で抑制される", () => {
  const result = calculateCompound({
    ...BASE_PARAMS,
    ...nisaOnly(100000000),
    annualReturnRate: 0,
    inflationRate: 0,
    withdrawalRate: 10,
    withdrawalMode: "rate",
    withdrawalStartYear: 0,
    withdrawalYears: 3,
    withdrawalLimitSchedule: limit(null, 300000),
  });
  assert.ok(Math.abs(result.yearly[1]!.yearlyWithdrawal - 300000 * 12) < 1);
});

test("calculateCompound (rate) - 下限がインフレ連動して名目で毎年増える", () => {
  const result = calculateCompound({
    ...BASE_PARAMS,
    ...nisaOnly(100000000),
    annualReturnRate: 0,
    inflationRate: 2,
    withdrawalRate: 0.01,
    withdrawalMode: "rate",
    withdrawalStartYear: 0,
    withdrawalYears: 5,
    withdrawalLimitSchedule: limit(100000, null),
  });
  const expected1 = 100000 * 1.02 * 12;
  assert.ok(Math.abs(result.yearly[1]!.yearlyWithdrawal - expected1) < 1);
  const expected5 = 100000 * Math.pow(1.02, 5) * 12;
  assert.ok(Math.abs(result.yearly[5]!.yearlyWithdrawal - expected5) < 1);
});

test("calculateCompound (rate) - 下限>上限のとき上限が優先される", () => {
  const result = calculateCompound({
    ...BASE_PARAMS,
    ...nisaOnly(100000000),
    annualReturnRate: 0,
    inflationRate: 0,
    withdrawalRate: 5,
    withdrawalMode: "rate",
    withdrawalStartYear: 0,
    withdrawalYears: 3,
    withdrawalLimitSchedule: limit(500000, 200000),
  });
  assert.ok(Math.abs(result.yearly[1]!.yearlyWithdrawal - 200000 * 12) < 1);
});

test("calculateCompound (rate) - 下限指定で資産枯渇が早まる", () => {
  const base: CalculateParams = {
    ...BASE_PARAMS,
    ...nisaOnly(10000000),
    annualReturnRate: 0,
    expenseRatio: 0,
    inflationRate: 0,
    withdrawalRate: 2,
    withdrawalMode: "rate" as const,
    withdrawalStartYear: 0,
    withdrawalYears: 10,
  };
  const withFloor = calculateCompound({
    ...base,
    withdrawalLimitSchedule: limit(150000, null),
  });
  const withoutFloor = calculateCompound({
    ...base,
    withdrawalLimitSchedule: limit(null, null),
  });
  const sum = (r: typeof withFloor) =>
    r.yearly.reduce((acc, y) => acc + y.yearlyWithdrawal, 0);
  assert.ok(sum(withFloor) > sum(withoutFloor));
  const lastWithFloor = withFloor.yearly[withFloor.yearly.length - 1]!;
  const lastWithoutFloor = withoutFloor.yearly[withoutFloor.yearly.length - 1]!;
  assert.ok(lastWithFloor.total < lastWithoutFloor.total);
});

test("calculateCompound (rate-risk) - 下限指定が効く", () => {
  const result = calculateCompound({
    ...BASE_PARAMS,
    ...nisaOnly(100000000),
    annualReturnRate: 0,
    inflationRate: 0,
    withdrawalRate: 0.1,
    withdrawalMode: "rate-risk",
    withdrawalStartYear: 0,
    withdrawalYears: 3,
    withdrawalLimitSchedule: limit(80000, null),
  });
  assert.ok(Math.abs(result.yearly[1]!.yearlyWithdrawal - 80000 * 12) < 1);
});

test("calculateCompound (rate-risk) - 上限指定が効く", () => {
  const result = calculateCompound({
    ...BASE_PARAMS,
    ...nisaOnly(100000000),
    annualReturnRate: 0,
    inflationRate: 0,
    withdrawalRate: 10,
    withdrawalMode: "rate-risk",
    withdrawalStartYear: 0,
    withdrawalYears: 3,
    withdrawalLimitSchedule: limit(null, 250000),
  });
  assert.ok(Math.abs(result.yearly[1]!.yearlyWithdrawal - 250000 * 12) < 1);
});

test("calculateCompound (amount) - 下限/上限指定は無視される", () => {
  const base: CalculateParams = {
    ...BASE_PARAMS,
    ...nisaOnly(10000000),
    annualReturnRate: 0,
    inflationRate: 0,
    withdrawalMode: "amount" as const,
    fixedMonthlyWithdrawal: 50000,
    withdrawalStartYear: 0,
    withdrawalYears: 3,
  };
  const withClamp = calculateCompound({
    ...base,
    withdrawalLimitSchedule: limit(200000, 10000),
  });
  const withoutClamp = calculateCompound({
    ...base,
    withdrawalLimitSchedule: limit(null, null),
  });
  for (let i = 0; i < withClamp.yearly.length; i++) {
    assert.strictEqual(withClamp.yearly[i]!.total, withoutClamp.yearly[i]!.total);
    assert.strictEqual(
      withClamp.yearly[i]!.yearlyWithdrawal,
      withoutClamp.yearly[i]!.yearlyWithdrawal,
    );
  }
});

test("calculateCompound (rate) - 下限のみ指定でも上限のみ指定でも正常動作", () => {
  const onlyFloor = calculateCompound({
    ...BASE_PARAMS,
    ...nisaOnly(10000000),
    inflationRate: 0,
    withdrawalRate: 4,
    withdrawalMode: "rate",
    withdrawalStartYear: 0,
    withdrawalYears: 5,
    withdrawalLimitSchedule: limit(50000, null),
  });
  const onlyCeiling = calculateCompound({
    ...BASE_PARAMS,
    ...nisaOnly(10000000),
    inflationRate: 0,
    withdrawalRate: 4,
    withdrawalMode: "rate",
    withdrawalStartYear: 0,
    withdrawalYears: 5,
    withdrawalLimitSchedule: limit(null, 80000),
  });
  for (const y of onlyFloor.yearly) assert.ok(Number.isFinite(y.total));
  for (const y of onlyCeiling.yearly) assert.ok(Number.isFinite(y.total));
});

test("calculateCompound (rate) - インフレ率0で下限が一定", () => {
  const result = calculateCompound({
    ...BASE_PARAMS,
    ...nisaOnly(100000000),
    annualReturnRate: 0,
    inflationRate: 0,
    withdrawalRate: 0.01,
    withdrawalMode: "rate",
    withdrawalStartYear: 0,
    withdrawalYears: 5,
    withdrawalLimitSchedule: limit(100000, null),
  });
  for (let y = 1; y <= 5; y++) {
    assert.ok(Math.abs(result.yearly[y]!.yearlyWithdrawal - 100000 * 12) < 1);
  }
});

test("calculateCompound (rate) - 下限が資産を超える場合は資産残以下に丸まる", () => {
  const result = calculateCompound({
    ...BASE_PARAMS,
    ...nisaOnly(1000000),
    annualReturnRate: 0,
    inflationRate: 0,
    withdrawalRate: 4,
    withdrawalMode: "rate",
    withdrawalStartYear: 0,
    withdrawalYears: 5,
    withdrawalLimitSchedule: limit(500000, null),
  });
  const last = result.yearly[result.yearly.length - 1]!;
  assert.ok(last.total === 0 || last.total < 100);
  for (const y of result.yearly) assert.ok(Number.isFinite(y.total));
});

test("calculateCompound (rate) - iDeCo 残高が基準額に含まれる（MC との整合）", () => {
  const base: CalculateParams = {
    ...BASE_PARAMS,
    ...nisaOnly(10000000),
    annualReturnRate: 0,
    expenseRatio: 0,
    inflationRate: 0,
    contributionYears: 0,
    withdrawalStartYear: 0,
    withdrawalYears: 1,
    withdrawalMode: "rate",
    withdrawalRate: 4,
    currentAge: 60,
  };
  const withoutIdeco = calculateCompound(base);
  const withIdeco = calculateCompound({
    ...base,
    idecoEnabled: true,
    ideco: {
      ...BASE_PARAMS.ideco,
      initialIdeco: 5000000,
      idecoReceiveStartAge: 65,
    },
  });

  assert.ok(Math.abs(withoutIdeco.monthly[0]!.rateWithdrawalBasis! - 10000000) < 1);
  assert.ok(Math.abs(withIdeco.monthly[0]!.rateWithdrawalBasis! - 15000000) < 1);
  assert.ok(
    Math.abs(
      withIdeco.yearly[1]!.yearlyWithdrawal -
        withoutIdeco.yearly[1]!.yearlyWithdrawal * 1.5,
    ) < 1000,
  );
});

// --- otherIncomes (期間付き複数件) ---

test("calculateCompound (otherIncomes) - 単一件・期間内で年合計に反映", () => {
  const result = calculateCompound({
    ...BASE_PARAMS,
    ...nisaOnly(10000000),
    annualReturnRate: 0,
    expenseRatio: 0,
    inflationRate: 0,
    contributionYears: 0,
    withdrawalStartYear: 0,
    withdrawalYears: 5,
    fixedMonthlyWithdrawal: 50000,
    otherIncomes: [{ monthlyAmount: 10000, startYearOffset: 0, endYearOffset: 5 }],
  });
  for (let y = 1; y <= 5; y++) {
    assert.strictEqual(result.yearly[y]!.yearlyOtherIncome, 10000 * 12);
  }
});

test("calculateCompound (otherIncomes) - 複数件の合算（重複期間は足し合わせ）", () => {
  const result = calculateCompound({
    ...BASE_PARAMS,
    ...nisaOnly(10000000),
    annualReturnRate: 0,
    inflationRate: 0,
    contributionYears: 0,
    withdrawalStartYear: 0,
    withdrawalYears: 5,
    fixedMonthlyWithdrawal: 50000,
    otherIncomes: [
      { monthlyAmount: 10000, startYearOffset: 0, endYearOffset: 3 },
      { monthlyAmount: 5000, startYearOffset: 1, endYearOffset: 4 },
    ],
  });
  assert.strictEqual(result.yearly[1]!.yearlyOtherIncome, 10000 * 12);
  assert.strictEqual(result.yearly[2]!.yearlyOtherIncome, 15000 * 12);
  assert.strictEqual(result.yearly[3]!.yearlyOtherIncome, 15000 * 12);
  assert.strictEqual(result.yearly[4]!.yearlyOtherIncome, 5000 * 12);
  assert.strictEqual(result.yearly[5]!.yearlyOtherIncome, 0);
});

test("calculateCompound (otherIncomes) - 期間外は加算されない（取り崩し額には影響しない）", () => {
  const params: CalculateParams = {
    ...BASE_PARAMS,
    ...nisaOnly(10000000),
    annualReturnRate: 0,
    inflationRate: 0,
    contributionYears: 0,
    withdrawalStartYear: 0,
    withdrawalYears: 5,
    fixedMonthlyWithdrawal: 100000,
    otherIncomes: [{ monthlyAmount: 100000, startYearOffset: 10, endYearOffset: 20 }],
  };
  const result = calculateCompound(params);
  for (let y = 1; y <= 5; y++) {
    assert.strictEqual(result.yearly[y]!.yearlyOtherIncome, 0);
  }
});

test("calculateCompound (otherIncomes) - 他収入で取り崩しが減額される", () => {
  const result = calculateCompound({
    ...BASE_PARAMS,
    ...nisaOnly(10000000),
    annualReturnRate: 0,
    inflationRate: 0,
    contributionYears: 0,
    withdrawalStartYear: 0,
    withdrawalYears: 5,
    fixedMonthlyWithdrawal: 50000,
    otherIncomes: [{ monthlyAmount: 30000, startYearOffset: 0, endYearOffset: 5 }],
  });
  assert.strictEqual(result.yearly[1]!.yearlyWithdrawal, 20000 * 12);
});

test("calculateCompound (otherIncomes) - 空配列は従来挙動と同じ（yearlyOtherIncome=0）", () => {
  const result = calculateCompound({ ...BASE_PARAMS, otherIncomes: [] });
  for (const y of result.yearly) {
    assert.strictEqual(y.yearlyOtherIncome, 0);
  }
});

// =====================================================================
// 新シナリオ: 3バケット初期化 / NISA振替 / 取り崩し優先順位 / 夫婦モード / リバランス
// =====================================================================

test("calculateCompound (init) - 初期 NISA/特定/防衛 が year=0 で正しく初期化される", () => {
  const params: CalculateParams = {
    ...BASE_PARAMS,
    initialNisa: 3000000,
    initialNisaGain: 500000,
    initialTaxableRisk: 2000000,
    initialTaxableRiskGain: 300000,
    initialDefense: 1000000,
    initialDefenseGain: 100000,
    withdrawalYears: 1,
  };
  const { yearly } = calculateCompound(params);
  const y0 = yearly[0]!;
  assert.strictEqual(y0.nisaTotal, 3000000);
  assert.strictEqual(y0.taxableRiskTotal, 2000000);
  assert.strictEqual(y0.defenseTotal, 1000000);
  assert.strictEqual(y0.total, 6000000);
  // 元本 = total - gain = 5100000
  assert.strictEqual(y0.principal, 5100000);
});

test("calculateCompound (init) - 初期含み益は特定/防衛では課税対象、NISAでは非課税", () => {
  // 含み益が同額でも、NISAなら取り崩し時の税ゼロ。
  // 1年で全額取り崩しを比較する。
  const baseParams: CalculateParams = {
    ...BASE_PARAMS,
    annualReturnRate: 0,
    expenseRatio: 0,
    contributionYears: 0,
    withdrawalStartYear: 0,
    withdrawalYears: 1,
    fixedMonthlyWithdrawal: 100000, // 月10万 × 12 = 120万を取り崩し
  };
  const nisaCase = calculateCompound({
    ...baseParams,
    initialNisa: 2000000,
    initialNisaGain: 1000000, // 含み益100万
    initialTaxableRisk: 0,
  });
  const taxableCase = calculateCompound({
    ...baseParams,
    initialNisa: 0,
    initialTaxableRisk: 2000000,
    initialTaxableRiskGain: 1000000,
  });
  // NISAは課税ゼロ → 取り崩し額 = 120万、残高 = 80万
  // 特定は含み益按分課税で取り崩し額 + 税 が引かれる → 残高は80万より少ない
  assert.strictEqual(nisaCase.yearly[1]!.tax, 0);
  assert.ok(taxableCase.yearly[1]!.tax > 0);
  // 取り崩し額自体は同じ
  assert.strictEqual(nisaCase.yearly[1]!.yearlyWithdrawal, 1200000);
  assert.strictEqual(taxableCase.yearly[1]!.yearlyWithdrawal, 1200000);
});

test("calculateCompound (contribution) - 月10万積立 → 全額NISA、年枠120万消費", () => {
  const params: CalculateParams = {
    ...BASE_PARAMS,
    initialNisa: 0,
    initialTaxableRisk: 0,
    initialDefense: 0,
    monthlyContribution: 100000,
    annualReturnRate: 0,
    expenseRatio: 0,
    contributionYears: 1,
    withdrawalStartYear: 1,
    withdrawalYears: 0,
  };
  const { yearly } = calculateCompound(params);
  assert.strictEqual(yearly[1]!.nisaTotal, 1200000);
  assert.strictEqual(yearly[1]!.taxableRiskTotal, 0);
  assert.strictEqual(yearly[1]!.nisaLifetimeUsed, 1200000);
});

test("calculateCompound (contribution) - 月50万積立 → NISA枠360万到達後は特定へ", () => {
  const params: CalculateParams = {
    ...BASE_PARAMS,
    initialNisa: 0,
    initialTaxableRisk: 0,
    initialDefense: 0,
    monthlyContribution: 500000,
    annualReturnRate: 0,
    expenseRatio: 0,
    contributionYears: 1,
    withdrawalStartYear: 1,
    withdrawalYears: 0,
  };
  const { yearly } = calculateCompound(params);
  // 年枠360万 + 残り240万は特定 → NISA=360万、特定=240万
  assert.strictEqual(yearly[1]!.nisaTotal, NISA_ANNUAL_LIMIT);
  assert.strictEqual(yearly[1]!.taxableRiskTotal, 500000 * 12 - NISA_ANNUAL_LIMIT);
});

test("calculateCompound (transfer) - 積立期+振替enabled で月10万積立+特定2000万 → 年初に240万一括振替", () => {
  // 含み益なしのケースで税0、proceeds=240万分が振替される
  const params: CalculateParams = {
    ...BASE_PARAMS,
    initialNisa: 0,
    initialTaxableRisk: 20000000,
    initialTaxableRiskGain: 0, // 含み益なし
    initialDefense: 0,
    monthlyContribution: 100000,
    annualReturnRate: 0,
    expenseRatio: 0,
    contributionYears: 1,
    withdrawalStartYear: 1,
    withdrawalYears: 0,
    nisaTransferEnabled: true,
  };
  const result = calculateCompound(params);
  // 年初一括振替: 360万 - 月積立年間120万 = 240万
  const m0 = result.monthly[0]!;
  assert.ok(m0.nisaTransferInfo != null);
  assert.ok(Math.abs(m0.nisaTransferInfo!.proceeds - 2400000) < 1);
  assert.strictEqual(m0.nisaTransferInfo!.taxAmount, 0);
  // 年末: NISA = 240万(振替) + 120万(月次積立) = 360万
  assert.strictEqual(result.yearly[1]!.nisaLifetimeUsed, NISA_ANNUAL_LIMIT);
});

test("calculateCompound (transfer) - 含み益ありの振替で按分課税が発生", () => {
  const params: CalculateParams = {
    ...BASE_PARAMS,
    initialNisa: 0,
    initialTaxableRisk: 20000000,
    initialTaxableRiskGain: 10000000, // 含み益50%
    initialDefense: 0,
    monthlyContribution: 100000,
    annualReturnRate: 0,
    expenseRatio: 0,
    contributionYears: 1,
    withdrawalStartYear: 1,
    withdrawalYears: 0,
    nisaTransferEnabled: true,
  };
  const result = calculateCompound(params);
  const m0 = result.monthly[0]!;
  assert.ok(m0.nisaTransferInfo != null);
  // proceeds=240万 ぴったり（年枠ベースで埋める設計）
  assert.ok(Math.abs(m0.nisaTransferInfo!.proceeds - 2400000) < 1);
  assert.ok(m0.nisaTransferInfo!.taxAmount > 0);
});

test("calculateCompound (coupled) - 夫婦モードで年枠720万・生涯3600万に拡張", () => {
  const params: CalculateParams = {
    ...BASE_PARAMS,
    initialNisa: 0,
    initialTaxableRisk: 50000000,
    initialTaxableRiskGain: 0,
    initialDefense: 0,
    monthlyContribution: 100000,
    annualReturnRate: 0,
    expenseRatio: 0,
    contributionYears: 1,
    withdrawalStartYear: 1,
    withdrawalYears: 0,
    nisaTransferEnabled: true,
    isCoupled: true,
  };
  const result = calculateCompound(params);
  // 年枠720万 - 月積立年間120万 = 600万を振替
  const m0 = result.monthly[0]!;
  assert.ok(m0.nisaTransferInfo != null);
  assert.ok(Math.abs(m0.nisaTransferInfo!.proceeds - 6000000) < 1);
  // 年末: NISA = 600万(振替) + 120万(月次積立) = 720万
  assert.strictEqual(result.yearly[1]!.nisaLifetimeUsed, NISA_ANNUAL_LIMIT * 2);
});

test("calculateCompound (transfer) - 生涯枠埋まりで振替されない", () => {
  const params: CalculateParams = {
    ...BASE_PARAMS,
    initialNisa: 0,
    initialTaxableRisk: 20000000,
    initialDefense: 0,
    monthlyContribution: 0,
    annualReturnRate: 0,
    expenseRatio: 0,
    contributionYears: 0,
    withdrawalStartYear: 1,
    withdrawalYears: 0,
    nisaTransferEnabled: true,
    nisaInitialLifetimeUsed: NISA_LIFETIME_LIMIT, // 既に埋まっている
  };
  const result = calculateCompound(params);
  const m0 = result.monthly[0]!;
  assert.strictEqual(m0.nisaTransferInfo, null);
  assert.strictEqual(result.yearly[1]!.nisaTotal, 0);
  assert.strictEqual(result.yearly[1]!.taxableRiskTotal, 20000000);
});

test("calculateCompound (transfer) - 取り崩し期の年初にも振替が走る", () => {
  // 積立0 + 特定残高あり + nisaTransferEnabled
  const params: CalculateParams = {
    ...BASE_PARAMS,
    initialNisa: 0,
    initialTaxableRisk: 10000000,
    initialTaxableRiskGain: 0,
    initialDefense: 0,
    monthlyContribution: 0,
    annualReturnRate: 0,
    expenseRatio: 0,
    contributionYears: 0,
    withdrawalStartYear: 0,
    withdrawalYears: 1,
    fixedMonthlyWithdrawal: 0, // 取り崩しなしで振替だけ走るか確認
    nisaTransferEnabled: true,
  };
  const result = calculateCompound(params);
  const m0 = result.monthly[0]!;
  assert.ok(m0.nisaTransferInfo != null);
  // contributionThisYear=0 なので annualForTransfer = 360万
  assert.ok(Math.abs(m0.nisaTransferInfo!.proceeds - NISA_ANNUAL_LIMIT) < 1);
});

test("calculateCompound (transfer) - 夫婦モードで生涯枠到達後の浮動小数誤差で空振替が出ない", () => {
  // 含み益あり・夫婦モード・nisaInitialLifetimeUsed=2160万 の状態で
  // 1年目+2年目に720万ずつ振替して生涯枠3600万に到達した後、
  // 3年目1月に浮動小数誤差由来の極小振替（0万円バッジ）が出ないことを確認
  const params: CalculateParams = {
    ...BASE_PARAMS,
    isCoupled: true,
    nisaTransferEnabled: true,
    nisaInitialLifetimeUsed: 21_600_000, // 2160万使用済
    initialNisa: 0,
    initialTaxableRisk: 100_000_000,
    initialTaxableRiskGain: 50_000_000, // 含み益50%
    initialDefense: 0,
    monthlyContribution: 0,
    contributionYears: 0,
    withdrawalStartYear: 0,
    withdrawalYears: 5,
    fixedMonthlyWithdrawal: 100_000,
    annualReturnRate: 0,
    expenseRatio: 0,
  };
  const result = calculateCompound(params);
  // 各年の1月（年初振替が実行されるタイミング）で振替有無を確認する
  // 1年目・2年目は720万振替（lifetimeRemain: 1440万→720万→0万）
  assert.ok(result.monthly[0]!.nisaTransferInfo != null);
  assert.ok(Math.abs(result.monthly[0]!.nisaTransferInfo!.proceeds - 7_200_000) < 1);
  assert.ok(result.monthly[12]!.nisaTransferInfo != null);
  assert.ok(Math.abs(result.monthly[12]!.nisaTransferInfo!.proceeds - 7_200_000) < 1);
  // 3年目以降は生涯枠に到達しているので振替なし（浮動小数誤差で0万円バッジが出ないこと）
  assert.strictEqual(result.monthly[24]!.nisaTransferInfo, null);
});

test("calculateCompound (withdrawal order) - 特定リスク優先で減りNISAは最後", () => {
  // 比率按分でもNISAは最後の設計
  // 特定リスク100万 + NISA900万 + 防衛なし、月10万を10年取り崩し
  // 10年で1200万取り崩し → 残り0、特定が先に枯渇しNISAが減る
  const params: CalculateParams = {
    ...BASE_PARAMS,
    initialNisa: 9000000,
    initialTaxableRisk: 1000000,
    initialDefense: 0,
    monthlyContribution: 0,
    annualReturnRate: 0,
    expenseRatio: 0,
    contributionYears: 0,
    withdrawalStartYear: 0,
    withdrawalYears: 10,
    fixedMonthlyWithdrawal: 100000,
    defensePriorityOnDrawdown: false, // 比率按分モード
  };
  const result = calculateCompound(params);
  // 1年目末: 月10万×12=120万取り崩し。比率按分なら NISA から減るが、splitRiskSide で特定優先。
  // 特定リスク 100万 はだいたい1年で枯渇する
  const m12 = result.monthly[11]!;
  assert.ok(m12.taxableRiskTotal < 100000, `taxable=${m12.taxableRiskTotal}`);
});

test("calculateCompound (withdrawal nisa tax) - NISAからの取り崩しは tax=0", () => {
  // 全額NISAで含み益あり → 取り崩しても tax は0
  const params: CalculateParams = {
    ...BASE_PARAMS,
    initialNisa: 2000000,
    initialNisaGain: 1000000,
    initialTaxableRisk: 0,
    initialDefense: 0,
    annualReturnRate: 0,
    expenseRatio: 0,
    contributionYears: 0,
    withdrawalStartYear: 0,
    withdrawalYears: 1,
    fixedMonthlyWithdrawal: 50000,
  };
  const result = calculateCompound(params);
  // 年末税試算でもNISA分は除外
  assert.strictEqual(result.yearly[1]!.tax, 0);
});

test("calculateCompound (rebalance) - リスクサイド売却は特定リスク優先・NISA最後", () => {
  // 特定50万 + NISA50万 + 防衛 0 で目標30% → 初期で乖離があるので 30万を特定優先で売却して防衛へ移す。
  const params: CalculateParams = {
    ...BASE_PARAMS,
    initialNisa: 500000,
    initialTaxableRisk: 500000,
    initialDefense: 0,
    targetDefenseRatioStart: 30,
    targetDefenseRatioEnd: 30,
    glidePathEndAge: 65,
    annualReturnRate: 0,
    expenseRatio: 0,
    defenseAnnualReturnRate: 0,
    rebalanceThresholdPoint: 1,
    contributionYears: 0,
    withdrawalStartYear: 0,
    withdrawalYears: 1,
    fixedMonthlyWithdrawal: 0,
  };
  const result = calculateCompound(params);
  const rb = result.monthly.find((m) => m.rebalanceInfo != null);
  assert.ok(rb != null);
  assert.strictEqual(rb!.rebalanceInfo!.direction, "risk-to-defense");
  // 特定優先売却の根拠: NISA はほぼ無傷、特定が減っている
  assert.ok(rb!.nisaTotal > rb!.taxableRiskTotal, `nisa=${rb!.nisaTotal}, taxable=${rb!.taxableRiskTotal}`);
});

test("calculateCompound (rebalance) - 防衛→リスクサイド買付はNISA枠優先", () => {
  // 防衛が過大になるよう、初期で 防衛 50万 リスクサイド 50万 → 目標比率50%
  // 防衛利回り高で乖離させて買付方向リバランスを誘発
  const params: CalculateParams = {
    ...BASE_PARAMS,
    initialNisa: 250000,
    initialTaxableRisk: 250000,
    initialDefense: 500000,
    targetDefenseRatioStart: 50,
    targetDefenseRatioEnd: 50,
    glidePathEndAge: 65,
    annualReturnRate: 0,
    expenseRatio: 0,
    defenseAnnualReturnRate: 200, // 防衛急騰
    rebalanceThresholdPoint: 1,
    contributionYears: 0,
    withdrawalStartYear: 1,
    withdrawalYears: 0,
    nisaInitialLifetimeUsed: 0,
  };
  const result = calculateCompound(params);
  const rb = result.monthly.find(
    (m) => m.rebalanceInfo != null && m.rebalanceInfo.direction === "defense-to-risk",
  );
  assert.ok(rb != null);
  // proceeds > 0 で nisaUsed > 0（年枠あり、生涯枠も初期使用ゼロ）
  assert.ok(rb!.rebalanceInfo!.nisaUsed > 0, `nisaUsed=${rb!.rebalanceInfo!.nisaUsed}`);
});

// --- monthlyWithdrawal 内訳 ---

test("calculateCompound - monthlyWithdrawal は内訳3バケットの和に等しい", () => {
  // 3バケット併存・取り崩しありの構成
  const params: CalculateParams = {
    ...BASE_PARAMS,
    initialNisa: 1000000,
    initialNisaGain: 200000,
    initialTaxableRisk: 1000000,
    initialTaxableRiskGain: 300000,
    initialDefense: 500000,
    initialDefenseGain: 100000,
    targetDefenseRatioStart: 25,
    targetDefenseRatioEnd: 25,
    glidePathEndAge: 65,
    annualReturnRate: 5,
    defenseAnnualReturnRate: 1,
    contributionYears: 0,
    withdrawalStartYear: 0,
    withdrawalYears: 2,
    fixedMonthlyWithdrawal: 50000,
    defensePriorityOnDrawdown: false,
  };
  const result = calculateCompound(params);
  const withdrawn = result.monthly.filter((m) => m.monthlyWithdrawal > 0);
  assert.ok(withdrawn.length > 0);
  for (const m of withdrawn) {
    const sum =
      m.monthlyWithdrawalNisa + m.monthlyWithdrawalTaxableRisk + m.monthlyWithdrawalDefense;
    // Math.round の丸めで ±1 のずれが許容範囲
    assert.ok(
      Math.abs(m.monthlyWithdrawal - sum) <= 1,
      `month=${m.year}-${m.month}: total=${m.monthlyWithdrawal}, sum=${sum}`,
    );
  }
});

test("calculateCompound - 平時はリスクサイドから優先取り崩し（特定→NISA順、防衛温存）", () => {
  // 決定論版は常に「平時」扱いのため splitRiskFirst によりリスクサイド優先で取り崩される
  const params: CalculateParams = {
    ...BASE_PARAMS,
    initialNisa: 5000000,
    initialTaxableRisk: 1000000,
    initialDefense: 5000000,
    annualReturnRate: 0,
    defenseAnnualReturnRate: 0,
    contributionYears: 0,
    withdrawalStartYear: 0,
    withdrawalYears: 1,
    fixedMonthlyWithdrawal: 30000,
    defensePriorityOnDrawdown: true,
    targetDefenseRatioStart: 0,
    targetDefenseRatioEnd: 0,
    glidePathEndAge: 65,
    rebalanceThresholdPoint: 100, // リバランス封じ
  };
  const result = calculateCompound(params);
  const first = result.monthly.find((m) => m.monthlyWithdrawal > 0);
  assert.ok(first != null);
  // splitRiskSide により特定リスク → NISA の順なので、特定が残っている間は特定のみ
  assert.ok(first!.monthlyWithdrawalTaxableRisk > 0);
  assert.strictEqual(first!.monthlyWithdrawalNisa, 0);
  assert.strictEqual(first!.monthlyWithdrawalDefense, 0);
});

test("calculateCompound - NISAのみ取り崩しは税額0", () => {
  // 防衛なし、特定なし、NISAのみのケース → 引出はすべてNISAから
  const params: CalculateParams = {
    ...BASE_PARAMS,
    initialNisa: 5000000,
    initialNisaGain: 1000000,
    initialTaxableRisk: 0,
    initialDefense: 0,
    annualReturnRate: 0,
    contributionYears: 0,
    withdrawalStartYear: 0,
    withdrawalYears: 1,
    fixedMonthlyWithdrawal: 30000,
    targetDefenseRatioStart: 0,
    targetDefenseRatioEnd: 0,
    glidePathEndAge: 65,
    rebalanceThresholdPoint: 100,
  };
  const result = calculateCompound(params);
  const first = result.monthly.find((m) => m.monthlyWithdrawal > 0);
  assert.ok(first != null);
  assert.ok(first!.monthlyWithdrawalNisa > 0);
  assert.strictEqual(first!.monthlyWithdrawalTaxableRisk, 0);
  assert.strictEqual(first!.monthlyWithdrawalTaxTaxableRisk, 0);
  assert.strictEqual(first!.monthlyWithdrawalTaxDefense, 0);
});

// --- findLimitForAge ---

test("findLimitForAge - 単純な3ステップで境界の前後で値が切り替わる", () => {
  const schedule: WithdrawalLimitStep[] = [
    { untilAge: 69, floor: 250000, ceiling: 400000 },
    { untilAge: 79, floor: 200000, ceiling: 320000 },
    { untilAge: null, floor: 150000, ceiling: 250000 },
  ];
  assert.deepStrictEqual(findLimitForAge(schedule, 65), { floor: 250000, ceiling: 400000 });
  assert.deepStrictEqual(findLimitForAge(schedule, 69), { floor: 250000, ceiling: 400000 });
  assert.deepStrictEqual(findLimitForAge(schedule, 70), { floor: 200000, ceiling: 320000 });
  assert.deepStrictEqual(findLimitForAge(schedule, 79), { floor: 200000, ceiling: 320000 });
  assert.deepStrictEqual(findLimitForAge(schedule, 80), { floor: 150000, ceiling: 250000 });
  assert.deepStrictEqual(findLimitForAge(schedule, 120), { floor: 150000, ceiling: 250000 });
});

test("findLimitForAge - 空配列は両方nullを返す", () => {
  assert.deepStrictEqual(findLimitForAge([], 50), { floor: null, ceiling: null });
});

test("findLimitForAge - 終端のみ（untilAge=null）は全年齢で終端値", () => {
  const schedule: WithdrawalLimitStep[] = [{ untilAge: null, floor: 100000, ceiling: 300000 }];
  assert.deepStrictEqual(findLimitForAge(schedule, 30), { floor: 100000, ceiling: 300000 });
  assert.deepStrictEqual(findLimitForAge(schedule, 99), { floor: 100000, ceiling: 300000 });
});

test("findLimitForAge - 片方のみnullが許容される", () => {
  const schedule: WithdrawalLimitStep[] = [
    { untilAge: 70, floor: 200000, ceiling: null },
    { untilAge: null, floor: null, ceiling: 250000 },
  ];
  assert.deepStrictEqual(findLimitForAge(schedule, 60), { floor: 200000, ceiling: null });
  assert.deepStrictEqual(findLimitForAge(schedule, 80), { floor: null, ceiling: 250000 });
});

// --- 年齢ステップ式の月額下限・上限 ---

test("calculateCompound (rate) - 年齢ステップで境界年で月額が切り替わる", () => {
  // currentAge=40, withdrawalStartYear=29 にすると year=30 で age=70 になる。
  // 〜69 歳: 上限 400000、70 歳以降: 上限 250000 にしておけば year=30 の年初で月額が抑制される。
  const result = calculateCompound({
    ...BASE_PARAMS,
    ...nisaOnly(1000000000),
    currentAge: 40,
    annualReturnRate: 0,
    inflationRate: 0,
    withdrawalRate: 10, // 大きめにして上限で抑制されることを保証
    withdrawalMode: "rate",
    withdrawalStartYear: 29,
    withdrawalYears: 5,
    withdrawalLimitSchedule: [
      { untilAge: 69, floor: null, ceiling: 400000 },
      { untilAge: null, floor: null, ceiling: 250000 },
    ],
  });
  // year=30 → age=70 → 終端行採用 → 250000 * 12
  const y30 = result.yearly[30]!;
  assert.strictEqual(y30.age, 70);
  assert.ok(Math.abs(y30.yearlyWithdrawal - 250000 * 12) < 1);
});

test("calculateCompound (rate) - 年齢が前段ステップ内なら前段のクランプ値が適用される", () => {
  // currentAge=60, withdrawalStartYear=0 → year=1 で age=61 → 〜69 行
  const result = calculateCompound({
    ...BASE_PARAMS,
    ...nisaOnly(1000000000),
    currentAge: 60,
    annualReturnRate: 0,
    inflationRate: 0,
    withdrawalRate: 10,
    withdrawalMode: "rate",
    withdrawalStartYear: 0,
    withdrawalYears: 3,
    withdrawalLimitSchedule: [
      { untilAge: 69, floor: null, ceiling: 400000 },
      { untilAge: null, floor: null, ceiling: 250000 },
    ],
  });
  const y1 = result.yearly[1]!;
  assert.strictEqual(y1.age, 61);
  assert.ok(Math.abs(y1.yearlyWithdrawal - 400000 * 12) < 1);
});

test("calculateCompound (rate) - 年齢ステップの下限もインフレ連動で名目化される", () => {
  // 終端行のみ floor=100000、インフレ2%。year=1 で 100000*1.02、year=5 で 100000*1.02^5。
  const result = calculateCompound({
    ...BASE_PARAMS,
    ...nisaOnly(100000000),
    currentAge: 40,
    annualReturnRate: 0,
    inflationRate: 2,
    withdrawalRate: 0.01,
    withdrawalMode: "rate",
    withdrawalStartYear: 0,
    withdrawalYears: 5,
    withdrawalLimitSchedule: limit(100000, null),
  });
  const expected1 = 100000 * 1.02 * 12;
  assert.ok(Math.abs(result.yearly[1]!.yearlyWithdrawal - expected1) < 1);
  const expected5 = 100000 * Math.pow(1.02, 5) * 12;
  assert.ok(Math.abs(result.yearly[5]!.yearlyWithdrawal - expected5) < 1);
});

test("findLimitForAge - 未ソートの schedule でも前から走査して安全に動く", () => {
  // 通常は untilAge 昇順だが、useParams で正規化されない裸の値でも動くこと
  const schedule: WithdrawalLimitStep[] = [
    { untilAge: 79, floor: 200000, ceiling: 320000 },
    { untilAge: 69, floor: 250000, ceiling: 400000 },
    { untilAge: null, floor: 150000, ceiling: 250000 },
  ];
  // age=65 は最初に untilAge=79 にマッチして 200000 を返す（意図的に「未ソート時の挙動」を確認）
  assert.deepStrictEqual(findLimitForAge(schedule, 65), { floor: 200000, ceiling: 320000 });
  // age=85 はどの有限 untilAge にもマッチせず終端を返す
  assert.deepStrictEqual(findLimitForAge(schedule, 85), { floor: 150000, ceiling: 250000 });
});

test("resolveDefenseRatio - Start=End なら全期間で同値", () => {
  const result0 = resolveDefenseRatio(40, 40, 20, 20, 60);
  const result1 = resolveDefenseRatio(50, 40, 20, 20, 60);
  const result2 = resolveDefenseRatio(70, 40, 20, 20, 60);
  assert.ok(Math.abs(result0 - 0.2) < 1e-10);
  assert.ok(Math.abs(result1 - 0.2) < 1e-10);
  assert.ok(Math.abs(result2 - 0.2) < 1e-10);
});

test("resolveDefenseRatio - 線形補間: currentAge=40, endAge=60, Start=20, End=50, year=10 で 35%", () => {
  const result = resolveDefenseRatio(50, 40, 20, 50, 60);
  assert.ok(Math.abs(result - 0.35) < 1e-10);
});

test("resolveDefenseRatio - ageThisYear >= endAge なら End で固定", () => {
  const result = resolveDefenseRatio(65, 40, 20, 50, 60);
  assert.ok(Math.abs(result - 0.5) < 1e-10);
});

test("resolveDefenseRatio - endAge <= currentAge のエッジケースで End で固定", () => {
  const result = resolveDefenseRatio(50, 60, 20, 50, 55);
  assert.ok(Math.abs(result - 0.5) < 1e-10);
});

test("resolveDefenseRatio - 範囲外の値（負・100超）が [0,1] にクランプされる", () => {
  const resultNeg = resolveDefenseRatio(40, 40, -10, -10, 60);
  const resultOver = resolveDefenseRatio(40, 40, 150, 150, 60);
  assert.ok(Math.abs(resultNeg - 0) < 1e-10);
  assert.ok(Math.abs(resultOver - 1) < 1e-10);
});

test("グライドパス統合 - Start=End=20 は従来固定値 20% と同じ資産推移", () => {
  const baseParams = {
    ...BASE_PARAMS,
    initialNisa: 3000000,
    initialTaxableRisk: 1000000,
    initialDefense: 1000000,
    withdrawalYears: 10,
    withdrawalMode: "amount" as const,
    fixedMonthlyWithdrawal: 50000,
    annualReturnRate: 5,
    rebalanceThresholdPoint: 5,
  };
  const fixed = calculateCompound({
    ...baseParams,
    targetDefenseRatioStart: 20,
    targetDefenseRatioEnd: 20,
    glidePathEndAge: 65,
  });
  const glide = calculateCompound({
    ...baseParams,
    targetDefenseRatioStart: 20,
    targetDefenseRatioEnd: 20,
    glidePathEndAge: 45, // currentAge=40 なので year=5 以降は End で固定
  });
  // Start=End なのでどちらも同じ結果になるはず
  for (let y = 0; y <= 10; y++) {
    assert.ok(Math.abs(fixed.yearly[y]!.total - glide.yearly[y]!.total) < 1);
  }
});

test("グライドパス統合 - Start=0, End=40 で年が進むにつれ防衛割合が増える", () => {
  const params = {
    ...BASE_PARAMS,
    currentAge: 40,
    initialNisa: 4000000,
    initialTaxableRisk: 1000000,
    initialDefense: 0,
    monthlyContribution: 0,
    contributionYears: 25,
    withdrawalStartYear: 25,
    withdrawalYears: 0,
    annualReturnRate: 5,
    targetDefenseRatioStart: 0,
    targetDefenseRatioEnd: 40,
    glidePathEndAge: 60,
    rebalanceThresholdPoint: 1, // 積極的にリバランス
  };
  const result = calculateCompound(params);
  // 年齢 40（year=0）では防衛ゼロ
  assert.ok(result.yearly[0]!.defenseTotal < 1);
  // 年齢 50（year=10）は補間で 20% 相当の防衛が生まれているはず
  const total10 = result.yearly[10]!.total;
  const defense10 = result.yearly[10]!.defenseTotal;
  assert.ok(defense10 / total10 > 0.05, `year10 の防衛比率が期待値未満: ${defense10 / total10}`);
  // 年齢 60（year=20）は End=40% に近い防衛比率
  const total20 = result.yearly[20]!.total;
  const defense20 = result.yearly[20]!.defenseTotal;
  assert.ok(defense20 / total20 > 0.1, `year20 の防衛比率が期待値未満: ${defense20 / total20}`);
  assert.ok(defense20 > defense10, "年が進むほど防衛資産が増えるべき");
});
