<script setup lang="ts">
import HelpIcon from "./HelpIcon.vue";
import { useMetrics } from "../composables/useMetrics.ts";
import { formatMan, formatPercent } from "../format.ts";
import type { YearlyProjection, CalculateParams } from "../../calculate.ts";
import type { MonteCarloResult } from "../../monte-carlo.ts";

const props = defineProps<{
  yearly: YearlyProjection[];
  mc: MonteCarloResult;
  params: CalculateParams;
}>();

const HELP = {
  totalContrib: "初期投資額 + 月額積立 × 12 × 積立年数。自身が拠出した元本の合計。",
  tax: "特定口座を想定した含み益への課税（20.315%）の累計概算。",
  mcP10: "最終資産分布の下位 10% タイル。下振れシナリオの目安。",
  mcP90: "最終資産分布の上位 10% タイル。上振れシナリオの目安。",
  finalNisa: "シミュレーション最終年のNISA口座残高（時価, 名目値）。NISAは非課税のため、取り崩しを最後に回すと有利。",
  nisaUsage: "NISA生涯枠（1人1800万 / 夫婦3600万）のうち、買付額ベースで何%を使ったか。",
  idecoTotal: "シミュレーション最終年のiDeCo残高（時価, 名目値）。受取開始後は減少していく。",
  idecoLumpSum:
    "受取開始月に一時金として受け取った税引後合計（特定リスクに移管済み）。退職所得控除は iDeCo の拠出年数で計算しており、退職金との受給間隔ルール（2026年改正で 5年→10年、退職金先行は 19年）は厳密にはモデル化していない。退職金を別途受給する会社員の場合、実際の税額はこれより高くなる可能性がある。",
  idecoPension:
    "iDeCo年金受取の累計（税引後）。月次取り崩しの支出に充当される。公的年金等控除は公的年金とiDeCo年金の合算枠で計算する（2025年改正後の速算表ベース）。",
  maxDDp50:
    "取り崩し開始月以降の総資産（NISA + 特定 + 防衛 + iDeCo, 実質）のピークからの最大下落率。N=5000 パスの中央値。心理的耐性 / bond tent 戦略の判断材料に使う。",
  maxDDp90:
    "上位 10% タイル（最も深いドローダウン側）。悲観シナリオで耐える必要がある含み損の目安。",
  maxDDp10:
    "下位 10% タイル（最も浅いドローダウン側）。順風シナリオでの下落幅。",
} as const;

const metrics = useMetrics(() => props.yearly, () => props.params);
</script>

<template>
  <details class="metrics-detail">
    <summary>詳細メトリクス</summary>
    <div class="metric-grid">
      <div class="metric">
        <div class="metric-label">積立元本合計<HelpIcon :text="HELP.totalContrib" /></div>
        <div class="metric-value">{{ formatMan(metrics.totalContrib) }}</div>
      </div>
      <div class="metric">
        <div class="metric-label">想定税金<HelpIcon :text="HELP.tax" /></div>
        <div class="metric-value">{{ formatMan(metrics.last.tax) }}</div>
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
        <div class="metric-label">最終 iDeCo 残高<HelpIcon :text="HELP.idecoTotal" /></div>
        <div class="metric-value">{{ formatMan(metrics.last.idecoTotal) }}</div>
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
    </div>
  </details>
</template>

<style scoped>
.metrics-detail {
  margin-bottom: 16px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel);
}

.metrics-detail > summary {
  cursor: pointer;
  padding: 10px 14px;
  font-size: 13px;
  font-weight: 600;
  color: var(--muted);
  user-select: none;
}

.metrics-detail[open] > summary {
  border-bottom: 1px solid var(--border);
}

.metrics-detail .metric-grid {
  padding: 12px 14px;
}
</style>
