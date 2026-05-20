<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount } from "vue";
import { Chart } from "chart.js";
import { ensureChartRegistered } from "../composables/useChartJs.ts";
import type { MonteCarloResult } from "../../monte-carlo.ts";
import type { CalculateParams } from "../../calculate.ts";

ensureChartRegistered();

const props = defineProps<{
  mc: MonteCarloResult;
  params: CalculateParams;
}>();

const canvas = ref<HTMLCanvasElement | null>(null);
let chart: Chart | null = null;

const toMan = (v: number) => v / 10000;

function formatManValue(manValue: number): string {
  if (!Number.isFinite(manValue)) return "-";
  return `${Math.round(manValue).toLocaleString("ja-JP", { maximumFractionDigits: 0 })}万円`;
}

function buildChart(): void {
  if (!canvas.value) return;
  chart?.destroy();

  const { mc, params } = props;
  const labels = mc.yearly.map((y) => (y.age != null ? `${y.age}歳` : `${y.year}年`));
  const p10 = mc.yearly.map((y) => toMan(y.p10));
  const p25 = mc.yearly.map((y) => toMan(y.p25 - y.p10));
  const p50low = mc.yearly.map((y) => toMan(y.p50 - y.p25));
  const p50high = mc.yearly.map((y) => toMan(y.p75 - y.p50));
  const p90 = mc.yearly.map((y) => toMan(y.p90 - y.p75));
  const median = mc.yearly.map((y) => toMan(y.p50));

  chart = new Chart(canvas.value, {
    type: "line",
    data: {
      labels,
      datasets: [
        { label: "p10", data: p10, backgroundColor: "rgba(59, 130, 246, 0.08)", borderWidth: 0, fill: true, stack: "fan", pointRadius: 0 },
        { label: "p10〜p25", data: p25, backgroundColor: "rgba(59, 130, 246, 0.15)", borderWidth: 0, fill: true, stack: "fan", pointRadius: 0 },
        { label: "p25〜p50", data: p50low, backgroundColor: "rgba(59, 130, 246, 0.3)", borderWidth: 0, fill: true, stack: "fan", pointRadius: 0 },
        { label: "p50〜p75", data: p50high, backgroundColor: "rgba(59, 130, 246, 0.3)", borderWidth: 0, fill: true, stack: "fan", pointRadius: 0 },
        { label: "p75〜p90", data: p90, backgroundColor: "rgba(59, 130, 246, 0.15)", borderWidth: 0, fill: true, stack: "fan", pointRadius: 0 },
        {
          label: "中央値 (p50)",
          data: median,
          type: "line",
          borderColor: "rgba(37, 99, 235, 1)",
          backgroundColor: "transparent",
          borderWidth: 2.5,
          fill: false,
          pointRadius: 0,
          tension: 0.15,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      scales: {
        y: {
          stacked: true,
          ticks: { callback: (v) => `${(v as number).toLocaleString("ja-JP")}万` },
          title: { display: true, text: "資産（万円, 実質値）" },
        },
        x: { title: { display: true, text: params.currentAge != null ? "年齢" : "経過年数" } },
      },
      plugins: {
        legend: { position: "bottom" },
        tooltip: {
          callbacks: { label: (ctx) => `${ctx.dataset.label}: ${formatManValue(ctx.parsed.y as number)}` },
        },
      },
    },
  });
}

onMounted(buildChart);
watch(() => [props.mc, props.params], buildChart, { deep: true });
onBeforeUnmount(() => chart?.destroy());
</script>

<template>
  <div class="chart-block">
    <h3>モンテカルロ・シミュレーション（5,000パス, 実質値）</h3>
    <div class="chart-wrap">
      <canvas ref="canvas"></canvas>
    </div>
    <p class="chart-note">
      塗りつぶしは p10–p90 のレンジ。中央線は p50（中央値）。インフレ控除後の実質値で表示しています。
    </p>
  </div>
</template>

<style scoped>
.chart-wrap {
  height: 360px;
  position: relative;
}
</style>
