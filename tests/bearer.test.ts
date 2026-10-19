import assert from "node:assert/strict";
import { test } from "node:test";
import { bearerToken } from "../src/lib/supabase/bearer";

test("only a well-formed Bearer JWT counts as a mobile credential", () => {
  assert.equal(bearerToken("Bearer aaa.bbb.c-c_c"), "aaa.bbb.c-c_c");
  for (const header of [null, "", "Bearer", "Bearer ", "bearer aaa.bbb.ccc", "Basic aaa.bbb.ccc", "Bearer aaa.bbb", "Bearer aaa.bbb.ccc extra",
    "Bearer aaa.bbb.ccc\n", " Bearer aaa.bbb.ccc", "Bearer aaa.bbb.c=c"]) assert.equal(bearerToken(header), null, JSON.stringify(header));
});
