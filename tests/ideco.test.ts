import { test } from "node:test";
import assert from "node:assert/strict";
import {
  retirementDeduction,
  lumpSumTax,
  pensionDeductionAnnual,
  pensionTax,
  idecoReceiveStartYearOffset,
  initIdecoState,
  stepIdeco,
  idecoEffectiveTaxRateForMC,
  type IdecoParams,
} from "../src/ideco.ts";
import { TAX_RATE, calculateCompound, type CalculateParams } from "../src/calculate.ts";

const BASE_IDECO: IdecoParams = {
  initialIdeco: 0,
  initialIdecoGain: 0,
  idecoMonthlyContribution: 0,
  idecoContributionYears: 0,
  idecoReceiveStartAge: 65,
  idecoLumpSumRatio: 1,
  idecoPensionYears: 10,
};

const BASE_PARAMS: CalculateParams = {
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
  withdrawalYears: 10,
  withdrawalMode: "amount",
  fixedMonthlyWithdrawal: 0,
  withdrawalRate: 4,
  withdrawalLimitSchedule: [{ untilAge: null, floor: null, ceiling: null }],
  inflationAdjustedWithdrawal: false,
  basePension: 0,
  pensionStartAge: 65,
  currentAge: 50,
  otherIncomes: [],
  defenseAnnualReturnRate: 0,
  rebalanceThresholdPoint: 5,
  defensePriorityOnDrawdown: false,
  isCoupled: false,
  nisaTransferEnabled: false,
  nisaInitialLifetimeUsed: 0,
  idecoEnabled: false,
  ideco: BASE_IDECO,
};

// --- retirementDeduction ---

test("retirementDeduction - 0年は最低80万", () => {
  assert.strictEqual(retirementDeduction(0), 800_000);
});

test("retirementDeduction - 1年は最低80万", () => {
  assert.strictEqual(retirementDeduction(1), 800_000);
});

test("retirementDeduction - 20年は 800万", () => {
  assert.strictEqual(retirementDeduction(20), 8_000_000);
});

test("retirementDeduction - 30年は 800万+70万×10=1500万", () => {
  assert.strictEqual(retirementDeduction(30), 15_000_000);
});

// --- lumpSumTax ---

test("lumpSumTax - 控除内なら税ゼロ", () => {
  // 30年勤続なら控除1500万。それ以下なら税ゼロ
  assert.strictEqual(lumpSumTax(10_000_000, 30), 0);
  assert.strictEqual(lumpSumTax(15_000_000, 30), 0);
});

test("lumpSumTax - 控除超過部分の半分にTAX_RATE", () => {
  // 控除1500万、超過500万、その半分(250万)に20.315%
  const tax = lumpSumTax(20_000_000, 30);
  const expected = ((20_000_000 - 15_000_000) / 2) * TAX_RATE;
  assert.ok(Math.abs(tax - expected) < 0.001);
});

// --- pensionDeductionAnnual ---

test("pensionDeductionAnnual - 64歳までは最低60万（合算 130万未満）", () => {
  assert.strictEqual(pensionDeductionAnnual(500_000, 60), 600_000);
  assert.strictEqual(pensionDeductionAnnual(1_299_999, 64), 600_000);
});

test("pensionDeductionAnnual - 65歳以上は最低110万（合算 330万未満）", () => {
  assert.strictEqual(pensionDeductionAnnual(1_000_000, 65), 1_100_000);
  assert.strictEqual(pensionDeductionAnnual(3_299_999, 75), 1_100_000);
});

test("pensionDeductionAnnual - 速算表（65歳以上・330万〜410万 → gross×25% + 27.5万）", () => {
  // 合算 400万 → 400万 × 0.25 + 27.5万 = 127.5万
  assert.strictEqual(pensionDeductionAnnual(4_000_000, 65), 4_000_000 * 0.25 + 275_000);
});

// --- pensionTax ---

test("pensionTax - 公的年金ゼロ・iDeCo 単独で控除内なら税ゼロ", () => {
  assert.strictEqual(pensionTax(500_000, 60, 0), 0);
  assert.strictEqual(pensionTax(1_000_000, 65, 0), 0);
});

test("pensionTax - 公的年金ゼロ・iDeCo 単独で控除超過にTAX_RATE", () => {
  // 65歳・年200万 → 合算控除は110万、超過90万にTAX_RATE
  const tax = pensionTax(2_000_000, 65, 0);
  const expected = (2_000_000 - 1_100_000) * TAX_RATE;
  assert.ok(Math.abs(tax - expected) < 0.001);
});

test("pensionTax - 公的年金が控除を全消費していると iDeCo 年金は全額課税", () => {
  // 65歳・公的年金 200万（控除110万を既に消費＋90万も超過分として消費）+ iDeCo 100万
  // 合算 300万、合算控除 110万、公的年金が消費する分 110万、残り控除 0 → iDeCo 100万全額課税
  const tax = pensionTax(1_000_000, 65, 2_000_000);
  const expected = 1_000_000 * TAX_RATE;
  assert.ok(Math.abs(tax - expected) < 0.001);
});

