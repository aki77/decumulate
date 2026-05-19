// モンテカルロ・シミュレーション（GBM、5000パス）
// 実質値（インフレ控除後）で計算。再現性のため Mulberry32 + Box-Muller を使用。
import { adjustedMonthlyPension } from "./pension.ts";
import {
  TAX_RATE,
  clampToBounds,
  needsRebalance,
  rebalanceBuckets,
  type CalculateParams,
  type MonthlyProjection,
  type RebalanceInfo,
} from "./calculate.ts";

const NUM_SIMULATIONS = 5000;
const SEED = 42;

export interface MonteCarloParams extends CalculateParams {
  volatility: number;
  defenseVolatility: number;
  drawdownThresholdPercent: number;
  skipRebalanceOnDrawdown: boolean;
}

export interface MonteCarloYearly {
  year: number;
  age: number | null;
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
  depletionRate: number;
  medianYearlyWithdrawal: number;
}

export type PercentileKey = "p10" | "p25" | "p50" | "p75" | "p90";
export const PERCENTILE_KEYS: readonly PercentileKey[] = ["p10", "p25", "p50", "p75", "p90"];
export type PivotMonthlies = Record<PercentileKey, MonthlyProjection[]>;

export interface MonteCarloResult {
  yearly: MonteCarloYearly[];
  failureProbability: number;
  depletionProbability: number;
  finalP50: number;
  finalP10: number;
  finalP90: number;
  pivotMonthlies: PivotMonthlies;
}

export interface SecurityScoreInput {
  depletionProbability: number;
  failureProbability: number;
  medianFinal: number;
}

