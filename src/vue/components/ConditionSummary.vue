<script setup lang="ts">
import { computed } from "vue";
import type { ParamsState } from "../composables/useParams.ts";

const props = defineProps<{ state: ParamsState }>();
const emit = defineEmits<{ open: [] }>();

const withdrawalLabel = computed((): string => {
  switch (props.state.withdrawalMode) {
    case "amount":
      return `定額 月${props.state.fixedMonthlyWithdrawalMan}万`;
    case "rate":
      return `定率 ${props.state.withdrawalRate}%`;
    case "rate-risk":
      return `定率×リスク ${props.state.withdrawalRate}%`;
    case "rate-guardrail":
      return `GKガードレール ${props.state.withdrawalRate}%`;
  }
});
</script>

<template>
  <button type="button" class="condition-summary" aria-label="入力を編集" @click="emit('open')">
    <span class="chip">積立 {{ state.contributionYears }}年 月{{ state.monthlyContributionMan }}万</span>
    <span class="chip">利回り {{ state.annualReturnRate }}% / σ{{ state.volatility }}%</span>
    <span class="chip">インフレ {{ state.inflationRate }}%</span>
    <span class="chip">切崩 {{ state.withdrawalStartYear }}年目から{{ state.withdrawalYears }}年</span>
    <span class="chip">{{ withdrawalLabel }}</span>
    <span class="chip">初期 NISA{{ state.initialNisaMan }}+特定{{ state.initialTaxableRiskMan }}+防衛{{ state.initialDefenseMan }}万</span>
    <span v-if="state.basePensionMan > 0" class="chip">年金 {{ state.pensionStartAge }}歳〜 月{{ state.basePensionMan }}万</span>
  </button>
</template>

<style scoped>
.condition-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 10px 12px;
  margin-bottom: 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: transparent;
  width: 100%;
  text-align: left;
  cursor: pointer;
}

.condition-summary:hover {
  border-color: var(--accent);
}

.chip {
  padding: 4px 10px;
  border-radius: 999px;
  background: var(--accent-soft, rgba(99, 102, 241, 0.12));
  color: var(--accent, #6366f1);
  font-size: 12px;
}
</style>
