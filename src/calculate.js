// 決定論的な複利 + 取り崩しシミュレーション
// 月次ループで運用 -> 積立 -> 取り崩し -> 損益按分課税 の順に処理する
import { adjustedMonthlyPension } from "./pension.js";

export const TAX_RATE = 0.20315;

export function calculateCompound(params) {
  const {
    initialAmount,
    monthlyContribution,
    annualReturnRate,
    expenseRatio,
    inflationRate,
    contributionYears,
    withdrawalStartYear,
    withdrawalYears,
    withdrawalMode, // "amount" | "rate"
    fixedMonthlyWithdrawal,
    withdrawalRate,
    inflationAdjustedWithdrawal,
    taxFree,
    basePension,
    pensionStartAge,
    currentAge,
    monthlyOtherIncome,
  } = params;

  const totalYears = Math.max(contributionYears, withdrawalStartYear + withdrawalYears);
  const realAnnualRate = (annualReturnRate - expenseRatio) / 100;
  const monthlyRate = Math.pow(1 + realAnnualRate, 1 / 12) - 1;
  const ri = inflationRate / 100;
  const monthlyInflationFactor = ri > 0 ? Math.pow(1 + ri, 1 / 12) : 1;
  const taxRate = taxFree ? 0 : TAX_RATE;

  const monthlyPension = basePension > 0 ? adjustedMonthlyPension(basePension, pensionStartAge) : 0;
  const pensionStartYearOffset =
    basePension > 0 && currentAge != null ? Math.max(0, pensionStartAge - currentAge) : null;

  let currentTotal = initialAmount;
  let totalPrincipal = initialAmount;
  let currentMonthlyWithdrawal = fixedMonthlyWithdrawal;
  let rateBasedMonthlyWithdrawal = 0;

  const projections = [
    {
      year: 0,
      age: currentAge != null ? currentAge : null,
      principal: totalPrincipal,
      interest: 0,
      tax: 0,
      total: currentTotal,
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
      currentTotal *= 1 + monthlyRate;

      if (isContributing) {
        currentTotal += monthlyContribution;
        totalPrincipal += monthlyContribution;
      }

      if (isWithdrawing && currentTotal > 0) {
        let baseWithdrawal;
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

        const gainRatio =
          currentTotal > totalPrincipal ? (currentTotal - totalPrincipal) / currentTotal : 0;
        const taxOnWithdrawal = netWithdrawal * gainRatio * taxRate;

        const withdrawalRatio = Math.min(netWithdrawal / currentTotal, 1);
        totalPrincipal *= 1 - withdrawalRatio;

        currentTotal -= netWithdrawal + taxOnWithdrawal;
        if (currentTotal < 0) currentTotal = 0;

        yearlyWithdrawal += netWithdrawal;
        yearlyPension += monthPension;
        yearlyOtherIncome += monthlyOtherIncome;
      }
    }

    // tax: 年末時点でまだ売却していない含み益に対する「もし全部売却したら」の試算税。
    // 月次ループ中に取り崩しと共に発生した課税分は currentTotal から既に控除済み。
    const interest = currentTotal - totalPrincipal;
    const tax = interest > 0 ? Math.round(interest * taxRate) : 0;
    const afterTaxTotal = Math.max(currentTotal - tax, 0);
    projections.push({
      year,
      age: currentAge != null ? currentAge + year : null,
      principal: Math.round(totalPrincipal),
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
