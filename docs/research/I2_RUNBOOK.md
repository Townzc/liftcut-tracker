# I2：离线准备和下一次开机操作手册

对应[事前设计](2026-10-12-i2-source-id-design.md)。只执行一个四组窗口，D事前候选。
本文命令从 `research/liftcut-agent` 执行；本机固定 tokenizer 解释器为 `.venv/Scripts/python.exe`，
SSH 传输解释器为 `E:/anaconda/python.exe`。Linux/CI 使用固定依赖的 Python。

## 开机前

1. 对真实 I1 恢复目录运行 `i2_protocol.py --create-reference`（已有文件不能覆盖）。
   该步骤重放222条真实轨迹并验证旧权重，不产生新模型调用。
2. 完成单测、`audit_i2_inputs.py` 的历史输入投影核验、`drill_i2.py` 实际权重容器恢复。
   没有私有权重的 CI 演练只允许 partial 回执。冻结后的任何源变更都要求新冻结与检查。
3. `i2_protocol.py --freeze` 保存冻结执行方案；提交独立分支，最终提交全部检查成功后
   合入main，核对受检树与合并树一致。精确执行提交使用经检验的分支提交，不用浮动main。
4. 本地预打包完整 Git bundle、固定诊断数据、tokenizer、预选权重和历史I1参考；
   不上传环境变量、SSH配置、密钥或其它outputs。完整 bundle 无旧 checkout 前置依赖。
5. 解包到新本地目录，核对资产哈希和 bundle 精确 checkout，确认可迁移。

```powershell
& ./.venv/Scripts/python.exe launch_i2.py --stage --stage-dir outputs/autodl/i2-stage-<commit> --commit <完整受检提交> --ref <对应分支> --diagnostic-dir outputs/state-diagnostic-v1 --d2-dir outputs/d2-prepared-a --tokenizer-dir outputs/tokenizers/cdbee75f17c01a7cc42f958dc650907174af0554 --i1-run-dir <真实I1恢复目录>/parts/evidence
& ./.venv/Scripts/python.exe launch_i2.py --verify-stage --stage-dir outputs/autodl/i2-stage-<commit>
```

私有 path-only config 只含：ssh_host、ssh_port、ssh_user、known_hosts、restore_python、
diagnostic、d2、tokenizer、remote_python、bootstrap_python、remote_model、remote_model_manifest。
bootstrap_python固定python3；其它远端路径使用 `/root/autodl-tmp/liftcut/...` 的 POSIX 路径。
密码只由getpass读取，不写文件。克隆实例应保留缓存模型与已固定依赖环境；若丢失，
先停止该试验窗口、保留失败原因，再另行准备，不能在本窗口临时下载/安装或扩盘。

## 用户通知开机后

记录**新开机消息实际UTC**作为成本代理，生成唯一run-id；地址变化时更新本地path配置。
不要沿用2026-10-03旧开机、旧预算或旧守护。严格核对known_hosts，不自动信任新主机密钥。

```powershell
& E:/anaconda/python.exe launch_i2.py --execute --stage-dir outputs/autodl/i2-stage-<commit> --config outputs/autodl/i2-config-20261012.json --run-id <实际UTC的YYYYMMDD-HHMMSS> --booted-at <新开机消息的带时区ISO时间>
```

记录唯一session/PID。启动器先验证本地冻结与数据，严格SSH连接，上传小bootstrap并
启用原开机+90分钟独立关机守护，再上传bundle/资产；校验缓存模型与环境、空闲GPU、
无其它worker，持久化唯一reservation，派发一次controller。任何未知返回先查现有进程、
reservation、opening和日志，不重复启动，也不重设截止。

计算最多60分钟，工作截止不晚于开机+70分钟；收集最多20分钟，硬截止开机+90分钟。
准备超10分钟拒绝新派发。已核验守护且尚未派发的准备失败，会尝试提前关机；
未知派发先保留证据，独立守护仍保留。每次实际费用代理只按同一个开机时间累计一次。

## 收集与恢复

每组完成即下载早期评估包。最终证据包包括实际权重；由固定本地恢复器检查所有
库存、444原环境/native/投影/反向映射回放和生成token，再生成完整回执。partial
归档绝不升级为完整。回执先上传临时文件、读回校验，再原子改名；发布不等于服务端消费。
同一collector继续读取服务端消费及关机请求/返回，不另开重复监控。

controller在真实回执消费后立即申请关机，失败/超时也关机并保留持久盘。独立守护不撤销、
不延长。SSH断连、本地进程退出0、关机命令返回和平台停止计费分别记录；缺失保持未知。
不得为补关机日志重开。只有平台状态必需且尚未问过时才问一次，不询问账单。

## 收尾与下一轮

先审计完整结果，再在新的结果分支发布全部配对与四条因素边，审查错误机制、ID
翻转、来源字段、误停/授权、token与成本。图表用真实数据渲染核查。完整门槛失败就
定位原因，不追加训练/seed；通过也仅是重复开发状态的系统候选，另行冻结独立评估。
后续开机须新窗口准备就绪并由用户提供状态。本次准备不启动任何自动循环付费试验。

当前阶段证据记录在[实验日志](EXPERIMENT_LOG.md)和[进度](../AGENT_RESEARCH_PROGRESS.md)。
本地ignored HANDOFF保存精确提交、stage路径、config和唯一运行会话；其中不存密码。
