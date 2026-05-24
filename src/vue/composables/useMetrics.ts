import { computed, type ComputedRef, type Ref } from "vue";
import { NISA_LIFETIME_LIMIT } from "../../calculate.ts";
import type { CalculateParams, YearlyProjection } from "../../calculate.ts";

// FP 実務（Kitces 等）の目安に合わせ、Monte Carlo「目標達成確率」で 4 段階に分類する。
// 0.95 以上は「保守的すぎ（DIE WITH ZERO 視点では出し渋り）」、0.50 未満は「半数以上のシナリオで未達」。
export const PLAN_RATING_THRESHOLDS = {
  conservative: 0.95,
  realistic: 0.8,
  marginal: 0.5,
} as const;

export type PlanRating = "conservative" | "realistic" | "marginal" | "risky" | "unknown";

export const PLAN_RATING_LABELS: Record<PlanRating, string> = {
  conservative: "余裕あり（保守的）",
  realistic: "現実的",
  marginal: "ギリギリ",
  risky: "リスク高",
  unknown: "—",
};

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
  // MC が finalTarget を渡されたときのみ算出される目標達成確率 [0,1]。
  finalAchievementProbability: number | undefined;
  planRating: PlanRating;
}

function classifyPlanRating(prob: number | undefined): PlanRating {
  if (prob == null) return "unknown";
  if (prob >= PLAN_RATING_THRESHOLDS.conservative) return "conservative";
  if (prob >= PLAN_RATING_THRESHOLDS.realistic) return "realistic";
  if (prob >= PLAN_RATING_THRESHOLDS.marginal) return "marginal";
  return "risky";
}

// `mcLastYearP50` を渡すと finalTotalAtLifeExpectancy に実質値（MC p50）を採用する。
// 未指定なら yearly[].total（名目値）にフォールバック。呼び出し側で単位を切り替える。
// finalAchievementProbability は MC が finalTarget を伴って実行された場合のみ有効。
export function computeMetrics(
  yearly: YearlyProjection[],
  params: CalculateParams,
  finalTarget: number = 0,
  mcLastYearP50?: number,
  finalAchievementProbability?: number,
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
  const planRating = classifyPlanRating(finalAchievementProbability);
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
    finalAchievementProbability,
    planRating,
  };
}

type Source<T> = Ref<T> | (() => T);

function read<T>(source: Source<T>): T;
function read<T>(source: Source<T> | undefined): T | undefined;
function read<T>(source: Source<T> | undefined): T | undefined {
  if (source == null) return undefined;
  return typeof source === "function" ? source() : source.value;
}

export function useMetrics(
  yearly: Source<YearlyProjection[]>,
  params: Source<CalculateParams>,
  finalTarget?: Source<number>,
  mcLastYearP50?: Source<number | undefined>,
  finalAchievementProbability?: Source<number | undefined>,
): ComputedRef<Metrics> {
  return computed(() =>
    computeMetrics(
      read(yearly),
      read(params),
      read(finalTarget) ?? 0,
      read(mcLastYearP50),
      read(finalAchievementProbability),
    ),
  );
}
