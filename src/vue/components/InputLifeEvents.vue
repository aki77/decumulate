<script setup lang="ts">
import HelpIcon from "./HelpIcon.vue";
import InputNumber from "./InputNumber.vue";
import type { ParamsState } from "../composables/useParams.ts";

const state = defineModel<ParamsState>({ required: true });
const emit = defineEmits<{
  addLifeEvent: [];
  removeLifeEvent: [id: string];
}>();
</script>

<template>
  <div class="field-group">
    <h3>ライフイベント支出</h3>
    <div class="field field--full life-events-field">
      <div class="life-events-header">
        <label>一時出費（年単位）</label>
        <HelpIcon text="車買い替え・住宅リフォーム・子の進学費など、特定の年齢に発生する大きな一時支出を登録できます。金額は実質値（今日の購買力）で入力してください。その年の1月に通常取り崩しに加算されます。" />
      </div>
      <div class="life-events-list">
        <div
          v-for="entry in state.lifeEvents"
          :key="entry.id"
          class="life-event-row"
        >
          <input
            class="le-label"
            type="text"
            placeholder="ラベル（例: 車買い替え）"
            :value="entry.label"
            @input="entry.label = ($event.target as HTMLInputElement).value"
          />
          <div class="le-controls">
            <InputNumber
              class="le-age"
              min="0"
              step="1"
              placeholder="発生年齢"
              :model-value="entry.age || null"
              @update:model-value="entry.age = $event ?? 0"
            />
            <span class="le-age-unit">歳</span>
            <InputNumber
              class="le-amount"
              min="0"
              step="1"
              placeholder="金額(万円)"
              :model-value="entry.amountMan || null"
              @update:model-value="entry.amountMan = $event ?? 0"
            />
            <span class="le-unit">万円</span>
            <button type="button" class="le-remove" aria-label="削除" @click="emit('removeLifeEvent', entry.id)">×</button>
          </div>
        </div>
      </div>
      <div class="preset-buttons">
        <button type="button" @click="emit('addLifeEvent')">＋ イベントを追加</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.life-events-field {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.life-events-header {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
  font-weight: 500;
  color: var(--muted);
}

.life-events-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.life-event-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px;
  border: 1px solid var(--border);
  border-radius: 4px;
}

.le-label {
  font-size: 13px;
  padding: 4px 6px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--panel);
  color: var(--text);
  width: 100%;
  box-sizing: border-box;
}

.le-controls {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
}

.le-age {
  width: 70px;
}

.le-age-unit {
  font-size: 12px;
  color: var(--muted);
}

.le-amount {
  width: 80px;
}

.le-unit {
  font-size: 12px;
  color: var(--muted);
}

.le-remove {
  margin-left: auto;
  background: none;
  border: none;
  color: var(--muted);
  cursor: pointer;
  font-size: 16px;
  padding: 2px 6px;
  border-radius: 4px;
  line-height: 1;
}

.le-remove:hover {
  background: rgba(220, 38, 38, 0.1);
  color: var(--danger, #dc2626);
}
</style>
