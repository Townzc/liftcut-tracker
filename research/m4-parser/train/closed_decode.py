"""Experimental G1 label grammar. No source interpretation or output repair."""
import json

REASONS = ("uncertain_quantity", "plan_not_actual", "negation", "question", "missing_reps", "missing_unit",
           "unsupported_unit", "rpe_scope", "unknown_exercise", "out_of_range")


def label_grammar(exercises):
    if (not isinstance(exercises, list) or not 1 <= len(exercises) <= 100
            or any(not isinstance(x, str) or x != x.strip() or not 1 <= len(x) <= 60 for x in exercises)
            or len(set(exercises)) != len(exercises)):
        raise ValueError("Use 1..100 unique nonempty exercise names, at most 60 characters each")
    literal = lambda text: json.dumps(text, ensure_ascii=False)
    value = lambda data: literal(json.dumps(data, ensure_ascii=False, separators=(",", ":")))
    enum = lambda values: " | ".join(value(x) for x in values)
    obj = lambda fields: '"{" ws ' + ' ws "," ws '.join(value(k) + ' ws ":" ws ' + v for k, v in fields) + ' ws "}"'
    fields = lambda intent, rest=(): [("intent", value(intent)), *rest]
    weighted = [("weight", "weight"), ("unit", "unit")]
    reps = [("reps", "reps")]
    rpe = [("rpe", "rpe")]
    corrections = [obj([*(weighted if mask & 1 else []), *(reps if mask & 2 else []), *(rpe if mask & 4 else [])])
                   for mask in range(1, 8)]
    rules = {
        "root": "ws (record | repeat | correct | skip | end | clarify) ws",
        "ws": r"[ \t\r\n]{0,8}",
        "exercise": enum([None, *exercises]), "unit": enum(["kg", "lb"]),
        "reps": r'([0-9] | [1-9] [0-9] | "100")',
        "index": r'([1-9] | [1-9] [0-9] | "100")',
        "count": r'([1-9] | "1" [0-6])',
        "weight": r'(("0" | [1-9] [0-9]{0,2} | "1" [0-9]{3} | "2" [0-1] [0-9]{2} | "220" [0-4]) ("." [0-9]{1,4})? | "2205")',
        "rpe": r'([1-9] (".0" | ".5")? | "10" (".0")?)',
        "effort": '"null" | rpe', "target": 'index | ' + value("last"),
        "set": obj([*weighted, *reps, ("rpe", "effort")]) + " | " + obj([("weight", '"null"'), ("unit", '"null"'), *reps, ("rpe", "effort")]),
        "sets": r'"[" ws set (ws "," ws set){0,15} ws "]"',
        "changes": " | ".join(corrections),
        "record": obj(fields("record", [("exercise", "exercise"), ("sets", "sets")])),
        "repeat": obj(fields("repeat", [("exercise", "exercise"), ("count", "count")])),
        "correct": obj(fields("correct", [("exercise", "exercise"), ("target", "target"), ("changes", "changes")])),
        "skip-target": "target | " + value("next"),
        "skip": obj(fields("skip", [("exercise", "exercise"), ("target", "skip-target")])),
        "end": obj(fields("end")), "reason": enum(REASONS),
        "clarify": obj(fields("clarify", [("reason", "reason")])),
    }
    return "\n".join(name + " ::= " + rule for name, rule in rules.items()) + "\n"
