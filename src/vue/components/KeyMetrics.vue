<script setup lang="ts">
import HelpIcon from "./HelpIcon.vue";
import { useMetrics } from "../composables/useMetrics.ts";
import { formatMan, formatPercent } from "../format.ts";
import type { YearlyProjection, CalculateParams } from "../../calculate.ts";
import type { MonteCarloResult } from "../../monte-carlo.ts";

const props = defineProps<{
  yearly: YearlyProjection[];
  mc: MonteCarloResult;
  params: CalculateParams;
}>();

const HELP = {
  finalTotal: "シミュレーション最終年の名目資産（インフレ調整なし）。",
  interest: "最終時点の元本超過分（運用益）。非課税口座でない場合は税金控除済み。",
  totalWithdrawn: "取り崩し期間中に引き出した金額の合計（名目値）。",
  mcP50: "モンテカルロ 5,000 試行の最終資産分布の中央値。インフレ控除後の購買力ベース。",
  depletion: "取り崩し期間中に資産がゼロになる試行の割合。",
  failure: "最終資産が積立元本合計を下回る試行の割合。",
} as const;

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
    </div>
    <div class="metric">
      <div class="metric-label">枯渇確率<HelpIcon :text="HELP.depletion" /></div>
      <div class="metric-value">{{ formatPercent(mc.depletionProbability) }}</div>
    </div>
    <div class="metric">
      <div class="metric-label">元本割れ確率<HelpIcon :text="HELP.failure" /></div>
      <div class="metric-value">{{ formatPercent(mc.failureProbability) }}</div>
    </div>
  </div>
</template>

<style scoped>
.metric-grid {
  margin-bottom: 16px;
}
</style>
