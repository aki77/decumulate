<script setup lang="ts">
import MonthlyTable from "./MonthlyTable.vue";
import type { MonthlyProjection, CalculateParams } from "../../calculate.ts";
import type { MonteCarloResult, PercentileKey } from "../../monte-carlo.ts";

defineProps<{
  detMonthly: MonthlyProjection[];
  mc: MonteCarloResult;
  params: CalculateParams;
}>();

const mcLabels: Array<[PercentileKey, string]> = [
  ["p90", "モンテカルロ P90 パス（楽観側, 月次, 実質値）"],
  ["p75", "モンテカルロ P75 パス（やや楽観, 月次, 実質値）"],
  ["p50", "モンテカルロ P50 パス（中央値, 月次, 実質値）"],
  ["p25", "モンテカルロ P25 パス（やや悲観, 月次, 実質値）"],
  ["p10", "モンテカルロ P10 パス（悲観側, 月次, 実質値）"],
];
</script>

<template>
  <div class="chart-block">
    <h3>月毎詳細</h3>
    <p class="chart-note">
      年をクリックすると、その年の12ヶ月分の月末資産・引出額・運用損益・リバランス発動が展開されます。
      数値はモンテカルロ中央パスの実質値（インフレ控除後）で表示しています。名目リターンがインフレ率を下回る防衛資産（個人向け国債・預金など）は、実質ベースでは目減りするため運用損益がマイナスで表示されます。
    </p>
    <div class="monthly-details">
      <details class="monthly-section">
        <summary>決定論的（月次, 名目値）</summary>
        <MonthlyTable :monthly="detMonthly" :params="params" />
      </details>
      <details v-for="[key, title] in mcLabels" :key="key" class="monthly-section">
        <summary>{{ title }}</summary>
        <MonthlyTable :monthly="mc.pivotMonthlies[key]" :params="params" />
      </details>
    </div>
  </div>
</template>

<style scoped>
.monthly-details {
  margin-top: 8px;
}

.monthly-section {
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 8px 12px;
  margin-bottom: 8px;
  background: var(--panel);
}

.monthly-section > summary {
  font-weight: 600;
  cursor: pointer;
  padding: 4px 0;
}
</style>