test("pensionTax - 公的年金が控除を一部しか消費しないと iDeCo に残り控除が回る", () => {
  // 65歳・公的年金 50万 + iDeCo 100万 → 合算 150万、合算控除 110万、
  // 公的年金が消費 50万、残り控除 60万 → iDeCo 課税 = 100万 - 60万 = 40万
  const tax = pensionTax(1_000_000, 65, 500_000);
  const expected = (1_000_000 - 600_000) * TAX_RATE;
  assert.ok(Math.abs(tax - expected) < 0.001);
});

test("pensionTax - 合算が速算表帯に入る場合（65歳・公的年金200万+iDeCo100万）", () => {
  // 合算 300万 < 330万なので最低控除 110万、公的年金が110万消費 → 残り控除0
  // → iDeCo 100万全額課税
  const tax = pensionTax(1_000_000, 65, 2_000_000);
  const expected = 1_000_000 * TAX_RATE;
  assert.ok(Math.abs(tax - expected) < 0.001);
});

// --- idecoReceiveStartYearOffset ---

test("idecoReceiveStartYearOffset - currentAge=50, 受取65なら15", () => {
  assert.strictEqual(idecoReceiveStartYearOffset(65, 50), 15);
});

test("idecoReceiveStartYearOffset - currentAge=null なら受取年齢をそのまま経過年として使う", () => {
  assert.strictEqual(idecoReceiveStartYearOffset(10, null), 10);
});

test("idecoReceiveStartYearOffset - 現在年齢 >= 受取年齢 なら 0", () => {
  assert.strictEqual(idecoReceiveStartYearOffset(60, 65), 0);
});

// --- initIdecoState ---

test("initIdecoState - 含み益から元本を逆算", () => {
  const s = initIdecoState({ ...BASE_IDECO, initialIdeco: 1_000_000, initialIdecoGain: 300_000 });
  assert.strictEqual(s.total, 1_000_000);
  assert.strictEqual(s.principal, 700_000);
});

// --- stepIdeco ---

test("stepIdeco - 拠出フェーズ中は積み上がる", () => {
  const ideco: IdecoParams = {
    ...BASE_IDECO,
    initialIdeco: 0,
    idecoMonthlyContribution: 23_000,
    idecoContributionYears: 10,
    idecoReceiveStartAge: 60,
  };
  let s = initIdecoState(ideco);
  // currentAge=50, 受取60 なら offset=10
  for (let m = 0; m < 12; m++) {
    s = stepIdeco(s, ideco, 1, m, 10, 51, 0).state;
  }
  // 12ヶ月 × 23000 = 276000
  assert.strictEqual(s.total, 276_000);
  assert.strictEqual(s.principal, 276_000);
});

test("stepIdeco - 受取開始月に一時金一括（lumpSumRatio=1, 控除内なら税ゼロ）", () => {
  const ideco: IdecoParams = {
    ...BASE_IDECO,
    initialIdeco: 500_000, // 退職所得控除80万未満
    idecoContributionYears: 0,
    idecoLumpSumRatio: 1,
  };
  const s0 = initIdecoState(ideco);
  const r = stepIdeco(s0, ideco, 1, 0, 0, 65, 0);
  assert.ok(r.lumpSum !== null);
  assert.strictEqual(r.lumpSum!.taxAmount, 0);
  assert.strictEqual(r.lumpSum!.proceeds, 500_000);
  assert.strictEqual(r.state.total, 0);
});

test("stepIdeco - 全額年金（lumpSumRatio=0）は受取月に一時金イベントなし", () => {
  const ideco: IdecoParams = {
    ...BASE_IDECO,
    initialIdeco: 1_200_000,
    idecoLumpSumRatio: 0,
    idecoPensionYears: 10,
  };
  const s0 = initIdecoState(ideco);
  const r = stepIdeco(s0, ideco, 1, 0, 0, 65, 0);
  assert.strictEqual(r.lumpSum, null);
  assert.ok(r.pension !== null);
  // 120ヶ月で割る → 月10000円
  assert.ok(Math.abs(r.pension!.grossAmount - 10_000) < 0.1);
});

test("stepIdeco - 受取開始前は受取イベントなし", () => {
  const ideco: IdecoParams = {
    ...BASE_IDECO,
    initialIdeco: 1_000_000,
    idecoLumpSumRatio: 1,
  };
  const s0 = initIdecoState(ideco);
  // receiveStartOffset=10 だが year=5 → 受取前
  const r = stepIdeco(s0, ideco, 5, 0, 10, 60, 0);
  assert.strictEqual(r.lumpSum, null);
  assert.strictEqual(r.pension, null);
});

