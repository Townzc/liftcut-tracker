import {test} from "node:test";
import assert from "node:assert/strict";
import {accountAuth} from "./api";
import {outboxApi} from "./outbox-api";

test("a retained transport uses refreshed same-owner tokens and sends nothing after logout or account switch",async t=>{
  let session:{access_token:string;user:{id:string}}|null={access_token:"old-token",user:{id:"owner-a"}};
  const captured:string[]=[];
  t.mock.method(globalThis,"fetch",async (_url:unknown,init:RequestInit)=>{
    captured.push((init.headers as Record<string,string>).Authorization);
    return new Response(JSON.stringify({error:"synthetic unavailable"}),{status:503});
  });
  const api=outboxApi(accountAuth("owner-a",()=>session));
  await api.send("set","{}");
  session={access_token:"refreshed-token",user:{id:"owner-a"}};
  await api.send("set","{}");
  assert.deepEqual(captured,["Bearer old-token","Bearer refreshed-token"]);
  session={access_token:"another-owner-token",user:{id:"owner-b"}};
  await assert.rejects(api.send("set","{}"),/SIGNED_OUT/);
  await assert.rejects(api.today(),/SIGNED_OUT/);
  session=null;
  await assert.rejects(api.send("set","{}"),/SIGNED_OUT/);
  assert.equal(captured.length,2);
});
