<script setup lang="ts">
import HelpIcon from "./HelpIcon.vue";
import type { ParamsState } from "../composables/useParams.ts";
import type { OtherIncomeEntry, OtherIncomeAmountMode } from "../../other-income.ts";
import { computed } from "vue";

const state = defineModel<ParamsState>({ required: true });
const emit = defineEmits<{
  addOtherIncome: [];
  removeOtherIncome: [id: string];
}>();

const periodUnit = computed(() => (state.value.currentAge != null ? "歳" : "年目"));
</script>

<template>
  <div class="field-group">
    <h3>年金・その他収入</h3>
    <div class="field">
      <label for="basePension">
        年金月額（65歳基準, 額面, 万円）
        <HelpIcon text="65歳開始時の額面（税・社会保険控除前）月額。受給開始年齢を変えると繰上げ/繰下げで自動調整される。" />
      </label>
      <input id="basePension" v-model.number="state.basePensionMan" type="number" min="0" step="1" />
      <div class="preset-buttons">
        <button type="button" @click="state.basePensionMan = 0">なし</button>
        <button type="button" @click="state.basePensionMan = 15">独身 (15万円)</button>
        <button type="button" @click="state.basePensionMan = 29">夫婦 (29万円)</button>
      </div>
    </div>
    <div class="field">
      <label for="pensionStartAge">
        受給開始年齢（60–75）
        <HelpIcon text="繰上げ：60〜64歳は1ヶ月あたり-0.4%。繰下げ：66〜75歳は1ヶ月あたり+0.7% で年金月額が調整される。" />
      </label>
      <input id="pensionStartAge" v-model.number="state.pensionStartAge" type="number" min="60" max="75" step="1" />
    </div>
    <div class="field other-incomes-field">
      <div class="other-incomes-header">
        <label>その他の月収（手取り）</label>
        <HelpIcon text="副業・講演料・家賃収入など、年金以外の収入を期間付きで複数登録できます。例:「副業300万円/年を今後5年」。年齢未設定時は「経過年（0=現在）」として扱います。終了は exclusive（30〜35なら 30,31,32,33,34歳の5年間）。" />
      </div>
      <div class="other-incomes-list">
        <div
          v-for="entry in state.otherIncomes"
          :key="entry.id"
          class="other-income-row"
        >
          <input
            class="oi-label"
            type="text"
            placeholder="ラベル（任意, 例: 副業）"
            :value="entry.label"
            @input="entry.label = ($event.target as HTMLInputElement).value"
          />
          <div class="oi-controls">
            <input
              class="oi-amount"
              type="number"
              min="0"
              step="1"
              placeholder="金額(万円)"
              :value="entry.amountMan === 0 ? '' : entry.amountMan"
              @input="entry.amountMan = Number(($event.target as HTMLInputElement).value) || 0"
            />
            <select
              class="oi-mode"
              :value="entry.amountMode"
              @change="entry.amountMode = ($event.target as HTMLSelectElement).value as OtherIncomeAmountMode"
            >
              <option value="monthly">月額</option>
              <option value="annual">年額</option>
            </select>
            <button type="button" class="oi-remove" aria-label="削除" @click="emit('removeOtherIncome', entry.id)">×</button>
          </div>
          <div class="oi-period-row">
            <input
              class="oi-start"
              type="number"
              min="0"
              step="1"
              :placeholder="`開始(${periodUnit})`"
              :value="entry.startAge ?? ''"
              @input="entry.startAge = ($event.target as HTMLInputElement).value === '' ? null : Number(($event.target as HTMLInputElement).value)"
            />
            <span class="oi-period-sep">〜</span>
            <input
              class="oi-end"
              type="number"
              min="0"
              step="1"
              :placeholder="`終了(${periodUnit})`"
              :value="entry.endAge ?? ''"
              @input="entry.endAge = ($event.target as HTMLInputElement).value === '' ? null : Number(($event.target as HTMLInputElement).value)"
            />
          </div>
        </div>
      </div>
      <div class="preset-buttons">
        <button type="button" @click="emit('addOtherIncome')">＋ 収入を追加</button>
      </div>
    </div>
  </div>
</template>
