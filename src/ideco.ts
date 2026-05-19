// iDeCo（個人型確定拠出年金）モジュール
// 3バケット（NISA / 特定リスク / 防衛）と並列に動く独立 state machine。
// 月次ループ各月で stepIdeco を呼び、戻り値の lumpSum / pension を呼び出し側に合流させる。
//
// 設計方針:
// - 運用利回りは外から渡される monthlyRate（=リスクサイドと同じ）
// - 受取開始月（受取フェーズ初月）に一時金一括支出と年金開始を同時に行う
// - 受取期間中の残高はリスク利回りで運用継続、月次取り崩しは「残高/残り月数」で再計算
// - 簡易税計算: 一時金=退職所得控除、年金=公的年金等控除（65歳前後で控除最低額が変わる）

import { TAX_RATE, withdrawFromBucket } from "./calculate.ts";

export interface IdecoParams {
  initialIdeco: number;
  initialIdecoGain: number;
  idecoMonthlyContribution: number;
  idecoContributionYears: number;
  // currentAge が設定されているなら歳、未設定なら経過年（0=現在）として解釈する
  idecoReceiveStartAge: number;
  idecoLumpSumRatio: number; // 0..1（一時金比率）
  idecoPensionYears: number; // 年金受取期間（年）。lumpSumRatio=1 の場合は無視
}

export interface IdecoState {
  total: number;
  principal: number;
}

export interface IdecoPayoutEvent {
  grossAmount: number;
  taxAmount: number;
  proceeds: number;
}

export interface IdecoStepResult {
  state: IdecoState;
  gain: number;
  lumpSum: IdecoPayoutEvent | null;
  pension: IdecoPayoutEvent | null;
}

// 退職所得控除（円）
// 勤続年数20年以下: 40万 × 年（最低80万）
// 勤続年数20年超: 800万 + 70万 ×（年-20）
export function retirementDeduction(serviceYears: number): number {
  if (serviceYears <= 0) return 800_000;
  if (serviceYears <= 20) return Math.max(800_000, serviceYears * 400_000);
  return 8_000_000 + (serviceYears - 20) * 700_000;
}

// 一時金にかかる所得税・住民税の合算簡易計算
// 退職所得 = (収入 - 控除) × 1/2、超過部分に TAX_RATE を適用
export function lumpSumTax(grossAmount: number, serviceYears: number): number {
  const deduction = retirementDeduction(serviceYears);
  const taxable = Math.max(0, (grossAmount - deduction) / 2);
  return taxable * TAX_RATE;
}

// 公的年金等控除の最低額（円/年）
// 65歳未満: 60万、65歳以上: 110万（他所得は無視する簡易計算）
export function pensionDeductionAnnual(receiveAge: number): number {
  return receiveAge >= 65 ? 1_100_000 : 600_000;
}

// 年金受取年額にかかる税（簡易）。年額から控除を引いた残りに TAX_RATE を適用。
export function pensionTax(annualGross: number, receiveAge: number): number {
  const deduction = pensionDeductionAnnual(receiveAge);
  const taxable = Math.max(0, annualGross - deduction);
  return taxable * TAX_RATE;
}

// currentAge が null（経過年モード）の場合は、受取開始は「現在から idecoReceiveStartAge 年後」と解釈する。
export function idecoReceiveStartYearOffset(
  idecoReceiveStartAge: number,
  currentAge: number | null,
): number {
  const offset = currentAge != null ? idecoReceiveStartAge - currentAge : idecoReceiveStartAge;
  return Math.max(0, offset);
}

// 受取開始時点の年齢。currentAge が null なら 65 歳と仮定（控除分岐の都合）。
export function idecoReceiveAge(idecoReceiveStartAge: number, currentAge: number | null): number {
  return currentAge != null
    ? currentAge + idecoReceiveStartYearOffset(idecoReceiveStartAge, currentAge)
    : 65;
}

export function initIdecoState(params: IdecoParams): IdecoState {
  const total = Math.max(0, params.initialIdeco);
  const principal = Math.max(0, total - Math.max(0, params.initialIdecoGain));
  return { total, principal };
}

