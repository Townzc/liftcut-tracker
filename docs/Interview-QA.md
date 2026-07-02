# LiftCut-Coach 面试 Q&A

---

## 一、基础类

### 1. 这个项目解决了什么问题？

LiftCut Tracker 是一个 AI 驱动的健身与减脂追踪平台。核心要解决的问题有两个层面：

**产品层面**：传统健身 App 的训练记录、饮食记录、体重数据分散在不同地方，用户需要手动制定训练和饮食计划。LiftCut 把这些整合到一个 Web App 中，并用 AI 自动生成个性化的训练计划和饮食计划。

**工程层面**：大语言模型生成的 JSON 输出不稳定——可能包含包裹层（如 `nutrition_plan`）、使用中文枚举（如「早餐」而不是 `breakfast`）、或字段缺失。前端和数据库需要可验证的结构化数据，不能直接信任 LLM 输出。因此我们设计了多层保障：strict prompt → wrapper unwrap → enum normalize → Zod schema validation → constraint checking。

### 2. 为什么要做 AI Provider abstraction？

因为不同场景对 AI 后端的需求不同：

- **生产环境**：需要稳定、快速的云端服务（DeepSeek）
- **研究/演示**：需要可控、低成本的本地模型（vLLM + LoRA）
- **备选**：可能切换到其他 OpenAI-compatible 服务（如 MiMo）

如果把 DeepSeek 的 API 调用直接写死在业务代码里，切换 Provider 就需要改很多地方。Provider abstraction 把这个差异封装在 `config.ts` + `client.ts` 中，前端和业务逻辑完全不感知后端用的是哪个 Provider。切换只需改一个环境变量 `AI_PROVIDER`。

### 3. 为什么不能直接相信大模型输出？

因为 LLM 的输出本质上是概率生成的文本，不是确定性的程序输出。具体来说：

- **JSON 结构不稳定**：同一个 prompt 跑两次，输出的 JSON key 可能不同
- **枚举值不一致**：要求输出 `breakfast`，模型可能输出「早餐」或 `Breakfast`
- **包裹层**：模型可能把结果包在 `{"nutrition_plan": {...}}` 里，而不是直接输出顶层字段
- **字段缺失**：模型可能省略 `warnings` 或 `daily_targets`

如果把这些输出直接写入数据库，前端渲染时会崩溃。所以必须用 Zod schema 做严格校验，不通过就不入库。

### 4. Zod 在项目中起什么作用？

Zod 在项目中有两个核心作用：

**1. AI 输出校验**：`src/lib/ai/schemas.ts` 定义了 `aiTrainingPlanSchema` 和 `aiNutritionPlanSchema`，用于校验 AI 生成的 JSON 是否符合预期结构。每个字段都有类型、范围、必填/可选的约束。

**2. 请求参数校验**：API route 用 Zod 校验前端发来的请求参数，防止非法数据进入后端。

对于 AI 输出，我们用了三层 Zod schema：
- **Raw schema**：宽松，容忍字符串/数字混用、可选字段缺失
- **Normalize 后**：通过 `normalizeAiTrainingPlan` / `normalizeAiNutritionPlan` 把 raw 数据转为合法格式
- **Final schema**：严格，不放宽，作为最后防线

### 5. 什么是 wrapper key error？

Wrapper key error 是指模型把输出结果包裹在一个额外的 JSON key 里。例如用户期望：

```json
{"plan_name": "...", "goal_type": "fat_loss", "days": [...]}
```

但模型输出：

```json
{"nutrition_plan": {"plan_name": "...", "goal_type": "fat_loss", "days": [...]}}
```

这种情况下，顶层缺少 `plan_name`、`goal_type` 等必需字段，final schema 会失败。我们通过两种方式处理：

1. Prompt 层明确禁止：在 system prompt 中列出 `forbidden_top_level_keys`
2. 代码层 unwrap：`unwrapNutritionPlanCandidate` 检测并自动解包

### 6. 为什么 meal_type 需要 enum normalization？

因为当 locale 是 zh-CN 时，模型倾向于用中文输出所有内容，包括 `meal_type`。例如输出「早餐」而不是 `breakfast`。

