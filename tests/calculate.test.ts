import { test } from "node:test";
import assert from "node:assert/strict";
import {
  TAX_RATE,
  withdrawFromBucket,
  splitProportional,
  splitRiskFirst,
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
  monthlyWithdrawalFloor: null,
  monthlyWithdrawalCeiling: null,
  inflationAdjustedWithdrawal: false,
  taxFree: true,
  basePension: 0,
  pensionStartAge: 65,
  currentAge: null,
  monthlyOtherIncome: 0,
  defenseRatio: 0,
  defenseAnnualReturnRate: 0,
  rebalanceThresholdPoint: 5,
  defensePriorityOnDrawdown: false,
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
  const r = rebalanceBuckets(0, 0, 0, 0, 0.3, TAX_RATE);
  assert.strictEqual(r.riskTotal, 0);
  assert.strictEqual(r.riskPrincipal, 0);
  assert.strictEqual(r.defenseTotal, 0);
  assert.strictEqual(r.defensePrincipal, 0);
  assert.strictEqual(r.info, null);
});

test("rebalanceBuckets - 目標比率ちょうどは変化なし", () => {
  const r = rebalanceBuckets(700, 700, 300, 300, 0.3, TAX_RATE);
  assert.strictEqual(r.riskTotal, 700);
  assert.strictEqual(r.riskPrincipal, 700);
  assert.strictEqual(r.defenseTotal, 300);
  assert.strictEqual(r.defensePrincipal, 300);
  assert.strictEqual(r.info, null);
});

test("rebalanceBuckets - リスク売却ケース（防衛が目標より少ない）", () => {
  // total=1000, defenseRatio=0.3, currentDefense=200 → 100分リスクを売って防衛に回す
  const r = rebalanceBuckets(800, 800, 200, 200, 0.3, 0);
  assert.ok(r.riskTotal < 800); // リスク減
  assert.ok(r.defenseTotal > 200); // 防衛増
  assert.ok(r.info != null);
  assert.strictEqual(r.info!.direction, "risk-to-defense");
  assert.ok(Math.abs(r.info!.sellAmount - 100) < 0.001);
  assert.strictEqual(r.info!.taxAmount, 0); // taxRate=0
  assert.ok(Math.abs(r.info!.proceeds - 100) < 0.001);
});

test("rebalanceBuckets - 防衛売却ケース（防衛が目標より多い）", () => {
  const r = rebalanceBuckets(500, 500, 500, 500, 0.3, 0);
  assert.ok(r.riskTotal > 500); // リスク増
  assert.ok(r.defenseTotal < 500); // 防衛減
  assert.ok(r.info != null);
  assert.strictEqual(r.info!.direction, "defense-to-risk");
  assert.ok(Math.abs(r.info!.sellAmount - 200) < 0.001);
});

