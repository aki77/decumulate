<script setup lang="ts">
import { computed } from "vue";
import HelpIcon from "./HelpIcon.vue";
import InputNumber from "./InputNumber.vue";
import type { ParamsState } from "../composables/useParams.ts";

const state = defineModel<ParamsState>({ required: true });

defineProps<{
  isComputingSwr: boolean;
  isComputingZeroLanding: boolean;
}>();

const isRateMode = computed(
  () =>
    state.value.withdrawalMode === "rate" ||
    state.value.withdrawalMode === "rate-risk" ||
    state.value.withdrawalMode === "rate-guardrail",
);
const isGuardrailMode = computed(() => state.value.withdrawalMode === "rate-guardrail");
const isDieWithZero = computed(() => state.value.withdrawalMode === "zero-landing");
const showLimitTable = computed(() => isRateMode.value || isDieWithZero.value);
const lifeExpectancyAge = computed(
  () => state.value.currentAge + state.value.withdrawalStartYear + state.value.withdrawalYears,
);

defineEmits<{
  addLimitStep: [];
  removeLimitStep: [idx: number];
  requestSwr: [];
  requestZeroLanding: [];
}>();
</script>

<template>
  <div class="field-group">
    <h3>取り崩し</h3>
    <div class="field field--full">
      <label for="withdrawalMode">
        取り崩しモード
        <HelpIcon text="「月額」は毎月一定額を引き出す方式。「年率（Trinity Study）」は初年度資産にかかる%を毎年インフレ調整。「年率×リスク資産」は毎年初にその時点のリスク資産に率をかけて月額を再計算（資産変動に追従、インフレ調整なし）。「Guyton-Klinger」は毎年インフレ調整した上で、当年の引出率が初期率の±20%を超えたら引出額を±10%調整する（固定%より枯渇を抑え、固定額より生活水準を維持）。" />
      </label>
      <select id="withdrawalMode" v-model="state.withdrawalMode">
        <option value="amount">月額で指定</option>
        <option value="rate">年率（%）で指定（Trinity Study）</option>
        <option value="rate-risk">年率（%）×リスク資産で毎年再評価</option>
        <option value="rate-guardrail">年率（%）Guyton-Klinger ガードレール</option>
        <option value="zero-landing">DIE WITH ZERO（ゼロ着地）</option>
      </select>
    </div>
    <div v-if="isDieWithZero" class="die-with-zero-info">
      想定寿命 = {{ lifeExpectancyAge }} 歳
      <span class="hint-aside">（現在年齢 + 切崩開始 + 切崩年数）</span>
    </div>
    <div v-if="!isRateMode && !isDieWithZero" class="field">
      <label for="fixedMonthlyWithdrawal">月額生活費（万円）</label>
      <InputNumber id="fixedMonthlyWithdrawal" v-model="state.fixedMonthlyWithdrawalMan" min="0" step="1" />
    </div>
    <template v-if="isDieWithZero">
      <div class="field">
        <label for="fixedMonthlyWithdrawal">
          Go-Go 期月額（万円）
          <HelpIcon text="取り崩し開始時点の基準月額。リスクサイド資産の変動に連動して毎年自動調整され、下限・上限の範囲内で動的に変化します。「ゼロ着地」ボタンで、最終残高目標に着地する基準月額を逆算できます。Slow-Go 月額 = 基準 × 係数、No-Go 月額 = 最低月額（固定）。" />
        </label>
        <div class="rate-with-button">
          <InputNumber id="fixedMonthlyWithdrawal" v-model="state.fixedMonthlyWithdrawalMan" min="0" step="1" />
          <button
            type="button"
            class="auto-calc-btn"
            :disabled="isComputingZeroLanding"
            @click="$emit('requestZeroLanding')"
          >
            {{ isComputingZeroLanding ? "計算中…" : "ゼロ着地" }}
          </button>
        </div>
        <p class="zero-landing-reset-note">再実行すると下記の上限・下限は再計算結果でリセットされます</p>
      </div>
      <div class="field">
        <label for="minMonthlyWithdrawal">
          最低月額（No-Go 期の床、万円）
          <HelpIcon text="No-Go 期（高齢で支出が減るフェーズ）に最低限確保したい月額。Go-Go 月額に対する係数ではなく、ユーザが独立して指定する固定値。床が高すぎると Go-Go 月額が下げられず「ゼロ着地」が達成不能になる場合があります。" />
        </label>
        <InputNumber id="minMonthlyWithdrawal" v-model="state.minMonthlyWithdrawalMan" min="0" step="1" />
      </div>
      <div class="field">
        <label for="finalTarget">
          最終残高目標（万円・実質値）
          <HelpIcon text="想定寿命時に残しておきたい資産。**実質値（インフレ控除後）で入力**してください。DIE WITH ZERO ソルバーは MC の p50（中央値・実質値）経路でこの目標残高に着地する Go-Go 月額を逆算します。0 なら純粋な DIE WITH ZERO、生前贈与しきれない遺産や葬式代等を見込むなら数百万〜数千万を入力。" />
        </label>
        <InputNumber id="finalTarget" v-model="state.finalTargetMan" min="0" step="100" />
      </div>
      <details class="curve-details">
        <summary>カーブ詳細設定</summary>
        <div class="curve-fields">
          <div class="field">
            <label for="slowGoStartAge">
              Slow-Go 期開始年齢
              <HelpIcon text="Slow-Go 期（Go-Go × 係数）の開始年齢。既定 75 歳。この歳以降は月額が係数倍に下がる。" />
            </label>
            <InputNumber id="slowGoStartAge" v-model="state.slowGoStartAge" min="50" max="120" step="1" />
          </div>
          <div class="field">
            <label for="noGoStartAge">
              No-Go 期開始年齢
              <HelpIcon text="No-Go 期（床固定）の開始年齢。既定 85 歳。この歳以降は最低月額（床）に張り付く。" />
            </label>
            <InputNumber id="noGoStartAge" v-model="state.noGoStartAge" min="50" max="120" step="1" />
          </div>
          <div class="field">
            <label for="slowGoCoefPercent">
              Slow-Go 係数（%）
              <HelpIcon text="Slow-Go 月額 ÷ Go-Go 月額。既定 80%。70〜80% が DIE WITH ZERO の標準。" />
            </label>
            <InputNumber id="slowGoCoefPercent" v-model="state.slowGoCoefPercent" min="0" max="100" step="1" />
          </div>
        </div>
      </details>
    </template>
    <template v-if="isRateMode">
      <div class="field">
        <label for="withdrawalRate">
          年間引出率（%）
          <HelpIcon text="年あたりの引出割合。Trinity Study モードでは取り崩し開始時の総資産に対する率（4%が目安）。リスク資産モードでは毎年初時点のリスク資産に対する率。「自動算出」ボタンで、成功率95%（取り崩し終了時に資産が枯渇しない確率）を満たす最大の引出率を二分探索で求められます。" />
        </label>
        <div class="rate-with-button">
          <InputNumber id="withdrawalRate" v-model="state.withdrawalRate" min="0" max="20" step="0.1" />
          <button
            type="button"
            class="auto-calc-btn"
            :disabled="isComputingSwr"
            @click="$emit('requestSwr')"
          >
            {{ isComputingSwr ? "計算中…" : "自動算出" }}
          </button>
        </div>
      </div>
      <details v-if="isGuardrailMode" class="guardrail-details">
        <summary>ガードレール詳細設定</summary>
        <div class="guardrail-fields">
          <div class="field">
            <label for="guardrailUpperPercent">
              上ガードレール（%）
              <HelpIcon text="引出率が初期引出率の この%分を超えたら、引出額を調整幅だけ削減する。既定 20%。" />
            </label>
            <InputNumber id="guardrailUpperPercent" v-model="state.guardrailUpperPercent" min="1" max="100" step="1" />
          </div>
          <div class="field">
            <label for="guardrailLowerPercent">
              下ガードレール（%）
              <HelpIcon text="引出率が初期引出率の この%分を下回ったら、引出額を調整幅だけ増加する。既定 20%。" />
            </label>
            <InputNumber id="guardrailLowerPercent" v-model="state.guardrailLowerPercent" min="1" max="100" step="1" />
          </div>
          <div class="field">
            <label for="guardrailAdjustmentPercent">
              調整幅（%）
              <HelpIcon text="ガードレール抵触時に引出額を増減する割合。既定 10%。" />
            </label>
            <InputNumber id="guardrailAdjustmentPercent" v-model="state.guardrailAdjustmentPercent" min="1" max="50" step="1" />
          </div>
        </div>
      </details>
    </template>
    <div v-if="showLimitTable" class="field field--full">
      <label>
        月額下限・上限（年齢ステップ式）
        <HelpIcon text="年齢に応じて月額下限・上限を段階的に変えられます。各行の「〜歳まで」までその区間の下限・上限を適用、最後の行は「以降ずっと」。値は「現在の購買力（万円）」で、シミュレーション内では自動でインフレ名目化されます。空欄は無制限。下限>上限のときは上限が優先されます。Guyton-Klinger モードでは GK 調整後の引出額をさらにこの下限・上限で挟むため、「最低限この金額は引き出す／この金額以上は引き出さない」という生活費の安全網として活用できます。" />
      </label>
      <p v-if="isDieWithZero" class="zero-landing-table-note">ゼロ着地ソルバーで自動入力された値です。下限・上限を広げて下落耐性を持たせることができます。</p>
      <table class="limit-table">
        <thead>
          <tr>
            <th>〜歳まで</th>
            <th>下限（万円）</th>
            <th>上限（万円）</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(step, idx) in state.withdrawalLimitSteps" :key="idx">
            <td>
              <span v-if="idx === state.withdrawalLimitSteps.length - 1" class="terminal-label">以降</span>
              <InputNumber v-else v-model="step.untilAge" min="0" max="120" step="1" placeholder="例: 69" />
            </td>
            <td>
              <InputNumber v-model="step.floorMan" min="0" step="1" placeholder="無制限" />
            </td>
            <td>
              <InputNumber v-model="step.ceilingMan" min="0" step="1" placeholder="無制限" />
            </td>
            <td>
              <button
                v-if="idx !== state.withdrawalLimitSteps.length - 1"
                type="button"
                class="limit-remove"
                aria-label="削除"
                @click="$emit('removeLimitStep', idx)"
              >×</button>
            </td>
          </tr>
        </tbody>
      </table>
      <button type="button" class="limit-add" @click="$emit('addLimitStep')">＋ 行を追加</button>
    </div>
    <div v-if="!isRateMode" class="field checkbox-field">
      <input
        id="inflationAdjustedWithdrawal"
        v-model="state.inflationAdjustedWithdrawal"
        type="checkbox"
        :disabled="isDieWithZero"
      />
      <label for="inflationAdjustedWithdrawal">月額をインフレに連動させる</label>
      <HelpIcon
        :text="
          isDieWithZero
            ? 'ゼロ着地モードではソルバーがインフレ連動前提で月額を逆算するため、強制 ON です。'
            : 'インフレ率の分だけ毎年引出額を増やし、実質購買力を維持する。'
        "
      />
    </div>
  </div>
