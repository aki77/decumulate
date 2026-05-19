<script setup lang="ts">
import type { ParamsState } from "../composables/useParams.ts";

const state = defineModel<ParamsState>({ required: true });
</script>

<template>
  <div class="field-group">
    <h3>期間</h3>
    <div class="field">
      <label for="contributionYears">積立年数</label>
      <input id="contributionYears" v-model.number="state.contributionYears" type="number" min="0" max="70" step="1" />
    </div>
    <div class="field">
      <label for="withdrawalStartYear">切崩開始（現在から○年後）</label>
      <input id="withdrawalStartYear" v-model.number="state.withdrawalStartYear" type="number" min="0" max="65" step="1" />
    </div>
    <div class="field">
      <label for="withdrawalYears">切崩年数</label>
      <input id="withdrawalYears" v-model.number="state.withdrawalYears" type="number" min="1" max="70" step="1" />
    </div>
  </div>
</template>