但我们的 schema 定义 `meal_type` 只接受 `breakfast | lunch | dinner | snack`，这是因为：
- 前端渲染依赖这些固定值做国际化映射
- 数据库存储需要统一格式
- 统计分析需要一致的枚举值

所以 `normalizeMealType` 做了一个 deterministic 映射：中文别名（包含式匹配）→ 英文枚举。例如「高蛋白早餐」包含「早餐」→ 映射为 `breakfast`。

### 7. DeepSeek、MiMo、LoRA 三者分别是什么角色？

- **DeepSeek v4 Pro**：云端大模型，生产默认 provider。优点是稳定、不需要本地 GPU；缺点是延迟高（P50 134s）、按 token 计费。
- **MiMo v2.5 Pro**：小米的云端模型，通过 OpenAI-compatible API 调用。优点是延迟低（P50 35s）、结构化输出质量不错；缺点是仍需云端调用。
- **LiftCut-Coach LoRA**：我们在 Qwen2.5-14B-Instruct 上用 LoRA 微调的本地模型。优点是 schema pass 100%、延迟低（P50 33s）、数据不经过第三方；缺点是需要本地 GPU。

在 293 条评测中，LoRA 在结构化输出稳定性上表现最好，延迟与 MiMo 接近。

### 8. Supabase 在项目中负责什么？

Supabase 提供三个核心能力：

- **Auth**：用户注册、登录、session 管理
- **Postgres**：存储用户设置、训练计划、饮食记录、身体数据、AI 生成历史
- **Storage**：用户头像上传

AI 生成的计划不直接存 Supabase——而是先经过 Zod 校验，校验通过后才通过 API 写入数据库。Guest 模式的数据存在 localStorage，登录后可迁移到 Supabase。

---

## 二、工程类

### 9. AI 生成计划的完整链路是什么？

以 nutrition plan 为例：

1. **前端**发送请求：locale、profile_snapshot、constraints
2. **API route** 校验请求参数（Zod）、加载用户 profile、检查 guest quota
3. **Prompt 构建**：`buildNutritionPlanPrompt` 生成 system prompt（strict schema 约束）+ user prompt（用户资料 + 约束条件 + schema example）
4. **API 调用**：`callAiProviderForJson` 调用 AI Provider（DeepSeek / local / openai_compatible）
5. **JSON 提取**：`extractJsonObjectFromText` 从模型输出中提取第一个完整 JSON 对象
6. **Wrapper 解包**：`unwrapNutritionPlanCandidate` 检测并解包 `nutrition_plan` 等包裹层
7. **Raw schema 解析**：用宽松的 `aiNutritionPlanRawSchema` 解析
8. **Normalize**：`normalizeAiNutritionPlan` 做字段类型转换、中文 meal_type 映射、默认值填充
9. **Final schema 验证**：用严格的 `aiNutritionPlanSchema` 做最终校验
10. **Constraint 检查**：检查 daily_targets 范围、meal_type 合法性
11. **返回前端**：用户预览、编辑、确认保存

### 10. 如何处理 JSON parse 失败？

JSON parse 失败意味着模型输出了不是合法 JSON 的内容（可能包含 markdown、自然语言、或截断的 JSON）。

处理方式：
1. `sanitizeModelJsonText` 去掉 code fence（` ```json ... ``` `）
2. `extractJsonObjectFromText` 用括号匹配找到第一个完整的 `{...}` 块
3. 如果找不到 `{` 或括号不匹配，抛出 `AI_INVALID_JSON` 错误
4. 评估脚本记录这个 case 为 `stage=generation` 失败

在 293 条评测中，DeepSeek 的 JSON parse success 是 99.66%（1 条失败），MiMo 是 99.32%（2 条失败），LoRA 是 100%。

### 11. JSON 合法但 schema 不合法怎么办？

这是更常见的情况。模型输出了合法 JSON，但结构不符合我们的 schema。例如：

- 缺少必需字段（如没有 `daily_targets`）
- 字段类型错误（如 `calories` 是字符串 `"2000"` 而不是数字 `2000`）
- 值超出范围（如 `calories: 50000`）

