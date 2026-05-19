// 決定論的な複利 + 取り崩しシミュレーション
// 月次ループで運用 -> 積立 -> 取り崩し -> 損益按分課税 の順に処理する
import { adjustedMonthlyPension } from "./pension.ts";

export const TAX_RATE = 0.20315;

export interface CalculateParams {
  initialAmount: number;
  monthlyContribution: number;
  annualReturnRate: number;
  expenseRatio: number;
  inflationRate: number;
  contributionYears: number;
  withdrawalStartYear: number;
  withdrawalYears: number;
  withdrawalMode: "amount" | "rate" | "rate-risk";
  fixedMonthlyWithdrawal: number;
  withdrawalRate: number;
  monthlyWithdrawalFloor: number | null;
  monthlyWithdrawalCeiling: number | null;
  inflationAdjustedWithdrawal: boolean;
  taxFree: boolean;
  basePension: number;
  pensionStartAge: number;
  currentAge: number | null;
  monthlyOtherIncome: number;
  defenseRatio: number;
  defenseAnnualReturnRate: number;
  rebalanceThresholdPoint: number;
  defensePriorityOnDrawdown: boolean;
}

export interface YearlyProjection {
  year: number;
  age: number | null;
  principal: number;
  interest: number;
  tax: number;
  total: number;
  yearlyWithdrawal: number;
  yearlyPension: number;
  yearlyOtherIncome: number;
}

export interface RebalanceInfo {
  direction: "risk-to-defense" | "defense-to-risk";
  sellAmount: number;
  taxAmount: number;
  proceeds: number;
}

export interface RebalanceResult {
  riskTotal: number;
  riskPrincipal: number;
  defenseTotal: number;
  defensePrincipal: number;
  info: RebalanceInfo | null;
}

export interface MonthlyProjection {
  year: number;
  month: number;
  age: number | null;
  riskTotal: number;
  defenseTotal: number;
  total: number;
  monthlyWithdrawal: number;
  monthlyPension: number;
  monthlyOtherIncome: number;
  monthlyGainRisk: number;
  monthlyGainDefense: number;
  monthlyGain: number;
  monthlyRate: number;
  rebalanceInfo: RebalanceInfo | null;
}

export interface CompoundResult {
  yearly: YearlyProjection[];
  monthly: MonthlyProjection[];
}

// 年率モード時の月額下限/上限クランプ。null は無効を意味する。
export function clampToBounds(
  value: number,
  floor: number | null,
  ceiling: number | null,
): number {
  let v = value;
  if (floor !== null && v < floor) v = floor;
  if (ceiling !== null && v > ceiling) v = ceiling;
  return v;
}

// 1バケットから amount を取り崩し、含み益按分課税分も合わせて控除する。
export function withdrawFromBucket(
  total: number,
  principal: number,
  amount: number,
  taxRate: number,
): [number, number] {
  if (amount <= 0 || total <= 0) return [total, principal];
  const gainRatio = total > principal ? (total - principal) / total : 0;
  const tax = amount * gainRatio * taxRate;
  const ratio = Math.min(amount / total, 1);
  const newPrincipal = principal * (1 - ratio);
  const newTotal = Math.max(total - amount - tax, 0);
  return [newTotal, newPrincipal];
}

// 取り崩し額を時価比率で2バケットに按分し、片方が枯渇した場合は他方で補う。
export function splitProportional(
  amount: number,
  riskTotal: number,
  defenseTotal: number,
): [number, number] {
  const total = riskTotal + defenseTotal;
  if (amount <= 0 || total <= 0) return [0, 0];
  let fromRisk = amount * (riskTotal / total);
  let fromDefense = amount * (defenseTotal / total);
  if (fromRisk > riskTotal) {
    fromDefense += fromRisk - riskTotal;
    fromRisk = riskTotal;
  }
  if (fromDefense > defenseTotal) {
    fromRisk += fromDefense - defenseTotal;
    fromDefense = defenseTotal;
  }
  return [Math.min(fromRisk, riskTotal), Math.min(fromDefense, defenseTotal)];
}

