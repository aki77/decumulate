<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount } from "vue";
import { Chart } from "chart.js";
import { ensureChartRegistered } from "../composables/useChartJs.ts";
import type { YearlyProjection } from "../../calculate.ts";
import type { CalculateParams } from "../../calculate.ts";

ensureChartRegistered();

const props = defineProps<{
  projections: YearlyProjection[];
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

  const { projections, params } = props;
  const labels = projections.map((p) => (p.age != null ? `${p.age}歳` : `${p.year}年`));
  const principal = projections.map((p) => toMan(p.principal));
  const interest = projections.map((p) => toMan(p.interest));
  const tax = projections.map((p) => toMan(p.tax));

  const annotations: Record<string, unknown> = {};
  if (params.contributionYears > 0 && params.contributionYears <= projections.length - 1) {
    annotations["contribEnd"] = {
      type: "line",
      xMin: params.contributionYears,
      xMax: params.contributionYears,
      borderColor: "rgba(34, 197, 94, 0.6)",
      borderWidth: 2,
      borderDash: [6, 6],
      label: { display: true, content: "積立終了", position: "start" },
    };
  }
  if (params.withdrawalStartYear > 0 && params.withdrawalStartYear <= projections.length - 1) {
    annotations["withdrawStart"] = {
      type: "line",
      xMin: params.withdrawalStartYear,
      xMax: params.withdrawalStartYear,
      borderColor: "rgba(239, 68, 68, 0.6)",
      borderWidth: 2,
      borderDash: [6, 6],
      label: { display: true, content: "切崩開始", position: "start" },
    };
  }

  chart = new Chart(canvas.value, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "元本",
          data: principal,
          backgroundColor: "rgba(59, 130, 246, 0.55)",
          borderColor: "rgba(59, 130, 246, 1)",
          borderWidth: 0,
          fill: true,
          stack: "assets",
          pointRadius: 0,
          tension: 0.15,
        },
        {
          label: "運用益（税引後）",
          data: interest,
          backgroundColor: "rgba(34, 197, 94, 0.5)",
          borderColor: "rgba(34, 197, 94, 1)",
          borderWidth: 0,
          fill: true,
          stack: "assets",
          pointRadius: 0,
          tension: 0.15,
        },
        {
          label: "税金（含み益分）",
          data: tax,
          backgroundColor: "rgba(244, 114, 182, 0.5)",
          borderColor: "rgba(244, 114, 182, 1)",
          borderWidth: 0,
          fill: true,
          stack: "assets",
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
          title: { display: true, text: "資産（万円, 名目）" },
        },
        x: { title: { display: true, text: params.currentAge != null ? "年齢" : "経過年数" } },
      },
      plugins: {
        legend: { position: "bottom" },
        tooltip: {
          callbacks: { label: (ctx) => `${ctx.dataset.label}: ${formatManValue(ctx.parsed.y as number)}` },
        },
        annotation: { annotations } as never,
      },
    },
  });
}

onMounted(buildChart);
watch(() => [props.projections, props.params], buildChart, { deep: true });
onBeforeUnmount(() => chart?.destroy());
</script>

<template>
  <div class="chart-block">
    <h3>積立・取り崩しの推移（決定論的, 名目値）</h3>
    <div class="chart-wrap">
      <canvas ref="canvas"></canvas>
    </div>
  </div>
</template>

<style scoped>
.chart-wrap {
  height: 420px;
  position: relative;
}
</style>