export interface ScoreLabelResult {
  label: string;
  className: string;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function normalRandom(rng: () => number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function simulateMonteCarlo(params: MonteCarloParams): MonteCarloResult {
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
    defenseVolatility,
    defensePriorityOnDrawdown,
    drawdownThresholdPercent,
    rebalanceThresholdPoint,
    skipRebalanceOnDrawdown,
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
  const skipRebalanceWhenDrawdown = !!skipRebalanceOnDrawdown;

  const monthlyPension = basePension > 0 ? adjustedMonthlyPension(basePension, pensionStartAge) : 0;
  const pensionStartYearOffset =
    basePension > 0 && currentAge != null ? Math.max(0, pensionStartAge - currentAge) : null;

  const isRateMode = withdrawalMode === "rate";
  const isRateRiskMode = withdrawalMode === "rate-risk";
  const isAnyRateMode = isRateMode || isRateRiskMode;

  // MC は内部が実質値計算。入力値（今日の購買力）をそのまま全期間の実質閾値に使う（決定論版とは違いインフレ進行させない）。
  const floorReal: number | null = monthlyWithdrawalFloor;
  const ceilingReal: number | null = monthlyWithdrawalCeiling;

  // 名目固定の引出額は実質値で目減りするのでデフレ調整
  const preWithdrawalDeflation =
    !isAnyRateMode && !inflationAdjustedWithdrawal && ri > 0
      ? Math.pow(1 + ri, -withdrawalStartYear)
      : 1;
  const monthlyRealWithdrawalFactor =
    !isAnyRateMode && !inflationAdjustedWithdrawal && ri > 0
      ? 1 / Math.pow(1 + ri, 1 / 12)
      : 1;

  const N = NUM_SIMULATIONS;
  const initialRisk = initialAmount * (1 - dr);
  const initialDefense = initialAmount * dr;

  // 本体ループを内部関数化している理由: pivotMask=null（フェーズ1）と pivotMask=非null（フェーズ2）の
  // 間で RNG 消費順序を完全に揃えることで、両フェーズが同じパスを生成し再現性を保つ。
  const runSimulation = (
    pivotIndices: Record<PercentileKey, number> | null,
  ): {
    yearly: MonteCarloYearly[];
    failureProbability: number;
    finalTotals: Float64Array | null;
    pivotMonthlies: PivotMonthlies;
  } => {
  // ホットループ（N×12×totalYears 回）で O(1) かつ分岐予測しやすい判定にするため、
  // パス index → 該当パーセンタイル の対応を Uint8Array のビットマスクで保持する。
  // 同一 index が複数パーセンタイルに最近接になる稀なケースもビット OR で表現できる。
  const pivotMaskByIndex = pivotIndices ? new Uint8Array(N) : null;
  if (pivotIndices && pivotMaskByIndex) {
    for (let bit = 0; bit < PERCENTILE_KEYS.length; bit++) {
      const k = PERCENTILE_KEYS[bit]!;
      pivotMaskByIndex[pivotIndices[k]]! |= 1 << bit;
    }
  }
  const keysForMask = (mask: number): PercentileKey[] => {
    const out: PercentileKey[] = [];
    for (let bit = 0; bit < PERCENTILE_KEYS.length; bit++) {
      if (mask & (1 << bit)) out.push(PERCENTILE_KEYS[bit]!);
    }
    return out;
  };
  const rng = mulberry32(SEED);
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
  const pivotMonthlies: PivotMonthlies = {
    p10: [],
    p25: [],
    p50: [],
    p75: [],
    p90: [],
  };

  const pushPivotRow = (
    keys: readonly PercentileKey[],
    raw: {
      year: number;
      month: number;
      prevRisk: number;
      prevDefense: number;
      riskTotal: number;
      defenseTotal: number;
      monthlyWithdrawal: number;
      monthlyPension: number;
      monthlyOtherIncome: number;
      monthlyGainRisk: number;
      monthlyGainDefense: number;
      rebalanceInfo: RebalanceInfo | null;
    },
  ): void => {
    const prevTotal = raw.prevRisk + raw.prevDefense;
    const monthlyRate =
      prevTotal > 0 ? (raw.monthlyGainRisk + raw.monthlyGainDefense) / prevTotal : 0;
    const row: MonthlyProjection = {
      year: raw.year,
      month: raw.month,
      age: currentAge != null ? currentAge + raw.year : null,
      riskTotal: Math.round(raw.riskTotal),
      defenseTotal: Math.round(raw.defenseTotal),
      total: Math.round(raw.riskTotal + raw.defenseTotal),
      monthlyWithdrawal: Math.round(raw.monthlyWithdrawal),
      monthlyPension: Math.round(raw.monthlyPension),
      monthlyOtherIncome: Math.round(raw.monthlyOtherIncome),
      monthlyGainRisk: Math.round(raw.monthlyGainRisk),
      monthlyGainDefense: Math.round(raw.monthlyGainDefense),
      monthlyGain: Math.round(raw.monthlyGainRisk + raw.monthlyGainDefense),
      monthlyRate,
      rebalanceInfo: raw.rebalanceInfo,
    };
    for (const k of keys) pivotMonthlies[k].push(row);
  };

  const yearly: MonteCarloYearly[] = [
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
    const checkDrawdown = priorityOnDrawdown && (isWithdrawing || skipRebalanceWhenDrawdown);
    const pensionActive =
      pensionStartYearOffset != null && year >= pensionStartYearOffset && monthlyPension > 0;
    const monthPension = pensionActive ? monthlyPension : 0;
    const yearlyWithdrawals = new Float64Array(N);

    // rate モードでは年頭にインフレ調整。決定論と挙動を揃える。
    if (isWithdrawing && isRateMode) {
      for (let i = 0; i < N; i++) {
        if (rateWithdrawalInitialized[i] && ri > 0) {
          rateBasedMonthlyWithdrawal[i]! *= 1 + ri;
        }
      }
    }

    for (let m = 0; m < 12; m++) {
      const isWithdrawalStartMonth = isFirstWithdrawalYear && m === 0;

      if (useDefense && defensePaths !== null && defenseCostBasis !== null) {
        for (let i = 0; i < N; i++) {
          const pivotMask = pivotMaskByIndex !== null ? pivotMaskByIndex[i]! : 0;
          const recordPivot = pivotMask !== 0;
          const prevRisk = riskPaths[i]!;
          const prevDefense = defensePaths[i]!;

          const zRisk = normalRandom(rng);
          riskPaths[i]! *= Math.exp(monthlyDriftRisk + monthlySigmaRisk * zRisk);
          const zDef = normalRandom(rng);
          defensePaths[i]! *= Math.exp(monthlyDriftDef + monthlySigmaDef * zDef);

          const gainRisk = riskPaths[i]! - prevRisk;
          const gainDefense = defensePaths[i]! - prevDefense;
          let monthlyWithdrawalRecorded = 0;
          let pensionRecorded = 0;
          let otherIncomeRecorded = 0;
          let rebalanceInfoRecorded: RebalanceInfo | null = null;

          if (isContributing) {
            riskPaths[i]! += contribRisk;
            riskCostBasis[i]! += contribRisk;
            defensePaths[i]! += contribDefense;
            defenseCostBasis[i]! += contribDefense;
          }

          // 積立期のピーク値を引きずらないよう、取り崩し開始月に高値基準（HWM）を再初期化する
          if (priorityOnDrawdown && riskHWM !== null) {
            if (isWithdrawalStartMonth) {
              riskHWM[i] = riskPaths[i]!;
            } else if (isWithdrawing && riskPaths[i]! > riskHWM[i]!) {
              riskHWM[i] = riskPaths[i]!;
            }
          }

          const total = riskPaths[i]! + defensePaths[i]!;
          const inDrawdown =
            checkDrawdown &&
            riskHWM !== null &&
            riskHWM[i]! > 0 &&
            1 - riskPaths[i]! / riskHWM[i]! >= drawdownThreshold;

          if (isWithdrawing && total > 0) {
            let baseWithdrawal: number;
            if (isRateMode) {
              if (!rateWithdrawalInitialized[i]) {
                rateBasedMonthlyWithdrawal[i] = (total * withdrawalRate) / 100 / 12;
                rateWithdrawalInitialized[i] = 1;
              }
              baseWithdrawal = rateBasedMonthlyWithdrawal[i]!;
            } else if (isRateRiskMode) {
              if (m === 0) {
                rateBasedMonthlyWithdrawal[i] = (riskPaths[i]! * withdrawalRate) / 100 / 12;
              }
              baseWithdrawal = rateBasedMonthlyWithdrawal[i]!;
            } else {
              baseWithdrawal = currentMonthlyWithdrawal[i]!;
            }

            if (isAnyRateMode) {
              baseWithdrawal = clampToBounds(baseWithdrawal, floorReal, ceilingReal);
            }

            const income = monthPension + monthlyOtherIncome;
            const netWithdrawal = Math.max(baseWithdrawal - income, 0);

            if (recordPivot) {
              pensionRecorded = monthPension;
              otherIncomeRecorded = monthlyOtherIncome;
            }

            if (netWithdrawal > 0) {
              let fromRisk: number;
              let fromDefense: number;
              if (inDrawdown && defensePaths[i]! > 0) {
                fromDefense = Math.min(netWithdrawal, defensePaths[i]!);
                fromRisk = netWithdrawal - fromDefense;
              } else if (priorityOnDrawdown && riskPaths[i]! > 0) {
                fromRisk = Math.min(netWithdrawal, riskPaths[i]!);
                fromDefense = netWithdrawal - fromRisk;
              } else {
                fromRisk = netWithdrawal * (riskPaths[i]! / total);
                fromDefense = netWithdrawal * (defensePaths[i]! / total);
              }
              // 片方が枯渇した分は他方に回す
              if (fromRisk > riskPaths[i]!) {
                fromDefense += fromRisk - riskPaths[i]!;
                fromRisk = riskPaths[i]!;
              }
              if (fromDefense > defensePaths[i]!) {
                fromRisk += fromDefense - defensePaths[i]!;
                fromDefense = defensePaths[i]!;
              }
              if (fromRisk > riskPaths[i]!) fromRisk = riskPaths[i]!;
              if (fromDefense > defensePaths[i]!) fromDefense = defensePaths[i]!;

              let drawnTotal = 0;
              if (fromRisk > 0) {
                const gainRatio =
                  riskPaths[i]! > riskCostBasis[i]!
                    ? (riskPaths[i]! - riskCostBasis[i]!) / riskPaths[i]!
                    : 0;
                const tax = fromRisk * gainRatio * taxRate;
                riskCostBasis[i]! *= 1 - Math.min(fromRisk / riskPaths[i]!, 1);
                riskPaths[i]! -= fromRisk + tax;
                if (riskPaths[i]! < 0) riskPaths[i] = 0;
                drawnTotal += fromRisk;
              }
              if (fromDefense > 0) {
                const gainRatio =
                  defensePaths[i]! > defenseCostBasis[i]!
                    ? (defensePaths[i]! - defenseCostBasis[i]!) / defensePaths[i]!
                    : 0;
                const tax = fromDefense * gainRatio * taxRate;
                defenseCostBasis[i]! *= 1 - Math.min(fromDefense / defensePaths[i]!, 1);
                defensePaths[i]! -= fromDefense + tax;
                if (defensePaths[i]! < 0) defensePaths[i] = 0;
                drawnTotal += fromDefense;
              }

              cumulativeWithdrawals[i]! += drawnTotal;
              yearlyWithdrawals[i]! += drawnTotal;
              if (recordPivot) monthlyWithdrawalRecorded = drawnTotal;
            }
          }

          const shouldSkipRebalance = skipRebalanceWhenDrawdown && inDrawdown;
          if (
            !shouldSkipRebalance &&
            needsRebalance(riskPaths[i]!, defensePaths[i]!, dr, rebalanceThresholdPoint)
          ) {
            const rb = rebalanceBuckets(
              riskPaths[i]!,
              riskCostBasis[i]!,
              defensePaths[i]!,
              defenseCostBasis[i]!,
              dr,
              taxRate,
            );
            riskPaths[i] = rb.riskTotal;
            riskCostBasis[i] = rb.riskPrincipal;
            defensePaths[i] = rb.defenseTotal;
            defenseCostBasis[i] = rb.defensePrincipal;
            if (recordPivot) rebalanceInfoRecorded = rb.info;
          }

          if (recordPivot) {
            pushPivotRow(keysForMask(pivotMask), {
              year,
              month: m + 1,
              prevRisk,
              prevDefense,
              riskTotal: riskPaths[i]!,
              defenseTotal: defensePaths[i]!,
              monthlyWithdrawal: monthlyWithdrawalRecorded,
              monthlyPension: pensionRecorded,
              monthlyOtherIncome: otherIncomeRecorded,
              monthlyGainRisk: gainRisk,
              monthlyGainDefense: gainDefense,
              rebalanceInfo: rebalanceInfoRecorded,
            });
          }
        }
      } else {
        for (let i = 0; i < N; i++) {
          const pivotMask = pivotMaskByIndex !== null ? pivotMaskByIndex[i]! : 0;
          const recordPivot = pivotMask !== 0;
          const prevRisk = riskPaths[i]!;

          const z = normalRandom(rng);
          riskPaths[i]! *= Math.exp(monthlyDriftRisk + monthlySigmaRisk * z);

          const gainRisk = riskPaths[i]! - prevRisk;
          let monthlyWithdrawalRecorded = 0;
          let pensionRecorded = 0;
          let otherIncomeRecorded = 0;

          if (isContributing) {
            riskPaths[i]! += contribRisk;
            riskCostBasis[i]! += contribRisk;
          }

          if (isWithdrawing && riskPaths[i]! > 0) {
            let baseWithdrawal: number;
            if (isRateMode) {
              if (!rateWithdrawalInitialized[i]) {
                rateBasedMonthlyWithdrawal[i] = (riskPaths[i]! * withdrawalRate) / 100 / 12;
                rateWithdrawalInitialized[i] = 1;
              }
              baseWithdrawal = rateBasedMonthlyWithdrawal[i]!;
            } else if (isRateRiskMode) {
              if (m === 0) {
                rateBasedMonthlyWithdrawal[i] = (riskPaths[i]! * withdrawalRate) / 100 / 12;
              }
              baseWithdrawal = rateBasedMonthlyWithdrawal[i]!;
            } else {
              baseWithdrawal = currentMonthlyWithdrawal[i]!;
            }

            if (isAnyRateMode) {
              baseWithdrawal = clampToBounds(baseWithdrawal, floorReal, ceilingReal);
            }

            const income = monthPension + monthlyOtherIncome;
            const netWithdrawal = Math.max(baseWithdrawal - income, 0);

            if (recordPivot) {
              pensionRecorded = monthPension;
              otherIncomeRecorded = monthlyOtherIncome;
            }

            if (netWithdrawal > 0) {
              const gainRatio =
                riskPaths[i]! > riskCostBasis[i]!
                  ? (riskPaths[i]! - riskCostBasis[i]!) / riskPaths[i]!
                  : 0;
              const tax = netWithdrawal * gainRatio * taxRate;
              const ratio = Math.min(netWithdrawal / riskPaths[i]!, 1);
              riskCostBasis[i]! *= 1 - ratio;
              riskPaths[i]! -= netWithdrawal + tax;
              if (riskPaths[i]! < 0) riskPaths[i] = 0;

              cumulativeWithdrawals[i]! += netWithdrawal;
              yearlyWithdrawals[i]! += netWithdrawal;
              if (recordPivot) monthlyWithdrawalRecorded = netWithdrawal;
            }
          }

          if (recordPivot) {
            pushPivotRow(keysForMask(pivotMask), {
              year,
              month: m + 1,
              prevRisk,
              prevDefense: 0,
              riskTotal: riskPaths[i]!,
              defenseTotal: 0,
              monthlyWithdrawal: monthlyWithdrawalRecorded,
              monthlyPension: pensionRecorded,
              monthlyOtherIncome: otherIncomeRecorded,
              monthlyGainRisk: gainRisk,
              monthlyGainDefense: 0,
              rebalanceInfo: null,
            });
          }
        }
      }

      if (isWithdrawing && !isAnyRateMode) {
        for (let i = 0; i < N; i++) {
          currentMonthlyWithdrawal[i]! *= monthlyRealWithdrawalFactor;
        }
      }
    }

    if (useDefense && defensePaths !== null) {
      for (let i = 0; i < N; i++) totalPaths[i] = riskPaths[i]! + defensePaths[i]!;
    } else {
      totalPaths.set(riskPaths);
    }
    let depleted = 0;
    for (let i = 0; i < N; i++) {
      if (totalPaths[i]! <= 0 && cumulativeWithdrawals[i]! > 0) depleted++;
    }
    totalPaths.sort();
    yearlyWithdrawals.sort();
    const q = (p: number) => totalPaths[Math.min(N - 1, Math.floor(N * p))]!;
    yearly.push({
      year,
      age: currentAge != null ? currentAge + year : null,
      p10: q(0.1),
      p25: q(0.25),
      p50: q(0.5),
      p75: q(0.75),
      p90: q(0.9),
      depletionRate: depleted / N,
      medianYearlyWithdrawal: yearlyWithdrawals[Math.floor(N * 0.5)]!,
    });
  }

  const totalContributed =
    initialAmount + monthlyContribution * 12 * Math.min(contributionYears, totalYears);
  let failureCount = 0;
  const finalTotals = pivotIndices === null ? new Float64Array(N) : null;
  for (let i = 0; i < N; i++) {
    const finalTotal =
      useDefense && defensePaths !== null
        ? riskPaths[i]! + defensePaths[i]!
        : riskPaths[i]!;
    if (finalTotals !== null) finalTotals[i] = finalTotal;
    if (finalTotal + cumulativeWithdrawals[i]! < totalContributed) failureCount++;
  }

  return {
    yearly,
    failureProbability: failureCount / N,
    finalTotals,
    pivotMonthlies,
  };
  };

  const phase1 = runSimulation(null);
  const lastYearly = phase1.yearly[phase1.yearly.length - 1]!;
  const finalP50 = lastYearly.p50;

  // 各パーセンタイルの最終値に最も近いパスを同時に特定。フェーズ2 で同じ index を抽出して月次を取得する。
  const finalTotals = phase1.finalTotals!;
  const targets: Record<PercentileKey, number> = {
    p10: lastYearly.p10,
    p25: lastYearly.p25,
    p50: lastYearly.p50,
    p75: lastYearly.p75,
    p90: lastYearly.p90,
  };
  const pivotIndices: Record<PercentileKey, number> = {
    p10: 0,
    p25: 0,
    p50: 0,
    p75: 0,
    p90: 0,
  };
  const pivotDiffs: Record<PercentileKey, number> = {
    p10: Infinity,
    p25: Infinity,
    p50: Infinity,
    p75: Infinity,
    p90: Infinity,
  };
  for (let i = 0; i < N; i++) {
    const v = finalTotals[i]!;
    for (const k of PERCENTILE_KEYS) {
      const d = Math.abs(v - targets[k]);
      if (d < pivotDiffs[k]) {
        pivotDiffs[k] = d;
        pivotIndices[k] = i;
      }
    }
  }

  const phase2 = runSimulation(pivotIndices);

  return {
    yearly: phase1.yearly,
    failureProbability: phase1.failureProbability,
    depletionProbability: lastYearly.depletionRate,
    finalP50,
    finalP10: lastYearly.p10,
    finalP90: lastYearly.p90,
    pivotMonthlies: phase2.pivotMonthlies,
  };
}

export function computeSecurityScore({
  depletionProbability,
  failureProbability,
  medianFinal,
}: SecurityScoreInput): number {
  let score = (1 - depletionProbability) * 100;
  if (failureProbability != null) score -= failureProbability * 20;
  if (medianFinal <= 0) score = Math.min(score, 10);
  return Math.max(0, Math.min(100, Math.round(score)));
}

export function scoreLabel(score: number): ScoreLabelResult {
  if (score >= 95) return { label: "非常に安心", className: "score-excellent" };
  if (score >= 80) return { label: "安心", className: "score-safe" };
  if (score >= 60) return { label: "やや注意", className: "score-caution" };
  if (score >= 40) return { label: "注意", className: "score-warn" };
  return { label: "要見直し", className: "score-danger" };
}
