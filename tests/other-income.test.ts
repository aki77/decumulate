import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeOtherIncomes,
  sumOtherIncomeAt,
  type OtherIncomeEntry,
} from "../src/other-income.ts";

const makeEntry = (overrides: Partial<OtherIncomeEntry> = {}): OtherIncomeEntry => ({
  id: "test",
  label: "",
  amountMan: 10,
  amountMode: "monthly",
  startAge: null,
  endAge: null,
  ...overrides,
});

test("normalizeOtherIncomes - 年齢ベースの期間変換（currentAge あり）", () => {
  const result = normalizeOtherIncomes(
    [makeEntry({ startAge: 35, endAge: 40 })],
    30,
    50,
    10000,
  );
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0]!.startYearOffset, 5);
  assert.strictEqual(result[0]!.endYearOffset, 10);
});

test("normalizeOtherIncomes - 経過年フォールバック（currentAge なし）", () => {
  const result = normalizeOtherIncomes(
    [makeEntry({ startAge: 2, endAge: 5 })],
    null,
    50,
    10000,
  );
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0]!.startYearOffset, 2);
  assert.strictEqual(result[0]!.endYearOffset, 5);
});

test("normalizeOtherIncomes - amountMode='annual' は年額 / 12 になる", () => {
  const result = normalizeOtherIncomes(
    [makeEntry({ amountMan: 300, amountMode: "annual", startAge: 0, endAge: 5 })],
    null,
    50,
    10000,
  );
  assert.strictEqual(result.length, 1);
  // 300 万円/年 → 月 25 万円 = 250,000 円
  assert.strictEqual(result[0]!.monthlyAmount, 250000);
});

test("normalizeOtherIncomes - amountMode='monthly' は万円 × 10000", () => {
  const result = normalizeOtherIncomes(
    [makeEntry({ amountMan: 10, amountMode: "monthly", startAge: 0, endAge: 5 })],
    null,
    50,
    10000,
  );
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0]!.monthlyAmount, 100000);
});

test("normalizeOtherIncomes - endAge=null は totalYears まで", () => {
  const result = normalizeOtherIncomes(
    [makeEntry({ startAge: 0, endAge: null })],
    null,
    30,
    10000,
  );
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0]!.endYearOffset, 30);
});

test("normalizeOtherIncomes - startAge=null は 0（現在から）として扱う", () => {
  const result = normalizeOtherIncomes(
    [makeEntry({ startAge: null, endAge: 35 })],
    30,
    50,
    10000,
  );
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0]!.startYearOffset, 0);
  assert.strictEqual(result[0]!.endYearOffset, 5);
});

test("normalizeOtherIncomes - 過去年齢の startAge は 0 にクランプ", () => {
  const result = normalizeOtherIncomes(
    [makeEntry({ startAge: 20, endAge: 35 })],
    30,
    50,
    10000,
  );
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0]!.startYearOffset, 0);
  assert.strictEqual(result[0]!.endYearOffset, 5);
});

test("normalizeOtherIncomes - 金額 0 は除外", () => {
  const result = normalizeOtherIncomes(
    [makeEntry({ amountMan: 0, startAge: 0, endAge: 5 })],
    null,
    50,
    10000,
  );
  assert.strictEqual(result.length, 0);
});

test("normalizeOtherIncomes - 期間逆転（end <= start）は除外", () => {
  const result = normalizeOtherIncomes(
    [makeEntry({ startAge: 40, endAge: 30 })],
    30,
    50,
    10000,
  );
  assert.strictEqual(result.length, 0);
});

test("normalizeOtherIncomes - startYearOffset >= totalYears は除外", () => {
  const result = normalizeOtherIncomes(
    [makeEntry({ startAge: 60, endAge: 65 })],
    30,
    20,
    10000,
  );
  assert.strictEqual(result.length, 0);
});

test("normalizeOtherIncomes - 複数件の正規化", () => {
  const result = normalizeOtherIncomes(
    [
      makeEntry({ id: "a", amountMan: 5, amountMode: "monthly", startAge: 0, endAge: 5 }),
      makeEntry({ id: "b", amountMan: 120, amountMode: "annual", startAge: 2, endAge: null }),
    ],
    null,
    30,
    10000,
  );
  assert.strictEqual(result.length, 2);
  assert.strictEqual(result[0]!.monthlyAmount, 50000);
  assert.strictEqual(result[0]!.startYearOffset, 0);
  assert.strictEqual(result[0]!.endYearOffset, 5);
  assert.strictEqual(result[1]!.monthlyAmount, 100000);
  assert.strictEqual(result[1]!.startYearOffset, 2);
  assert.strictEqual(result[1]!.endYearOffset, 30);
});

test("normalizeOtherIncomes - 空配列は空配列を返す", () => {
  const result = normalizeOtherIncomes([], 30, 50, 10000);
  assert.deepStrictEqual(result, []);
});

test("sumOtherIncomeAt - endYearOffset は inclusive（境界年に収入が発生する）", () => {
  // startAge=35, endAge=40, currentAge=30 → startYearOffset=5, endYearOffset=10
  const result = normalizeOtherIncomes(
    [makeEntry({ startAge: 35, endAge: 40 })],
    30,
    50,
    10000,
  );
  const offset = result[0]!;
  // year=5（startAge=35）〜year=10（endAge=40）で収入あり、year=4, year=11 はゼロ
  assert.strictEqual(sumOtherIncomeAt(result, 4), 0);
  assert.ok(sumOtherIncomeAt(result, offset.startYearOffset) > 0);
  assert.ok(sumOtherIncomeAt(result, offset.endYearOffset) > 0);
  assert.strictEqual(sumOtherIncomeAt(result, 11), 0);
});

test("normalizeOtherIncomes - startAge==endAge は 1 年限定で残る（inclusive）", () => {
  const result = normalizeOtherIncomes(
    [makeEntry({ startAge: 35, endAge: 35 })],
    30,
    50,
    10000,
  );
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0]!.startYearOffset, 5);
  assert.strictEqual(result[0]!.endYearOffset, 5);
  assert.ok(sumOtherIncomeAt(result, 5) > 0);
  assert.strictEqual(sumOtherIncomeAt(result, 4), 0);
  assert.strictEqual(sumOtherIncomeAt(result, 6), 0);
});
