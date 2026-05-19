<script setup lang="ts">
import { onMounted, toRef } from "vue";
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
import ResultSummary from "./components/ResultSummary.vue";
import CompoundChart from "./components/CompoundChart.vue";
import MonteCarloChart from "./components/MonteCarloChart.vue";
import MonthlyDetails from "./components/MonthlyDetails.vue";

const { state, mcParams, applyProductPreset, applyDefensePreset, addOtherIncome, removeOtherIncome } = useParams();
const storage = useStorage(state);
const { result } = useSimulator(toRef(mcParams));

onMounted(() => {
  storage.load();
  storage.startAutoSave();
});

function handleReset() {
  storage.reset();
  Object.assign(state, { ...DEFAULT_PARAMS });
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

      <section class="panel results">
        <h2>結果</h2>
        <template v-if="result">
          <ResultSummary
            :yearly="result.yearly"
            :mc="result.mc"
            :params="mcParams"
            :score="result.score"
            :score-class-name="result.scoreInfo.className"
            :score-label="result.scoreInfo.label"
          />
          <CompoundChart :projections="result.yearly" :params="mcParams" />
          <MonteCarloChart :mc="result.mc" :params="mcParams" />
          <MonthlyDetails :det-monthly="result.monthly" :mc="result.mc" :params="mcParams" />
        </template>
        <p v-else class="chart-note">計算中…</p>
      </section>
    </main>

    <footer class="page-footer">
      <p>
        本ツールは過去の市場データやリスクを保証するものではなく、投資判断を保証するものではありません。
      </p>
    </footer>
  </div>
</template>
