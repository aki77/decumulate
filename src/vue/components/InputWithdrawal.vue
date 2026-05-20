<script setup lang="ts">
import { computed } from "vue";
import HelpIcon from "./HelpIcon.vue";
import type { ParamsState, WithdrawalMode } from "../composables/useParams.ts";

const state = defineModel<ParamsState>({ required: true });

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
      <input id="fixedMonthlyWithdrawal" v-model.number="state.fixedMonthlyWithdrawalMan" type="number" min="0" step="1" />
    </div>
    <template v-if="isRateMode">
      <div class="field">
        <label for="withdrawalRate">
          年間引出率（%）
          <HelpIcon text="年あたりの引出割合。Trinity Study モードでは取り崩し開始時の総資産に対する率（4%が目安）。リスク資産モードでは毎年初時点のリスク資産に対する率。" />
        </label>
        <input id="withdrawalRate" v-model.number="state.withdrawalRate" type="number" min="0" max="20" step="0.1" />
      </div>
      <div class="field">
        <label for="monthlyWithdrawalFloor">
          月額下限（万円, 任意）
          <HelpIcon text="年率モードで計算した月額がこの値を下回ったら、この値まで引き上げます。空欄なら無制限。値は「現在の購買力」基準で、シミュレーション内では毎年インフレ率分だけ自動で増えるため実質価値が保たれます。資産がほぼ枯渇したときは下限を維持できず資産残全額を引き出します。" />
        </label>
        <input
          id="monthlyWithdrawalFloor"
          type="number"
          min="0"
          step="1"
          placeholder="例: 20"
          :value="state.monthlyWithdrawalFloorMan ?? ''"
          @input="state.monthlyWithdrawalFloorMan = ($event.target as HTMLInputElement).value === '' ? null : Number(($event.target as HTMLInputElement).value)"
        />
      </div>
      <div class="field">
        <label for="monthlyWithdrawalCeiling">
          月額上限（万円, 任意）
          <HelpIcon text="年率モードで計算した月額がこの値を上回ったら、この値で抑えます。空欄なら無制限。値は「現在の購買力」基準で、毎年インフレ率分だけ自動で増えます。下限と上限を両方指定して下限 > 上限になった場合は上限が優先されます。" />
        </label>
        <input
          id="monthlyWithdrawalCeiling"
          type="number"
          min="0"
          step="1"
          placeholder="例: 40"
          :value="state.monthlyWithdrawalCeilingMan ?? ''"
          @input="state.monthlyWithdrawalCeilingMan = ($event.target as HTMLInputElement).value === '' ? null : Number(($event.target as HTMLInputElement).value)"
        />
      </div>
    </template>
    <div v-if="!isRateMode" class="field checkbox-field">
      <input id="inflationAdjustedWithdrawal" v-model="state.inflationAdjustedWithdrawal" type="checkbox" />
      <label for="inflationAdjustedWithdrawal">月額をインフレに連動させる</label>
      <HelpIcon text="インフレ率の分だけ毎年引出額を増やし、実質購買力を維持する。" />
    </div>
  </div>
</template>
