# I2：无卡准备与4090执行手册

## 本次覆盖：2026-10-13用户授权整夜保留实例

本次用户明确要求保留到洛杉矶08:00，**不得使用下文立即关机的普通execute入口**。改用经过最终精确提交检查的`launch_i2_overnight.py`和原独立lease。04:27UTC实例开机不变，15:00UTC电源截止不变；I2实际开始后60/20/90分钟，只结束实验进程组。既有32fbbac准备目录只读复核，只上传小代码delta，原科学方案不变。[原因、测试和启动边界](2026-10-13-i2-overnight-plan.md)。下文普通独立开机模式保留为历史/未来单窗口操作说明。

对应[事前设计](2026-10-12-i2-source-id-design.md)及[启动复盘](2026-10-13-i2-startup-recovery.md)。
四组科学方案及预选D保持不变，部署分两个独立开机窗口。命令从research/liftcut-agent执行。
本机tokenizer/恢复解释器为.venv/Scripts/python.exe，SSH为E:/anaconda/python.exe。

2026-10-13已实际完成无卡准备，用户确认平台关闭。
[完整记录](2026-10-13-i2-no-gpu-preparation.md)。执行提交固定
32fbbac18d48493a8f37221a3e4b090e3b431cf2，stage为outputs/autodl/i2-stage-32fbbac，
真实准备记录为outputs/autodl/i2-prep-20261013-014645-operations/prepared.json。
保持同一实例数据时，不再执行阶段一；等待用户另一次正式4090开机后进入阶段二。

## 离线准备

真实I1参考已核验，保留reports/i2-reference-v1.json，不重选权重。源变更重新冻结
reports/i2-execution-v1.json，保留旧冻结并比较科学字段不变。执行单测、输入审计、
实际权重完整恢复及partial演练。独立分支的最终精确提交全部检查成功才合main并
核对树一致；执行使用该提交，不使用浮动main。

```powershell
& ./.venv/Scripts/python.exe launch_i2.py --stage --compact --stage-dir outputs/autodl/i2-stage-<commit> --commit <完整受检提交> --ref <对应分支> --diagnostic-dir outputs/state-diagnostic-v1 --d2-dir outputs/d2-prepared-a --tokenizer-dir outputs/tokenizers/cdbee75f17c01a7cc42f958dc650907174af0554 --i1-run-dir <真实I1恢复目录>/parts/evidence
& ./.venv/Scripts/python.exe launch_i2.py --verify-stage --stage-dir outputs/autodl/i2-stage-<commit>
```

增量bundle以2bf816a02e116a3d26961bba817c49c590ccb910的干净I1 checkout为底座。
31文件索引保留权重大小/SHA，资产包不含132MB原权重；原权重完整核验后复制到新
准备目录，不用硬链接。打包后须在新本地目录实际安装，验证旧底座不变。缓存缺失/
不匹配则停止，不默默下载或换另一权重。

私有path-only config：ssh_host、ssh_port、ssh_user、known_hosts、restore_python、
diagnostic、d2、tokenizer、remote_python、bootstrap_python、remote_model、
remote_model_manifest、remote_cached_weight。bootstrap使用/root/miniconda3/bin/python，
remote_python使用固定持久盘环境；远端资产使用/root/autodl-tmp/liftcut/下规范POSIX路径。
密码仅getpass内存读取。严格known_hosts，不自动接受新主机密钥。

PowerShell可将JSON中的ISO字符串自动转成DateTime，传给原生命令时变为当地日期
格式。`--booted-at`必须传明确带时区的ISO字符串（如单引号包围的实际UTC），
不要直接传ConvertFrom-Json产生的日期对象。准备与GPU时间都来自各自真实开机，
示例日期或旧窗口时间不能用于新实验。

## 阶段一：用户新开无卡模式

