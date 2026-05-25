<script setup lang="ts">
import type { RebalanceInfo } from "../../calculate.ts";

defineProps<{
  symbol: string;
  kind: "transfer" | "rebalance" | "ideco-lump" | "ideco-pension" | "life-event";
  ariaLabel: string;
  direction?: RebalanceInfo["direction"];
  variant?: "year";
}>();
</script>

<template>
  <span
    class="event-badge"
    :class="{ 'event-badge--year': variant === 'year' }"
    :data-kind="kind"
    :data-direction="direction"
    tabindex="0"
    :aria-label="ariaLabel"
  >{{ symbol }}<span class="event-tip"><slot /></span></span>
</template>

<style scoped>
.event-badge {
  position: relative;
  display: inline-block;
  cursor: help;
  font-weight: 700;
  user-select: none;
  margin-right: 2px;
}

.event-badge--year {
  margin-left: 4px;
}

.event-badge[data-kind="transfer"] {
  color: var(--success);
}

.event-badge[data-kind="rebalance"][data-direction="risk-to-defense"] {
  color: var(--accent);
}

.event-badge[data-kind="rebalance"][data-direction="defense-to-risk"] {
  color: var(--warn);
}

.event-badge[data-kind="ideco-lump"] {
  color: #9333ea;
}

.event-badge[data-kind="ideco-pension"] {
  color: #db2777;
}

.event-badge[data-kind="life-event"] {
  color: #d97706;
}

.event-badge .event-tip {
  visibility: hidden;
  opacity: 0;
  position: absolute;
  bottom: calc(100% + 6px);
  right: 0;
  background: var(--text);
  color: var(--panel);
  font-size: 12px;
  font-weight: 400;
  line-height: 1.5;
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
}

.event-badge:hover .event-tip,
.event-badge:focus .event-tip {
  visibility: visible;
  opacity: 1;
}
</style>
