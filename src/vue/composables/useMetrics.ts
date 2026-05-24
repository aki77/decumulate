import { computed, type ComputedRef, type Ref } from "vue";
import { NISA_LIFETIME_LIMIT } from "../../calculate.ts";
import type { CalculateParams, YearlyProjection } from "../../calculate.ts";

export const NEAR_ZERO_THRESHOLD_YEN = 10_000_000;

export type DieWithZeroStatus = "surplus" | "shortage" | "near-zero";

export interface Metrics {
  last: YearlyProjection;
  totalContrib: number;
  totalWithdrawn: number;
  totalIdecoLumpSum: number;
  totalIdecoPension: number;
  nisaLifetimeUsageRatio: number;
  lifeExpectancyAge: number;
  finalTotalAtLifeExpectancy: number;
  finalTarget: number;
  finalDelta: number;
  finalStatus: DieWithZeroStatus;
}

// `mcLastYearP50` を渡すと finalTotalAtLifeExpectancy に実質値（MC p50）を採用する。
// 未指定なら yearly[].total（名目値）にフォールバック。呼び出し側で単位を切り替える。
export function computeMetrics(
  yearly: YearlyProjection[],
  params: CalculateParams,
  finalTarget: number = 0,
  mcLastYearP50?: number,
): Metrics {
  const last = yearly[yearly.length - 1]!;
  const initialTotal = params.initialNisa + params.initialTaxableRisk + params.initialDefense;
  const totalContrib = initialTotal + params.monthlyContribution * 12 * params.contributionYears;
  const totalWithdrawn = yearly.reduce((s, x) => s + x.yearlyWithdrawal, 0);
  const totalIdecoLumpSum = yearly.reduce((s, x) => s + x.yearlyIdecoLumpSum, 0);
  const totalIdecoPension = yearly.reduce((s, x) => s + x.yearlyIdecoPension, 0);
  const nisaLifetimeLimit = params.isCoupled ? NISA_LIFETIME_LIMIT * 2 : NISA_LIFETIME_LIMIT;
  const nisaLifetimeUsageRatio = nisaLifetimeLimit > 0 ? last.nisaLifetimeUsed / nisaLifetimeLimit : 0;
  const lifeExpectancyAge = params.currentAge + params.withdrawalStartYear + params.withdrawalYears;
  const finalTotalAtLifeExpectancy = mcLastYearP50 ?? last.total;
  const finalDelta = finalTotalAtLifeExpectancy - finalTarget;
  const finalStatus: DieWithZeroStatus =
    Math.abs(finalDelta) < NEAR_ZERO_THRESHOLD_YEN ? "near-zero" : finalDelta > 0 ? "surplus" : "shortage";
  return {
    last,
    totalContrib,
    totalWithdrawn,
    totalIdecoLumpSum,
    totalIdecoPension,
    nisaLifetimeUsageRatio,
    lifeExpectancyAge,
    finalTotalAtLifeExpectancy,
    finalTarget,
    finalDelta,
    finalStatus,
  };
}

export function useMetrics(
  yearly: Ref<YearlyProjection[]> | (() => YearlyProjection[]),
  params: Ref<CalculateParams> | (() => CalculateParams),
  finalTarget?: Ref<number> | (() => number),
  mcLastYearP50?: Ref<number | undefined> | (() => number | undefined),
): ComputedRef<Metrics> {
  return computed(() => {
    const y = typeof yearly === "function" ? yearly() : yearly.value;
    const p = typeof params === "function" ? params() : params.value;
    const t = finalTarget == null ? 0 : typeof finalTarget === "function" ? finalTarget() : finalTarget.value;
    const p50 =
      mcLastYearP50 == null
        ? undefined
        : typeof mcLastYearP50 === "function"
          ? mcLastYearP50()
          : mcLastYearP50.value;
    return computeMetrics(y, p, t, p50);
  });
}
