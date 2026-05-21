<script setup lang="ts">
import type { ParamsState } from "../composables/useParams.ts";
import InputNumber from "./InputNumber.vue";

const state = defineModel<ParamsState>({ required: true });
</script>

<template>
  <div class="field-group">
    <h3>期間</h3>
    <div class="field">
      <label for="contributionYears">積立年数</label>
      <InputNumber id="contributionYears" v-model="state.contributionYears" min="0" max="70" step="1" />
    </div>
    <div class="field">
      <label for="withdrawalStartYear">切崩開始（現在から○年後）</label>
      <InputNumber id="withdrawalStartYear" v-model="state.withdrawalStartYear" min="0" max="65" step="1" />
    </div>
    <div class="field">
      <label for="withdrawalYears">切崩年数</label>
      <InputNumber id="withdrawalYears" v-model="state.withdrawalYears" min="1" max="70" step="1" />
    </div>
  </div>
</template>
