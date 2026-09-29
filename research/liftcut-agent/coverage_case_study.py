"""Render one verified four-arm diagnostic case for human inspection, without model calls."""
import argparse
import json
from pathlib import Path

from liftcut_agent.benchmark import read_jsonl
from publish_state_coverage import verify_publication
from state_coverage import ARMS
from state_diagnostics import load_prepared


def block(value):
    return "```json\n" + json.dumps(value, ensure_ascii=False, indent=2) + "\n```"


def render(run, diagnostic, reviewed, identity):
    cases = load_prepared(diagnostic)
    try:
        index = next(i for i, c in enumerate(cases) if c["id"] == identity)
    except StopIteration as exc:
        raise ValueError("unknown fixed-state case") from exc
    case = cases[index]
    lines = [f"# 四组原始案例：{identity}", "",
        "本文件由已通过清单与回放验证的公开证据生成；没有新增模型调用。",
        "这是固定状态下首个有任务含义的决定，不等于完整任务最终成功。", "",
        "## 相同的接手条件", "",
        "四组使用同一个前缀。下面是研究者侧的因素标签，不是额外发送给模型的输入：", "",
        block(case["factors"]), "", "用户初始请求与约束：", "", block(case["scenario"]["input"]), ""]
    if case["scenario"]["memories"]:
        lines += ["工具返回的记忆记录顺序：", "", block(case["scenario"]["memories"]), ""]
    lines += ["接手前已真实发生的动作（包含脚本工具及用户事件）：", "",
        block([{k: e[k] for k in ("index", "actor", "action")} for e in case["prefix"]["trace"]["events"]]), "",
        "## 评分依据", "", "以下参考动作只用于评分与讲解，没有作为答案提示发给模型：", "",
        block(case["expected"]["reference_action"]), "",
        "## 四组行为", "", "| 组 | 首个决定正确 | 首个任务动作 | 模型请求次数 | 先重新读取次数 |",
        "| --- | --- | --- | ---: | ---: |"]
    rows = {}
    for arm in ARMS:
        row = next(r for r in reviewed["arms"][arm]["diagnostic_cases"] if r["case_id"] == identity)
        rows[arm] = row
        tool = row["first_decision"]["tool"] if row["first_decision"] else "未作决定"
        lines.append(f"| {arm.upper()} | {row['correct']} | {tool} | {row['requests']} | {row['rereads_before_decision']} |")
    for arm in ARMS:
        row = rows[arm]
        path = run / "evaluation" / arm / "diagnostic/episodes.jsonl"
        episode = read_jsonl(path)[index]
        if episode["case_id"] != identity:
            raise ValueError("case order differs from verified diagnostic inventory")
        lines += ["", f"### {arm.upper()}", "",
            f"原始证据：`evaluation/{arm}/diagnostic/episodes.jsonl` 第 {index + 1} 行。", "",
            "实际自主动作（额外读取也保留）：", "", block(row["autonomous_actions"]), "",
            "首个任务动作的真实工具返回：", "", block(row["first_observation"]), "",
            "与候选来源匹配的值（只表示输出值相同，不证明模型内部如何推理）：", "",
            block(row["observed_value_matches"]), "",
            f"停止原因：`{row['stop_reason']}`；策略失败：`{row['policy_failure']}`。"]
        calls = episode["calls"][episode["scripted_prefix_calls"]:]
        for i, call in enumerate(calls, 1):
            lines += ["", f"模型请求 {i} 的原始服务响应（包含内容、tool calls 与 usage）：", "",
                      block(call["response"])]
    lines += ["", "## 自己复盘", "",
        "1. 不看模型输出时，依据哪些用户事件或记忆有效性字段决定下一步？",
        "2. 如果模型重新读取，原授权或记忆规则有没有发生变化？",
        "3. 正确/错误的是参数、动作类型、终止标签，还是根本没有作出决定？",
        "4. 哪个配对只改变 T，哪个配对只改变 M？另一个配对是否支持相同解释？",
        "5. 这一个案例能支持什么观察，不能支持什么总体能力结论？", ""]
    return "\n".join(lines)


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__)
    for name in ("run-dir", "prepared-dir", "diagnostic-dir", "output"):
        p.add_argument("--" + name, type=Path, required=True)
    p.add_argument("--case", required=True)
    args = p.parse_args()
    if args.output.exists():
        p.error("new output file required")
    reviewed = verify_publication(args.run_dir, args.prepared_dir, args.diagnostic_dir)
    content = render(args.run_dir, args.diagnostic_dir, reviewed, args.case)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(content, encoding="utf-8", newline="\n")
    print(json.dumps({"case": args.case, "verified_source": True, "model_calls": 0, "output": str(args.output)}))
