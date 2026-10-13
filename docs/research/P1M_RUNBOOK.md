# P1-M分段运行手册

仅在[准备协议](2026-10-13-p1m-readiness.md)最终精确七项CI通过、用户明确提供新开机后使用。原E1已关机，不重连取日志，不延长旧窗口。

1. 本机创建全新空的`liftcut_p1_*`开发数据库，设置loopback的`P1_TEST_DATABASE_URL`，执行`node --import tsx tests/agent-db/setup.ts`。只有合成身份与计划。可信应用用受限`liftcut_agent`角色，数据库URL不传云端。
2. `prepare.py check`核对189源；配置副本放ignored outputs，`codeCommit`填与最终受检提交具有相同Git树的main合并提交精确SHA，不能填main别名；HANDOFF另存受检SHA和树相等证据。这样squash后的合并提交满足启动器的main祖先检查。补当前SSH、known_hosts、已经信任的key SHA、本机tokenizer/父权重/恢复Python路径及已核验远端资产路径。密码只getpass，配置/权重不提交Git。
3. 新开机消息到来后如实记录opening UTC，授权文件填本轮study、明确用户授权、90分钟/¥4/每小时¥2.18。模板false/null不能执行，禁止虚构授权、沿用旧opening或在失败重试时重置截止。
4. 先检查`outputs/autodl/p1m-data-use-v1.json`、已有operations和进程。遇未知或失败预约先查日志/数据，不能删预约自动重启。先执行`python research/p1-model/launch.py --config <path>`离线核验，再用PTY执行相同命令加`--connect --authorization <path> --operations <new-directory>`。记录唯一会话/PID。默认没有connect不访问云端。
5. 只观察现有会话。一个模型进程，24case各最多12请求；只有已经落盘的resume流程可将应用进程退出75后恢复，模型不重启。传输未知、崩溃、截止不自动重试，普通模型动作错误不修原文或改变条件。
6. 恢复器实际读取父权重、全部原生token和真实SQL dump，创建新库核对原24终态并逐步新SQL回放。仅真正生成的完整`kind=model`回执上传临时文件、SHA核验后原子rename；消费与上传是不同事实。CPU回执不能代用。
7. 失败保留原run检查点、native、dump与partial，不晋升完整。worker完成/失败提早请求关机，独立守护保持原hard cutoff。记录请求/返回/断连，平台电源未知时只问一次，不问费用，不重新开机取日志。
8. 结果分支公开24case、逐次原输出/批准/撤销/版本、尝试与提交、失败/停止/恢复、真实token/耗时、GPU采样覆盖与成本代理。新schema和旧E1界限不混淆；最终精确全检查后合main。

实时SSH/GPU/关机尚未在本轮执行。服务器缺缓存资产、运行时变化或已有GPU进程时停止保留失败，不在GPU租期重新传权重或改实验条件。CPU已知局限及首次失败见[详细记录](2026-10-13-p1m-readiness.md)。
