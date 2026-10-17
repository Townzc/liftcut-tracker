/** Local mode never impersonates a model or claims a write. */
export function isCoachIntroduction(input:string):boolean {
  const s=input.normalize("NFKC").trim().toLowerCase().replace(/[。.!！?？]+$/u,"").trim();
  return /^(?:(?:你好|您好|嗨|哈喽)[ ,，]*)?(?:你(?:能|可以)(?:帮我)?做(?:些|点)?什么(?:呀|啊|呢|吗)?|介绍一下(?:你的功能|你能帮我做什么)|怎么用|帮助)$/.test(s)||
    /^(你好|您好|嗨|哈喽|早上好|晚上好|谢谢|谢谢你|hello|hi|hey|help|thanks|thank you|what can you (?:do|help me with))$/.test(s);
}
export function localCoachReply(input:string,signedIn:boolean,en:boolean):string[] {
  const mode=signedIn?(en?"Natural conversation is off or unavailable. You can enable it in Conversation options when available.":"当前使用数据模式. 可在「对话选项」中开启自然对话；服务暂不可用时请稍后再试."):
    (en?"Guest data mode is on. Agree and enable natural conversation below to try AI chat. Confirmed entries stay on this device; sign in to sync them.":"访客当前使用本机数据模式. 同意开启下方自然对话即可试用 AI；补录仍需确认，登录后可以同步保存的数据.");
  if(isCoachIntroduction(input))return [en?"Hi! I can look up saved measurements, meals and workout records by date, for example ‘what was my weight two months ago?’. Only saved records count as facts.":"你好！我可以按日期查询已保存的体重、饮食和训练记录，例如「我两个月前的体重是多少」. 只会依据实际保存的记录回答.",mode];
  if(/记忆|记住|忘|六轮|6轮|memory|remember|forget/i.test(input))return [en?"Six turns is the model's conversation context, not a limit on saved records. Confirmed measurements keep their dates and are queried afresh. Mentioning a number in chat alone does not save a measurement.":"六轮限制的是模型聊天上下文，不是数据保存期限. 确认保存的测量值按日期保留，每次查询重新读取；仅在聊天中提到一个数字，不等于已经保存为测量记录.",signedIn?
    (en?"Account records survive starting or deleting a conversation.":"账号记录独立于聊天，开启新对话或删除聊天都不会删除已保存的数据."):
    (en?"Guest records stay in this browser only. Private browsing or clearing site data can erase them; sign in for cloud storage.":"访客记录只在当前浏览器. 无痕浏览结束或清除网站数据可能丢失，长期保存请登录同步.")];
  if(/训练|卧推|深蹲|硬拉|\d+\s*(?:次|组)|workout|\breps?\b/i.test(input))return [signedIn?
    (en?"To record workout sets, say ‘start workout’, then choose and confirm a session.":"记录训练组前，先说「开始训练」，选择并确认本次训练."):
    (en?"Sign in to start and record a workout. You can still ask about records saved in this browser.":"登录后可以开始并记录本次训练. 现在可以查询这个浏览器里已保存的数据."),mode];
  return [en?"I couldn't match that request in data mode. Try ‘recent weight’ or a date such as ‘2026-08-16 weight’. A workout is not required to query measurements or meals.":"数据模式还不能理解这句话. 可以试试「最近体重」或「2026-08-16 的体重是多少」；查身体和饮食数据不需要开始训练.",mode];
}