记录新开机消息实际UTC作为费用代理和唯一准备ID；原开机+120分钟独立守护，
参考¥0.10/小时、预留¥0.20。无卡0.5核/2GB，只用流式哈希、软件版本和tokenizer，
不加载基座模型、不创建CUDA上下文。[官方说明](https://www.autodl.com/docs/save_money/)。

现场确认AutoDL可能将nvidia-smi替换为零字节占位文件，调用返回ENOEXEC。
仅该错误且文件确实为空、没有NVIDIA设备节点时按不可用记录处理；权限错误、
非空坏文件或GPU设备节点仍拒绝。已知失败的受控继续必须保存失败/无派发证据，
使用新目录且仍用原CPU开机+120分钟截止，至少留30分钟准备余量；不重置时钟、
不自动重试。GPU预检的10分钟限制不变。

```powershell
& E:/anaconda/python.exe launch_i2.py --prepare-instance --stage-dir outputs/autodl/i2-stage-<commit> --config outputs/autodl/i2-preparation-config-20261013.json --run-id <实际UTC的YYYYMMDD-HHMMSS> --booted-at <本次无卡新开机ISO>
```

记录唯一session/PID与outputs/autodl/i2-prep-<id>-operations。先上传小守护、核对无
可见GPU/实验worker与真实守护身份；再核对旧Git底座、实际权重并传增量。新目录
安装后检查31资产、114源、全部固定依赖、基座文件清单和固定权重。实际成功才生成
并上传prepared.json，其中model_result=false，不能作为完整实验ACK。

成功/已知失败立即请求关闭，未知返回保留原守护和证据缺口。未知结果先查已有会话、
进程、日志与上传状态，不能自动再开准备器。真实准备成功、平台显示关闭后才通知
用户正常开4090；不在无卡模式执行科学计算，不自动重开或切换配置。

## 阶段二：用户另一次新开4090

GPU新开机时间须晚于准备完成。原90分钟/¥4预留、10分钟预检、60分钟计算、
20分钟收集保持不变；不沿用CPU时间，不重置已经开始的GPU时钟。

```powershell
& E:/anaconda/python.exe launch_i2.py --execute --stage-dir outputs/autodl/i2-stage-<commit> --config outputs/autodl/i2-preparation-config-20261013.json --prepared outputs/autodl/i2-prep-<实际准备id>-operations/prepared.json --run-id <本次实际UTC的YYYYMMDD-HHMMSS> --booted-at <本次4090新开机ISO>
```

读回真实准备记录和bootstrap字节，启用新90分钟独立守护。**不上传资产或重新安装
代码**，只复核实际部署/环境，再查空闲GPU、固定模型和唯一reservation，派发一次
原controller。CUDA运行时仍在GPU阶段实际核验；准备记录不是未来实例永久有效的证明。

超10分钟拒绝派发；已知尚未派发且守护已核验时提前关机。未知派发先查现有进程、
reservation、opening和日志，不能重复启动/自动重连/改截止。各窗口分别计时，跨窗口
累计与单窗口费用不能重复相加。默认不临时下载安装或扩盘。

## 收集与交付

每组完成下载早期包。冻结恢复器检查实际权重、444原环境/native/投影/反向映射回放、
全部生成token后才生成真实完整回执，partial不能升级。回执先临时上传读回校验，
再原子发布；服务端消费单独观察，不手写ACK，不开重复collector。

完成/失败按原流程自动关机保留数据。关机请求、返回、SSH断连、平台电源分别记录；
不为补日志重开。仅必要且未问过时确认平台状态，不询问账单。

结果分支审查111配对、四条因素边、ID翻转、来源错误、误停/授权、真实token和成本，
实际渲染图表，按原机制和固定S0保护判定。历史I1仅参考；48保留任务不用，不宣称
独立泛化。失败定位原因，不盲目追加seed/训练。[日志](EXPERIMENT_LOG.md)记录原因、
结果、局限和下一步；ignored HANDOFF保留精确提交/包/配置/唯一会话和截止，不存密码。
