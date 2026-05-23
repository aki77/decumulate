import type { WithdrawalMode } from "./composables/useParams.ts";

export interface WithdrawalLabelInput {
  withdrawalMode: WithdrawalMode;
  fixedMonthlyWithdrawalMan: number;
  withdrawalRate: number;
}

export function withdrawalLabel(state: WithdrawalLabelInput): string {
  switch (state.withdrawalMode) {
    case "amount":
      return `定額 月${state.fixedMonthlyWithdrawalMan}万`;
    case "rate":
      return `定率 ${state.withdrawalRate}%`;
    case "rate-risk":
      return `定率×リスク ${state.withdrawalRate}%`;
    case "rate-guardrail":
      return `GKガードレール ${state.withdrawalRate}%`;
  }
}
