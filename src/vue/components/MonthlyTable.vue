<script setup lang="ts">
import { computed } from "vue";
import type { MonthlyProjection, CalculateParams } from "../../calculate.ts";
import HelpIcon from "./HelpIcon.vue";

const props = defineProps<{
  monthly: MonthlyProjection[];
  params: CalculateParams;
}>();

const toMan = (v: number) => v / 10000;

function formatMan(yen: number): string {
  if (!Number.isFinite(yen)) return "-";
  return `${Math.round(toMan(yen)).toLocaleString("ja-JP", { maximumFractionDigits: 0 })}万円`;
}

function formatPercent(v: number): string {
  if (!Number.isFinite(v)) return "-";
  return `${(v * 100).toFixed(1)}%`;
}

function formatMonthlyGain(yen: number): string {
  if (!Number.isFinite(yen)) return "-";
  const sign = Math.round(toMan(yen)) > 0 ? "+" : "";
  return `${sign}${formatMan(yen)}`;
}

type RateBand = "pos-strong" | "pos" | "flat" | "neg" | "neg-strong";

function classifyRateBand(rate: number, isAnnual: boolean): RateBand {
  if (!Number.isFinite(rate)) return "flat";
  const strong = isAnnual ? 0.18 : 0.015;
  const weak = isAnnual ? 0.06 : 0.005;
  if (rate >= strong) return "pos-strong";
  if (rate >= weak) return "pos";
  if (rate > -weak) return "flat";
  if (rate > -strong) return "neg";
  return "neg-strong";
}

function formatRate(rate: number): string {
  if (!Number.isFinite(rate)) return "-";
  const sign = rate > 0 ? "+" : "";
  return `${sign}${(rate * 100).toFixed(2)}%`;
}

interface DisplayRow {
  src: MonthlyProjection;
  riskCombined: number;
  riskBreakdownHtml: string;
}

interface YearGroup {
  year: number;
  age: number | null;
  rows: DisplayRow[];
  yearlyGain: number;
  yearlyRate: number;
  yearBand: RateBand;
  baseStr: string | null;
}

function buildRiskBreakdownHtml(r: MonthlyProjection): string {
  const lines = [
    `NISA: ${formatMonthlyGain(r.monthlyGainNisa)}`,
    `特定リスク: ${formatMonthlyGain(r.monthlyGainTaxableRisk)}`,
  ];
  if (r.idecoTotal > 0) {
    lines.push(`iDeCo: ${formatMonthlyGain(r.monthlyGainIdeco)}`);
  }
  return lines.join("<br>");
}

const yearGroups = computed<YearGroup[]>(() => {
  const { monthly, params } = props;
  if (monthly.length === 0) return [];

  const byYear = new Map<number, DisplayRow[]>();
  for (const m of monthly) {
    const row: DisplayRow = {
      src: m,
      riskCombined: m.monthlyGainRisk + m.monthlyGainIdeco,
      riskBreakdownHtml: buildRiskBreakdownHtml(m),
    };
    const list = byYear.get(m.year);
    if (list) list.push(row);
    else byYear.set(m.year, [row]);
  }

  const groups: YearGroup[] = [];
  for (const [year, rows] of byYear) {
    const first = rows[0]!.src;
    const age = first.age;
    const yearlyGain = rows.reduce((s, r) => s + r.src.monthlyGain, 0);
    const yearlyRate = rows.reduce((acc, r) => acc * (1 + r.src.monthlyRate), 1) - 1;
    const yearBand = classifyRateBand(yearlyRate, true);
    let baseStr: string | null = null;
    if (first.baseWithdrawal > 0) {
      const pension = first.monthlyPension;
      const other = first.monthlyOtherIncome;
      const total = first.baseWithdrawal + pension + other;
      const isRateMode = params.withdrawalMode === "rate" || params.withdrawalMode === "rate-risk";
      const lines: string[] = [];
      if (isRateMode && first.rateWithdrawalBasis != null) {
        const basisLabel = params.withdrawalMode === "rate-risk" ? "リスク資産" : "総資産";
        lines.push(`${basisLabel} ${formatMan(first.rateWithdrawalBasis)} × ${params.withdrawalRate}% / 12 = ${formatMan(first.baseWithdrawal)}`);
      } else {
        lines.push(`資産取り崩し目標: ${formatMan(first.baseWithdrawal)}`);
      }
      if (pension > 0) lines.push(`年金: ${formatMan(pension)}`);
      if (other > 0) lines.push(`その他収入: ${formatMan(other)}`);
      if (pension > 0 || other > 0) lines.push(`合計: ${formatMan(total)}`);
      baseStr = `合計生活費 ${formatMan(total)}|${lines.join("<br>")}`;
    }
    groups.push({ year, age, rows, yearlyGain, yearlyRate, yearBand, baseStr });
  }
  return groups;
});
</script>

