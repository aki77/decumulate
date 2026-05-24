import { simulateMonteCarlo, type MonteCarloParams } from "./monte-carlo.ts";
import type { WithdrawalLimitStep } from "./calculate.ts";

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
  seed?: number;
}

export interface ZeroLandingResult {
  monthlyAmount: number;
  finalTotal: number;
  iterations: number;
  boundary: "found" | "below-min" | "above-max";
  seed: number;
}

const MAX_MONTHLY = 5_000_000;
// 反復ごとに N=5000 の MC を回すので、log2(5_000_000 / 1000) ≒ 13 反復に余裕を加えて 25 に抑える。
const DEFAULT_TOLERANCE = 1_000;
const DEFAULT_MAX_ITERATIONS = 25;

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

// 途中年で p50 経路が枯渇しても yearly[].p50 は 0 を埋めて続くため、finalTotal だけだと
// target=0 が成立して二分探索が壊れる。p50 経路の月次（最終 12 ヶ月を除く）で 0 以下を
// 検出し、`depleted` で isFeasible から弾く。
function evaluateAt(
  baseParams: MonteCarloParams,
  goGoMonthly: number,
  curve: ZeroLandingCurve,
  seed: number,
): { finalTotal: number; depleted: boolean } {
  const result = simulateMonteCarlo(
    {
      ...baseParams,
      fixedMonthlyWithdrawal: goGoMonthly,
      withdrawalLimitSchedule: buildZeroLandingSchedule(goGoMonthly, curve),
    },
    seed,
  );
  const p50Monthly = result.pivotMonthlies.p50;
  const lastWindowStart = p50Monthly.length - 12;
  let depleted = false;
  for (let i = 0; i < lastWindowStart; i++) {
    if (p50Monthly[i]!.total <= 0) {
      depleted = true;
      break;
    }
  }
  return { finalTotal: result.finalP50, depleted };
}

export function findZeroLandingMonthly(
  params: MonteCarloParams,
  options: ZeroLandingOptions,
): ZeroLandingResult {
  const { finalTarget, curve } = options;
  const tolerance = options.toleranceYen ?? DEFAULT_TOLERANCE;
  const maxIterations = options.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  // 二分探索の判定が MC ノイズでフリップしないよう、全反復で同一 seed を使い回す。
  const seed = options.seed ?? Math.floor(Math.random() * 0x100000000);

  // withdrawalMode は zero-landing を維持: monte-carlo.ts は zero-landing を amount 経路 + clamp で動かすため、
  // amount に書き換えると isClampActive=false になりカーブが無視される。
  const baseParams: MonteCarloParams = {
    ...params,
    withdrawalMode: "zero-landing",
    inflationAdjustedWithdrawal: true,
  };

  const isFeasible = (e: { finalTotal: number; depleted: boolean }): boolean =>
    !e.depleted && e.finalTotal >= finalTarget;

  // 下限 = 床: Go-Go < 床 は単調減カーブの反転で意味がない。床自体が高すぎれば below-min を返す。
  const minMonthly = curve.noGoMonthly;
  const evalAtMin = evaluateAt(baseParams, minMonthly, curve, seed);
  if (!isFeasible(evalAtMin)) {
    return {
      monthlyAmount: minMonthly,
      finalTotal: evalAtMin.finalTotal,
      iterations: 0,
      boundary: "below-min",
      seed,
    };
  }

  const evalAtMax = evaluateAt(baseParams, MAX_MONTHLY, curve, seed);
  if (isFeasible(evalAtMax)) {
    return {
      monthlyAmount: MAX_MONTHLY,
      finalTotal: evalAtMax.finalTotal,
      iterations: 0,
      boundary: "above-max",
      seed,
    };
  }

  let lo = minMonthly;
  let hi = MAX_MONTHLY;
  let loFinal = evalAtMin.finalTotal;
  let iterations = 0;
  for (let i = 0; i < maxIterations; i++) {
    iterations++;
    const mid = (lo + hi) / 2;
    const evalAtMid = evaluateAt(baseParams, mid, curve, seed);
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
    seed,
  };
}