</template>

<style scoped>
.limit-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

.limit-table th {
  text-align: left;
  font-weight: 500;
  color: var(--muted);
  padding: 4px 6px;
  border-bottom: 1px solid var(--border);
}

.limit-table td {
  padding: 4px 6px;
  vertical-align: middle;
}

.limit-table td :deep(input) {
  width: 100%;
  box-sizing: border-box;
}

.terminal-label {
  color: var(--muted);
  font-size: 13px;
}

.limit-remove {
  background: transparent;
  border: 1px solid var(--border);
  color: var(--muted);
  border-radius: 4px;
  width: 24px;
  height: 24px;
  cursor: pointer;
  line-height: 1;
}

.limit-remove:hover {
  border-color: var(--danger);
  color: var(--danger);
}

.limit-add {
  margin-top: 8px;
  background: transparent;
  border: 1px dashed var(--border);
  color: var(--muted);
  border-radius: 4px;
  padding: 4px 12px;
  cursor: pointer;
  font-size: 13px;
}

.limit-add:hover {
  border-color: var(--accent);
  color: var(--accent);
}

.guardrail-details {
  margin-top: 8px;
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 8px 12px;
}

.guardrail-details summary {
  cursor: pointer;
  font-size: 13px;
  color: var(--muted);
  user-select: none;
}

