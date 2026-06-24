# LiftCut-Coach Data

此目录只提交小型、可公开的格式示例。真实用户数据、原始采集数据和大规模合成数据不得提交到仓库。

## 黄金样本格式

每行是一个独立 JSON 对象：

```json
{
  "task": "generate_training_plan",
  "instruction": "Generate a structured workout plan for LiftCut Tracker. Return JSON only.",
  "input": {
    "locale": "zh-CN",
    "profile_snapshot": {},
    "constraints": {}
  },
  "output": {}
}
```

`task` 可取：

- `generate_training_plan`
- `generate_nutrition_plan`

`output` 必须通过主应用中的 `aiTrainingPlanSchema` 或 `aiNutritionPlanSchema`。

## 数据治理

- 训练集、验证集和测试集应按固定种子切分。
- 独立评测集不得用于训练或提示词调优。
- 删除姓名、邮箱、账号、病历等可识别信息。
- 强模型合成样本先通过 Zod 自动校验，再做人工抽查。
- `raw/`、`generated/` 和 `splits/` 已被 Git 忽略。
