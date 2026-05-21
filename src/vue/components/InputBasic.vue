<script setup lang="ts">
import type { ParamsState } from "../composables/useParams.ts";
import InputNumber from "./InputNumber.vue";

const state = defineModel<ParamsState>({ required: true });
</script>

<template>
  <div class="field-group">
    <h3>基本</h3>
    <div class="field">
      <label for="currentAge">現在の年齢</label>
      <InputNumber id="currentAge" v-model="state.currentAge" min="0" max="100" step="1" placeholder="例: 35" required />
    </div>
    <div class="field">
      <label for="monthlyContribution">月額積立（万円）</label>
      <InputNumber id="monthlyContribution" v-model="state.monthlyContributionMan" min="0" step="1" />
    </div>
  </div>
</template>
