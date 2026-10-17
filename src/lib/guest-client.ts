let pending:Promise<{remaining:number;limit:number}>|null=null;
export async function ensureGuestSession(signal?:AbortSignal):Promise<{remaining:number;limit:number}>{
  signal?.throwIfAborted();
  // Consent prewarm and a fast first send must share one identity handshake.
  // Cancelling one waiter must not create two racing Set-Cookie responses.
  pending??=fetch("/api/guest-session",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}",signal:AbortSignal.timeout(15000)})
    .then(async response=>{if(!response.ok)throw new Error("GUEST_UNAVAILABLE");return response.json();}).finally(()=>{pending=null;});
  const result=await pending;signal?.throwIfAborted();return result;
}
