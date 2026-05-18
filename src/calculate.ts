// 決定論的な複利 + 取り崩しシミュレーション
// 月次ループで運用 -> 積立 -> 取り崩し -> 損益按分課税 の順に処理する
import { adjustedMonthlyPension } from "./pension.js";

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
  withdrawalMode: "amount" | "rate";
  fixedMonthlyWithdrawal: number;
  withdrawalRate: number;
  inflationAdjustedWithdrawal: boolean;
  taxFree: boolean;
  basePension: number;
  pensionStartAge: number;
  currentAge: number | null;
  monthlyOtherIncome: number;
  defenseRatio: number;
  defenseAnnualReturnRate: number;
  rebalanceThresholdPoint: number;
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

// 1バケットから amount を取り崩し、含み益按分課税分も合わせて控除する。
// 戻り値: [新しい total, 新しい principal]
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
): [number, number, number, number] {
  const total = riskTotal + defenseTotal;
  if (total <= 0) return [riskTotal, riskPrincipal, defenseTotal, defensePrincipal];
  const delta = defenseRatio * total - defenseTotal;
  if (delta === 0) return [riskTotal, riskPrincipal, defenseTotal, defensePrincipal];

  const sellRisk = delta > 0;
  const srcTotal = sellRisk ? riskTotal : defenseTotal;
  const srcPrincipal = sellRisk ? riskPrincipal : defensePrincipal;
  const sell = Math.min(Math.abs(delta), srcTotal);
  if (sell <= 0) return [riskTotal, riskPrincipal, defenseTotal, defensePrincipal];

  const gainRatio = srcTotal > srcPrincipal ? (srcTotal - srcPrincipal) / srcTotal : 0;
  const proceeds = sell - sell * gainRatio * taxRate;
  const [newSrcTotal, newSrcPrincipal] = withdrawFromBucket(srcTotal, srcPrincipal, sell, taxRate);

  return sellRisk
    ? [newSrcTotal, newSrcPrincipal, defenseTotal + proceeds, defensePrincipal + proceeds]
    : [riskTotal + proceeds, riskPrincipal + proceeds, newSrcTotal, newSrcPrincipal];
}

export function calculateCompound(params: CalculateParams): YearlyProjection[] {
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
    inflationAdjustedWithdrawal,
    taxFree,
    basePension,
    pensionStartAge,
    currentAge,
    monthlyOtherIncome,
    defenseRatio,
    defenseAnnualReturnRate,
    rebalanceThresholdPoint,
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

  for (let year = 1; year <= totalYears; year++) {
    const isContributing = year <= contributionYears;
    const isWithdrawing =
      year > withdrawalStartYear && year <= withdrawalStartYear + withdrawalYears;
    let yearlyWithdrawal = 0;
    let yearlyPension = 0;
    let yearlyOtherIncome = 0;

    for (let m = 0; m < 12; m++) {
      riskTotal *= 1 + monthlyRateRisk;
      defenseTotal *= 1 + monthlyRateDefense;

      if (isContributing) {
        riskTotal += contribRisk;
        riskPrincipal += contribRisk;
        defenseTotal += contribDefense;
        defensePrincipal += contribDefense;
      }

      const currentTotal = riskTotal + defenseTotal;

      if (isWithdrawing && currentTotal > 0) {
        let baseWithdrawal: number;
        if (withdrawalMode === "rate") {
          if (m === 0 && year === withdrawalStartYear + 1) {
            rateBasedMonthlyWithdrawal = (currentTotal * withdrawalRate) / 100 / 12;
          } else if (m === 0) {
            rateBasedMonthlyWithdrawal *= 1 + ri;
          }
          baseWithdrawal = rateBasedMonthlyWithdrawal;
        } else {
          baseWithdrawal = currentMonthlyWithdrawal;
          if (inflationAdjustedWithdrawal) {
            currentMonthlyWithdrawal *= monthlyInflationFactor;
          }
        }

        const pensionActive =
          pensionStartYearOffset != null && year >= pensionStartYearOffset && monthlyPension > 0;
        const monthPension = pensionActive ? monthlyPension : 0;
        const income = monthPension + monthlyOtherIncome;
        const netWithdrawal = Math.max(baseWithdrawal - income, 0);

        const [fromRisk, fromDefense] = splitProportional(netWithdrawal, riskTotal, defenseTotal);
        [riskTotal, riskPrincipal] = withdrawFromBucket(riskTotal, riskPrincipal, fromRisk, taxRate);
        [defenseTotal, defensePrincipal] = withdrawFromBucket(
          defenseTotal,
          defensePrincipal,
          fromDefense,
          taxRate,
        );

        yearlyWithdrawal += fromRisk + fromDefense;
        yearlyPension += monthPension;
        yearlyOtherIncome += monthlyOtherIncome;
      }

      if (dr > 0 && needsRebalance(riskTotal, defenseTotal, dr, rebalanceThresholdPoint)) {
        [riskTotal, riskPrincipal, defenseTotal, defensePrincipal] = rebalanceBuckets(
          riskTotal,
          riskPrincipal,
          defenseTotal,
          defensePrincipal,
          dr,
          taxRate,
        );
      }
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

  return projections;
}
