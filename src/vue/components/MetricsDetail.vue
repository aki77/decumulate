<script setup lang="ts">
import { computed } from "vue";
import HelpIcon from "./HelpIcon.vue";
import { useMetrics, type DieWithZeroStatus } from "../composables/useMetrics.ts";
import { formatMan, formatPercent } from "../format.ts";
import { METRICS_DETAIL_HELP as HELP } from "../help-dict.ts";
import type { YearlyProjection, CalculateParams } from "../../calculate.ts";
import type { MonteCarloResult } from "../../monte-carlo.ts";

const props = defineProps<{
  yearly: YearlyProjection[];
  mc: MonteCarloResult;
  params: CalculateParams;
  finalTargetYen?: number;
}>();

const metrics = useMetrics(
  () => props.yearly,
  () => props.params,
  () => props.finalTargetYen ?? 0,
);

const isDieWithZero = computed(() => props.params.withdrawalMode === "zero-landing");

const statusLabel: Record<DieWithZeroStatus, string> = {
  surplus: "使い残し",
  shortage: "不足リスク",
  "near-zero": "ほぼ目標通り",
};
</script>

<template>
  <section class="metrics-detail">
    <div class="metrics-detail-label">詳細メトリクス</div>
    <div class="metric-grid">
      <div class="metric">
        <div class="metric-label">積立元本合計<HelpIcon :text="HELP.totalContrib" /></div>
        <div class="metric-value">{{ formatMan(metrics.totalContrib) }}</div>
      </div>
      <div class="metric">
        <div class="metric-label">最終 NISA 残高<HelpIcon :text="HELP.finalNisa" /></div>
        <div class="metric-value">{{ formatMan(metrics.last.nisaTotal) }}</div>
      </div>
      <div class="metric">
        <div class="metric-label">NISA 生涯枠使用率<HelpIcon :text="HELP.nisaUsage" /></div>
        <div class="metric-value">{{ formatPercent(metrics.nisaLifetimeUsageRatio) }}</div>
      </div>
      <div class="metric">
        <div class="metric-label">iDeCo 一時金累計<HelpIcon :text="HELP.idecoLumpSum" /></div>
        <div class="metric-value">{{ formatMan(metrics.totalIdecoLumpSum) }}</div>
      </div>
      <div class="metric">
        <div class="metric-label">iDeCo 年金累計<HelpIcon :text="HELP.idecoPension" /></div>
        <div class="metric-value">{{ formatMan(metrics.totalIdecoPension) }}</div>
      </div>
      <div class="metric">
        <div class="metric-label">MC 悲観値 p10（実質）<HelpIcon :text="HELP.mcP10" /></div>
        <div class="metric-value">{{ formatMan(mc.finalP10) }}</div>
      </div>
      <div class="metric">
        <div class="metric-label">MC 楽観値 p90（実質）<HelpIcon :text="HELP.mcP90" /></div>
        <div class="metric-value">{{ formatMan(mc.finalP90) }}</div>
      </div>
      <div class="metric">
        <div class="metric-label">最大DD 中央値<HelpIcon :text="HELP.maxDDp50" /></div>
        <div class="metric-value">{{ formatPercent(mc.maxDrawdownP50) }}</div>
      </div>
      <div class="metric">
        <div class="metric-label">最大DD 上位10%（深い）<HelpIcon :text="HELP.maxDDp90" /></div>
        <div class="metric-value">{{ formatPercent(mc.maxDrawdownP90) }}</div>
      </div>
      <div class="metric">
        <div class="metric-label">最大DD 下位10%（浅い）<HelpIcon :text="HELP.maxDDp10" /></div>
        <div class="metric-value">{{ formatPercent(mc.maxDrawdownP10) }}</div>
      </div>
      <div class="metric">
        <div class="metric-label">シーケンスp10：5年後資産比率<HelpIcon :text="HELP.sequenceP10Ratio" /></div>
        <div class="metric-value">{{
          mc.sequenceP10Diagnostics
            ? formatPercent(mc.sequenceP10Diagnostics.totalAtSeqWindowEnd / mc.sequenceP10Diagnostics.baseTotalAtWithdrawalStart)
            : "―"
        }}</div>
      </div>
    </div>
    <template v-if="isDieWithZero">
      <div class="metrics-detail-label die-with-zero-label">DIE WITH ZERO 指標</div>
      <div class="metric-grid">
        <div class="metric">
          <div class="metric-label">
            想定寿命（{{ metrics.lifeExpectancyAge }}歳）時残高<HelpIcon :text="HELP.finalAtLifeExpectancy" />
          </div>
          <div class="metric-value">{{ formatMan(metrics.finalTotalAtLifeExpectancy) }}</div>
        </div>
        <div class="metric">
          <div class="metric-label">目標残高との差分<HelpIcon :text="HELP.finalDelta" /></div>
          <div
            class="metric-value"
            :class="{
              'delta-surplus': metrics.finalStatus === 'surplus',
              'delta-shortage': metrics.finalStatus === 'shortage',
            }"
          >{{ (metrics.finalDelta >= 0 ? "+" : "") + formatMan(metrics.finalDelta) }}</div>
        </div>
        <div class="metric">
          <div class="metric-label">ゼロ着地判定<HelpIcon :text="HELP.finalStatus" /></div>
          <div class="metric-value">
            <span class="status-badge" :class="`status-${metrics.finalStatus}`">
              {{ statusLabel[metrics.finalStatus] }}
            </span>
          </div>
        </div>
      </div>
      <p v-if="metrics.finalStatus === 'shortage'" class="shortage-hint">
        ※ 最低月額（No-Go 期の床）と最終残高目標を同時に達成できない可能性があります。
        床を下げる / 最終残高目標を下げる / 想定寿命を縮める のいずれかを試してください。
      </p>
    </template>
  </section>
</template>

<style scoped>
.metrics-detail {
  margin-bottom: 16px;
  padding-top: 12px;
  border-top: 1px solid var(--border);
  opacity: 0.92;
}

.metrics-detail-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--muted);
  margin-bottom: 8px;
}

.die-with-zero-label {
  margin-top: 16px;
}

.delta-surplus {
  color: var(--warn, #d97706);
}

.delta-shortage {
  color: var(--danger, #dc2626);
}

.status-badge {
  display: inline-block;
  padding: 2px 10px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  line-height: 1.6;
}

.status-near-zero {
  background: rgba(16, 185, 129, 0.12);
  color: #059669;
}

.status-surplus {
  background: rgba(217, 119, 6, 0.12);
  color: #d97706;
}

.status-shortage {
  background: rgba(220, 38, 38, 0.12);
  color: #dc2626;
}

.shortage-hint {
  margin: 8px 0 0;
  padding: 8px 12px;
  font-size: 12px;
  line-height: 1.5;
  color: #b91c1c;
  background: rgba(220, 38, 38, 0.06);
  border-left: 3px solid var(--danger, #dc2626);
  border-radius: 4px;
}
</style>
