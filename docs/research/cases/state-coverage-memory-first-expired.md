# 四组原始案例：sd1-memory-0-first-expired

本文件由已通过清单与回放验证的公开证据生成；没有新增模型调用。
这是固定状态下首个有任务含义的决定，不等于完整任务最终成功。

## 相同的接手条件

四组使用同一个前缀。下面是研究者侧的因素标签，不是额外发送给模型的输入：

```json
{
  "clarification": false,
  "position": "first",
  "invalid": "expired"
}
```

用户初始请求与约束：

```json
{
  "request": "请根据记录和我的后续回复处理本次计划。",
  "constraints": {
    "available_days": [
      "wed",
      "thu",
      "sat"
    ],
    "sessions_per_week": 2,
    "equipment": [
      "bodyweight"
    ],
    "max_minutes": 23,
    "min_exercises": 2,
    "excluded_exercise_ids": []
  },
  "records": [
    {
      "id": "record-b4f5e3604ae9",
      "summary": "Synthetic task record."
    }
  ]
}
```

工具返回的记忆记录顺序：

```json
[
  {
    "id": "memory-3138c36b1044",
    "field": "equipment",
    "value": [
      "dumbbell"
    ],
    "revision": 8,
    "confirmed": true,
    "expires_on": null
  },
  {
    "id": "memory-9ce38d7055bf",
    "field": "equipment",
    "value": [
      "barbell"
    ],
    "revision": 5,
    "confirmed": true,
    "expires_on": null
  },
  {
    "id": "memory-e89c64075c2a",
    "field": "equipment",
    "value": [
      "machine"
    ],
    "revision": 12,
    "confirmed": true,
    "expires_on": "2026-09-28"
  }
]
```

接手前已真实发生的动作（包含脚本工具及用户事件）：

```json
[
  {
    "index": 0,
    "actor": "agent",
    "action": {
      "tool": "get_context",
      "arguments": {}
    }
  },
  {
    "index": 1,
    "actor": "agent",
    "action": {
      "tool": "get_memories",
      "arguments": {}
    }
  }
]
```

## 评分依据

以下参考动作只用于评分与讲解，没有作为答案提示发给模型：

```json
{
  "tool": "search_exercises",
  "arguments": {
    "equipment": [
      "dumbbell"
    ]
  }
}
```

## 四组行为

| 组 | 首个决定正确 | 首个任务动作 | 模型请求次数 | 先重新读取次数 |
| --- | --- | --- | ---: | ---: |
| S0 | True | search_exercises | 1 | 0 |
| T | False | search_exercises | 1 | 0 |
| M | False | search_exercises | 1 | 0 |
| TM | False | search_exercises | 1 | 0 |

### S0

原始证据：`evaluation/s0/diagnostic/episodes.jsonl` 第 12 行。

实际自主动作（额外读取也保留）：

```json
[
  {
    "tool": "search_exercises",
    "arguments": {
      "equipment": [
        "dumbbell"
      ]
    }
  }
]
```

首个任务动作的真实工具返回：

```json
{
  "ok": true,
  "result": {
    "blocks": [
      {
        "id": "dumbbell-a",
        "equipment": [
          "dumbbell"
        ],
        "minutes": 8
      },
      {
        "id": "dumbbell-b",
        "equipment": [
          "dumbbell"
        ],
        "minutes": 10
      },
      {
        "id": "dumbbell-c",
        "equipment": [
          "dumbbell"
        ],
        "minutes": 12
      }
    ]
  },
  "done": false,
  "steps_remaining": 21
}
```

与候选来源匹配的值（只表示输出值相同，不证明模型内部如何推理）：

```json
[
  {
    "id": "memory-3138c36b1044",
    "field": "equipment",
    "value": [
      "dumbbell"
    ],
    "revision": 8,
    "confirmed": true,
    "expires_on": null,
    "role": "current_confirmed_memory"
  }
]
```

停止原因：`first_decision`；策略失败：`None`。

模型请求 1 的原始服务响应（包含内容、tool calls 与 usage）：

```json
{
  "body": "{\"model\":\"Qwen/Qwen3-4B-Instruct-2507\",\"choices\":[{\"index\":0,\"message\":{\"role\":\"assistant\",\"content\":null,\"tool_calls\":[{\"id\":\"qwen-15-0\",\"type\":\"function\",\"function\":{\"name\":\"search_exercises\",\"arguments\":\"{\\\"equipment\\\":[\\\"dumbbell\\\"]}\"}}]},\"finish_reason\":\"tool_calls\"}],\"usage\":{\"prompt_tokens\":1678,\"completion_tokens\":24,\"total_tokens\":1702}}",
  "status": 200,
  "error": null,
  "elapsed_seconds": 2.3521301448345184
}
```

### T

原始证据：`evaluation/t/diagnostic/episodes.jsonl` 第 12 行。

实际自主动作（额外读取也保留）：

```json
[
  {
    "tool": "search_exercises",
    "arguments": {
      "equipment": [
        "machine"
      ]
    }
  }
]
```

首个任务动作的真实工具返回：

```json
{
  "ok": true,
  "result": {
    "blocks": [
      {
        "id": "machine-a",
        "equipment": [
          "machine"
        ],
        "minutes": 12
      },
      {
        "id": "machine-b",
        "equipment": [
          "machine"
        ],
        "minutes": 16
      }
    ]
  },
  "done": false,
  "steps_remaining": 21
}
```