test("rebalanceBuckets - 含み益ありリスク売却で税額が発生", () => {
  // riskTotal=800, riskPrincipal=400 → gainRatio=0.5
  // sell=100 → tax = 100 * 0.5 * TAX_RATE
  const r = rebalanceBuckets(800, 400, 200, 200, 0.3, TAX_RATE);
  assert.ok(r.info != null);
  const expectedTax = 100 * 0.5 * TAX_RATE;
  assert.ok(Math.abs(r.info!.taxAmount - expectedTax) < 0.001);
  assert.ok(Math.abs(r.info!.proceeds - (100 - expectedTax)) < 0.001);
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

test("calculateCompound - 非課税口座ではtax=0", () => {
  const params = { ...BASE_PARAMS, taxFree: true };
  const { yearly } = calculateCompound(params);
  for (const row of yearly) {
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
  const { yearly } = calculateCompound(params);
  const year1 = yearly[1]!;
  // 100000 + 10000*12 = 220000
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
  const { yearly } = calculateCompound(params);
  assert.ok(Math.abs(yearly[2]!.yearlyWithdrawal - 40000) < 1);
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
  const { yearly } = calculateCompound(params);
  // 取り崩し初年度（year=1）よりも、その翌年（year=2）の方が引出額が小さい
  assert.ok(yearly[2]!.yearlyWithdrawal < yearly[1]!.yearlyWithdrawal);
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
  const trinity = calculateCompound({ ...base, withdrawalMode: "rate" }).yearly;
  const riskBased = calculateCompound({ ...base, withdrawalMode: "rate-risk" }).yearly;
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
  const noDefense = calculateCompound({ ...base, defenseRatio: 0 }).yearly;
  const halfDefense = calculateCompound({ ...base, defenseRatio: 50 }).yearly;
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

test("calculateCompound - monthly の年末12月の total は yearly.total と一致（taxFree）", () => {
  // taxFree=true なら年末に追加で控除する想定税が0なので、afterTaxTotal == endTotal == monthly[12k-1].total
  const params: CalculateParams = {
    ...BASE_PARAMS,
    taxFree: true,
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
  // 防衛比率30%目標だが、initialAmountは全部リスク扱い... ではなく
  // calculate.ts は initialAmount に dr を掛けて配分するので、初期から目標比率になっている
  // 代わりに 高ボラ的設定: defenseAnnualReturnRate を極端に大きくして1ヶ月で乖離させる
  const params: CalculateParams = {
    ...BASE_PARAMS,
    initialAmount: 1000000,
    annualReturnRate: 5,
    defenseRatio: 30,
    defenseAnnualReturnRate: 200, // 異常値だが乖離を起こすため
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

test("calculateCompound - 単一バケットでは monthlyRate が月次換算レートに一致", () => {
  const { monthly } = calculateCompound({
    ...BASE_PARAMS,
    initialAmount: 10000000,
    monthlyContribution: 0,
    annualReturnRate: 12,
    expenseRatio: 0,
    defenseRatio: 0,
    contributionYears: 0,
    withdrawalStartYear: 1,
    withdrawalYears: 0,
  });
  const expected = Math.pow(1.12, 1 / 12) - 1;
  assert.ok(Math.abs(monthly[0]!.monthlyRate - expected) < 1e-9);
});

test("calculateCompound - 2バケットでは monthlyRate が両バケット月率の加重平均（取り崩し前）", () => {
  // リスク50% (年10%) と防衛50% (年2%) を半分ずつ持つ初期残高のみ
  // 取り崩しが始まる前なので、初月の monthlyRate は両月率の単純平均と一致する
  const { monthly } = calculateCompound({
    ...BASE_PARAMS,
    initialAmount: 10000000,
    monthlyContribution: 0,
    annualReturnRate: 10,
    expenseRatio: 0,
    defenseRatio: 50,
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

// --- defensePriorityOnDrawdown (決定論的計算では常に平時扱い＝リスク優先) ---

test("calculateCompound - defensePriorityOnDrawdown=true は平時リスク優先で防衛資産を温存", () => {
  // 利回り0、非課税、防衛比率30%、5年取り崩し
  // リスク700万から月10万 × 12ヶ月 × 5年 = 600万取り崩し → リスク残100万、防衛300万不変
  const { monthly } = calculateCompound({
    ...BASE_PARAMS,
    initialAmount: 10000000,
    monthlyContribution: 0,
    annualReturnRate: 0,
    expenseRatio: 0,
    defenseRatio: 30,
    defenseAnnualReturnRate: 0,
    contributionYears: 0,
    withdrawalStartYear: 0,
    withdrawalYears: 5,
    fixedMonthlyWithdrawal: 100000,
    rebalanceThresholdPoint: 100,
    taxFree: true,
    defensePriorityOnDrawdown: true,
  });
  const month12 = monthly[11]!;
  // 1年で120万取り崩し → リスク 700-120 = 580万、防衛 300万不変
  assert.ok(Math.abs(month12.riskTotal - 5800000) < 1, `risk=${month12.riskTotal}`);
  assert.strictEqual(month12.defenseTotal, 3000000);
});

test("calculateCompound - defensePriorityOnDrawdown=false は時価比率按分で両資産が減る", () => {
  const { monthly } = calculateCompound({
    ...BASE_PARAMS,
    initialAmount: 10000000,
    monthlyContribution: 0,
    annualReturnRate: 0,
    expenseRatio: 0,
    defenseRatio: 30,
    defenseAnnualReturnRate: 0,
    contributionYears: 0,
    withdrawalStartYear: 0,
    withdrawalYears: 5,
    fixedMonthlyWithdrawal: 100000,
    rebalanceThresholdPoint: 100,
    taxFree: true,
    defensePriorityOnDrawdown: false,
  });
  const month12 = monthly[11]!;
  // 按分なら防衛も比率分減る
  assert.ok(month12.defenseTotal < 3000000, `defense=${month12.defenseTotal}`);
});

test("calculateCompound - defensePriorityOnDrawdown=true でリスク枯渇後は防衛から取り崩し", () => {
  // 初期1000万、防衛50%、月10万取り崩しを20年
  // リスク500万 / 月10万 ≒ 50ヶ月でリスク枯渇 → その後は防衛から
  const { monthly } = calculateCompound({
    ...BASE_PARAMS,
    initialAmount: 10000000,
    monthlyContribution: 0,
    annualReturnRate: 0,
    expenseRatio: 0,
    defenseRatio: 50,
    defenseAnnualReturnRate: 0,
    contributionYears: 0,
    withdrawalStartYear: 0,
    withdrawalYears: 20,
    fixedMonthlyWithdrawal: 100000,
    rebalanceThresholdPoint: 100,
    taxFree: true,
    defensePriorityOnDrawdown: true,
  });
  const last = monthly[monthly.length - 1]!;
  assert.strictEqual(last.riskTotal, 0);
  assert.ok(last.defenseTotal < 5000000);
});

test("calculateCompound - defensePriorityOnDrawdown=true でも defenseRatio=0 はエラーなく完走", () => {
  const result = calculateCompound({
    ...BASE_PARAMS,
    defenseRatio: 0,
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
  // 率0.1%で計算月額は約833円 → 下限10万に持ち上げられることを確認
  const result = calculateCompound({
    ...BASE_PARAMS,
    initialAmount: 100000000,
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
  // 1億・年率10% 相当で計算月額は 833,333 程度。上限30万に抑える。
  const result = calculateCompound({
    ...BASE_PARAMS,
    initialAmount: 100000000,
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
    initialAmount: 100000000,
    annualReturnRate: 0,
    inflationRate: 2,
    withdrawalRate: 0.01, // ほぼ常に下限が支配的
    withdrawalMode: "rate",
    withdrawalStartYear: 0,
    withdrawalYears: 5,
    monthlyWithdrawalFloor: 100000,
    monthlyWithdrawalCeiling: null,
  });
  // year=1 開始時に *=1.02 されているので 1年目は 100000*1.02 が下限
  const expected1 = 100000 * 1.02 * 12;
  assert.ok(Math.abs(result.yearly[1]!.yearlyWithdrawal - expected1) < 1);
  // 5年目は 100000 * 1.02^5 が下限
  const expected5 = 100000 * Math.pow(1.02, 5) * 12;
  assert.ok(Math.abs(result.yearly[5]!.yearlyWithdrawal - expected5) < 1);
});

test("calculateCompound (rate) - 下限>上限のとき上限が優先される", () => {
  const result = calculateCompound({
    ...BASE_PARAMS,
    initialAmount: 100000000,
    annualReturnRate: 0,
    inflationRate: 0,
    withdrawalRate: 5,
    withdrawalMode: "rate",
    withdrawalStartYear: 0,
    withdrawalYears: 3,
    monthlyWithdrawalFloor: 500000,
    monthlyWithdrawalCeiling: 200000,
  });
  // Math.max → Math.min の順で適用されるので上限が最終的に勝つ
  assert.ok(Math.abs(result.yearly[1]!.yearlyWithdrawal - 200000 * 12) < 1);
});

test("calculateCompound (rate) - 下限指定で資産枯渇が早まる", () => {
  // rate=2%（月約16,666円）なのに下限を月15万に持ち上げる→明らかに資産消費が増える
  const base = {
    ...BASE_PARAMS,
    initialAmount: 10000000,
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
  // 下限ありの方が累積取り崩しが多い
  const sum = (r: typeof withFloor) =>
    r.yearly.reduce((acc, y) => acc + y.yearlyWithdrawal, 0);
  assert.ok(sum(withFloor) > sum(withoutFloor));
  // 結果として最終残高も小さい
  const lastWithFloor = withFloor.yearly[withFloor.yearly.length - 1]!;
  const lastWithoutFloor = withoutFloor.yearly[withoutFloor.yearly.length - 1]!;
  assert.ok(lastWithFloor.total < lastWithoutFloor.total);
});

test("calculateCompound (rate-risk) - 下限指定が効く", () => {
  const result = calculateCompound({
    ...BASE_PARAMS,
    initialAmount: 100000000,
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
    initialAmount: 100000000,
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
  const base = {
    ...BASE_PARAMS,
    initialAmount: 10000000,
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
    initialAmount: 10000000,
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
    initialAmount: 10000000,
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
    initialAmount: 100000000,
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
    initialAmount: 1000000, // 100万円
    annualReturnRate: 0,
    inflationRate: 0,
    withdrawalRate: 4,
    withdrawalMode: "rate",
    withdrawalStartYear: 0,
    withdrawalYears: 5,
    monthlyWithdrawalFloor: 500000, // 月50万、資産は2ヶ月で枯渇
    monthlyWithdrawalCeiling: null,
  });
  // 最終的に資産は 0 に近づく
  const last = result.yearly[result.yearly.length - 1]!;
  assert.ok(last.total === 0 || last.total < 100);
  // NaN/Infinity が出ない
  for (const y of result.yearly) assert.ok(Number.isFinite(y.total));
});
