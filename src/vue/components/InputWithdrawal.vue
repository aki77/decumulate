<script setup lang="ts">
import { computed } from "vue";
import HelpIcon from "./HelpIcon.vue";
import InputNumber from "./InputNumber.vue";
import type { ParamsState, WithdrawalMode } from "../composables/useParams.ts";

const state = defineModel<ParamsState>({ required: true });

defineEmits<{
  addLimitStep: [];
  removeLimitStep: [idx: number];
}>();

const isRateMode = computed(
  () => state.value.withdrawalMode === "rate" || state.value.withdrawalMode === "rate-risk",
);
</script>

<template>
  <div class="field-group">
    <h3>取り崩し</h3>
    <div class="field field--full">
      <label for="withdrawalMode">
        取り崩しモード
        <HelpIcon text="「月額」は毎月一定額を引き出す方式。「年率（Trinity Study）」は初年度資産にかかる%を毎年インフレ調整。「年率×リスク資産」は毎年初にその時点のリスク資産に率をかけて月額を再計算（資産変動に追従、インフレ調整なし）。" />
      </label>
      <select id="withdrawalMode" v-model="state.withdrawalMode">
        <option value="amount">月額で指定</option>
        <option value="rate">年率（%）で指定（Trinity Study）</option>
        <option value="rate-risk">年率（%）×リスク資産で毎年再評価</option>
      </select>
    </div>
    <div v-if="!isRateMode" class="field">
      <label for="fixedMonthlyWithdrawal">月額生活費（万円）</label>
      <InputNumber id="fixedMonthlyWithdrawal" v-model="state.fixedMonthlyWithdrawalMan" min="0" step="1" />
    </div>
    <template v-if="isRateMode">
      <div class="field">
        <label for="withdrawalRate">
          年間引出率（%）
          <HelpIcon text="年あたりの引出割合。Trinity Study モードでは取り崩し開始時の総資産に対する率（4%が目安）。リスク資産モードでは毎年初時点のリスク資産に対する率。" />
        </label>
        <InputNumber id="withdrawalRate" v-model="state.withdrawalRate" min="0" max="20" step="0.1" />
      </div>
      <div class="field field--full">
        <label>
          月額下限・上限（年齢ステップ式）
          <HelpIcon text="年齢に応じて月額下限・上限を段階的に変えられます。各行の「〜歳まで」までその区間の下限・上限を適用、最後の行は「以降ずっと」。値は「現在の購買力（万円）」で、シミュレーション内では自動でインフレ名目化されます。空欄は無制限。下限>上限のときは上限が優先されます。" />
        </label>
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
    </template>
    <div v-if="!isRateMode" class="field checkbox-field">
      <input id="inflationAdjustedWithdrawal" v-model="state.inflationAdjustedWithdrawal" type="checkbox" />
      <label for="inflationAdjustedWithdrawal">月額をインフレに連動させる</label>
      <HelpIcon text="インフレ率の分だけ毎年引出額を増やし、実質購買力を維持する。" />
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
</style>
