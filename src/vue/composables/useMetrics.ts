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

export function computeMetrics(
  yearly: YearlyProjection[],
  params: CalculateParams,
  finalTarget: number = 0,
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
  const finalTotalAtLifeExpectancy = last.total;
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
): ComputedRef<Metrics> {
  return computed(() => {
    const y = typeof yearly === "function" ? yearly() : yearly.value;
    const p = typeof params === "function" ? params() : params.value;
    const t = finalTarget == null ? 0 : typeof finalTarget === "function" ? finalTarget() : finalTarget.value;
    return computeMetrics(y, p, t);
  });
}