// リスク資産から優先取り崩し。リスクが足りない場合は不足分を防衛から補う。
export function splitRiskFirst(
  amount: number,
  riskTotal: number,
  defenseTotal: number,
): [number, number] {
  if (amount <= 0) return [0, 0];
  const fromRisk = Math.min(amount, Math.max(riskTotal, 0));
  const fromDefense = Math.min(amount - fromRisk, Math.max(defenseTotal, 0));
  return [fromRisk, fromDefense];
}

// 月末時点の防衛資産比率が目標から thresholdPoint（pt）以上乖離していたらリバランス発動。
export function needsRebalance(
  riskTotal: number,
  defenseTotal: number,
  defenseRatio: number,
  thresholdPoint: number,
): boolean {
  const total = riskTotal + defenseTotal;
  if (total <= 0) return false;
  const currentRatio = defenseTotal / total;
  return Math.abs(currentRatio - defenseRatio) * 100 > thresholdPoint;
}

// 売却側のみ含み益按分課税。税引後の手取りを買付側に加算して目標比率に近づける。
export function rebalanceBuckets(
  riskTotal: number,
  riskPrincipal: number,
  defenseTotal: number,
  defensePrincipal: number,
  defenseRatio: number,
  taxRate: number,
): RebalanceResult {
  const total = riskTotal + defenseTotal;
  const delta = total > 0 ? defenseRatio * total - defenseTotal : 0;
  const sellRisk = delta > 0;
  const srcTotal = sellRisk ? riskTotal : defenseTotal;
  const srcPrincipal = sellRisk ? riskPrincipal : defensePrincipal;
  const sell = delta === 0 ? 0 : Math.min(Math.abs(delta), srcTotal);
  if (sell <= 0) {
    return { riskTotal, riskPrincipal, defenseTotal, defensePrincipal, info: null };
  }

  const gainRatio = srcTotal > srcPrincipal ? (srcTotal - srcPrincipal) / srcTotal : 0;
  const tax = sell * gainRatio * taxRate;
  const proceeds = sell - tax;
  const [newSrcTotal, newSrcPrincipal] = withdrawFromBucket(srcTotal, srcPrincipal, sell, taxRate);

  const info: RebalanceInfo = {
    direction: sellRisk ? "risk-to-defense" : "defense-to-risk",
    sellAmount: sell,
    taxAmount: tax,
    proceeds,
  };

  return sellRisk
    ? {
        riskTotal: newSrcTotal,
        riskPrincipal: newSrcPrincipal,
        defenseTotal: defenseTotal + proceeds,
        defensePrincipal: defensePrincipal + proceeds,
        info,
      }
    : {
        riskTotal: riskTotal + proceeds,
        riskPrincipal: riskPrincipal + proceeds,
        defenseTotal: newSrcTotal,
        defensePrincipal: newSrcPrincipal,
        info,
      };
}

