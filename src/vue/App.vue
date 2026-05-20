<script setup lang="ts">
import { onMounted } from "vue";
import { useParams, DEFAULT_PARAMS } from "./composables/useParams.ts";
import { useStorage } from "./composables/useStorage.ts";
import { useSimulator } from "./composables/useSimulator.ts";
import InputBasic from "./components/InputBasic.vue";
import InputPortfolio from "./components/InputPortfolio.vue";
import InputProduct from "./components/InputProduct.vue";
import InputDefense from "./components/InputDefense.vue";
import InputPeriod from "./components/InputPeriod.vue";
import InputWithdrawal from "./components/InputWithdrawal.vue";
import InputIdeco from "./components/InputIdeco.vue";
import InputPension from "./components/InputPension.vue";
import ScoreHero from "./components/ScoreHero.vue";
import KeyMetrics from "./components/KeyMetrics.vue";
import MetricsDetail from "./components/MetricsDetail.vue";
import CompoundChart from "./components/CompoundChart.vue";
import MonteCarloChart from "./components/MonteCarloChart.vue";
import MonthlyDetails from "./components/MonthlyDetails.vue";

const { state, debouncedMcParams, applyProductPreset, applyDefensePreset, addOtherIncome, removeOtherIncome } = useParams();
const storage = useStorage(state);
const { result } = useSimulator(debouncedMcParams);

function estimateTargetDefenseRatioPercent(): number {
  const total = state.initialNisaMan + state.initialTaxableRiskMan + state.initialDefenseMan;
  if (total <= 0) return 0;
  return Math.round((state.initialDefenseMan / total) * 1000) / 10;
}

onMounted(() => {
  const loaded = storage.load();
  if (!loaded) {
    state.targetDefenseRatioPercent = estimateTargetDefenseRatioPercent();
  }
  storage.startAutoSave();
});

function handleReset() {
  storage.reset();
  Object.assign(state, { ...DEFAULT_PARAMS });
  state.targetDefenseRatioPercent = estimateTargetDefenseRatioPercent();
}

function preventNumberScroll(e: WheelEvent) {
  const el = document.activeElement;
  if (el instanceof HTMLInputElement && el.type === "number" && e.target === el) {
    e.preventDefault();
  }
}
</script>

<template>
  <div @wheel.capture="preventNumberScroll" style="display: contents">
    <header class="page-header">
      <h1>資産切り崩しシミュレーター</h1>
      <p class="subtitle">
        積立 → 取り崩しの資産推移をモンテカルロで評価します。すべての計算はブラウザ内で完結し、データは外部送信されません。
      </p>
    </header>

    <main class="layout">
      <section class="panel results">
        <h2>結果</h2>
        <template v-if="result">
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
          <CompoundChart :projections="result.yearly" :params="debouncedMcParams" />
          <MonteCarloChart :mc="result.mc" :params="debouncedMcParams" />
          <MetricsDetail
            :yearly="result.yearly"
            :mc="result.mc"
            :params="debouncedMcParams"
          />
          <MonthlyDetails :det-monthly="result.monthly" :mc="result.mc" :params="debouncedMcParams" />
        </template>
        <p v-else class="chart-note">計算中…</p>
      </section>

      <section class="panel inputs">
        <h2>入力</h2>
        <InputBasic v-model="state" />
        <InputPortfolio v-model="state" />
        <InputProduct
          v-model="state"
          @apply-product-preset="applyProductPreset"
        />
        <InputDefense
          v-model="state"
          @apply-defense-preset="applyDefensePreset"
        />
        <InputPeriod v-model="state" />
        <InputWithdrawal v-model="state" />
        <InputIdeco v-model="state" />
        <InputPension
          v-model="state"
          @add-other-income="addOtherIncome"
          @remove-other-income="removeOtherIncome"
        />
        <div class="form-actions">
          <button type="button" class="reset-button" @click="handleReset">入力をリセット</button>
        </div>
      </section>
    </main>

    <footer class="page-footer">
      <p>
        本ツールは過去の市場データやリスクを保証するものではなく、投資判断を保証するものではありません。
      </p>
    </footer>
  </div>
</template>

<style scoped>
.page-header {
  padding: 24px 24px 8px;
  max-width: 1400px;
  margin: 0 auto;
}

.page-header h1 {
  margin: 0 0 4px;
  font-size: 22px;
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

.form-actions {
  margin-top: 20px;
  padding-top: 16px;
  border-top: 1px solid var(--border);
  display: flex;
  justify-content: flex-end;
}

.reset-button {
  font-size: 13px;
  padding: 6px 14px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--muted);
  cursor: pointer;
}

.reset-button:hover {
  border-color: var(--danger);
  color: var(--danger);
}

.page-footer {
  text-align: center;
  font-size: 12px;
  color: var(--muted);
  padding: 16px 24px 32px;
}
</style>