处理链路：
1. Raw schema 宽松解析，容忍字符串/数字混用
2. Normalize 做类型转换和范围修正（`clampNumber`）
3. Final schema 严格校验，不通过则抛出 `AI_SCHEMA_VALIDATION_FAILED`

关键设计：**final schema 不放宽**。它保护前端和数据库的数据稳定性。

### 12. 为什么要区分 raw schema、normalized schema、final Zod schema？

这三层各有职责：

- **Raw schema**：最大容忍度，把模型的各种"小错误"（字符串数字、缺失可选字段）先接住
- **Normalize**：确定性的修复逻辑——字符串转数字、中文枚举映射、默认值填充、范围截断
- **Final schema**：严格校验，不通过就不入库。它是前端和数据库的数据质量保障

如果只用一层 strict schema，模型的很多"小错误"（如 `"2000"` vs `2000`）会直接失败，但这些是可以 deterministic 修复的。如果只用一层宽松 schema，前端会收到不一致的数据。

### 13. 什么是 constraint satisfaction？

Constraint satisfaction 是比 schema 更高层次的业务约束检查。Schema 检查的是"数据结构是否合法"，constraint 检查的是"数据是否符合用户的输入需求"。

例如：
- 用户要求每周训练 3 天，模型生成了 5 天 → schema 通过，constraint 失败
- 用户要求 session 60 分钟，模型生成了 90 分钟 → schema 通过，constraint 失败
- 用户的 calorie target 是 1800，模型生成了 5000 → schema 通过，constraint 失败

在 293 条评测中，LoRA 的 constraint pass 是 99.66%（1 条 training case 失败），说明模型不仅输出结构正确，业务约束也基本满足。

### 14. 为什么 provider-specific timeout 比全局 timeout 更好？

不同 Provider 的响应速度差异巨大：

- DeepSeek P95: 277s
- MiMo P95: 66s
- LoRA P95: 63s

如果全局用 30s timeout，MiMo 和 LoRA 会频繁超时。如果全局用 120s，DeepSeek 的正常请求也要等很久才超时。

Provider-specific timeout 让每个 Provider 用最合适的超时值：DeepSeek 30s（快速失败）、local 120s（给本地推理足够时间）。通过环境变量可覆盖，灵活度高。

### 15. Web App 和 research eval 为什么要分开？

因为它们的目标不同：

- **Web App**：面向真实用户，需要 Supabase auth、guest mode、quota、前端渲染
- **Research eval**：面向模型评测，只需要读 eval cases、调 API、记录结果

如果把 eval 逻辑嵌入 Web App API route，会：
1. 需要 Supabase 环境（eval 服务器可能没有）
2. 受 guest quota 限制
3. 无法批量跑 293 条

所以 eval 是独立的 Node.js 脚本，直接调用 AI Provider 层，绕过 Web App 的 auth 和 UI 逻辑。

### 16. 为什么 evaluation script 不能只看 final success？

因为只看 final success 会丢失诊断信息。如果 293 条中有 6 条失败，只看 "6 条失败" 不够——需要知道：

- 失败在哪个 stage？（raw_schema / normalize / final_schema / constraints）
- 是 wrapper key 问题还是 enum 问题？
- 是 training 还是 nutrition 失败更多？

这些诊断信息帮助我们决定下一步优化方向：
- 如果 raw_schema 失败多 → 模型输出质量差，需要更好的 prompt 或训练数据
- 如果 normalize 失败多 → normalize 逻辑需要增强
- 如果 constraints 失败多 → 模型理解了 schema 但不理解业务约束

---

## 三、模型与训练类

### 17. 为什么选择 Qwen2.5-14B？

选择理由：
- **尺寸合适**：14B 参数在 A800-80GB 上可以用 LoRA 舒适训练
- **指令跟随能力好**：Qwen2.5-Instruct 系列在中文指令跟随上表现不错
- **已有基础**：服务器上已经下载了 Qwen2.5-14B-Instruct 权重
- **开源可商用**：Qwen2.5 使用 Apache 2.0 license

没有选 7B 是因为我们希望 base model 能力更强，LoRA 只需微调结构化输出格式。32B 太大，训练成本高。

### 18. 什么是 LoRA？

LoRA（Low-Rank Adaptation）是一种参数高效的微调方法。核心思想：

