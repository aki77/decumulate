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

export function useMetrics(
  yearly: Ref<YearlyProjection[]> | (() => YearlyProjection[]),
  params: Ref<CalculateParams> | (() => CalculateParams),
): ComputedRef<Metrics> {
  return computed(() => {
    const y = typeof yearly === "function" ? yearly() : yearly.value;
    const p = typeof params === "function" ? params() : params.value;
    const last = y[y.length - 1]!;
    const initialTotal = p.initialNisa + p.initialTaxableRisk + p.initialDefense;
    const totalContrib = initialTotal + p.monthlyContribution * 12 * p.contributionYears;
    const totalWithdrawn = y.reduce((s, x) => s + x.yearlyWithdrawal, 0);
    const totalIdecoLumpSum = y.reduce((s, x) => s + x.yearlyIdecoLumpSum, 0);
    const totalIdecoPension = y.reduce((s, x) => s + x.yearlyIdecoPension, 0);
    const nisaLifetimeLimit = p.isCoupled ? NISA_LIFETIME_LIMIT * 2 : NISA_LIFETIME_LIMIT;
    const nisaLifetimeUsageRatio = nisaLifetimeLimit > 0 ? last.nisaLifetimeUsed / nisaLifetimeLimit : 0;
    return { last, totalContrib, totalWithdrawn, totalIdecoLumpSum, totalIdecoPension, nisaLifetimeUsageRatio };
  });
}
