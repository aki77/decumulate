<script setup lang="ts">
defineProps<{ text: string; ariaLabel?: string }>();
</script>

<template>
  <span class="help-icon" tabindex="0" :aria-label="ariaLabel ?? 'ヘルプ'">?<span class="help-tip" v-html="text"></span></span>
</template>