- 不更新模型的所有参数（14B 全量微调需要 ~112GB 显存）
- 只在每个 Transformer 层的注意力/FFN 的线性投影旁边加一个小的低秩矩阵
- 训练时只更新这些小矩阵，原始权重冻结

具体到我们的项目：
- LoRA rank=16, alpha=32
- 目标模块：q_proj, k_proj, v_proj, o_proj, gate_proj, up_proj, down_proj
- 可训练参数：68,812,800（仅占总参数的 0.46%）
- Adapter 大小：~275MB

### 19. 为什么 LoRA adapter 只有 275MB 但推理仍然需要加载 14B base model？

因为 LoRA adapter 只存储增量权重（低秩矩阵），推理时需要把它加回到原始模型的权重上：

```
output = W·x + (A·B)·x
```

其中 `W` 是原始 14B 权重（28GB），`A·B` 是 LoRA 增量（275MB）。两者都需要在 GPU 上才能计算。

所以虽然 adapter 很小，但推理时 GPU 显存仍然需要装下整个 14B 模型。LoRA 的优势不是推理时省内存，而是训练时省显存和训练时间。

### 20. rank=16 代表什么？

rank 是 LoRA 矩阵的秩。LoRA 把一个 `d×d` 的权重矩阵 `W` 替换为两个小矩阵 `A(d×r)` 和 `B(r×d)`，其中 `r` 就是 rank。

- rank=16 意味着每个 LoRA 层增加 16×d + d×16 的参数
- rank 越大，表达能力越强，但参数也越多
- rank=16 是一个常用的经验值，在表达能力和效率之间取得平衡

在我们的实验中，rank=16 足以让 14B 模型学会 LiftCut 的结构化输出格式。

### 21. 为什么训练 loss 下降不等于模型可用？

因为 train loss 只衡量模型在训练集上的拟合程度，不衡量：

- **泛化能力**：在未见过的数据上是否同样好
- **结构化输出质量**：loss 低不代表输出的 JSON 一定合法
- **业务约束满足**：schema 通过不代表训练天数、时长符合用户需求
- **安全性**：loss 低不代表不会输出危险建议

因此我们用 held-out test set 做独立评测，而不是只看 train loss。

### 22. eval loss 缺失会带来什么问题？

eval loss 缺失意味着我们无法在训练过程中监控模型是否过拟合。可能的风险：

- 模型在训练集上 loss 很低，但在 test set 上表现差
- 训练轮数过多导致记忆训练数据
- 无法做 early stopping

实际上我们的 LoRA 在 test set 上达到了 100% schema pass，说明过拟合问题不严重。但这仍然是一个需要改进的地方——下次训练应该确保 LLaMA-Factory 正确配置了 eval dataset。

### 23. 为什么要用 held-out eval cases？

因为如果用训练数据来评测，结果会虚高——模型可能只是记住了训练样本的格式，而不是学会了通用的结构化输出能力。

我们的做法：
1. 从 seed cases 中按 80/10/10 切分 train/val/test
2. Test set（293 条）在训练过程中完全不参与
3. 评测时用 test set 跑完整的 prompt → API → pipeline 链路

这保证了评测结果反映的是模型的真实泛化能力。

### 24. 为什么 nutrition plan 比 training plan 更容易通过？

从三个模型的评测结果看，nutrition 的 pass rate 都是 100%，而 training 有不同程度的失败。原因可能是：

- **结构复杂度**：training plan 有 weeks → days → exercises 三层嵌套，nutrition 只有 days → meals → foods
- **字段数量**：training plan 的 exercise 有 name/sets/rep_range/target_rpe/rest_seconds/notes/alternative_exercises 七个字段，nutrition food 只有六个
- **约束多样性**：training 需要匹配 weekly_training_days、session_duration_minutes、RPE 范围等多个约束
- **输出长度**：training plan 通常更长（多 week 多 day），JSON 更容易截断或出错

### 25. 如果没有 A800 GPU，项目怎么部署？

有几个选择：

