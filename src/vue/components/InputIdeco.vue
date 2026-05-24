<script setup lang="ts">
import HelpIcon from "./HelpIcon.vue";
import InputNumber from "./InputNumber.vue";
import type { ParamsState } from "../composables/useParams.ts";

const state = defineModel<ParamsState>({ required: true });
</script>

<template>
  <div class="field-group">
    <h3>
      iDeCo（個人型確定拠出年金）
      <HelpIcon text="運用中非課税、60歳以降に受取（一時金/年金/併用）。本シミュレータは資産フローのみを扱い、所得控除メリットや拠出上限チェックは行わない。一時金課税は拠出年数で退職所得控除を適用するが、退職金との受給間隔ルール（2026年改正で 5年→10年、退職金先行は 19年→9年に短縮予定）は厳密にはモデル化しないため、退職金がある会社員の税額は過小評価になり得る。年金課税は公的年金との合算で公的年金等控除を計算する。利回りはリスクサイドと同じ。拠出上限は 2024年12月改正で会社員（DC無）は月 2.3 万円等に拡大（詳細は加入資格に応じて確認）。" />
    </h3>
    <div class="field checkbox-field">
      <input id="idecoEnabled" v-model="state.idecoEnabled" type="checkbox" />
      <label for="idecoEnabled">iDeCo を有効にする</label>
    </div>
    <template v-if="state.idecoEnabled">
      <div class="field">
        <label for="initialIdeco">iDeCo 時価（万円）</label>
        <InputNumber id="initialIdeco" v-model="state.initialIdecoMan" min="0" step="1" />
      </div>
      <div class="field">
        <label for="initialIdecoGain">うちiDeCo 含み益（万円）</label>
        <InputNumber id="initialIdecoGain" v-model="state.initialIdecoGainMan" min="0" step="1" />
      </div>
      <div class="field">
        <label for="idecoMonthlyContribution">
          月額拠出（万円）
          <HelpIcon text="職業区分により上限が異なる（会社員DC無 2.3万・有 1.2万、公務員 2万、自営業 6.8万 など; 2024年12月改正後）。上限チェックは行わない。" />
        </label>
        <InputNumber id="idecoMonthlyContribution" v-model="state.idecoMonthlyContributionMan" min="0" step="0.1" />
      </div>
      <div class="field">
        <label for="idecoContributionYears">
          拠出年数
          <HelpIcon text="現在から何年間iDeCo拠出を続けるか。退職所得控除の勤続年数としても使われる。" />
        </label>
        <InputNumber id="idecoContributionYears" v-model="state.idecoContributionYears" min="0" max="50" step="1" />
      </div>
      <div class="field">
        <label for="idecoReceiveStartAge">
          受取開始年齢
          <HelpIcon text="通常60〜75歳。現在年齢が空欄なら「現在から○年後」として扱う。" />
        </label>
        <InputNumber id="idecoReceiveStartAge" v-model="state.idecoReceiveStartAge" min="60" max="75" step="1" />
      </div>
      <div class="field">
        <label for="idecoLumpSumRatio">
          一時金比率（%）
          <HelpIcon text="受取総額のうち一時金で受け取る割合。100%なら全額一時金（特定リスクへ振替）、0%なら全額年金、間の値で併用。" />
        </label>
        <InputNumber id="idecoLumpSumRatio" v-model="state.idecoLumpSumRatio" min="0" max="100" step="1" />
      </div>
      <div class="field">
        <label for="idecoPensionYears">
          年金受取期間（年）
          <HelpIcon text="5〜20年が一般的。一時金比率100%の場合は無視される。期間中も運用が継続し、毎月「現在残高÷残月数」を取り崩しに合流させる。" />
        </label>
        <InputNumber id="idecoPensionYears" v-model="state.idecoPensionYears" min="1" max="30" step="1" />
      </div>
    </template>
  </div>
</template>
