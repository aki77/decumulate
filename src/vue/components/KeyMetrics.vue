<script setup lang="ts">
import HelpIcon from "./HelpIcon.vue";
import { useMetrics } from "../composables/useMetrics.ts";
import { formatMan, formatPercent } from "../format.ts";
import { KEY_METRICS_HELP as HELP } from "../help-dict.ts";
import type { YearlyProjection, CalculateParams } from "../../calculate.ts";
import type { MonteCarloResult } from "../../monte-carlo.ts";

const props = defineProps<{
  yearly: YearlyProjection[];
  mc: MonteCarloResult;
  params: CalculateParams;
}>();

const metrics = useMetrics(() => props.yearly, () => props.params);
</script>

<template>
  <div class="metric-grid">
    <div class="metric">
      <div class="metric-label">最終総資産（名目）<HelpIcon :text="HELP.finalTotal" /></div>
      <div class="metric-value">{{ formatMan(metrics.last.total) }}</div>
    </div>
    <div class="metric">
      <div class="metric-label">運用益（税引後）<HelpIcon :text="HELP.interest" /></div>
      <div class="metric-value">{{ formatMan(metrics.last.interest) }}</div>
    </div>
    <div class="metric">
      <div class="metric-label">総引出額（名目）<HelpIcon :text="HELP.totalWithdrawn" /></div>
      <div class="metric-value">{{ formatMan(metrics.totalWithdrawn) }}</div>
    </div>
    <div class="metric">
      <div class="metric-label">MC 中央値残高（実質）<HelpIcon :text="HELP.mcP50" /></div>
      <div class="metric-value">{{ formatMan(mc.finalP50) }}</div>
      <div class="metric-note">今の購買力に換算した予測中央値</div>
    </div>
    <div class="metric">
      <div class="metric-label">枯渇確率<HelpIcon :text="HELP.depletion" /></div>
      <div class="metric-value">{{ formatPercent(mc.depletionProbability) }}</div>
      <div class="metric-note">取り崩し中に資産がゼロになる確率</div>
    </div>
    <div class="metric">
      <div class="metric-label">元本割れ確率<HelpIcon :text="HELP.failure" /></div>
      <div class="metric-value">{{ formatPercent(mc.failureProbability) }}</div>
      <div class="metric-note">最終時点で積立元本を下回る確率</div>
    </div>
  </div>
</template>

<style scoped>
.metric-grid {
  margin-bottom: 16px;
}

.metric-note {
  font-size: 11px;
  color: var(--muted);
  margin-top: 2px;
}
</style>
