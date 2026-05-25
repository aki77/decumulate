<script setup lang="ts">
import { computed } from "vue";
import type { MonthlyProjection, CalculateParams } from "../../calculate.ts";
import HelpIcon from "./HelpIcon.vue";
import { toMan, formatMan, formatPercent } from "../format.ts";

const props = defineProps<{
  monthly: MonthlyProjection[];
  params: CalculateParams;
}>();

function formatMonthlyGain(yen: number): string {
  if (!Number.isFinite(yen)) return "-";
  const sign = Math.round(toMan(yen)) > 0 ? "+" : "";
  return `${sign}${formatMan(yen)}`;
}

// 防衛資産の月次損益は通常 1万円未満で、formatMan の整数丸めでは "0万円" に潰れて情報が失われる。
// 絶対値が 1万円未満のときだけ小数 1 桁で表示する。
function formatMonthlyGainFine(yen: number): string {
  if (!Number.isFinite(yen)) return "-";
  const man = toMan(yen);
  if (Math.abs(man) < 1) {
    const rounded = Math.round(man * 10) / 10;
    if (rounded === 0) return "0.0万円";
    return `${rounded > 0 ? "+" : ""}${rounded.toFixed(1)}万円`;
  }
  return formatMonthlyGain(yen);
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
}

interface BaseInfo {
  summary: string;
  formula: string | null;
  pension: number;
  other: number;
  netWithdrawal: number;
  total: number;
}

interface YearEvents {
  nisaTransfer: boolean;
  rebalance: boolean;
  idecoLumpSum: boolean;
  idecoPension: boolean;
  lifeEvent: boolean;
}

interface YearGroup {
  year: number;
  age: number | null;
  rows: DisplayRow[];
  yearlyGain: number;
  yearlyRate: number;
  yearBand: RateBand;
  base: BaseInfo | null;
  yearEvents: YearEvents;
}

const YEAR_EVENT_BADGES = [
  { key: "nisaTransfer" as keyof YearEvents, symbol: "▲", label: "NISA振替", kind: "transfer", tip: "NISA振替あり" },
  { key: "rebalance" as keyof YearEvents, symbol: "●", label: "リバランス", kind: "rebalance", tip: "リバランスあり" },
  { key: "idecoLumpSum" as keyof YearEvents, symbol: "■", label: "iDeCo一時金", kind: "ideco-lump", tip: "iDeCo 一時金あり" },
  { key: "idecoPension" as keyof YearEvents, symbol: "◆", label: "iDeCo年金", kind: "ideco-pension", tip: "iDeCo 年金あり" },
  { key: "lifeEvent" as keyof YearEvents, symbol: "★", label: "ライフイベント", kind: "life-event", tip: "ライフイベントあり" },
] as const;

const showIdeco = computed(() => props.params.idecoEnabled);
const riskColspan = computed(() => showIdeco.value ? 5 : 4);

