import { simulateMonteCarlo, type MonteCarloParams } from "./monte-carlo.ts";

export interface SwrSearchOptions {
  targetSuccessRate?: number;
}

export interface SwrSearchResult {
  rate: number;
  successRate: number;
  boundary: "found" | "below-min" | "above-max";
}

const MIN_RATE = 0.5;
const MAX_RATE = 10.0;
const ITERATIONS = 7;
const DEFAULT_TARGET_SUCCESS_RATE = 0.95;

function successRateAt(params: MonteCarloParams, rate: number): number {
  const result = simulateMonteCarlo({ ...params, withdrawalRate: rate });
  return 1 - result.depletionProbability;
}

function roundRate(rate: number): number {
  return Math.round(rate * 100) / 100;
}

export function findSafeWithdrawalRate(
  params: MonteCarloParams,
  options?: SwrSearchOptions,
): SwrSearchResult {
  const target = options?.targetSuccessRate ?? DEFAULT_TARGET_SUCCESS_RATE;

  const successAtMin = successRateAt(params, MIN_RATE);
  if (successAtMin < target) {
    return { rate: roundRate(MIN_RATE), successRate: successAtMin, boundary: "below-min" };
  }

  const successAtMax = successRateAt(params, MAX_RATE);
  if (successAtMax >= target) {
    return { rate: roundRate(MAX_RATE), successRate: successAtMax, boundary: "above-max" };
  }

  let lo = MIN_RATE;
  let hi = MAX_RATE;
  let loSuccess = successAtMin;
  for (let i = 0; i < ITERATIONS; i++) {
    const mid = (lo + hi) / 2;
    const successAtMid = successRateAt(params, mid);
    if (successAtMid >= target) {
      lo = mid;
      loSuccess = successAtMid;
    } else {
      hi = mid;
    }
  }

  return { rate: roundRate(lo), successRate: loSuccess, boundary: "found" };
}
