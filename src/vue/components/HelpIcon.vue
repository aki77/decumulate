<script setup lang="ts">
import { useId } from "vue";

defineProps<{ text?: string; ariaLabel?: string; compact?: boolean }>();
const anchorName = `--help-${useId()}`;
</script>

<template>
  <span
    class="help-icon"
    :class="{ 'help-icon--compact': compact }"
    :style="{ anchorName }"
    tabindex="0"
    :aria-label="ariaLabel ?? 'ヘルプ'"
  >?<span class="help-tip" :style="{ positionAnchor: anchorName }"><slot>{{ text }}</slot></span></span>
</template>

<style scoped>
.help-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--border);
  color: var(--muted);
  font-size: 10px;
  font-weight: 700;
  line-height: 1;
  margin-left: 4px;
  cursor: help;
  position: relative;
  user-select: none;
  vertical-align: middle;
}

.help-icon--compact {
  width: 13px;
  height: 13px;
  margin-left: 3px;
}

.help-icon:hover,
.help-icon:focus {
  background: var(--accent);
  color: #fff;
  outline: none;
}

.help-icon .help-tip {
  visibility: hidden;
  opacity: 0;
  position: fixed;
  position-area: top;
  position-try-fallbacks:
    bottom,
    top right,
    bottom right,
    top left,
    bottom left;
  background: var(--text);
  color: var(--panel);
  font-size: 12px;
  font-weight: 400;
  line-height: 1.4;
  padding: 8px 10px;
  border-radius: 6px;
  width: max-content;
  max-width: 240px;
  white-space: normal;
  text-align: left;
  z-index: 10;
  pointer-events: none;
  transition: opacity 0.15s ease;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.18);
  margin-bottom: 6px;
}

.help-icon:hover .help-tip,
.help-icon:focus .help-tip {
  visibility: visible;
  opacity: 1;
}

@media (max-width: 600px) {
  .help-icon .help-tip {
    max-width: 200px;
  }
}
</style>
