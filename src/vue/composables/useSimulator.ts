import { ref, watchEffect, type Ref } from "vue";
import { calculateCompound, type YearlyProjection, type MonthlyProjection } from "../../calculate.ts";
import { simulateMonteCarlo, computeSecurityScore, scoreLabel, type MonteCarloResult } from "../../monte-carlo.ts";
import type { MonteCarloParams } from "../../monte-carlo.ts";

const DEBOUNCE_MS = 800;

export interface SimulatorResult {
  yearly: YearlyProjection[];
  monthly: MonthlyProjection[];
  mc: MonteCarloResult;
  score: number;
  scoreInfo: ReturnType<typeof scoreLabel>;
}

export function useSimulator(mcParams: Ref<MonteCarloParams>) {
  const result = ref<SimulatorResult | null>(null);

  watchEffect((onInvalidate) => {
    const params = mcParams.value;
    const t = setTimeout(() => {
      const { yearly, monthly } = calculateCompound(params);
      const mc = simulateMonteCarlo(params);
      const score = computeSecurityScore({
        depletionProbability: mc.depletionProbability,
        failureProbability: mc.failureProbability,
        medianFinal: mc.finalP50,
      });
      result.value = {
        yearly,
        monthly,
        mc,
        score,
        scoreInfo: scoreLabel(score),
      };
    }, DEBOUNCE_MS);
    onInvalidate(() => clearTimeout(t));
  });

  return { result };
}