与候选来源匹配的值（只表示输出值相同，不证明模型内部如何推理）：

```json
[
  {
    "id": "memory-e89c64075c2a",
    "field": "equipment",
    "value": [
      "machine"
    ],
    "revision": 12,
    "confirmed": true,
    "expires_on": "2026-09-28",
    "role": "expired_memory"
  }
]
```

停止原因：`first_decision`；策略失败：`None`。

模型请求 1 的原始服务响应（包含内容、tool calls 与 usage）：

```json
{
  "body": "{\"model\":\"Qwen/Qwen3-4B-Instruct-2507\",\"choices\":[{\"index\":0,\"message\":{\"role\":\"assistant\",\"content\":null,\"tool_calls\":[{\"id\":\"qwen-12-0\",\"type\":\"function\",\"function\":{\"name\":\"search_exercises\",\"arguments\":\"{\\\"equipment\\\":[\\\"machine\\\"]}\"}}]},\"finish_reason\":\"tool_calls\"}],\"usage\":{\"prompt_tokens\":1678,\"completion_tokens\":22,\"total_tokens\":1700}}",
  "status": 200,
  "error": null,
  "elapsed_seconds": 1.971017548814416
}
```

### M

原始证据：`evaluation/m/diagnostic/episodes.jsonl` 第 12 行。

实际自主动作（额外读取也保留）：

```json
[
  {
    "tool": "search_exercises",
    "arguments": {
      "equipment": [
        "machine"
      ]
    }
  }
]
```

首个任务动作的真实工具返回：

```json
{
  "ok": true,
  "result": {
    "blocks": [
      {
        "id": "machine-a",
        "equipment": [
          "machine"
        ],
        "minutes": 12
      },
      {
        "id": "machine-b",
        "equipment": [
          "machine"
        ],
        "minutes": 16
      }
    ]
  },
  "done": false,
  "steps_remaining": 21
}
```

与候选来源匹配的值（只表示输出值相同，不证明模型内部如何推理）：

```json
[
  {
    "id": "memory-e89c64075c2a",
    "field": "equipment",
    "value": [
      "machine"
    ],
    "revision": 12,
    "confirmed": true,
    "expires_on": "2026-09-28",
    "role": "expired_memory"
  }
]
```

停止原因：`first_decision`；策略失败：`None`。

模型请求 1 的原始服务响应（包含内容、tool calls 与 usage）：

```json
{
  "body": "{\"model\":\"Qwen/Qwen3-4B-Instruct-2507\",\"choices\":[{\"index\":0,\"message\":{\"role\":\"assistant\",\"content\":null,\"tool_calls\":[{\"id\":\"qwen-15-0\",\"type\":\"function\",\"function\":{\"name\":\"search_exercises\",\"arguments\":\"{\\\"equipment\\\":[\\\"machine\\\"]}\"}}]},\"finish_reason\":\"tool_calls\"}],\"usage\":{\"prompt_tokens\":1678,\"completion_tokens\":22,\"total_tokens\":1700}}",
  "status": 200,
  "error": null,
  "elapsed_seconds": 2.169424708932638
}
```

### TM

原始证据：`evaluation/tm/diagnostic/episodes.jsonl` 第 12 行。

实际自主动作（额外读取也保留）：

```json
[
  {
    "tool": "search_exercises",
    "arguments": {
      "equipment": [
        "machine"
      ]
    }
  }
]
```

首个任务动作的真实工具返回：

```json
{
  "ok": true,
  "result": {
    "blocks": [
      {
        "id": "machine-a",
        "equipment": [
          "machine"
        ],
        "minutes": 12
      },
      {
        "id": "machine-b",
        "equipment": [
          "machine"
        ],
        "minutes": 16
      }
    ]
  },
  "done": false,
  "steps_remaining": 21
}
```

与候选来源匹配的值（只表示输出值相同，不证明模型内部如何推理）：

```json
[
  {
    "id": "memory-e89c64075c2a",
    "field": "equipment",
    "value": [
      "machine"
    ],
    "revision": 12,
    "confirmed": true,
    "expires_on": "2026-09-28",
    "role": "expired_memory"
  }
]
```

停止原因：`first_decision`；策略失败：`None`。

模型请求 1 的原始服务响应（包含内容、tool calls 与 usage）：

```json
{
  "body": "{\"model\":\"Qwen/Qwen3-4B-Instruct-2507\",\"choices\":[{\"index\":0,\"message\":{\"role\":\"assistant\",\"content\":null,\"tool_calls\":[{\"id\":\"qwen-12-0\",\"type\":\"function\",\"function\":{\"name\":\"search_exercises\",\"arguments\":\"{\\\"equipment\\\":[\\\"machine\\\"]}\"}}]},\"finish_reason\":\"tool_calls\"}],\"usage\":{\"prompt_tokens\":1678,\"completion_tokens\":22,\"total_tokens\":1700}}",
  "status": 200,
  "error": null,
  "elapsed_seconds": 1.968427324667573
}
```

## 自己复盘

1. 不看模型输出时，依据哪些用户事件或记忆有效性字段决定下一步？
2. 如果模型重新读取，原授权或记忆规则有没有发生变化？
3. 正确/错误的是参数、动作类型、终止标签，还是根本没有作出决定？
4. 哪个配对只改变 T，哪个配对只改变 M？另一个配对是否支持相同解释？
5. 这一个案例能支持什么观察，不能支持什么总体能力结论？