1. **继续用云端 Provider**：DeepSeek 或 MiMo。项目已经支持多 Provider，切换只需改环境变量
2. **用更小的模型**：7B 或 3B 的 LoRA 可以在消费级 GPU（如 RTX 3090 24GB）上运行
3. **量化**：用 GPTQ/AWQ 把 14B 模型量化到 4bit，减少显存需求
4. **CPU 推理**：用 llama.cpp 跑 GGUF 格式，但延迟会很高

在没有 GPU 的情况下，建议继续用 DeepSeek 或 MiMo 作为生产 provider，LoRA 仅在有 GPU 的环境中用于研究和演示。

---

## 四、评测类

### 26. 你设计了哪些 evaluation metrics？

10 个指标：

1. **JSON parse success**：模型输出能否被 JSON.parse
2. **Raw schema pass**：能否通过宽松 raw schema
3. **Normalized schema pass**：unwrap + normalize 后能否通过
4. **Final Zod schema pass**：能否通过严格 final schema
5. **Constraint satisfaction**：业务约束是否满足
6. **Wrapper key errors**：是否包含 nutrition_plan 等包裹 key
7. **Enum errors**：meal_type 是否为非法值
8. **Latency avg/p50/p95**：延迟统计
9. **Per-task breakdown**：training/nutrition 分别统计
10. **Failure stage breakdown**：失败按 stage 分类

### 27. JSON parse success 和 final schema pass 有什么区别？

- **JSON parse success**：模型输出的文本能否被 `JSON.parse()` 解析为一个 JavaScript 对象。这是最基本的要求——如果连合法 JSON 都不是，后面都不用做了。
- **Final schema pass**：JSON 解析成功后，经过 unwrap、normalize、Zod schema 验证，所有字段都符合严格 schema。

两者之间有很多中间步骤。一个 JSON parse 成功的输出可能因为 wrapper key、enum 错误、字段缺失等原因在 final schema 失败。

### 28. constraint pass 和 schema pass 有什么区别？

- **Schema pass**：数据结构合法——字段存在、类型正确、值在 schema 定义的范围内
- **Constraint pass**：业务逻辑合法——训练天数匹配用户需求、时长在合理范围、宏量营养素在健康范围

Schema pass 是 constraint pass 的前提（不合法的数据无法检查约束），但 schema pass 不保证 constraint pass。例如 schema 允许 `calories: 5000`，但 constraint 会标记它超出合理范围。

### 29. 为什么 wrapper/enum errors 是重要诊断指标？

因为它们直接指向模型的特定失败模式：

- **Wrapper key errors 高** → 模型倾向于给输出加容器，需要加强 prompt 约束
- **Enum errors 高** → 模型在 locale=zh-CN 时用中文输出枚举值，需要加强 prompt 或 normalize

在我们的评测中，三个模型的 wrapper/enum errors 都是 0，说明 strict prompt + normalize 的组合有效。如果某个模型这两个指标高，我们可以针对性地优化。

### 30. DeepSeek、MiMo、LoRA 的结果说明了什么？

关键发现：

1. **LoRA 结构化输出最稳定**：100% Final Schema Pass，说明 LoRA 微调确实让模型学会了 LiftCut 的输出格式
2. **MiMo 延迟优势明显**：比 DeepSeek 快 3.8 倍，但 schema pass 略低
3. **云端大模型不一定更好**：DeepSeek 参数量远大于 LoRA，但在结构化输出任务上反而不如 LoRA
4. **Local 模型可行**：LoRA 证明了用 0.46% 的参数微调就能在特定任务上超越云端大模型

### 31. 为什么 MiMo 延迟明显低于 DeepSeek？

可能的原因：
- MiMo 的推理基础设施优化更好（小米自研推理引擎）
- DeepSeek 可能有更高的并发负载
- 网络延迟差异（DeepSeek 服务器可能更远）
- MiMo 模型架构可能更适合快速推理

在我们的测试中，MiMo 平均 39s，DeepSeek 平均 148s，差距接近 4 倍。

### 32. 为什么 LoRA 结果更好？

可能的原因：

- **任务特异性**：LoRA 是在 LiftCut 的训练/饮食计划数据上微调的，它"见过"大量类似格式的输出，所以更容易生成符合 schema 的 JSON
- **格式记忆**：LoRA 训练让模型记住了 LiftCut 的 JSON 结构，减少了 wrapper key 和 enum 错误
- **Prompt 熟悉度**：训练数据的 prompt 和评测的 prompt 格式一致，模型更容易理解

