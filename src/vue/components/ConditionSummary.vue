<script setup lang="ts">
import { computed, ref } from "vue";
import { useTimeoutFn } from "@vueuse/core";
import type { ParamsState } from "../composables/useParams.ts";
import type { MonteCarloParams } from "../../monte-carlo.ts";
import type { SimulatorResult } from "../composables/useSimulator.ts";
import { withdrawalLabel as buildWithdrawalLabel } from "../withdrawal-label.ts";
import { buildMarkdownReport } from "../markdown-export.ts";
import { computeMetrics } from "../composables/useMetrics.ts";
import HelpIcon from "./HelpIcon.vue";

const COPY_HELP =
  "入力条件・主要メトリクス・モンテカルロ年次推移を Markdown 形式でクリップボードにコピーします。ChatGPT や Claude などの LLM チャットに貼り付けて、FP や日本の個人金融制度の専門家にシミュレーション結果の妥当性検証や改善案を相談する用途で使えます。";

const props = defineProps<{
  state: ParamsState;
  params: MonteCarloParams;
  result: SimulatorResult;
}>();
const emit = defineEmits<{ open: [] }>();

const withdrawalLabel = computed((): string => buildWithdrawalLabel(props.state));

type CopyState = "idle" | "ok" | "err";
const COPY_LABELS: Record<CopyState, string> = {
  idle: "AI相談用にコピー",
  ok: "コピーしました ✓",
  err: "コピー失敗",
};
const copyState = ref<CopyState>("idle");
const copyButtonLabel = computed(() => COPY_LABELS[copyState.value]);

const { start: scheduleReset, stop: stopReset } = useTimeoutFn(
  () => {
    copyState.value = "idle";
  },
  2000,
  { immediate: false },
);

async function handleCopy() {
  const metrics = computeMetrics(props.result.yearly, props.params);
  const markdown = buildMarkdownReport(props.state, props.params, props.result, metrics);
  try {
    await navigator.clipboard.writeText(markdown);
    copyState.value = "ok";
  } catch {
    copyState.value = "err";
  }
  stopReset();
  scheduleReset();
}
</script>

<template>
  <div class="condition-summary-row">
    <button type="button" class="condition-summary" aria-label="入力を編集" @click="emit('open')">
      <span class="chip">積立 {{ state.contributionYears }}年 月{{ state.monthlyContributionMan }}万</span>
      <span class="chip">利回り {{ state.annualReturnRate }}% / σ{{ state.volatility }}%</span>
      <span class="chip">インフレ {{ state.inflationRate }}%</span>
      <span class="chip">切崩 {{ state.withdrawalStartYear }}年目から{{ state.withdrawalYears }}年</span>
      <span class="chip">{{ withdrawalLabel }}</span>
      <span class="chip">初期 NISA{{ state.initialNisaMan }}+特定{{ state.initialTaxableRiskMan }}+防衛{{ state.initialDefenseMan }}万</span>
      <span v-if="state.basePensionMan > 0" class="chip">年金 {{ state.pensionStartAge }}歳〜 月{{ state.basePensionMan }}万</span>
    </button>
    <div class="copy-btn-wrap">
      <button
        type="button"
        class="copy-btn"
        :class="{ 'copy-btn-ok': copyState === 'ok', 'copy-btn-err': copyState === 'err' }"
        @click="handleCopy"
      >{{ copyButtonLabel }}</button>
      <HelpIcon :text="COPY_HELP" />
    </div>
  </div>
</template>

<style scoped>
.condition-summary-row {
  display: flex;
  align-items: stretch;
  gap: 8px;
  margin-bottom: 12px;
}

.condition-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: transparent;
  flex: 1;
  min-width: 0;
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

.copy-btn-wrap {
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
  align-self: flex-start;
}

.copy-btn {
  padding: 8px 14px;
  border: 1px solid var(--accent);
  color: var(--accent);
  background: transparent;
  border-radius: 8px;
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
}

.copy-btn:hover:not(:disabled) {
  background: var(--accent-soft, rgba(99, 102, 241, 0.12));
}

.copy-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.copy-btn-ok {
  color: #16a34a;
  border-color: #16a34a;
}

.copy-btn-err {
  color: #dc2626;
  border-color: #dc2626;
}
</style>
