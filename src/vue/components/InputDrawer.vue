<script setup lang="ts">
import { nextTick, watch, useTemplateRef } from "vue";
import { useEventListener } from "@vueuse/core";
import type { ParamsState } from "../composables/useParams.ts";
import InputBasic from "./InputBasic.vue";
import InputPortfolio from "./InputPortfolio.vue";
import InputProduct from "./InputProduct.vue";
import InputDefense from "./InputDefense.vue";
import InputPeriod from "./InputPeriod.vue";
import InputWithdrawal from "./InputWithdrawal.vue";
import InputIdeco from "./InputIdeco.vue";
import InputPension from "./InputPension.vue";

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{
  close: [];
  applyProductPreset: [key: string];
  applyDefensePreset: [key: string];
  addOtherIncome: [];
  removeOtherIncome: [id: string];
  addLimitStep: [];
  removeLimitStep: [idx: number];
  reset: [];
  export: [];
  import: [data: string];
}>();

function handleImport(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    if (typeof reader.result === "string") emit("import", reader.result);
    (e.target as HTMLInputElement).value = "";
  };
  reader.readAsText(file);
}

const state = defineModel<ParamsState>({ required: true });
const drawerEl = useTemplateRef<HTMLElement>("drawerEl");

useEventListener(window, "keydown", (e) => {
  if (props.open && e.key === "Escape") emit("close");
});

watch(
  () => props.open,
  async (v) => {
    if (v) {
      await nextTick();
      drawerEl.value?.querySelector<HTMLElement>("input, select, button")?.focus();
    }
  },
);
</script>

<template>
  <Teleport to="body">
    <Transition name="drawer">
      <div
        v-if="open"
        class="drawer-root"
        role="dialog"
        aria-modal="true"
        aria-labelledby="drawer-title"
      >
        <div class="drawer-overlay" @click="emit('close')"></div>
        <aside ref="drawerEl" class="drawer">
          <header class="drawer-header">
            <h2 id="drawer-title">入力</h2>
            <button type="button" class="drawer-close" aria-label="閉じる" @click="emit('close')">&#x2715;</button>
          </header>
          <div class="drawer-body">
            <InputBasic v-model="state" />
            <InputPortfolio v-model="state" />
            <InputProduct v-model="state" @apply-product-preset="emit('applyProductPreset', $event)" />
            <InputDefense v-model="state" @apply-defense-preset="emit('applyDefensePreset', $event)" />
            <InputPeriod v-model="state" />
            <InputWithdrawal
              v-model="state"
              @add-limit-step="emit('addLimitStep')"
              @remove-limit-step="emit('removeLimitStep', $event)"
            />
            <InputIdeco v-model="state" />
            <InputPension
              v-model="state"
              @add-other-income="emit('addOtherIncome')"
              @remove-other-income="emit('removeOtherIncome', $event)"
            />
            <div class="form-actions">
              <div class="form-actions-left">
                <button type="button" class="action-button" @click="emit('export')">エクスポート</button>
                <label class="action-button">
                  インポート
                  <input type="file" accept=".json" style="display:none" @change="handleImport">
                </label>
              </div>
              <button type="button" class="reset-button" @click="emit('reset')">入力をリセット</button>
            </div>
          </div>
        </aside>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.drawer-root {
  position: fixed;
  inset: 0;
  z-index: 100;
}

.drawer-overlay {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
}

.drawer {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: 480px;
  background: var(--panel);
  border-left: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  box-shadow: -8px 0 24px rgba(0, 0, 0, 0.15);
}

.drawer-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border);
  position: sticky;
  top: 0;
  background: var(--panel);
  z-index: 1;
  flex-shrink: 0;
}

.drawer-header h2 {
  margin: 0;
  font-size: 16px;
}

.drawer-close {
  background: transparent;
  border: none;
  font-size: 22px;
  line-height: 1;
  cursor: pointer;
  color: var(--muted);
  padding: 4px 8px;
}

.drawer-close:hover {
  color: var(--text);
}

.drawer-body {
  overflow-y: auto;
  padding: 16px 20px;
  flex: 1;
}

.form-actions {
  margin-top: 20px;
  padding-top: 16px;
  border-top: 1px solid var(--border);
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}

.form-actions-left {
  display: flex;
  gap: 8px;
}

.action-button {
  font-size: 13px;
  padding: 6px 14px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--muted);
  cursor: pointer;
}

.action-button:hover {
  border-color: var(--accent);
  color: var(--accent);
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

@media (max-width: 700px) {
  .drawer {
    width: 100%;
  }
}

.drawer-enter-active,
.drawer-leave-active {
  transition: opacity 200ms;
}

.drawer-enter-active .drawer,
.drawer-leave-active .drawer {
  transition: transform 300ms cubic-bezier(0.4, 0, 0.2, 1);
}

.drawer-enter-from,
.drawer-leave-to {
  opacity: 0;
}

.drawer-enter-from .drawer,
.drawer-leave-to .drawer {
  transform: translateX(100%);
}
</style>
