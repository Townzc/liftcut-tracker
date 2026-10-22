import {expect,type APIRequestContext} from "@playwright/test";
import {randomUUID} from "node:crypto";

// No browser interception: provider -> application -> browser still uses HTTP.
export async function holdGreetingStream(request:APIRequestContext){
  const id=randomUUID(),url=`http://127.0.0.1:59999/__test/stream-gates/${id}`;
  expect((await request.post(url)).status()).toBe(201);
  return {
    text:`你好 [stream-gate:${id}]`,
    release:async()=>{expect((await request.delete(url)).status()).toBe(204);},
  };
}
