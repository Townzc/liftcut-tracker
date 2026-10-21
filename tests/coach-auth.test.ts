import {test} from "node:test";
import assert from "node:assert/strict";
import {generateKeyPairSync,sign,randomUUID} from "node:crypto";
import {NextRequest} from "next/server";
import {updateSession} from "../src/lib/supabase/middleware";

test("page authentication verifies ES256 signatures, caches public keys and rejects tampered subjects",async t=>{
  const {privateKey,publicKey}=generateKeyPairSync("ec",{namedCurve:"prime256v1"}),kid=randomUUID(),sub=randomUUID();
  const jwk={...publicKey.export({format:"jwk"}),kid,alg:"ES256",use:"sig"};let jwks=0,users=0;
  let settingsStatus: "complete" | "missing" | "denied" | "unavailable" = "complete";
  const previous={url:process.env.NEXT_PUBLIC_SUPABASE_URL,key:process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY};
  process.env.NEXT_PUBLIC_SUPABASE_URL=`https://claims-${kid}.example.invalid`;process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY="synthetic-public-anon";
  const part=(v:unknown)=>Buffer.from(JSON.stringify(v)).toString("base64url");
  const unsigned=`${part({alg:"ES256",typ:"JWT",kid})}.${part({sub,exp:Math.floor(Date.now()/1000)+3600,iat:Math.floor(Date.now()/1000),aud:"authenticated",role:"authenticated"})}`;
  const token=`${unsigned}.${sign("sha256",Buffer.from(unsigned),{key:privateKey,dsaEncoding:"ieee-p1363"}).toString("base64url")}`;
  const request=(access_token:string)=>{
    const r=new NextRequest("https://app.example.invalid/agent");
    const session={access_token,refresh_token:"synthetic-refresh",expires_at:Math.floor(Date.now()/1000)+3600,expires_in:3600,token_type:"bearer",user:{id:sub}};
    r.cookies.set(`sb-claims-${kid}-auth-token`,`base64-${part(session)}`);return r;
  };
  t.mock.method(globalThis,"fetch",async(input:RequestInfo|URL)=>{
    const url=String(input);if(url.includes(".well-known/jwks.json")){jwks++;return Response.json({keys:[jwk]});}
    if(url.includes("/auth/v1/user")){users++;return Response.json({error:"unexpected remote identity"},{status:401});}
    if(url.includes("/rest/v1/user_settings")) {
      if(settingsStatus === "denied") return Response.json({code:"42501",message:"permission denied"},{status:403});
      if(settingsStatus === "unavailable") return Response.json({code:"PGRST002",message:"connection unavailable"},{status:503});
      if(settingsStatus === "missing") return Response.json(null);
      return Response.json({gender:"male",age:25,height:170,current_weight:65,target_weight:65,weekly_training_days:3});
    }
    throw Error("Unexpected fixture request");
  });
  try{
    assert.equal((await updateSession(request(token))).status,200);assert.equal((await updateSession(request(token))).status,200);
    assert.equal(jwks,1);assert.equal(users,0);
    for (const failure of ["denied", "unavailable"] as const) {
      settingsStatus = failure;
      const unavailable = await updateSession(request(token));
      assert.equal(unavailable.status, 503);
      assert.equal(unavailable.headers.get("location"), null);
      assert.equal(unavailable.headers.get("cache-control"), "no-store");
      assert.match(await unavailable.text(), /无需重新填写/);
    }
    settingsStatus = "missing";
    assert.match((await updateSession(request(token))).headers.get("location")!, /\/onboarding$/);
    settingsStatus = "complete";
    assert.equal((await updateSession(request(token))).status, 200);
    const [header,payload,signature]=token.split(".");const forged=`${header}.${part({...JSON.parse(Buffer.from(payload,"base64url").toString()),sub:randomUUID()})}.${signature}`;
    const denied=await updateSession(request(forged));assert.equal(denied.status,307);assert.ok(denied.headers.get("location")?.includes("/login"));
    const expiredUnsigned=`${header}.${part({...JSON.parse(Buffer.from(payload,"base64url").toString()),exp:Math.floor(Date.now()/1000)-60})}`;
    const expired=`${expiredUnsigned}.${sign("sha256",Buffer.from(expiredUnsigned),{key:privateKey,dsaEncoding:"ieee-p1363"}).toString("base64url")}`;
    assert.equal((await updateSession(request(expired))).status,307);
    const absent=await updateSession(new NextRequest("https://app.example.invalid/agent"));assert.equal(absent.status,307);
  }finally{
    if(previous.url===undefined)delete process.env.NEXT_PUBLIC_SUPABASE_URL;else process.env.NEXT_PUBLIC_SUPABASE_URL=previous.url;
    if(previous.key===undefined)delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY=previous.key;
  }
});
