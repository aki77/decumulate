<script setup lang="ts">
import { computed } from "vue";
import HelpIcon from "./HelpIcon.vue";
import { NISA_LIFETIME_LIMIT } from "../../calculate.ts";
import type { YearlyProjection } from "../../calculate.ts";
import type { MonteCarloResult } from "../../monte-carlo.ts";
import type { CalculateParams } from "../../calculate.ts";

const props = defineProps<{
  yearly: YearlyProjection[];
  mc: MonteCarloResult;
  params: CalculateParams;
  score: number;
  scoreClassName: string;
  scoreLabel: string;
}>();

const HELP: Record<string, string> = {
  score: "枯渇確率・元本割れ確率・中央値残高から算出した 0–100 の総合指標。高いほど安心。",
  totalContrib: "初期投資額 + 月額積立 × 12 × 積立年数。自身が拠出した元本の合計。",
  finalTotal: "シミュレーション最終年の名目資産（インフレ調整なし）。",
  interest: "最終時点の元本超過分（運用益）。非課税口座でない場合は税金控除済み。",
  tax: "特定口座を想定した含み益への課税（20.315%）の累計概算。",
  totalWithdrawn: "取り崩し期間中に引き出した金額の合計（名目値）。",
  mcP50: "モンテカルロ 5,000 試行の最終資産分布の中央値。インフレ控除後の購買力ベース。",
  mcP10: "最終資産分布の下位 10% タイル。下振れシナリオの目安。",
  mcP90: "最終資産分布の上位 10% タイル。上振れシナリオの目安。",
  depletion: "取り崩し期間中に資産がゼロになる試行の割合。",
  failure: "最終資産が積立元本合計を下回る試行の割合。",
  finalNisa: "シミュレーション最終年のNISA口座残高（時価, 名目値）。NISAは非課税のため、取り崩しを最後に回すと有利。",
  nisaUsage: "NISA生涯枠（1人1800万 / 夫婦3600万）のうち、買付額ベースで何%を使ったか。",
  idecoTotal: "シミュレーション最終年のiDeCo残高（時価, 名目値）。受取開始後は減少していく。",
  idecoLumpSum: "受取開始月に一時金として受け取った税引後合計（特定リスクに移管済み）。",
  idecoPension: "iDeCo年金受取の累計（税引後）。月次取り崩しの支出に充当される。",
};

const toMan = (v: number) => v / 10000;

function formatMan(yen: number): string {
  if (!Number.isFinite(yen)) return "-";
  return `${Math.round(toMan(yen)).toLocaleString("ja-JP", { maximumFractionDigits: 0 })}万円`;
}

function formatPercent(v: number): string {
  if (!Number.isFinite(v)) return "-";
  return `${(v * 100).toFixed(1)}%`;
}

const metrics = computed(() => {
  const { yearly, mc, params } = props;
  const last = yearly[yearly.length - 1]!;
  const initialTotal = params.initialNisa + params.initialTaxableRisk + params.initialDefense;
  const totalContrib = initialTotal + params.monthlyContribution * 12 * params.contributionYears;
  const totalWithdrawn = yearly.reduce((s, p) => s + p.yearlyWithdrawal, 0);
  const totalIdecoLumpSum = yearly.reduce((s, p) => s + p.yearlyIdecoLumpSum, 0);
  const totalIdecoPension = yearly.reduce((s, p) => s + p.yearlyIdecoPension, 0);
  const nisaLifetimeLimit = params.isCoupled ? NISA_LIFETIME_LIMIT * 2 : NISA_LIFETIME_LIMIT;
  const nisaLifetimeUsageRatio = nisaLifetimeLimit > 0 ? last.nisaLifetimeUsed / nisaLifetimeLimit : 0;
  return { last, totalContrib, totalWithdrawn, totalIdecoLumpSum, totalIdecoPension, nisaLifetimeUsageRatio };
});
</script>