const yearGroups = computed<YearGroup[]>(() => {
  const { monthly, params } = props;
  if (monthly.length === 0) return [];

  const byYear = new Map<number, DisplayRow[]>();
  for (const m of monthly) {
    const row: DisplayRow = {
      src: m,
      riskCombined: m.monthlyGainRisk + m.monthlyGainIdeco,
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
    let base: BaseInfo | null = null;
    if (first.baseWithdrawal > 0) {
      const pension = first.monthlyPension;
      const other = first.monthlyOtherIncome;
      const total = first.baseWithdrawal;
      const netWithdrawal = total - pension - other;
      const isRateMode = params.withdrawalMode === "rate" || params.withdrawalMode === "rate-risk";
      let formula: string | null = null;
      if (isRateMode && first.rateWithdrawalBasis != null) {
        const basisLabel = params.withdrawalMode === "rate-risk" ? "リスク資産" : "総資産";
        formula = `${basisLabel} ${formatMan(first.rateWithdrawalBasis)} × ${params.withdrawalRate}% / 12 = ${formatMan(first.baseWithdrawal)}`;
      }
      base = { summary: formatMan(total), formula, pension, other, netWithdrawal, total };
    }
    const yearEvents: YearEvents = { nisaTransfer: false, rebalance: false, idecoLumpSum: false, idecoPension: false, lifeEvent: false };
    for (const r of rows) {
      if (r.src.nisaTransferInfo != null) yearEvents.nisaTransfer = true;
      if (r.src.rebalanceInfo != null) yearEvents.rebalance = true;
      if (r.src.idecoLumpSumInfo != null) yearEvents.idecoLumpSum = true;
      if (r.src.idecoPensionInfo != null) yearEvents.idecoPension = true;
      if (r.src.lifeEventInfo != null) yearEvents.lifeEvent = true;
    }
    groups.push({ year, age, rows, yearlyGain, yearlyRate, yearBand, base, yearEvents });
  }
  return groups;
});
</script>

<template>
  <template v-for="g in yearGroups" :key="g.year">
    <details class="monthly-year">
      <summary>
        {{ g.age != null ? `${g.year}年目 / ${g.age}歳` : `${g.year}年目` }}
        <template v-for="b in YEAR_EVENT_BADGES" :key="b.key">
          <span v-if="g.yearEvents[b.key]" class="event-badge year-event-badge" :data-kind="b.kind" tabindex="0" :aria-label="b.label">{{ b.symbol }}<span class="event-tip">{{ b.tip }}</span></span>
        </template>
        <template v-if="g.base">
          <span class="year-summary">
            合計生活費 {{ g.base.summary }}
            <HelpIcon ariaLabel="内訳" compact><template v-if="g.base.formula">{{ g.base.formula }}</template><template v-else>資産取り崩し目標: {{ formatMan(g.base.total) }}</template><template v-if="g.base.pension > 0"><br>年金: {{ formatMan(g.base.pension) }}</template><template v-if="g.base.other > 0"><br>その他収入: {{ formatMan(g.base.other) }}</template><template v-if="g.base.pension > 0 || g.base.other > 0"><br>資産取り崩し: {{ formatMan(g.base.netWithdrawal) }}<br>合計: {{ formatMan(g.base.total) }}</template></HelpIcon>
          </span>
          {{ ' ' }}
        </template>
        <span class="year-summary">年合計運用損益 {{ formatMonthlyGain(g.yearlyGain) }}</span>
        {{ ' ' }}
        <span class="year-summary year-rate" :data-rate-band="g.yearBand">
          年率 {{ formatRate(g.yearlyRate) }}
          <HelpIcon
            text="資産全体（リスク資産 + 防衛資産）に対する年複利率。12ヶ月の月率を複利合成した値。"
            ariaLabel="年率の基準"
            compact
          />
        </span>
      </summary>
      <table class="monthly-table">
        <thead>
          <tr>
            <th rowspan="2">月</th>
            <th :colspan="riskColspan" class="group-header group-risk">リスク資産</th>
            <th colspan="2" class="group-header group-defense">防衛資産</th>
            <th rowspan="2">合計</th>
            <th colspan="3" class="group-header group-cashflow">キャッシュフロー</th>
            <th rowspan="2">
              月率
              <HelpIcon
                text="資産全体（リスク資産 + 防衛資産）に対する月次損益率。"
                ariaLabel="月率の基準"
                compact
              />
            </th>
            <th rowspan="2">イベント</th>
          </tr>
          <tr>
            <th>特定リスク</th><th>NISA</th><th v-if="showIdeco">iDeCo</th><th>リスク計</th><th>リスク損益</th>
            <th>防衛額</th><th>防衛損益</th>
            <th>純引出</th><th>年金</th><th>他収入</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in g.rows" :key="row.src.month">
            <td>{{ row.src.month }}月</td>
            <td>
              {{ formatMan(row.src.taxableRiskTotal) }}
              <span v-if="row.src.total > 0" class="cell-sub">({{ formatPercent(row.src.taxableRiskTotal / row.src.total) }})</span>
            </td>
            <td>
              {{ formatMan(row.src.nisaTotal) }}
              <span v-if="row.src.total > 0" class="cell-sub">({{ formatPercent(row.src.nisaTotal / row.src.total) }})</span>
            </td>
            <td v-if="showIdeco">
              {{ formatMan(row.src.idecoTotal) }}
              <span v-if="row.src.total > 0" class="cell-sub">({{ formatPercent(row.src.idecoTotal / row.src.total) }})</span>
            </td>
            <td>
              {{ formatMan(row.src.riskTotal) }}
              <span v-if="row.src.total > 0" class="cell-sub">({{ formatPercent(row.src.riskTotal / row.src.total) }})</span>
            </td>
            <td :class="row.riskCombined < 0 ? 'neg' : ''">
              {{ formatMonthlyGain(row.riskCombined) }}
              <span class="cell-sub-inline">({{ formatRate(row.src.monthlyRateRisk) }})</span>
              <HelpIcon
                ariaLabel="リスク損益内訳"
              >リスク資産の月次運用損益（取り崩し・リバランス・積立は含まない）<br>NISA: {{ formatMonthlyGain(row.src.monthlyGainNisa) }}<br>特定リスク: {{ formatMonthlyGain(row.src.monthlyGainTaxableRisk) }}<template v-if="row.src.idecoTotal > 0"><br>iDeCo: {{ formatMonthlyGain(row.src.monthlyGainIdeco) }}</template><br>月率 {{ formatRate(row.src.monthlyRateRisk) }}（リスク資産 = NISA + 特定リスク<template v-if="row.src.idecoTotal > 0"> + iDeCo</template> に対する月次損益率）</HelpIcon>
            </td>
            <td>
              {{ formatMan(row.src.defenseTotal) }}
              <span v-if="row.src.total > 0" class="cell-sub">({{ formatPercent(row.src.defenseTotal / row.src.total) }})</span>
            </td>
            <td :class="row.src.monthlyGainDefense < 0 ? 'neg' : ''">
              {{ formatMonthlyGainFine(row.src.monthlyGainDefense) }}
              <HelpIcon
                v-if="row.src.monthlyWithdrawalDefense > 0 || row.src.rebalanceInfo"
                ariaLabel="防衛損益内訳"
              >防衛資産の月次運用損益（取り崩し・リバランスは含まない）<br>運用損益: {{ formatMonthlyGain(row.src.monthlyGainDefense) }}<template v-if="row.src.monthlyWithdrawalDefense > 0"><br>取り崩し: -{{ formatMan(row.src.monthlyWithdrawalDefense) }}<template v-if="row.src.monthlyWithdrawalTaxDefense > 0"> (税 {{ formatMan(row.src.monthlyWithdrawalTaxDefense) }})</template></template><template v-if="row.src.rebalanceInfo"><br><template v-if="row.src.rebalanceInfo.direction === 'risk-to-defense'">リバランス買付: +{{ formatMan(row.src.rebalanceInfo.proceeds) }}</template><template v-else>リバランス売却: -{{ formatMan(row.src.rebalanceInfo.sellAmount) }} (税 {{ formatMan(row.src.rebalanceInfo.taxAmount) }})</template></template></HelpIcon>
            </td>
            <td>{{ formatMan(row.src.total) }}</td>
            <td>
              {{ formatMan(row.src.monthlyWithdrawal) }}
              <HelpIcon
                v-if="row.src.monthlyWithdrawalTaxableRisk > 0 || row.src.monthlyWithdrawalNisa > 0 || row.src.monthlyWithdrawalDefense > 0"
                ariaLabel="純引出内訳"
              ><template v-if="row.src.monthlyWithdrawalTaxableRisk > 0">特定リスク: {{ formatMan(row.src.monthlyWithdrawalTaxableRisk) }}<template v-if="row.src.monthlyWithdrawalTaxTaxableRisk > 0"> (税 {{ formatMan(row.src.monthlyWithdrawalTaxTaxableRisk) }})</template></template><template v-if="row.src.monthlyWithdrawalNisa > 0"><br v-if="row.src.monthlyWithdrawalTaxableRisk > 0">NISA: {{ formatMan(row.src.monthlyWithdrawalNisa) }}</template><template v-if="row.src.monthlyWithdrawalDefense > 0"><br v-if="row.src.monthlyWithdrawalTaxableRisk > 0 || row.src.monthlyWithdrawalNisa > 0">防衛: {{ formatMan(row.src.monthlyWithdrawalDefense) }}<template v-if="row.src.monthlyWithdrawalTaxDefense > 0"> (税 {{ formatMan(row.src.monthlyWithdrawalTaxDefense) }})</template></template></HelpIcon>
            </td>
            <td>{{ formatMan(row.src.monthlyPension) }}</td>
            <td>{{ formatMan(row.src.monthlyOtherIncome) }}</td>
            <td class="monthly-rate" :data-rate-band="classifyRateBand(row.src.monthlyRate, false)">{{ formatRate(row.src.monthlyRate) }}</td>
            <td>
              <template v-if="row.src.nisaTransferInfo">
                <span class="event-badge" data-kind="transfer" tabindex="0" aria-label="NISA振替">▲<span class="event-tip">特定 → NISA 振替<br>売却額 {{ formatMan(row.src.nisaTransferInfo.sellAmount) }}<br>税額 {{ formatMan(row.src.nisaTransferInfo.taxAmount) }}<br>NISA買付 {{ formatMan(row.src.nisaTransferInfo.proceeds) }}</span></span>
              </template>
              <template v-if="row.src.rebalanceInfo">
                <span class="event-badge" data-kind="rebalance" :data-direction="row.src.rebalanceInfo.direction" tabindex="0" :aria-label="row.src.rebalanceInfo.direction === 'risk-to-defense' ? 'リスク → 防衛' : '防衛 → リスク'">●<span class="event-tip"><template v-if="row.src.rebalanceInfo.direction === 'risk-to-defense'">リスク → 防衛</template><template v-else>防衛 → リスク</template><br>売却額 {{ formatMan(row.src.rebalanceInfo.sellAmount) }}<br>税額 {{ formatMan(row.src.rebalanceInfo.taxAmount) }}<br>受取額 {{ formatMan(row.src.rebalanceInfo.proceeds) }}<template v-if="row.src.rebalanceInfo.nisaUsed > 0"><br>うちNISA枠充当 {{ formatMan(row.src.rebalanceInfo.nisaUsed) }}</template></span></span>
              </template>
              <template v-if="row.src.idecoLumpSumInfo">
                <span class="event-badge" data-kind="ideco-lump" tabindex="0" aria-label="iDeCo一時金">■<span class="event-tip">iDeCo 一時金受取<br>受取総額 {{ formatMan(row.src.idecoLumpSumInfo.grossAmount) }}<br>税額 {{ formatMan(row.src.idecoLumpSumInfo.taxAmount) }}<br>特定リスクへ {{ formatMan(row.src.idecoLumpSumInfo.proceeds) }}</span></span>
              </template>
              <template v-if="row.src.idecoPensionInfo">
                <span class="event-badge" data-kind="ideco-pension" tabindex="0" aria-label="iDeCo年金">◆<span class="event-tip">iDeCo 年金受取<br>受取総額 {{ formatMan(row.src.idecoPensionInfo.grossAmount) }}<br>税額 {{ formatMan(row.src.idecoPensionInfo.taxAmount) }}<br>税引後 {{ formatMan(row.src.idecoPensionInfo.proceeds) }}</span></span>
              </template>
              <template v-if="row.src.lifeEventInfo">
                <span class="event-badge" data-kind="life-event" tabindex="0" :aria-label="`ライフイベント: ${row.src.lifeEventInfo.label}`">★<span class="event-tip">ライフイベント<br>{{ row.src.lifeEventInfo.label }}<br>金額 {{ formatMan(row.src.lifeEventInfo.amount) }}</span></span>
              </template>
            </td>
          </tr>
        </tbody>
      </table>
    </details>
  </template>
</template>

<style scoped>
.monthly-year {
  border-top: 1px dashed var(--border);
  padding: 6px 0;
}

.monthly-year > summary {
  cursor: pointer;
  font-size: 13px;
  padding: 4px 0;
  color: var(--text);
}

.year-event-badge {
  margin-left: 4px;
}

.year-summary {
  color: var(--muted);
  font-weight: 400;
  margin-left: 8px;
  font-size: 12px;
}

.year-summary.year-rate[data-rate-band="pos-strong"] {
  color: var(--success);
  font-weight: 600;
}
.year-summary.year-rate[data-rate-band="pos"] {
  color: var(--success);
}
.year-summary.year-rate[data-rate-band="neg"] {
  color: var(--danger);
}
.year-summary.year-rate[data-rate-band="neg-strong"] {
  color: var(--danger);
  font-weight: 600;
}

.monthly-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
  margin-top: 6px;
  font-variant-numeric: tabular-nums;
}

