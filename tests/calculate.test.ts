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
  calculateCompound,
  type CalculateParams,
} from "../src/calculate.ts";

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
  monthlyWithdrawalFloor: null,
  monthlyWithdrawalCeiling: null,
  inflationAdjustedWithdrawal: false,
  basePension: 0,
  pensionStartAge: 65,
  currentAge: null,
  otherIncomes: [],
  defenseAnnualReturnRate: 0,
  rebalanceThresholdPoint: 5,
  defensePriorityOnDrawdown: false,
  isCoupled: false,
  nisaTransferEnabled: false,
  nisaInitialLifetimeUsed: 0,
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

test("calculateCompound - 年齢がnullの場合ageはnull", () => {
  const params = { ...BASE_PARAMS, currentAge: null };
  const { yearly } = calculateCompound(params);
  assert.strictEqual(yearly[0]!.age, null);
  assert.strictEqual(yearly[1]!.age, null);
});

test("calculateCompound - 年齢が指定された場合ageが計算される", () => {
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
    monthlyWithdrawalFloor: 100000,
    monthlyWithdrawalCeiling: null,
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
    monthlyWithdrawalFloor: null,
    monthlyWithdrawalCeiling: 300000,
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
    monthlyWithdrawalFloor: 100000,
    monthlyWithdrawalCeiling: null,
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
    monthlyWithdrawalFloor: 500000,
    monthlyWithdrawalCeiling: 200000,
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
    monthlyWithdrawalFloor: 150000,
    monthlyWithdrawalCeiling: null,
  });
  const withoutFloor = calculateCompound({
    ...base,
    monthlyWithdrawalFloor: null,
    monthlyWithdrawalCeiling: null,
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
    monthlyWithdrawalFloor: 80000,
    monthlyWithdrawalCeiling: null,
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
    monthlyWithdrawalFloor: null,
    monthlyWithdrawalCeiling: 250000,
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
    monthlyWithdrawalFloor: 200000,
    monthlyWithdrawalCeiling: 10000,
  });
  const withoutClamp = calculateCompound({
    ...base,
    monthlyWithdrawalFloor: null,
    monthlyWithdrawalCeiling: null,
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
    monthlyWithdrawalFloor: 50000,
    monthlyWithdrawalCeiling: null,
  });
  const onlyCeiling = calculateCompound({
    ...BASE_PARAMS,
    ...nisaOnly(10000000),
    inflationRate: 0,
    withdrawalRate: 4,
    withdrawalMode: "rate",
    withdrawalStartYear: 0,
    withdrawalYears: 5,
    monthlyWithdrawalFloor: null,
    monthlyWithdrawalCeiling: 80000,
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
    monthlyWithdrawalFloor: 100000,
    monthlyWithdrawalCeiling: null,
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
    monthlyWithdrawalFloor: 500000,
    monthlyWithdrawalCeiling: null,
  });
  const last = result.yearly[result.yearly.length - 1]!;
  assert.ok(last.total === 0 || last.total < 100);
  for (const y of result.yearly) assert.ok(Number.isFinite(y.total));
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
  // 特定50万 + NISA50万 + 防衛 0 → 防衛比率30%目標 → 30万を防衛へ移動
  // splitRiskSide で 特定から30万売却、NISAは温存
  const params: CalculateParams = {
    ...BASE_PARAMS,
    initialNisa: 500000,
    initialTaxableRisk: 500000,
    initialDefense: 0,
    annualReturnRate: 0,
    expenseRatio: 0,
    defenseAnnualReturnRate: 0,
    rebalanceThresholdPoint: 1,
    contributionYears: 0,
    withdrawalStartYear: 0,
    withdrawalYears: 1,
    fixedMonthlyWithdrawal: 0,
  };
  // ただし上記の初期化では防衛比率0なのでdr=0となりリバランス発動しない
  // 代わりに「防衛比率30%目標、初期で乖離させる」シナリオに変更
  const params2: CalculateParams = {
    ...params,
    initialNisa: 500000,
    initialTaxableRisk: 500000,
    initialDefense: 200000, // 初期防衛比率 ≈ 16.7%、目標30%（初期から導出）にはならないので別アプローチ
  };
  // 設計上、dr は初期総資産から導出される。なので「特定リスク優先売却」を確認するには
  // 初期で目標比率(dr)を満たした上で、月次の運用差で乖離させて売却が起きるシナリオが必要。
  // 簡略化のため、初期 NISA+特定:防衛 = 7:3 とし、防衛の利回りを負にして売却方向のリバランスを誘発する。
  const params3: CalculateParams = {
    ...BASE_PARAMS,
    initialNisa: 350000,
    initialTaxableRisk: 350000,
    initialDefense: 300000,
    annualReturnRate: 120, // リスクが急騰してリスクサイドが過大に
    expenseRatio: 0,
    defenseAnnualReturnRate: 0,
    rebalanceThresholdPoint: 1,
    contributionYears: 0,
    withdrawalStartYear: 1,
    withdrawalYears: 0,
  };
  const result = calculateCompound(params3);
  // どこかでリバランス発動し、direction = risk-to-defense
  const rb = result.monthly.find((m) => m.rebalanceInfo != null);
  assert.ok(rb != null);
  assert.strictEqual(rb!.rebalanceInfo!.direction, "risk-to-defense");
  // この月のNISA残高が初期350000をリスク利回りで増やした水準に近いことを期待
  // 実際は1ヶ月分の運用後の値だが、「nisaは大きく減っていない」ことが特定優先売却の根拠
  // 比較: その月の特定リスクはNISAより少ない方向に動く
  assert.ok(rb!.nisaTotal > rb!.taxableRiskTotal, `nisa=${rb!.nisaTotal}, taxable=${rb!.taxableRiskTotal}`);
  // params2 はリンタを満たすために使用
  void params2;
});

test("calculateCompound (rebalance) - 防衛→リスクサイド買付はNISA枠優先", () => {
  // 防衛が過大になるよう、初期で 防衛 50万 リスクサイド 50万 → 目標比率50%
  // 防衛利回り高で乖離させて買付方向リバランスを誘発
  const params: CalculateParams = {
    ...BASE_PARAMS,
    initialNisa: 250000,
    initialTaxableRisk: 250000,
    initialDefense: 500000,
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
