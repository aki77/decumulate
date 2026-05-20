import { ref, watchEffect, type Ref } from "vue";
import {
  calculateCompound,
  type YearlyProjection,
  type MonthlyProjection,
} from "../../calculate.ts";
import {
  simulateMonteCarlo,
  computeSecurityScore,
  scoreLabel,
  type MonteCarloParams,
  type MonteCarloResult,
  type ScoreLabelResult,
} from "../../monte-carlo.ts";

export interface SimulatorResult {
  yearly: YearlyProjection[];
  monthly: MonthlyProjection[];
  mc: MonteCarloResult;
  score: number;
  scoreInfo: ScoreLabelResult;
}

export function useSimulator(mcParams: Ref<MonteCarloParams>) {
  const result = ref<SimulatorResult | null>(null);

  watchEffect(() => {
    const params = mcParams.value;
    const { yearly, monthly } = calculateCompound(params);
    const mc = simulateMonteCarlo(params);
    const score = computeSecurityScore({
      depletionProbability: mc.depletionProbability,
      failureProbability: mc.failureProbability,
      medianFinal: mc.finalP50,
    });
    result.value = { yearly, monthly, mc, score, scoreInfo: scoreLabel(score) };
  });

  return { result };
}