.guardrail-fields {
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.rate-with-button {
  display: flex;
  gap: 8px;
  align-items: stretch;
}

.rate-with-button :deep(input) {
  flex: 1;
  min-width: 0;
}

.auto-calc-btn {
  background: transparent;
  border: 1px solid var(--border);
  color: var(--accent);
  border-radius: 4px;
  padding: 0 12px;
  font-size: 13px;
  cursor: pointer;
  white-space: nowrap;
}

.auto-calc-btn:hover:not(:disabled) {
  border-color: var(--accent);
}

.auto-calc-btn:disabled {
  opacity: 0.6;
  cursor: progress;
}

.die-with-zero-info {
  margin: 0 0 12px;
  padding: 8px 12px;
  background: var(--surface-2, rgba(0, 0, 0, 0.03));
  border-left: 3px solid var(--accent);
  border-radius: 4px;
  font-size: 13px;
  color: var(--text);
}

.die-with-zero-info .hint-aside {
  margin-left: 8px;
  color: var(--muted);
  font-size: 12px;
}

.curve-details {
  margin-top: 8px;
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 8px 12px;
}

.curve-details summary {
  cursor: pointer;
  font-size: 13px;
  color: var(--muted);
  user-select: none;
}

.curve-fields {
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.zero-landing-reset-note {
  margin: 4px 0 0;
  font-size: 11px;
  color: var(--muted);
}

.zero-landing-table-note {
  margin: 0 0 8px;
  padding: 6px 10px;
  background: var(--surface-2, rgba(0, 0, 0, 0.03));
  border-left: 3px solid var(--accent);
  border-radius: 4px;
  font-size: 12px;
  color: var(--muted);
}
</style>
