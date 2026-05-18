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
  } = params;

  const totalYears = Math.max(contributionYears, withdrawalStartYear + withdrawalYears);
  const mu = (annualReturnRate - expenseRatio) / 100;
  const sigma = volatility / 100;
  const ri = inflationRate / 100;
  const monthlyDrift = (mu - ri - (sigma * sigma) / 2) / 12;
  const monthlySigma = sigma / Math.sqrt(12);
  const taxRate = taxFree ? 0 : TAX_RATE;

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
  const paths = new Float64Array(N).fill(initialAmount);
  const costBasis = new Float64Array(N).fill(initialAmount);
  const cumulativeWithdrawals = new Float64Array(N);
  const rateBasedMonthlyWithdrawal = new Float64Array(N);
  const rateWithdrawalInitialized = new Uint8Array(N);
  const currentMonthlyWithdrawal = new Float64Array(N).fill(
    fixedMonthlyWithdrawal * preWithdrawalDeflation,
  );

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
      for (let i = 0; i < N; i++) {
        const z = normalRandom(rng);
        const growthFactor = Math.exp(monthlyDrift + monthlySigma * z);
        paths[i] *= growthFactor;

        if (isContributing) {
          paths[i] += monthlyContribution;
          costBasis[i] += monthlyContribution;
        }

        if (isWithdrawing && paths[i] > 0) {
          let baseWithdrawal;
          if (isRateMode) {
            if (!rateWithdrawalInitialized[i]) {
              rateBasedMonthlyWithdrawal[i] = (paths[i] * withdrawalRate) / 100 / 12;
              rateWithdrawalInitialized[i] = 1;
            }
            baseWithdrawal = rateBasedMonthlyWithdrawal[i];
          } else {
            baseWithdrawal = currentMonthlyWithdrawal[i];
          }

          const income = monthPension + monthlyOtherIncome;
          const netWithdrawal = Math.max(baseWithdrawal - income, 0);
          cumulativeWithdrawals[i] += netWithdrawal;
          yearlyWithdrawals[i] += netWithdrawal;

          const gainRatio =
            paths[i] > costBasis[i] ? (paths[i] - costBasis[i]) / paths[i] : 0;
          const taxOnWithdrawal = netWithdrawal * gainRatio * taxRate;
          const withdrawalRatio = Math.min(netWithdrawal / paths[i], 1);
          costBasis[i] *= 1 - withdrawalRatio;

          paths[i] -= netWithdrawal + taxOnWithdrawal;
          if (paths[i] < 0) paths[i] = 0;
        }
      }

      if (isWithdrawing && !isRateMode) {
        for (let i = 0; i < N; i++) {
          currentMonthlyWithdrawal[i] *= monthlyRealWithdrawalFactor;
        }
      }
    }

    const sorted = Float64Array.from(paths).sort();
    const q = (p) => sorted[Math.min(N - 1, Math.floor(N * p))];
    let depleted = 0;
    for (let i = 0; i < N; i++) {
      if (paths[i] <= 0 && cumulativeWithdrawals[i] > 0) depleted++;
    }
    const sortedW = Float64Array.from(yearlyWithdrawals).sort();
    yearly.push({
      year,
      age: currentAge != null ? currentAge + year : null,
      p10: q(0.1),
      p25: q(0.25),
      p50: q(0.5),
      p75: q(0.75),
      p90: q(0.9),
      depletionRate: depleted / N,
      medianYearlyWithdrawal: sortedW[Math.floor(N * 0.5)],
    });
  }

  const totalContributed =
    initialAmount + monthlyContribution * 12 * Math.min(contributionYears, totalYears);
  let failureCount = 0;
  for (let i = 0; i < N; i++) {
    if (paths[i] + cumulativeWithdrawals[i] < totalContributed) failureCount++;
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
