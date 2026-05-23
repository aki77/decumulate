<script setup lang="ts">
import HelpIcon from "./HelpIcon.vue";
import { useMetrics } from "../composables/useMetrics.ts";
import { formatMan, formatPercent } from "../format.ts";
import { METRICS_DETAIL_HELP as HELP } from "../help-dict.ts";
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
  <section class="metrics-detail">
    <div class="metrics-detail-label">詳細メトリクス</div>
    <div class="metric-grid">
      <div class="metric">
        <div class="metric-label">積立元本合計<HelpIcon :text="HELP.totalContrib" /></div>
        <div class="metric-value">{{ formatMan(metrics.totalContrib) }}</div>
      </div>
      <div class="metric">
        <div class="metric-label">最終 NISA 残高<HelpIcon :text="HELP.finalNisa" /></div>
        <div class="metric-value">{{ formatMan(metrics.last.nisaTotal) }}</div>
      </div>
      <div class="metric">
        <div class="metric-label">NISA 生涯枠使用率<HelpIcon :text="HELP.nisaUsage" /></div>
        <div class="metric-value">{{ formatPercent(metrics.nisaLifetimeUsageRatio) }}</div>
      </div>
      <div class="metric">
        <div class="metric-label">iDeCo 一時金累計<HelpIcon :text="HELP.idecoLumpSum" /></div>
        <div class="metric-value">{{ formatMan(metrics.totalIdecoLumpSum) }}</div>
      </div>
      <div class="metric">
        <div class="metric-label">iDeCo 年金累計<HelpIcon :text="HELP.idecoPension" /></div>
        <div class="metric-value">{{ formatMan(metrics.totalIdecoPension) }}</div>
      </div>
      <div class="metric">
        <div class="metric-label">MC 悲観値 p10（実質）<HelpIcon :text="HELP.mcP10" /></div>
        <div class="metric-value">{{ formatMan(mc.finalP10) }}</div>
      </div>
      <div class="metric">
        <div class="metric-label">MC 楽観値 p90（実質）<HelpIcon :text="HELP.mcP90" /></div>
        <div class="metric-value">{{ formatMan(mc.finalP90) }}</div>
      </div>
      <div class="metric">
        <div class="metric-label">最大DD 中央値<HelpIcon :text="HELP.maxDDp50" /></div>
        <div class="metric-value">{{ formatPercent(mc.maxDrawdownP50) }}</div>
      </div>
      <div class="metric">
        <div class="metric-label">最大DD 上位10%（深い）<HelpIcon :text="HELP.maxDDp90" /></div>
        <div class="metric-value">{{ formatPercent(mc.maxDrawdownP90) }}</div>
      </div>
      <div class="metric">
        <div class="metric-label">最大DD 下位10%（浅い）<HelpIcon :text="HELP.maxDDp10" /></div>
        <div class="metric-value">{{ formatPercent(mc.maxDrawdownP10) }}</div>
      </div>
      <div class="metric">
        <div class="metric-label">シーケンスp10：5年後資産比率<HelpIcon :text="HELP.sequenceP10Ratio" /></div>
        <div class="metric-value">{{
          mc.sequenceP10Diagnostics
            ? formatPercent(mc.sequenceP10Diagnostics.totalAtSeqWindowEnd / mc.sequenceP10Diagnostics.baseTotalAtWithdrawalStart)
            : "―"
        }}</div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.metrics-detail {
  margin-bottom: 16px;
  padding-top: 12px;
  border-top: 1px solid var(--border);
  opacity: 0.92;
}

.metrics-detail-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--muted);
  margin-bottom: 8px;
}
</style>
