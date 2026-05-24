<script setup lang="ts">
import { onMounted, nextTick, useTemplateRef } from "vue";
import { useLocalStorage } from "@vueuse/core";
import { useParams, DEFAULT_PARAMS } from "./composables/useParams.ts";
import { useStorage } from "./composables/useStorage.ts";
import { useSimulator } from "./composables/useSimulator.ts";
import InputDrawer from "./components/InputDrawer.vue";
import ConditionSummary from "./components/ConditionSummary.vue";
import ScoreHero from "./components/ScoreHero.vue";
import KeyMetrics from "./components/KeyMetrics.vue";
import MetricsDetail from "./components/MetricsDetail.vue";
import CompoundChart from "./components/CompoundChart.vue";
import MonteCarloChart from "./components/MonteCarloChart.vue";
import MonthlyDetails from "./components/MonthlyDetails.vue";

const {
  state,
  debouncedMcParams,
  applyScenarioPreset,
  applyProductPreset,
  applyDefensePreset,
  addOtherIncome,
  removeOtherIncome,
  addLimitStep,
  removeLimitStep,
  isComputingSwr,
  runSwrSearch,
  isComputingZeroLanding,
  runZeroLandingSolver,
} = useParams();
const storage = useStorage(state);
const { result } = useSimulator(debouncedMcParams);

const drawerOpen = useLocalStorage("decumulate:drawerOpen:v1", true);
let initiallyOpenScenarioPreset = true;
const openBtnEl = useTemplateRef<HTMLButtonElement>("openBtnEl");

function openDrawer() {
  drawerOpen.value = true;
  document.body.style.overflow = 'hidden';
}

async function closeDrawer() {
  drawerOpen.value = false;
  document.body.style.overflow = '';
  await nextTick();
  openBtnEl.value?.focus();
}

function estimateTargetDefenseRatioPercent(): number {
  const total = state.initialNisaMan + state.initialTaxableRiskMan + state.initialDefenseMan;
  if (total <= 0) return 0;
  return Math.round((state.initialDefenseMan / total) * 1000) / 10;
}

onMounted(() => {
  const loaded = storage.load();
  initiallyOpenScenarioPreset = !loaded;
  if (!loaded) {
    const est = estimateTargetDefenseRatioPercent();
    state.targetDefenseRatioStartPercent = est;
    state.targetDefenseRatioEndPercent = est;
  }
  storage.startAutoSave();
});

function handleReset() {
  storage.reset();
  Object.assign(state, { ...DEFAULT_PARAMS });
  const est = estimateTargetDefenseRatioPercent();
  state.targetDefenseRatioStartPercent = est;
  state.targetDefenseRatioEndPercent = est;
}

function handleExport() {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([storage.exportData()], { type: "application/json" }));
  a.download = "decumulate-inputs.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 100);
}

</script>

<template>
  <div style="display: contents">
    <header class="page-header">
      <div class="page-header-top">
        <h1>積立・取り崩しシミュレーター</h1>
        <button ref="openBtnEl" type="button" class="drawer-trigger" @click="openDrawer">入力…</button>
      </div>
      <p class="subtitle">
        NISA・特定口座・防衛資産の3バケットを日本の税制に沿って管理。iDeCo・公的年金も含め、取り崩し戦略をモンテカルロ（5,000パス）と年次／月次テーブルで詳しく検証できます。すべての計算はブラウザ内で完結し、データは外部送信されません。
      </p>
    </header>

    <main class="layout">
      <section class="panel results">
        <h2>結果</h2>
        <template v-if="result">
          <ConditionSummary
            :state="state"
            :params="debouncedMcParams"
            :result="result"
            @open="openDrawer"
          />
          <ScoreHero
            :score="result.score"
            :score-class-name="result.scoreInfo.className"
            :score-label="result.scoreInfo.label"
          />
          <KeyMetrics
            :yearly="result.yearly"
            :mc="result.mc"
            :params="debouncedMcParams"
          />
          <MetricsDetail
            :yearly="result.yearly"
            :mc="result.mc"
            :params="debouncedMcParams"
            :final-target-yen="state.finalTargetMan * 10000"
          />
          <CompoundChart :projections="result.yearly" :params="debouncedMcParams" />
          <MonteCarloChart :mc="result.mc" :params="debouncedMcParams" />
          <MonthlyDetails :det-monthly="result.monthly" :mc="result.mc" :params="debouncedMcParams" />
        </template>
        <p v-else class="chart-note">計算中…</p>
      </section>
    </main>

    <InputDrawer
      :open="drawerOpen"
      :initially-open-scenario-preset="initiallyOpenScenarioPreset"
      :is-computing-swr="isComputingSwr"
      :is-computing-zero-landing="isComputingZeroLanding"
      v-model="state"
      @close="closeDrawer"
      @apply-scenario-preset="applyScenarioPreset"
      @apply-product-preset="applyProductPreset"
      @apply-defense-preset="applyDefensePreset"
      @add-other-income="addOtherIncome"
      @remove-other-income="removeOtherIncome"
      @add-limit-step="addLimitStep"
      @remove-limit-step="removeLimitStep"
      @request-swr="runSwrSearch"
      @request-zero-landing="runZeroLandingSolver"
      @reset="handleReset"
      @export="handleExport"
      @import="storage.importData"
    />

    <footer class="page-footer">
      <p>
        本ツールは過去の市場データやリスクを保証するものではなく、投資判断を保証するものではありません。
      </p>
    </footer>
  </div>
</template>

<style scoped>
.page-header {
  position: sticky;
  top: 0;
  z-index: 10;
  background: var(--bg);
  padding: 24px 24px 8px;
  max-width: 1400px;
  margin: 0 auto;
}

.page-header-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  margin-bottom: 4px;
}

.page-header h1 {
  margin: 0;
  font-size: 22px;
}

.drawer-trigger {
  border: 1px solid var(--accent);
  color: var(--accent);
  background: transparent;
  padding: 6px 14px;
  border-radius: 8px;
  font-size: 13px;
  cursor: pointer;
  white-space: nowrap;
  flex-shrink: 0;
}

.drawer-trigger:hover {
  background: var(--accent-soft, rgba(99, 102, 241, 0.12));
}

.subtitle {
  color: var(--muted);
  margin: 0;
  font-size: 14px;
}

.layout {
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding: 20px 24px;
  max-width: 1400px;
  margin: 0 auto;
}

.panel {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 20px;
}

.panel h2 {
  margin: 0 0 16px;
  font-size: 16px;
  border-bottom: 1px solid var(--border);
  padding-bottom: 8px;
}

.page-footer {
  text-align: center;
  font-size: 12px;
  color: var(--muted);
  padding: 16px 24px 32px;
}
</style>
