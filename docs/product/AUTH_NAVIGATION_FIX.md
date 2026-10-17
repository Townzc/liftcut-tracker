# 登录后的导航缓存修复

2026-10-16，在「当前计划」正式站合成账号验收中观察到：成功登录后从 Agent 返回首页，主窗口先进入 `/login?redirectedFrom=%2F`，随后才回到首页。同期未见对应服务端运行错误，计划仍是待批准状态，未发生数据丢失。

登录界面原先会预取受保护首页；登录成功调用 `router.replace` 紧接 `router.refresh`，可能继续使用匿名身份下缓存的重定向。本仓库 Next 16.4.1 文档说明 `refresh` 清理当前路由的客户端缓存。[Supabase SSR 文档](https://supabase.com/docs/guides/auth/server-side/advanced-guide#no-session-on-the-server-side-with-nextjs-route-prefetching) 也说明预取与登录凭据处理之间的竞态。

现在身份切换完成后使用一次完整页面导航，丢弃匿名路由缓存和未完成预取；登录页品牌链接关闭首页预取。适用于密码登录、直接获得会话的注册和游客入口。正常登录后的首页、Agent、设置仍使用客户端导航，现有对话持久化及批准账本不变。没有修改鉴权方式、权限或数据库结构。

新增浏览器回归覆盖匿名访问受保护首页后登录、登录页/注册页游客入口、重复切换三个标签与刷新。浏览器记录实际主框架导航，断言登录后不再绕回登录页。原来仅匹配 `router.replace` 代码文本的游客测试由这些行为测试替代。实际执行结果见本次产品日志和发布交接；本地 HTTP 身份夹具不替代正式站 Supabase Auth 验收。