export function calculateCompound(params: CalculateParams): CompoundResult {
  const {
    initialAmount,
    monthlyContribution,
    annualReturnRate,
    expenseRatio,
    inflationRate,
    contributionYears,
    withdrawalStartYear,
    withdrawalYears,
    withdrawalMode,
    fixedMonthlyWithdrawal,
    withdrawalRate,
    monthlyWithdrawalFloor,
    monthlyWithdrawalCeiling,
    inflationAdjustedWithdrawal,
    taxFree,
    basePension,
    pensionStartAge,
    currentAge,
    monthlyOtherIncome,
    defenseRatio,
    defenseAnnualReturnRate,
    rebalanceThresholdPoint,
    defensePriorityOnDrawdown,
  } = params;

  const totalYears = Math.max(contributionYears, withdrawalStartYear + withdrawalYears);
  const ri = inflationRate / 100;
  const monthlyInflationFactor = ri > 0 ? Math.pow(1 + ri, 1 / 12) : 1;
  const taxRate = taxFree ? 0 : TAX_RATE;

  const dr = Math.max(0, Math.min(100, defenseRatio || 0)) / 100;
  const contribRisk = monthlyContribution * (1 - dr);
  const contribDefense = monthlyContribution * dr;

  const realAnnualRateRisk = (annualReturnRate - expenseRatio) / 100;
  const monthlyRateRisk = Math.pow(1 + realAnnualRateRisk, 1 / 12) - 1;
  const realAnnualRateDefense = (defenseAnnualReturnRate || 0) / 100;
  const monthlyRateDefense = Math.pow(1 + realAnnualRateDefense, 1 / 12) - 1;

  const monthlyPension = basePension > 0 ? adjustedMonthlyPension(basePension, pensionStartAge) : 0;
  const pensionStartYearOffset =
    basePension > 0 && currentAge != null ? Math.max(0, pensionStartAge - currentAge) : null;

  let riskTotal = initialAmount * (1 - dr);
  let defenseTotal = initialAmount * dr;
  let riskPrincipal = riskTotal;
  let defensePrincipal = defenseTotal;
  let currentMonthlyWithdrawal = fixedMonthlyWithdrawal;
  let rateBasedMonthlyWithdrawal = 0;
  const isAnyRateMode = withdrawalMode === "rate" || withdrawalMode === "rate-risk";
  // 決定論版は名目値計算のため、年率モードの下限/上限を毎年初に *=(1+ri) して実質購買力を一定に保つ。
  let currentMonthlyFloor: number | null = monthlyWithdrawalFloor;
  let currentMonthlyCeiling: number | null = monthlyWithdrawalCeiling;

  const projections: YearlyProjection[] = [
    {
      year: 0,
      age: currentAge != null ? currentAge : null,
      principal: Math.round(riskPrincipal + defensePrincipal),
      interest: 0,
      tax: 0,
      total: Math.round(riskTotal + defenseTotal),
      yearlyWithdrawal: 0,
      yearlyPension: 0,
      yearlyOtherIncome: 0,
    },
  ];
  const monthlyArr: MonthlyProjection[] = [];

  for (let year = 1; year <= totalYears; year++) {
    const isContributing = year <= contributionYears;
    const isWithdrawing =
      year > withdrawalStartYear && year <= withdrawalStartYear + withdrawalYears;
    let yearlyWithdrawal = 0;
    let yearlyPension = 0;
    let yearlyOtherIncome = 0;

    if (ri > 0) {
      if (currentMonthlyFloor !== null) currentMonthlyFloor *= 1 + ri;
      if (currentMonthlyCeiling !== null) currentMonthlyCeiling *= 1 + ri;
    }

    for (let m = 0; m < 12; m++) {
      const prevRisk = riskTotal;
      const prevDefense = defenseTotal;
      riskTotal *= 1 + monthlyRateRisk;
      defenseTotal *= 1 + monthlyRateDefense;
      const gainRisk = riskTotal - prevRisk;
      const gainDefense = defenseTotal - prevDefense;

      if (isContributing) {
        riskTotal += contribRisk;
        riskPrincipal += contribRisk;
        defenseTotal += contribDefense;
        defensePrincipal += contribDefense;
      }

      const currentTotal = riskTotal + defenseTotal;

      let monthlyWithdrawal = 0;
      let monthPension = 0;
      let monthOtherIncome = 0;

      if (isWithdrawing && currentTotal > 0) {
        let baseWithdrawal: number;
        if (withdrawalMode === "rate") {
          if (m === 0 && year === withdrawalStartYear + 1) {
            rateBasedMonthlyWithdrawal = (currentTotal * withdrawalRate) / 100 / 12;
          } else if (m === 0) {
            rateBasedMonthlyWithdrawal *= 1 + ri;
          }
          baseWithdrawal = rateBasedMonthlyWithdrawal;
        } else if (withdrawalMode === "rate-risk") {
          if (m === 0) {
            rateBasedMonthlyWithdrawal = (riskTotal * withdrawalRate) / 100 / 12;
          }
          baseWithdrawal = rateBasedMonthlyWithdrawal;
        } else {
          baseWithdrawal = currentMonthlyWithdrawal;
          if (inflationAdjustedWithdrawal) {
            currentMonthlyWithdrawal *= monthlyInflationFactor;
          }
        }

        if (isAnyRateMode) {
          baseWithdrawal = clampToBounds(baseWithdrawal, currentMonthlyFloor, currentMonthlyCeiling);
        }

        const pensionActive =
          pensionStartYearOffset != null && year >= pensionStartYearOffset && monthlyPension > 0;
        monthPension = pensionActive ? monthlyPension : 0;
        monthOtherIncome = monthlyOtherIncome;
        const income = monthPension + monthOtherIncome;
        const netWithdrawal = Math.max(baseWithdrawal - income, 0);

        const [fromRisk, fromDefense] = defensePriorityOnDrawdown
          ? splitRiskFirst(netWithdrawal, riskTotal, defenseTotal)
          : splitProportional(netWithdrawal, riskTotal, defenseTotal);
        [riskTotal, riskPrincipal] = withdrawFromBucket(riskTotal, riskPrincipal, fromRisk, taxRate);
        [defenseTotal, defensePrincipal] = withdrawFromBucket(
          defenseTotal,
          defensePrincipal,
          fromDefense,
          taxRate,
        );

        monthlyWithdrawal = fromRisk + fromDefense;
        yearlyWithdrawal += monthlyWithdrawal;
        yearlyPension += monthPension;
        yearlyOtherIncome += monthOtherIncome;
      }

      let rebalanceInfo: RebalanceInfo | null = null;
      if (dr > 0 && needsRebalance(riskTotal, defenseTotal, dr, rebalanceThresholdPoint)) {
        const rb = rebalanceBuckets(
          riskTotal,
          riskPrincipal,
          defenseTotal,
          defensePrincipal,
          dr,
          taxRate,
        );
        riskTotal = rb.riskTotal;
        riskPrincipal = rb.riskPrincipal;
        defenseTotal = rb.defenseTotal;
        defensePrincipal = rb.defensePrincipal;
        rebalanceInfo = rb.info;
      }

      const prevTotal = prevRisk + prevDefense;
      const monthlyRate = prevTotal > 0 ? (gainRisk + gainDefense) / prevTotal : 0;
      monthlyArr.push({
        year,
        month: m + 1,
        age: currentAge != null ? currentAge + year : null,
        riskTotal: Math.round(riskTotal),
        defenseTotal: Math.round(defenseTotal),
        total: Math.round(riskTotal + defenseTotal),
        monthlyWithdrawal: Math.round(monthlyWithdrawal),
        monthlyPension: Math.round(monthPension),
        monthlyOtherIncome: Math.round(monthOtherIncome),
        monthlyGainRisk: Math.round(gainRisk),
        monthlyGainDefense: Math.round(gainDefense),
        monthlyGain: Math.round(gainRisk + gainDefense),
        monthlyRate,
        rebalanceInfo,
      });
    }

    // tax: 年末時点でまだ売却していない含み益に対する「もし全部売却したら」の試算税。
    // 月次ループ中に取り崩しと共に発生した課税分は currentTotal から既に控除済み。
    const endTotal = riskTotal + defenseTotal;
    const endPrincipal = riskPrincipal + defensePrincipal;
    const interest = endTotal - endPrincipal;
    const tax = interest > 0 ? Math.round(interest * taxRate) : 0;
    const afterTaxTotal = Math.max(endTotal - tax, 0);
    projections.push({
      year,
      age: currentAge != null ? currentAge + year : null,
      principal: Math.round(endPrincipal),
      interest: interest > 0 ? Math.round(interest - tax) : 0,
      tax,
      total: Math.round(afterTaxTotal),
      yearlyWithdrawal: Math.round(yearlyWithdrawal),
      yearlyPension: Math.round(yearlyPension),
      yearlyOtherIncome: Math.round(yearlyOtherIncome),
    });
  }

  return { yearly: projections, monthly: monthlyArr };
}
