// モンテカルロ・シミュレーション（GBM、5000パス）
// 実質値（インフレ控除後）で計算。再現性のため Mulberry32 + Box-Muller を使用。
import { adjustedMonthlyPension } from "./pension.js";
import { TAX_RATE } from "./calculate.js";

const NUM_SIMULATIONS = 5000;
const SEED = 42;

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function normalRandom(rng) {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function simulateMonteCarlo(params) {
  const {
    initialAmount,
    monthlyContribution,
    annualReturnRate,
    expenseRatio,
    inflationRate,
    volatility,
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
    defenseVolatility,
    defensePriorityOnDrawdown,
    drawdownThresholdPercent,
  } = params;

  const totalYears = Math.max(contributionYears, withdrawalStartYear + withdrawalYears);
  const ri = inflationRate / 100;
  const taxRate = taxFree ? 0 : TAX_RATE;

  const dr = Math.max(0, Math.min(100, defenseRatio || 0)) / 100;
  const useDefense = dr > 0;
  const contribRisk = monthlyContribution * (1 - dr);
  const contribDefense = monthlyContribution * dr;

  const muRisk = (annualReturnRate - expenseRatio) / 100;
  const sigmaRisk = volatility / 100;
  const monthlyDriftRisk = (muRisk - ri - (sigmaRisk * sigmaRisk) / 2) / 12;
  const monthlySigmaRisk = sigmaRisk / Math.sqrt(12);

  const muDef = (defenseAnnualReturnRate || 0) / 100;
  const sigmaDef = (defenseVolatility || 0) / 100;
  const monthlyDriftDef = (muDef - ri - (sigmaDef * sigmaDef) / 2) / 12;
  const monthlySigmaDef = sigmaDef / Math.sqrt(12);

  const drawdownThreshold = Math.max(0, drawdownThresholdPercent || 0) / 100;
  const priorityOnDrawdown = !!defensePriorityOnDrawdown && useDefense;

  const monthlyPension = basePension > 0 ? adjustedMonthlyPension(basePension, pensionStartAge) : 0;
  const pensionStartYearOffset =
    basePension > 0 && currentAge != null ? Math.max(0, pensionStartAge - currentAge) : null;

  const isRateMode = withdrawalMode === "rate";

  // 名目固定の引出額は実質値で目減りするのでデフレ調整
  const preWithdrawalDeflation =
    !isRateMode && !inflationAdjustedWithdrawal && ri > 0
      ? Math.pow(1 + ri, -withdrawalStartYear)
      : 1;
  const monthlyRealWithdrawalFactor =
    !isRateMode && !inflationAdjustedWithdrawal && ri > 0
      ? 1 / Math.pow(1 + ri, 1 / 12)
      : 1;

  const rng = mulberry32(SEED);
  const N = NUM_SIMULATIONS;
  const initialRisk = initialAmount * (1 - dr);
  const initialDefense = initialAmount * dr;
  const riskPaths = new Float64Array(N).fill(initialRisk);
  const defensePaths = useDefense ? new Float64Array(N).fill(initialDefense) : null;
  const riskCostBasis = new Float64Array(N).fill(initialRisk);
  const defenseCostBasis = useDefense ? new Float64Array(N).fill(initialDefense) : null;
  const riskHWM = priorityOnDrawdown ? new Float64Array(N).fill(initialRisk) : null;
  const cumulativeWithdrawals = new Float64Array(N);
  const rateBasedMonthlyWithdrawal = new Float64Array(N);
  const rateWithdrawalInitialized = new Uint8Array(N);
  const currentMonthlyWithdrawal = new Float64Array(N).fill(
    fixedMonthlyWithdrawal * preWithdrawalDeflation,
  );
  const totalPaths = new Float64Array(N);

  const yearly = [
    {
      year: 0,
      age: currentAge != null ? currentAge : null,
      p10: initialAmount,
      p25: initialAmount,
      p50: initialAmount,
      p75: initialAmount,
      p90: initialAmount,
      depletionRate: 0,
      medianYearlyWithdrawal: 0,
    },
  ];

  for (let year = 1; year <= totalYears; year++) {
    const isContributing = year <= contributionYears;
    const isWithdrawing =
      year > withdrawalStartYear && year <= withdrawalStartYear + withdrawalYears;
    const isFirstWithdrawalYear = year === withdrawalStartYear + 1;
    const pensionActive =
      pensionStartYearOffset != null && year >= pensionStartYearOffset && monthlyPension > 0;
    const monthPension = pensionActive ? monthlyPension : 0;
    const yearlyWithdrawals = new Float64Array(N);

    // rate モードでは年頭にインフレ調整。決定論と挙動を揃える。
    if (isWithdrawing && isRateMode) {
      for (let i = 0; i < N; i++) {
        if (rateWithdrawalInitialized[i] && ri > 0) {
          rateBasedMonthlyWithdrawal[i] *= 1 + ri;
        }
      }
    }

    for (let m = 0; m < 12; m++) {
      const isWithdrawalStartMonth = isFirstWithdrawalYear && m === 0;

      if (useDefense) {
        for (let i = 0; i < N; i++) {
          const zRisk = normalRandom(rng);
          riskPaths[i] *= Math.exp(monthlyDriftRisk + monthlySigmaRisk * zRisk);
          const zDef = normalRandom(rng);
          defensePaths[i] *= Math.exp(monthlyDriftDef + monthlySigmaDef * zDef);

          if (isContributing) {
            riskPaths[i] += contribRisk;
            riskCostBasis[i] += contribRisk;
            defensePaths[i] += contribDefense;
            defenseCostBasis[i] += contribDefense;
          }

          // 積立期のピーク値を引きずらないよう、取り崩し開始月に高値基準（HWM）を再初期化する
          if (priorityOnDrawdown) {
            if (isWithdrawalStartMonth) {
              riskHWM[i] = riskPaths[i];
            } else if (isWithdrawing && riskPaths[i] > riskHWM[i]) {
              riskHWM[i] = riskPaths[i];
            }
          }

          const total = riskPaths[i] + defensePaths[i];

          if (isWithdrawing && total > 0) {
            let baseWithdrawal;
            if (isRateMode) {
              if (!rateWithdrawalInitialized[i]) {
                rateBasedMonthlyWithdrawal[i] = (total * withdrawalRate) / 100 / 12;
                rateWithdrawalInitialized[i] = 1;
              }
              baseWithdrawal = rateBasedMonthlyWithdrawal[i];
            } else {
              baseWithdrawal = currentMonthlyWithdrawal[i];
            }

            const income = monthPension + monthlyOtherIncome;
            const netWithdrawal = Math.max(baseWithdrawal - income, 0);

            if (netWithdrawal > 0) {
              let fromRisk;
              let fromDefense;
              const inDrawdown =
                priorityOnDrawdown &&
                riskHWM[i] > 0 &&
                1 - riskPaths[i] / riskHWM[i] >= drawdownThreshold;
              if (inDrawdown && defensePaths[i] > 0) {
                fromDefense = Math.min(netWithdrawal, defensePaths[i]);
                fromRisk = netWithdrawal - fromDefense;
              } else {
                fromRisk = netWithdrawal * (riskPaths[i] / total);
                fromDefense = netWithdrawal * (defensePaths[i] / total);
              }
              // 片方が枯渇した分は他方に回す
              if (fromRisk > riskPaths[i]) {
                fromDefense += fromRisk - riskPaths[i];
                fromRisk = riskPaths[i];
              }
              if (fromDefense > defensePaths[i]) {
                fromRisk += fromDefense - defensePaths[i];
                fromDefense = defensePaths[i];
              }
              if (fromRisk > riskPaths[i]) fromRisk = riskPaths[i];
              if (fromDefense > defensePaths[i]) fromDefense = defensePaths[i];

              let drawnTotal = 0;
              if (fromRisk > 0) {
                const gainRatio =
                  riskPaths[i] > riskCostBasis[i]
                    ? (riskPaths[i] - riskCostBasis[i]) / riskPaths[i]
                    : 0;
                const tax = fromRisk * gainRatio * taxRate;
                riskCostBasis[i] *= 1 - Math.min(fromRisk / riskPaths[i], 1);
                riskPaths[i] -= fromRisk + tax;
                if (riskPaths[i] < 0) riskPaths[i] = 0;
                drawnTotal += fromRisk;
              }
              if (fromDefense > 0) {
                const gainRatio =
                  defensePaths[i] > defenseCostBasis[i]
                    ? (defensePaths[i] - defenseCostBasis[i]) / defensePaths[i]
                    : 0;
                const tax = fromDefense * gainRatio * taxRate;
                defenseCostBasis[i] *= 1 - Math.min(fromDefense / defensePaths[i], 1);
                defensePaths[i] -= fromDefense + tax;
                if (defensePaths[i] < 0) defensePaths[i] = 0;
                drawnTotal += fromDefense;
              }

              cumulativeWithdrawals[i] += drawnTotal;
              yearlyWithdrawals[i] += drawnTotal;
            }
          }
        }
      } else {
        for (let i = 0; i < N; i++) {
          const z = normalRandom(rng);
          riskPaths[i] *= Math.exp(monthlyDriftRisk + monthlySigmaRisk * z);

          if (isContributing) {
            riskPaths[i] += contribRisk;
            riskCostBasis[i] += contribRisk;
          }

          if (isWithdrawing && riskPaths[i] > 0) {
            let baseWithdrawal;
            if (isRateMode) {
              if (!rateWithdrawalInitialized[i]) {
                rateBasedMonthlyWithdrawal[i] = (riskPaths[i] * withdrawalRate) / 100 / 12;
                rateWithdrawalInitialized[i] = 1;
              }
              baseWithdrawal = rateBasedMonthlyWithdrawal[i];
            } else {
              baseWithdrawal = currentMonthlyWithdrawal[i];
            }

            const income = monthPension + monthlyOtherIncome;
            const netWithdrawal = Math.max(baseWithdrawal - income, 0);

            if (netWithdrawal > 0) {
              const gainRatio =
                riskPaths[i] > riskCostBasis[i]
                  ? (riskPaths[i] - riskCostBasis[i]) / riskPaths[i]
                  : 0;
              const tax = netWithdrawal * gainRatio * taxRate;
              const ratio = Math.min(netWithdrawal / riskPaths[i], 1);
              riskCostBasis[i] *= 1 - ratio;
              riskPaths[i] -= netWithdrawal + tax;
              if (riskPaths[i] < 0) riskPaths[i] = 0;

              cumulativeWithdrawals[i] += netWithdrawal;
              yearlyWithdrawals[i] += netWithdrawal;
            }
          }
        }
      }

      if (isWithdrawing && !isRateMode) {
        for (let i = 0; i < N; i++) {
          currentMonthlyWithdrawal[i] *= monthlyRealWithdrawalFactor;
        }
      }
    }

    if (useDefense) {
      for (let i = 0; i < N; i++) totalPaths[i] = riskPaths[i] + defensePaths[i];
    } else {
      totalPaths.set(riskPaths);
    }
    let depleted = 0;
    for (let i = 0; i < N; i++) {
      if (totalPaths[i] <= 0 && cumulativeWithdrawals[i] > 0) depleted++;
    }
    totalPaths.sort();
    yearlyWithdrawals.sort();
    const q = (p) => totalPaths[Math.min(N - 1, Math.floor(N * p))];
    yearly.push({
      year,
      age: currentAge != null ? currentAge + year : null,
      p10: q(0.1),
      p25: q(0.25),
      p50: q(0.5),
      p75: q(0.75),
      p90: q(0.9),
      depletionRate: depleted / N,
      medianYearlyWithdrawal: yearlyWithdrawals[Math.floor(N * 0.5)],
    });
  }

  const totalContributed =
    initialAmount + monthlyContribution * 12 * Math.min(contributionYears, totalYears);
  let failureCount = 0;
  for (let i = 0; i < N; i++) {
    const finalTotal = useDefense ? riskPaths[i] + defensePaths[i] : riskPaths[i];
    if (finalTotal + cumulativeWithdrawals[i] < totalContributed) failureCount++;
  }

  return {
    yearly,
    failureProbability: failureCount / N,
    depletionProbability: yearly[yearly.length - 1].depletionRate,
    finalP50: yearly[yearly.length - 1].p50,
    finalP10: yearly[yearly.length - 1].p10,
    finalP90: yearly[yearly.length - 1].p90,
  };
}

export function computeSecurityScore({ depletionProbability, failureProbability, medianFinal }) {
  let score = (1 - depletionProbability) * 100;
  if (failureProbability != null) score -= failureProbability * 20;
  if (medianFinal <= 0) score = Math.min(score, 10);
  return Math.max(0, Math.min(100, Math.round(score)));
}

export function scoreLabel(score) {
  if (score >= 95) return { label: "非常に安心", className: "score-excellent" };
  if (score >= 80) return { label: "安心", className: "score-safe" };
  if (score >= 60) return { label: "やや注意", className: "score-caution" };
  if (score >= 40) return { label: "注意", className: "score-warn" };
  return { label: "要見直し", className: "score-danger" };
}