test("stepIdeco - 一時金+年金併用（50:50）", () => {
  const ideco: IdecoParams = {
    ...BASE_IDECO,
    initialIdeco: 2_000_000,
    idecoLumpSumRatio: 0.5,
    idecoPensionYears: 10,
  };
  const s0 = initIdecoState(ideco);
  const r = stepIdeco(s0, ideco, 1, 0, 0, 65, 0);
  assert.ok(r.lumpSum !== null);
  // 一時金100万、控除内なので税ゼロ
  assert.ok(Math.abs(r.lumpSum!.grossAmount - 1_000_000) < 0.1);
  assert.ok(r.pension !== null);
  // 年金は残り100万を120ヶ月で割る → 約 8333円
  assert.ok(Math.abs(r.pension!.grossAmount - 1_000_000 / 120) < 1);
});

// --- idecoEffectiveTaxRateForMC ---

test("idecoEffectiveTaxRateForMC - 控除内なら税率ゼロ", () => {
  const r = idecoEffectiveTaxRateForMC(
    { ...BASE_IDECO, initialIdeco: 5_000_000, idecoContributionYears: 20, idecoLumpSumRatio: 1 },
    65,
  );
  assert.strictEqual(r.lumpSumRate, 0);
});

// --- calculateCompound + iDeCo 結合テスト ---

test("calculateCompound - idecoEnabled=false なら BASE_PARAMS と完全同一の出力", () => {
  const r1 = calculateCompound(BASE_PARAMS);
  const r2 = calculateCompound({
    ...BASE_PARAMS,
    idecoEnabled: false,
    ideco: { ...BASE_IDECO, initialIdeco: 1_000_000, idecoMonthlyContribution: 100_000 },
  });
  // idecoEnabled=false なので iDeCo フィールドの値は無視される
  assert.strictEqual(r1.yearly[r1.yearly.length - 1]!.total, r2.yearly[r2.yearly.length - 1]!.total);
});

test("calculateCompound - iDeCo拠出のみ（受取前）で iDeCo残高が積み上がる", () => {
  const params: CalculateParams = {
    ...BASE_PARAMS,
    currentAge: 30,
    contributionYears: 30,
    withdrawalStartYear: 35,
    withdrawalYears: 5,
    idecoEnabled: true,
    ideco: {
      ...BASE_IDECO,
      idecoMonthlyContribution: 23_000,
      idecoContributionYears: 30,
      idecoReceiveStartAge: 65, // currentAge=30 → offset=35
      idecoLumpSumRatio: 1,
    },
  };
  const r = calculateCompound(params);
  // 30年目末では受取前なので残高あり
  const y30 = r.yearly[30]!;
  assert.ok(y30.idecoTotal > 0);
  // 拠出元本: 23000 × 12 × 30 = 8_280_000
  assert.ok(y30.idecoTotal >= 8_000_000);
});

test("calculateCompound - iDeCo一時金は受取月に特定リスクへ振替", () => {
  const params: CalculateParams = {
    ...BASE_PARAMS,
    currentAge: 60,
    contributionYears: 0,
    withdrawalStartYear: 0,
    withdrawalYears: 10,
    fixedMonthlyWithdrawal: 0,
    idecoEnabled: true,
    ideco: {
      ...BASE_IDECO,
      initialIdeco: 5_000_000,
      idecoContributionYears: 10,
      idecoReceiveStartAge: 65, // offset=5
      idecoLumpSumRatio: 1,
    },
  };
  const r = calculateCompound(params);
  // year=5 末ではまだ受取前
  const y4 = r.yearly[4]!;
  assert.ok(y4.idecoTotal > 0);
  // year=6 末では受取済み（iDeCo残高ゼロ、特定リスクへ振替済み）
  const y6 = r.yearly[6]!;
  assert.strictEqual(y6.idecoTotal, 0);
  // 累計一時金が記録されている（10年勤続 控除400万、超過100万の半分に課税で税約10万）
  const sumLump = r.yearly.reduce((s, p) => s + p.yearlyIdecoLumpSum, 0);
  assert.ok(sumLump > 4_800_000 && sumLump < 5_000_000);
});

test("calculateCompound - iDeCo年金は取り崩しに合流（otherIncome 風）", () => {
  const params: CalculateParams = {
    ...BASE_PARAMS,
    currentAge: 60,
    contributionYears: 0,
    withdrawalStartYear: 0,
    withdrawalYears: 15,
    fixedMonthlyWithdrawal: 200_000, // 月20万
    initialTaxableRisk: 30_000_000,
    idecoEnabled: true,
    ideco: {
      ...BASE_IDECO,
      initialIdeco: 1_200_000,
      idecoContributionYears: 10,
      idecoReceiveStartAge: 65, // offset=5
      idecoLumpSumRatio: 0,
      idecoPensionYears: 10,
    },
  };
  const r = calculateCompound(params);
  // 累計年金が記録されている
  const sumPension = r.yearly.reduce((s, p) => s + p.yearlyIdecoPension, 0);
  assert.ok(sumPension > 0);
  // iDeCo残高は最終的にゼロ近辺
  const last = r.yearly[r.yearly.length - 1]!;
  assert.ok(last.idecoTotal < 100); // 浮動小数誤差以内
});
