import { calculateCompound, type CalculateParams, type WithdrawalLimitStep } from "./calculate.ts";

// DIE WITH ZERO カーブの定義。Go-Go 月額を変数として与え、Slow-Go = Go-Go × slowGoCoef、No-Go = noGoMonthly（床、独立変数）。
export interface ZeroLandingCurve {
  slowGoStartAge: number;
  noGoStartAge: number;
  slowGoCoef: number;
  noGoMonthly: number;
}

export interface ZeroLandingOptions {
  finalTarget: number;
  curve: ZeroLandingCurve;
  toleranceYen?: number;
  maxIterations?: number;
}

export interface ZeroLandingResult {
  monthlyAmount: number;
  finalTotal: number;
  iterations: number;
  boundary: "found" | "below-min" | "above-max";
}

const MAX_MONTHLY = 5_000_000;
// tolerance 1000 円なら最大 ~12 反復で収束。30 年取り崩しで最終残高ぶれは target ± ~36 万円。
const DEFAULT_TOLERANCE = 1_000;
const DEFAULT_MAX_ITERATIONS = 40;

export function buildZeroLandingSchedule(
  goGoMonthly: number,
  curve: ZeroLandingCurve,
): WithdrawalLimitStep[] {
  const slowGoMonthly = goGoMonthly * curve.slowGoCoef;
  return [
    { untilAge: curve.slowGoStartAge - 1, floor: goGoMonthly, ceiling: goGoMonthly },
    { untilAge: curve.noGoStartAge - 1, floor: slowGoMonthly, ceiling: slowGoMonthly },
    { untilAge: null, floor: curve.noGoMonthly, ceiling: curve.noGoMonthly },
  ];
}

// 途中年で枯渇すると calculateCompound は最終年を 0 で返すため、finalTotal だけだと target=0 が成立して
// 二分探索が壊れる。「最終年より前に枯渇したか」を併せて返して isFeasible で弾く。
function evaluateAt(
  baseParams: CalculateParams,
  goGoMonthly: number,
  curve: ZeroLandingCurve,
): { finalTotal: number; depleted: boolean } {
  const { yearly } = calculateCompound({
    ...baseParams,
    fixedMonthlyWithdrawal: goGoMonthly,
    withdrawalLimitSchedule: buildZeroLandingSchedule(goGoMonthly, curve),
  });
  const finalTotal = yearly[yearly.length - 1]!.total;
  let depleted = false;
  for (let i = 0; i < yearly.length - 1; i++) {
    if (yearly[i]!.total <= 0) {
      depleted = true;
      break;
    }
  }
  return { finalTotal, depleted };
}

export function findZeroLandingMonthly(
  params: CalculateParams,
  options: ZeroLandingOptions,
): ZeroLandingResult {
  const { finalTarget, curve } = options;
  const tolerance = options.toleranceYen ?? DEFAULT_TOLERANCE;
  const maxIterations = options.maxIterations ?? DEFAULT_MAX_ITERATIONS;

  // withdrawalMode は zero-landing を維持: calculate.ts は zero-landing を amount 経路 + clamp で動かすため、
  // amount に書き換えると isClampActive=false になりカーブが無視される。
  const baseParams: CalculateParams = {
    ...params,
    withdrawalMode: "zero-landing",
    inflationAdjustedWithdrawal: true,
  };

  const isFeasible = (e: { finalTotal: number; depleted: boolean }): boolean =>
    !e.depleted && e.finalTotal >= finalTarget;

  // 下限 = 床: Go-Go < 床 は単調減カーブの反転で意味がない。床自体が高すぎれば below-min を返す。
  const minMonthly = curve.noGoMonthly;
  const evalAtMin = evaluateAt(baseParams, minMonthly, curve);
  if (!isFeasible(evalAtMin)) {
    return {
      monthlyAmount: minMonthly,
      finalTotal: evalAtMin.finalTotal,
      iterations: 0,
      boundary: "below-min",
    };
  }

  const evalAtMax = evaluateAt(baseParams, MAX_MONTHLY, curve);
  if (isFeasible(evalAtMax)) {
    return {
      monthlyAmount: MAX_MONTHLY,
      finalTotal: evalAtMax.finalTotal,
      iterations: 0,
      boundary: "above-max",
    };
  }

  let lo = minMonthly;
  let hi = MAX_MONTHLY;
  let loFinal = evalAtMin.finalTotal;
  let iterations = 0;
  for (let i = 0; i < maxIterations; i++) {
    iterations++;
    const mid = (lo + hi) / 2;
    const evalAtMid = evaluateAt(baseParams, mid, curve);
    if (isFeasible(evalAtMid)) {
      lo = mid;
      loFinal = evalAtMid.finalTotal;
    } else {
      hi = mid;
    }
    if (hi - lo < tolerance) break;
  }

  return {
    monthlyAmount: lo,
    finalTotal: loFinal,
    iterations,
    boundary: "found",
  };
}
