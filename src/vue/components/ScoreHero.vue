<script setup lang="ts">
import HelpIcon from "./HelpIcon.vue";
import type { ScoreClassName } from "../../monte-carlo.ts";

defineProps<{
  score: number;
  scoreClassName: ScoreClassName;
  scoreLabel: string;
}>();

const HELP = "枯渇確率・元本割れ確率・中央値残高から算出したシミュレーション成功率ベースの 0–100 スコア。高いほど良好だが、実際の安全性は市場の想定外変動（GBM では過小評価されるファットテール等）により異なる。";
</script>

<template>
  <div :class="`score-hero ${scoreClassName}`">
    <div class="score-value">{{ score }}</div>
    <div class="score-label">{{ scoreLabel }}</div>
    <div class="score-desc">
      安心度スコア（0–100）<HelpIcon :text="HELP" />
    </div>
    <div class="score-inline-hint">高いほど安心。80 以上を目安に。</div>
  </div>
</template>

<style scoped>
.score-hero {
  border-radius: 12px;
  padding: 18px 24px;
  text-align: center;
  display: flex;
  flex-direction: row;
  align-items: baseline;
  justify-content: center;
  gap: 16px;
  flex-wrap: wrap;
  border: 1px solid var(--border);
  margin-bottom: 16px;
}

.score-value {
  font-size: 48px;
  font-weight: 700;
  line-height: 1;
}

.score-label {
  font-size: 15px;
  font-weight: 600;
}

.score-desc {
  font-size: 11px;
  color: var(--muted);
}

.score-inline-hint {
  width: 100%;
  text-align: center;
  font-size: 12px;
  color: inherit;
  opacity: 0.7;
  margin-top: 2px;
}

.score-excellent {
  background: rgba(22, 163, 74, 0.12);
  border-color: rgba(22, 163, 74, 0.3);
  color: var(--success);
}

.score-safe {
  background: rgba(22, 163, 74, 0.08);
  border-color: rgba(22, 163, 74, 0.25);
  color: var(--success);
}

.score-caution {
  background: rgba(245, 158, 11, 0.12);
  border-color: rgba(245, 158, 11, 0.3);
  color: var(--warn);
}

.score-warn {
  background: rgba(245, 158, 11, 0.16);
  border-color: rgba(245, 158, 11, 0.4);
  color: var(--warn);
}

.score-danger {
  background: rgba(220, 38, 38, 0.12);
  border-color: rgba(220, 38, 38, 0.3);
  color: var(--danger);
}

.score-hero :deep(.help-icon) {
  background: rgba(255, 255, 255, 0.4);
  color: inherit;
}
</style>
