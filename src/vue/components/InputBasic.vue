<script setup lang="ts">
import type { ParamsState } from "../composables/useParams.ts";

const state = defineModel<ParamsState>({ required: true });
</script>

<template>
  <div class="field-group">
    <h3>基本</h3>
    <div class="field">
      <label for="currentAge">現在の年齢（任意）</label>
      <input
        id="currentAge"
        type="number"
        min="0"
        max="100"
        step="1"
        placeholder="例: 35"
        :value="state.currentAge ?? ''"
        @input="state.currentAge = ($event.target as HTMLInputElement).value === '' ? null : Number(($event.target as HTMLInputElement).value)"
      />
    </div>
    <div class="field">
      <label for="monthlyContribution">月額積立（万円）</label>
      <input
        id="monthlyContribution"
        v-model.number="state.monthlyContributionMan"
        type="number"
        min="0"
        step="1"
      />
    </div>
  </div>
</template>
