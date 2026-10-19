import assert from "node:assert/strict";
import { test } from "node:test";
import { format, localeFor, messages } from "./messages";

test("both languages define every message with the same placeholders", () => {
  const zh = messages["zh-CN"], en = messages.en, slots = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();
  assert.deepEqual(Object.keys(en).sort(), Object.keys(zh).sort());
  for (const key of Object.keys(zh) as (keyof typeof zh)[]) {
    assert.ok(zh[key].trim() && en[key].trim(), key);
    assert.deepEqual(slots(en[key]), slots(zh[key]), key);
  }
});

test("system language picks Chinese only for zh; placeholders fill without inventing values", () => {
  assert.deepEqual(["zh", "ZH", "zh-Hant", "en", "fr", null, undefined].map(localeFor), ["zh-CN", "zh-CN", "zh-CN", "en", "en", "en", "en"]);
  assert.equal(format(messages["zh-CN"].progress, { done: 2, total: 5 }), "已完成 2 / 5 组");
  assert.equal(format("{a} · {b}", { a: 1 }), "1 · {b}");
});