<template>
  <template v-for="g in yearGroups" :key="g.year">
    <details class="monthly-year">
      <summary>
        {{ g.age != null ? `${g.year}年目 / ${g.age}歳` : `${g.year}年目` }}
        <template v-if="g.baseStr">
          <span class="year-summary">
            合計生活費 {{ g.baseStr.split('|')[0] }}
            <span class="year-summary-help help-icon" tabindex="0" aria-label="内訳">?<span class="help-tip year-summary-tip" v-html="g.baseStr.split('|')[1]"></span></span>
          </span>
          {{ ' ' }}
        </template>
        <span class="year-summary">年合計運用損益 {{ formatMonthlyGain(g.yearlyGain) }}</span>
        {{ ' ' }}
        <span class="year-summary year-rate" :data-rate-band="g.yearBand">年率 {{ formatRate(g.yearlyRate) }}</span>
      </summary>
      <table class="monthly-table">
        <thead>
          <tr>
            <th>月</th><th>NISA</th><th>特定リスク</th><th>防衛資産</th><th>iDeCo</th><th>合計</th>
            <th>純引出</th><th>年金</th><th>他収入</th>
            <th>リスク損益</th><th>防衛損益</th><th>月率</th><th>イベント</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in g.rows" :key="row.src.month">
            <td>{{ row.src.month }}月</td>
            <td>
              {{ formatMan(row.src.nisaTotal) }}
              <span v-if="row.src.total > 0" class="cell-sub">({{ formatPercent(row.src.nisaTotal / row.src.total) }})</span>
            </td>
            <td>
              {{ formatMan(row.src.taxableRiskTotal) }}
              <span v-if="row.src.total > 0" class="cell-sub">({{ formatPercent(row.src.taxableRiskTotal / row.src.total) }})</span>
            </td>
            <td>
              {{ formatMan(row.src.defenseTotal) }}
              <span v-if="row.src.total > 0" class="cell-sub">({{ formatPercent(row.src.defenseTotal / row.src.total) }})</span>
            </td>
            <td>
              {{ formatMan(row.src.idecoTotal) }}
              <span v-if="row.src.total > 0" class="cell-sub">({{ formatPercent(row.src.idecoTotal / row.src.total) }})</span>
            </td>
            <td>{{ formatMan(row.src.total) }}</td>
            <td>{{ formatMan(row.src.monthlyWithdrawal) }}</td>
            <td>{{ formatMan(row.src.monthlyPension) }}</td>
            <td>{{ formatMan(row.src.monthlyOtherIncome) }}</td>
            <td :class="row.riskCombined < 0 ? 'neg' : ''">
              {{ formatMonthlyGain(row.riskCombined) }}
              <HelpIcon :text="row.riskBreakdownHtml" ariaLabel="リスク損益内訳" />
            </td>
            <td :class="row.src.monthlyGainDefense < 0 ? 'neg' : ''">{{ formatMonthlyGain(row.src.monthlyGainDefense) }}</td>
            <td class="monthly-rate" :data-rate-band="classifyRateBand(row.src.monthlyRate, false)">{{ formatRate(row.src.monthlyRate) }}</td>
            <td>
              <template v-if="row.src.nisaTransferInfo">
                <span class="transfer-badge" tabindex="0" aria-label="NISA振替">▲<span class="rebalance-tip" v-html="`特定 → NISA 振替<br>売却額 ${formatMan(row.src.nisaTransferInfo.sellAmount)}<br>税額 ${formatMan(row.src.nisaTransferInfo.taxAmount)}<br>NISA買付 ${formatMan(row.src.nisaTransferInfo.proceeds)}`"></span></span>
              </template>
              <template v-if="row.src.rebalanceInfo">
                <span class="rebalance-badge" :data-direction="row.src.rebalanceInfo.direction" tabindex="0" :aria-label="row.src.rebalanceInfo.direction === 'risk-to-defense' ? 'リスク → 防衛' : '防衛 → リスク'">●<span class="rebalance-tip" v-html="`${row.src.rebalanceInfo.direction === 'risk-to-defense' ? 'リスク → 防衛' : '防衛 → リスク'}<br>売却額 ${formatMan(row.src.rebalanceInfo.sellAmount)}<br>税額 ${formatMan(row.src.rebalanceInfo.taxAmount)}<br>受取額 ${formatMan(row.src.rebalanceInfo.proceeds)}${row.src.rebalanceInfo.nisaUsed > 0 ? '<br>うちNISA枠充当 ' + formatMan(row.src.rebalanceInfo.nisaUsed) : ''}`"></span></span>
              </template>
              <template v-if="row.src.idecoLumpSumInfo">
                <span class="ideco-lump-badge" tabindex="0" aria-label="iDeCo一時金">■<span class="rebalance-tip" v-html="`iDeCo 一時金受取<br>受取総額 ${formatMan(row.src.idecoLumpSumInfo.grossAmount)}<br>税額 ${formatMan(row.src.idecoLumpSumInfo.taxAmount)}<br>特定リスクへ ${formatMan(row.src.idecoLumpSumInfo.proceeds)}`"></span></span>
              </template>
              <template v-if="row.src.idecoPensionInfo">
                <span class="ideco-pension-badge" tabindex="0" aria-label="iDeCo年金">◆<span class="rebalance-tip" v-html="`iDeCo 年金受取<br>受取総額 ${formatMan(row.src.idecoPensionInfo.grossAmount)}<br>税額 ${formatMan(row.src.idecoPensionInfo.taxAmount)}<br>税引後 ${formatMan(row.src.idecoPensionInfo.proceeds)}`"></span></span>
              </template>
            </td>
          </tr>
        </tbody>
      </table>
    </details>
  </template>
</template>
