<script lang="ts" setup>
import { SCENARIO_PRESETS } from "../composables/useParams.ts";

const { initiallyOpen = true } = defineProps<{ initiallyOpen?: boolean }>();
const emit = defineEmits<{
  applyScenarioPreset: [index: number];
}>();
</script>

<template>
  <details class="field-group scenario-preset-group" :open="initiallyOpen || undefined">
    <summary class="scenario-summary"><h3>よくある設定から始める <span class="scenario-chevron">▶</span></h3></summary>
    <p class="scenario-hint">典型的なシナリオを選ぶとすべてのフィールドが自動入力されます。</p>
    <div class="scenario-buttons">
      <button
        v-for="(scenario, index) in SCENARIO_PRESETS"
        :key="index"
        type="button"
        class="scenario-button"
        @click="emit('applyScenarioPreset', index)"
      >
        <span class="scenario-label">{{ scenario.label }}</span>
        <span class="scenario-desc">{{ scenario.description }}</span>
      </button>
    </div>
  </details>
</template>

<style scoped>
.scenario-preset-group {
  display: block;
  border-bottom: 2px solid var(--accent, #6366f1);
  margin-bottom: 8px;
  padding-bottom: 20px;
}

.scenario-summary {
  cursor: pointer;
  list-style: none;
  padding-bottom: 4px;
}

.scenario-summary::-webkit-details-marker {
  display: none;
}

.scenario-summary h3 {
  margin: 0;
}

.scenario-chevron {
  font-size: 10px;
  color: var(--muted);
  display: inline-block;
  transition: transform 0.2s;
}

.scenario-preset-group[open] .scenario-chevron {
  transform: rotate(90deg);
}

.scenario-hint {
  font-size: 12px;
  color: var(--muted);
  margin: 0 0 12px;
}

.scenario-buttons {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.scenario-button {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  padding: 10px 14px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: transparent;
  cursor: pointer;
  text-align: left;
  transition: border-color 0.15s, background 0.15s;
}

.scenario-button:hover {
  border-color: var(--accent, #6366f1);
  background: var(--accent-soft, rgba(99, 102, 241, 0.06));
}

.scenario-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
}

.scenario-desc {
  font-size: 11px;
  color: var(--muted);
}
</style>