这也说明了 LoRA 微调的价值——即使只训练 0.46% 的参数，也能显著提升特定任务的表现。

### 33. P50/P95 latency bug 是怎么发现和修复的？

**发现**：评测结果中 DeepSeek 的 P50 和 P95 都显示 277,436ms，MiMo 都显示 65,555ms。P50 和 P95 完全相同在统计上极不可能，说明计算有 bug。

**原因**：代码中 P50 错误调用了 `p95()` 函数：

```typescript
// Bug: P50 和 P95 都调用 p95()
console.log(`| P50 | ${Math.round(p95(metrics.latencies))}ms |`);
console.log(`| P95 | ${Math.round(p95(metrics.latencies))}ms |`);
```

**修复**：改为通用 `percentile(values, p)` 函数，P50 调用 `percentile(latencies, 0.50)`，P95 调用 `percentile(latencies, 0.95)`。

**验证**：从 results.jsonl 统计实际分布，确认 DeepSeek P50=133,604ms, P95=277,436ms，差异明显。

### 34. normalized pass 低于 raw pass 说明什么？

理论上，normalize 应该修复一些 raw schema 的问题（如字符串数字转为数字），所以 normalized pass 应该 ≥ raw pass。

如果 normalized pass < raw pass，可能说明：
1. **Normalize 逻辑有 bug**：某些合法的 raw 数据经过 normalize 后反而变非法了
2. **指标定义问题**：raw schema 和 final schema 的严格程度差异太大
3. **非破坏性 normalize 审计**：需要检查 normalize 是否对某些输入做了错误的修改

在我们的评测中，这个差异很小（DeepSeek: 99.32% → 98.98%，MiMo: 99.32% → 98.29%），且 final pass 已经很高。这是一个需要后续审计的问题，但不是 blocker。

---

## 五、高级类

### 35. 如果要把这个系统上线，你会怎么做？

关键步骤：

1. **配置 Supabase 生产环境**：设置正确的 URL、anon key、RLS policies
2. **选择生产 Provider**：推荐 DeepSeek（延迟高但稳定）或 MiMo（延迟低）
3. **配置 timeout**：根据实际 Provider 延迟设置合理的 timeout
4. **监控**：接入 error tracking（如 Sentry）和 AI 调用日志
5. **安全审计**：确保 API key 不泄露、RLS 正确配置、用户数据隔离
6. **压力测试**：多用户并发时 AI 调用的延迟和成本
7. **用户反馈**：收集用户对 AI 计划质量的评价

### 36. 如果要降低本地部署成本，你会怎么做？

几个方向：

1. **更小的模型**：用 Qwen2.5-7B 甚至 3B 做 LoRA，显存需求从 80GB 降到 24GB 甚至更低
2. **量化**：GPTQ/AWQ 4bit 量化，14B 模型显存需求从 ~28GB 降到 ~8GB
3. **模型蒸馏**：用大模型生成数据，训练小模型
4. **批处理**：多个请求合并推理，提高 GPU 利用率
5. **选择性调用**：简单请求用小模型，复杂请求用大模型

### 37. 如果用户输入极端目标，比如一周瘦 10kg，系统如何处理？

系统在两个层面处理：

1. **前端校验**：targetWeeklyLossMin/Max 的范围限制在 0-3 kg/周
2. **Constraint checking**：如果 AI 生成的计划中有极端值（如每天只吃 500 卡），constraint checker 会标记
3. **Prompt 约束**：system prompt 中要求"避免极端低热量饮食"
4. **Warnings**：AI 生成的计划中包含 warnings 字段，可以提醒用户

但我们没有做"拒绝生成"的逻辑——如果用户真的输入极端目标，AI 会生成一个相对保守的计划。这是一个可以改进的方向。

### 38. 如何避免 AI 生成危险健身/饮食建议？

当前的措施：

