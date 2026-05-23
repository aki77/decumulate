<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount } from "vue";
import { Chart } from "chart.js";
import { ensureChartRegistered } from "../composables/useChartJs.ts";
import { buildPhaseAnnotations } from "../composables/phaseAnnotations.ts";
import { toMan, formatManValue } from "../format.ts";
import { NUM_SIMULATIONS } from "../../monte-carlo.ts";
import type { MonteCarloResult, MonteCarloParams } from "../../monte-carlo.ts";

ensureChartRegistered();

const props = defineProps<{
  mc: MonteCarloResult;
  params: MonteCarloParams;
}>();

const copyLabel = ref("デバッグJSONをコピー");

async function copyDebugJson(): Promise<void> {
  const { mc, params } = props;
  const payload = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    seed: mc.seed,
    numSimulations: NUM_SIMULATIONS,
    params: JSON.parse(JSON.stringify(params)) as MonteCarloParams,
    summary: {
      finalP10: mc.finalP10,
      finalP50: mc.finalP50,
      finalP90: mc.finalP90,
      failureProbability: mc.failureProbability,
      depletionProbability: mc.depletionProbability,
      maxDrawdownP10: mc.maxDrawdownP10,
      maxDrawdownP50: mc.maxDrawdownP50,
      maxDrawdownP90: mc.maxDrawdownP90,
      sequenceRiskDepletionAge: mc.sequenceRiskDepletionAge,
    },
    yearly: mc.yearly,
    sequenceP10Diagnostics: mc.sequenceP10Diagnostics,
  };
  try {
    await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
    copyLabel.value = "コピーしました";
    setTimeout(() => { copyLabel.value = "デバッグJSONをコピー"; }, 2000);
  } catch {
    alert("コピーに失敗しました");
  }
}

const canvas = ref<HTMLCanvasElement | null>(null);
let chart: Chart | null = null;

function buildChart(): void {
  if (!canvas.value) return;
  chart?.destroy();

  const { mc, params } = props;
  const labels = mc.yearly.map((y) => (y.age != null ? `${y.age}歳` : `${y.year}年`));
  const p10Cum = mc.yearly.map((y) => toMan(y.p10));
  const p25Cum = mc.yearly.map((y) => toMan(y.p25));
  const p50Cum = mc.yearly.map((y) => toMan(y.p50));
  const p75Cum = mc.yearly.map((y) => toMan(y.p75));
  const p90Cum = mc.yearly.map((y) => toMan(y.p90));

  let sequenceYearly: (number | null)[] | null = null;
  const seqWindowYears = mc.sequenceP10Diagnostics
    ? Math.ceil(mc.sequenceP10Diagnostics.seqWindowMonths / 12)
    : 5;
  const seqWindowEndYear = params.withdrawalStartYear + seqWindowYears;

  if (mc.sequenceP10Monthly.length > 0) {
    sequenceYearly = [];
    for (let y = 0; y < mc.yearly.length; y++) {
      if (y < params.withdrawalStartYear) {
        sequenceYearly.push(null);
      } else if (y === params.withdrawalStartYear) {
        sequenceYearly.push(toMan(mc.yearly[y]!.p50));
      } else {
        const idx = y * 12 - 1;
        sequenceYearly.push(
          idx < mc.sequenceP10Monthly.length
            ? toMan(mc.sequenceP10Monthly[idx]!.total)
            : null,
        );
      }
    }
  }

  const annotations = buildPhaseAnnotations({
    contributionYears: params.contributionYears,
    withdrawalStartYear: params.withdrawalStartYear,
    maxYear: mc.yearly.length - 1,
  });

  chart = new Chart(canvas.value, {
    type: "line",
    data: {
      labels,
      datasets: [
        { label: "p10", data: p10Cum, backgroundColor: "rgba(59, 130, 246, 0.08)", borderWidth: 0, fill: "origin", pointRadius: 0 },
        { label: "p10〜p25", data: p25Cum, backgroundColor: "rgba(59, 130, 246, 0.15)", borderWidth: 0, fill: "-1", pointRadius: 0 },
        { label: "p25〜p50", data: p50Cum, backgroundColor: "rgba(59, 130, 246, 0.3)", borderWidth: 0, fill: "-1", pointRadius: 0 },
        { label: "p50〜p75", data: p75Cum, backgroundColor: "rgba(59, 130, 246, 0.3)", borderWidth: 0, fill: "-1", pointRadius: 0 },
        { label: "p75〜p90", data: p90Cum, backgroundColor: "rgba(59, 130, 246, 0.15)", borderWidth: 0, fill: "-1", pointRadius: 0 },
        {
          label: "中央値 (p50)",
          data: p50Cum,
          type: "line",
          borderColor: "rgba(37, 99, 235, 1)",
          backgroundColor: "transparent",
          borderWidth: 2.5,
          fill: false,
          pointRadius: 0,
          tension: 0.15,
        },
        ...(sequenceYearly ? [{
          label: "シーケンスリスクシナリオ (p10)",
          data: sequenceYearly,
          type: "line" as const,
          borderColor: "rgba(220, 38, 38, 0.9)",
          backgroundColor: "transparent",
          borderWidth: 2,
          fill: false,
          pointRadius: 0,
          tension: 0,
          segment: {
            borderColor: (ctx: { p1DataIndex: number }) =>
              ctx.p1DataIndex <= seqWindowEndYear
                ? "rgba(220, 38, 38, 0.9)"
                : "rgba(220, 38, 38, 0.35)",
            borderWidth: (ctx: { p1DataIndex: number }) =>
              ctx.p1DataIndex <= seqWindowEndYear ? 2.5 : 1,
            borderDash: (ctx: { p1DataIndex: number }) =>
              ctx.p1DataIndex <= seqWindowEndYear ? [] : [3, 4],
          },
        }] : []),
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      scales: {
        y: {
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
        annotation: { annotations } as never,
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
      塗りつぶしは p10–p90 のレンジ。中央線は p50（中央値）。赤線は取り崩し開始 5 年の累積実質リターンが下位 10% の単一パスで、<strong>実線部分（最初の 5 年）がシーケンスリスクが顕在化する局面</strong>。点線部分は同一パスの参考延長（長期では回復するケースも多い）。インフレ控除後の実質値で表示。
    </p>
    <button type="button" class="debug-copy-btn" @click="copyDebugJson">{{ copyLabel }}</button>
  </div>
</template>

<style scoped>
.chart-wrap {
  height: 420px;
  position: relative;
}

.debug-copy-btn {
  margin-top: 8px;
  padding: 4px 12px;
  font-size: 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
}

.debug-copy-btn:hover {
  background: var(--accent-soft, rgba(99, 102, 241, 0.12));
  color: var(--accent);
}
</style>