// 月次ステップ: 運用 → 拠出 → 受取（受取開始月のみ一時金、毎月の年金）
export function stepIdeco(
  state: IdecoState,
  params: IdecoParams,
  year: number,
  m: number,
  receiveStartYearOffset: number,
  receiveAge: number,
  monthlyRate: number,
): IdecoStepResult {
  const {
    idecoMonthlyContribution,
    idecoContributionYears,
    idecoLumpSumRatio,
    idecoPensionYears,
  } = params;

  let { total, principal } = state;

  const prevTotal = total;
  total *= 1 + monthlyRate;
  const gain = total - prevTotal;

  if (
    idecoMonthlyContribution > 0 &&
    year <= idecoContributionYears &&
    year <= receiveStartYearOffset
  ) {
    total += idecoMonthlyContribution;
    principal += idecoMonthlyContribution;
  }

  let lumpSum: IdecoPayoutEvent | null = null;
  let pension: IdecoPayoutEvent | null = null;

  const isReceiveStartMonth = year === receiveStartYearOffset + 1 && m === 0;
  if (isReceiveStartMonth && total > 0) {
    const ratio = Math.max(0, Math.min(1, idecoLumpSumRatio));
    if (ratio > 0) {
      const gross = total * ratio;
      const tax = lumpSumTax(gross, idecoContributionYears);
      // 一時金の税は退職所得控除ベース。withdrawFromBucket の含み益按分課税とは別計算なので、
      // 残高更新は taxRate=0 で呼んで「gross だけ抜く」挙動を借用する。
      [total, principal] = withdrawFromBucket(total, principal, gross, 0);
      lumpSum = { grossAmount: gross, taxAmount: tax, proceeds: Math.max(0, gross - tax) };
    }
  }

  const pensionTotalMonths = idecoLumpSumRatio < 1 ? Math.max(0, idecoPensionYears) * 12 : 0;
  if (pensionTotalMonths > 0 && total > 0) {
    const monthIndex = (year - 1 - receiveStartYearOffset) * 12 + m;
    if (monthIndex >= 0 && monthIndex < pensionTotalMonths) {
      const remainMonths = pensionTotalMonths - monthIndex;
      const gross = remainMonths > 0 ? total / remainMonths : total;
      const monthlyTax = pensionTax(gross * 12, receiveAge) / 12;
      [total, principal] = withdrawFromBucket(total, principal, gross, 0);
      pension = { grossAmount: gross, taxAmount: monthlyTax, proceeds: Math.max(0, gross - monthlyTax) };
    }
  }

  return { state: { total, principal }, gain, lumpSum, pension };
}

// MC 用の実効税率を事前計算する。
// 受取総額（拠出累計+運用益見込み）の代わりに、初期残高+将来拠出累計を粗く使う。
// 厳密性は犠牲にしているが、CLAUDE.md の方針通り MC では課税を簡易化する。
export function idecoEffectiveTaxRateForMC(
  params: IdecoParams,
  receiveAge: number,
): { lumpSumRate: number; pensionAnnualGrossEstimate: number; pensionRate: number } {
  const contributions = params.idecoMonthlyContribution * 12 * params.idecoContributionYears;
  const estimatedTotal = Math.max(0, params.initialIdeco) + contributions;
  const lumpSumGross = estimatedTotal * Math.max(0, Math.min(1, params.idecoLumpSumRatio));
  const lumpTax = lumpSumTax(lumpSumGross, params.idecoContributionYears);
  const lumpSumRate = lumpSumGross > 0 ? lumpTax / lumpSumGross : 0;

  const pensionTotal = estimatedTotal - lumpSumGross;
  const pensionAnnualGross =
    params.idecoPensionYears > 0 ? pensionTotal / params.idecoPensionYears : 0;
  const ptax = pensionTax(pensionAnnualGross, receiveAge);
  const pensionRate = pensionAnnualGross > 0 ? ptax / pensionAnnualGross : 0;

  return { lumpSumRate, pensionAnnualGrossEstimate: pensionAnnualGross, pensionRate };
}