1. **Prompt 约束**：system prompt 中要求"避免极端训练量"、"避免极端低热量饮食"、"不提供医疗诊断"
2. **Constraint checking**：检查热量、蛋白质、RPE 等是否在合理范围
3. **Warnings 字段**：AI 计划中包含安全提醒
4. **用户确认流程**：AI 生成 → 预览 → 用户确认 → 保存，不是自动生效

可以进一步改进：
- 加入更专业的安全规则库
- 对伤病用户加强保守约束
- 加入 disclaimer

### 39. 如何做 streaming generation？

当前是同步生成——用户点击"生成"后等待完整 JSON 返回。Streaming 可以让用户看到逐步生成的过程。

实现方式：
1. 后端用 SSE（Server-Sent Events）或 WebSocket
2. AI Provider 调用时设置 `stream: true`
3. 逐步把 token 发送给前端
4. 前端做增量 JSON 解析，在结构完整时显示预览

挑战：JSON 必须完整才能做 schema 验证，所以 streaming 主要提升用户体验（减少等待焦虑），但最终确认仍然需要等完整 JSON。

### 40. 如何做 user feedback loop？

收集用户对 AI 计划质量的评价：

1. 在 plan 预览页面加"有用/没用"按钮
2. 收集用户的编辑行为（哪些字段被修改了）
3. 把 feedback 关联到对应的 generation 记录
4. 定期用 feedback 数据做 prompt 调优或 LoRA 再训练

这可以形成一个正向循环：用户反馈 → 数据积累 → 模型改进 → 更好的计划 → 更多用户。

### 41. 如何把本项目扩展成真正的 AI fitness product？

几个方向：

1. **社交功能**：分享训练计划、互相打卡
2. **教练模式**：认证教练可以为学员定制计划
3. **智能调整**：根据用户的历史训练数据自动调整计划
4. **视频指导**：为每个动作生成视频示范
5. **穿戴设备集成**：从 Apple Watch / Garmin 获取心率、步数数据
6. **营养数据库**：集成更完整的食物营养数据

### 42. 这个项目和普通 CRUD 项目最大的区别？

最大的区别是**数据来源的不确定性**。

普通 CRUD：前端表单 → 后端校验 → 存入数据库。数据来源是确定的（用户输入），格式是可控的。

LiftCut-Coach：AI 生成 → 多层校验 → 存入数据库。数据来源是不确定的（LLM 概率输出），格式需要"猜测+修复+验证"。

这带来了独特的工程挑战：wrapper unwrap、enum normalization、三层 schema、constraint checking、evaluation pipeline——这些都是普通 CRUD 不需要的。

### 43. 这个项目体现了哪些 AI 产品经理能力？

1. **需求定义**：把"AI 健身助手"这个模糊需求转化为具体的产品功能（训练计划、饮食计划、结构化预览）
2. **质量标准**：定义了可量化的评测指标（schema pass rate、constraint satisfaction）
3. **取舍决策**：选择 LoRA 而不是全量微调，选择 14B 而不是 7B 或 32B
4. **用户流程**：AI 生成 → 预览 → 编辑 → 确认保存，不是"一键生成就完事"
5. **风险控制**：constraint checking + warnings + 用户确认

### 44. 这个项目体现了哪些 AI 工程能力？

1. **结构化输出保障**：多层 pipeline 把不稳定的 LLM 输出转化为可靠数据
2. **Provider 抽象**：支持多 AI 后端无缝切换
3. **评测体系**：10 个指标、293 条 test case、三模型对比
4. **LoRA 微调**：从数据生成到训练到部署的完整流程
5. **问题定位**：从 latency bug、timeout 问题到 wrapper/enum 问题的系统性排查

### 45. 如果重新做一遍，你会改进什么？

1. **Eval loss 监控**：确保 LLaMA-Factory 配置正确记录 eval loss
2. **Normalize 审计**：深入检查 normalized pass < raw pass 的原因
3. **更早的 E2E 测试**：在开发过程中就配置 Supabase 测试环境
4. **Streaming 先行**：从一开始就设计 streaming 接口
5. **更小的基线模型**：先用 7B 验证可行性，再升级到 14B
6. **自动化评测**：把 eval 集成到 CI/CD，每次 prompt 修改后自动跑
7. **用户反馈机制**：在 MVP 阶段就加入 feedback 收集
