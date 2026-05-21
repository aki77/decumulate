<script setup lang="ts">
import HelpIcon from "./HelpIcon.vue";
import InputNumber from "./InputNumber.vue";
import type { ParamsState } from "../composables/useParams.ts";

const state = defineModel<ParamsState>({ required: true });
</script>

<template>
  <div class="field-group">
    <h3>基本</h3>
    <div class="field">
      <label for="currentAge">現在の年齢</label>
      <InputNumber id="currentAge" v-model="state.currentAge" min="0" max="100" step="1" placeholder="例: 35" required />
    </div>
    <div class="field">
      <label for="monthlyContribution">
        月額積立（万円）
        <HelpIcon text="毎月この額（万円）を積み立てる。NISA年間枠・生涯枠の範囲内で優先的にNISAへ、超過分は特定（リスク）へ。<br>積立年数の間だけ実行され、切崩開始後と重なる期間も継続する。<br>防衛資産には積み立てない。積立分は含み益ゼロ（取得価額=積立額）として扱う。" />
      </label>
      <InputNumber id="monthlyContribution" v-model="state.monthlyContributionMan" min="0" step="1" />
    </div>
  </div>
</template>
