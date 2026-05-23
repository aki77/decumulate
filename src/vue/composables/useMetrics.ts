import { computed, type ComputedRef, type Ref } from "vue";
import { NISA_LIFETIME_LIMIT } from "../../calculate.ts";
import type { CalculateParams, YearlyProjection } from "../../calculate.ts";

export interface Metrics {
  last: YearlyProjection;
  totalContrib: number;
  totalWithdrawn: number;
  totalIdecoLumpSum: number;
  totalIdecoPension: number;
  nisaLifetimeUsageRatio: number;
}

// 純関数版。markdown-export.ts などからも参照する。
export function computeMetrics(yearly: YearlyProjection[], params: CalculateParams): Metrics {
  const last = yearly[yearly.length - 1]!;
  const initialTotal = params.initialNisa + params.initialTaxableRisk + params.initialDefense;
  const totalContrib = initialTotal + params.monthlyContribution * 12 * params.contributionYears;
  const totalWithdrawn = yearly.reduce((s, x) => s + x.yearlyWithdrawal, 0);
  const totalIdecoLumpSum = yearly.reduce((s, x) => s + x.yearlyIdecoLumpSum, 0);
  const totalIdecoPension = yearly.reduce((s, x) => s + x.yearlyIdecoPension, 0);
  const nisaLifetimeLimit = params.isCoupled ? NISA_LIFETIME_LIMIT * 2 : NISA_LIFETIME_LIMIT;
  const nisaLifetimeUsageRatio = nisaLifetimeLimit > 0 ? last.nisaLifetimeUsed / nisaLifetimeLimit : 0;
  return { last, totalContrib, totalWithdrawn, totalIdecoLumpSum, totalIdecoPension, nisaLifetimeUsageRatio };
}

export function useMetrics(
  yearly: Ref<YearlyProjection[]> | (() => YearlyProjection[]),
  params: Ref<CalculateParams> | (() => CalculateParams),
): ComputedRef<Metrics> {
  return computed(() => {
    const y = typeof yearly === "function" ? yearly() : yearly.value;
    const p = typeof params === "function" ? params() : params.value;
    return computeMetrics(y, p);
  });
}