.monthly-table th,
.monthly-table td {
  border-bottom: 1px solid var(--border);
  padding: 4px 8px;
  text-align: right;
  white-space: nowrap;
}

.monthly-table th:first-child,
.monthly-table td:first-child {
  text-align: left;
}

.monthly-table th {
  font-weight: 600;
  color: var(--muted);
  background: transparent;
}

.monthly-table td.neg {
  color: var(--danger);
}

.monthly-table td.monthly-rate {
  font-variant-numeric: tabular-nums;
  font-weight: 600;
}

.monthly-table td[data-rate-band="pos-strong"] {
  background: var(--rate-pos-strong-bg);
}
.monthly-table td[data-rate-band="pos"] {
  background: var(--rate-pos-bg);
}
.monthly-table td[data-rate-band="neg"] {
  background: var(--rate-neg-bg);
  color: var(--danger);
}
.monthly-table td[data-rate-band="neg-strong"] {
  background: var(--rate-neg-strong-bg);
  color: var(--danger);
}

.monthly-table .cell-sub,
.monthly-table .cell-sub-inline {
  font-size: 0.85em;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}

.monthly-table .cell-sub {
  display: block;
  line-height: 1.1;
  margin-top: 1px;
}

.monthly-table .cell-sub-inline {
  margin-left: 2px;
}

.monthly-table th.group-header {
  text-align: center;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.06em;
  border-bottom: none;
  padding-bottom: 2px;
}

.monthly-table th.group-risk {
  background: color-mix(in srgb, var(--accent) 8%, transparent);
  color: var(--accent);
}

.monthly-table th.group-defense {
  background: color-mix(in srgb, var(--warn) 8%, transparent);
  color: var(--warn);
}

.monthly-table th.group-cashflow {
  background: color-mix(in srgb, var(--muted) 8%, transparent);
  color: var(--muted);
}

.event-badge {
  position: relative;
  display: inline-block;
  cursor: help;
  font-weight: 700;
  user-select: none;
  margin-right: 2px;
}

.event-badge[data-kind="transfer"] {
  color: #16a34a;
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