<template>
  <div class="summary">
    <div :class="`score-card ${scoreClassName}`">
      <div class="score-value">{{ score }}</div>
      <div class="score-label">{{ scoreLabel }}</div>
      <div class="score-desc">
        安心度スコア（0–100）<HelpIcon :text="HELP['score']!" />
      </div>
    </div>
    <div class="metric-grid">
      <div class="metric">
        <div class="metric-label">積立元本合計<HelpIcon :text="HELP['totalContrib']!" /></div>
        <div class="metric-value">{{ formatMan(metrics.totalContrib) }}</div>
      </div>
      <div class="metric">
        <div class="metric-label">最終総資産（名目）<HelpIcon :text="HELP['finalTotal']!" /></div>
        <div class="metric-value">{{ formatMan(metrics.last.total) }}</div>
      </div>
      <div class="metric">
        <div class="metric-label">運用益（税引後）<HelpIcon :text="HELP['interest']!" /></div>
        <div class="metric-value">{{ formatMan(metrics.last.interest) }}</div>
      </div>
      <div class="metric">
        <div class="metric-label">想定税金<HelpIcon :text="HELP['tax']!" /></div>
        <div class="metric-value">{{ formatMan(metrics.last.tax) }}</div>
      </div>
      <div class="metric">
        <div class="metric-label">総引出額（名目）<HelpIcon :text="HELP['totalWithdrawn']!" /></div>
        <div class="metric-value">{{ formatMan(metrics.totalWithdrawn) }}</div>
      </div>
      <div class="metric">
        <div class="metric-label">最終 NISA 残高<HelpIcon :text="HELP['finalNisa']!" /></div>
        <div class="metric-value">{{ formatMan(metrics.last.nisaTotal) }}</div>
      </div>
      <div class="metric">
        <div class="metric-label">NISA 生涯枠使用率<HelpIcon :text="HELP['nisaUsage']!" /></div>
        <div class="metric-value">{{ formatPercent(metrics.nisaLifetimeUsageRatio) }}</div>
      </div>
      <div class="metric">
        <div class="metric-label">最終 iDeCo 残高<HelpIcon :text="HELP['idecoTotal']!" /></div>
        <div class="metric-value">{{ formatMan(metrics.last.idecoTotal) }}</div>
      </div>
      <div class="metric">
        <div class="metric-label">iDeCo 一時金累計<HelpIcon :text="HELP['idecoLumpSum']!" /></div>
        <div class="metric-value">{{ formatMan(metrics.totalIdecoLumpSum) }}</div>
      </div>
      <div class="metric">
        <div class="metric-label">iDeCo 年金累計<HelpIcon :text="HELP['idecoPension']!" /></div>
        <div class="metric-value">{{ formatMan(metrics.totalIdecoPension) }}</div>
      </div>
      <div class="metric">
        <div class="metric-label">MC 中央値残高（実質）<HelpIcon :text="HELP['mcP50']!" /></div>
        <div class="metric-value">{{ formatMan(mc.finalP50) }}</div>
      </div>
      <div class="metric">
        <div class="metric-label">MC 悲観値 p10（実質）<HelpIcon :text="HELP['mcP10']!" /></div>
        <div class="metric-value">{{ formatMan(mc.finalP10) }}</div>
      </div>
      <div class="metric">
        <div class="metric-label">MC 楽観値 p90（実質）<HelpIcon :text="HELP['mcP90']!" /></div>
        <div class="metric-value">{{ formatMan(mc.finalP90) }}</div>
      </div>
      <div class="metric">
        <div class="metric-label">枯渇確率<HelpIcon :text="HELP['depletion']!" /></div>
        <div class="metric-value">{{ formatPercent(mc.depletionProbability) }}</div>
      </div>
      <div class="metric">
        <div class="metric-label">元本割れ確率<HelpIcon :text="HELP['failure']!" /></div>
        <div class="metric-value">{{ formatPercent(mc.failureProbability) }}</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.summary {
  display: grid;
  grid-template-columns: minmax(160px, 220px) 1fr;
  gap: 16px;
  margin-bottom: 24px;
}

@media (max-width: 700px) {
  .summary {
    grid-template-columns: 1fr;
  }
}

.score-card {
  border-radius: 12px;
  padding: 18px;
  text-align: center;
  display: flex;
  flex-direction: column;
  justify-content: center;
  border: 1px solid var(--border);
}

.score-value {
  font-size: 48px;
  font-weight: 700;
  line-height: 1;
}

.score-label {
  font-size: 15px;
  font-weight: 600;
  margin-top: 4px;
}

.score-desc {
  font-size: 11px;
  color: var(--muted);
  margin-top: 4px;
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

.score-card :deep(.help-icon) {
  background: rgba(255, 255, 255, 0.4);
  color: inherit;
}

.metric-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 10px;
}

.metric {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 10px 12px;
}

.metric-label {
  font-size: 11px;
  color: var(--muted);
  margin-bottom: 2px;
  display: flex;
  align-items: center;
  gap: 2px;
}

.metric-value {
  font-size: 16px;
  font-weight: 600;
}
</style>
