"""Plot an already audited frozen three-seed review; never perform a new audit.

This validates the review's schema and internal arithmetic, not its provenance.
Run the frozen reviewer on genuine restored evidence first. No model, tokenizer,
weight or reserved-task access is needed here. Matplotlib is optional until plot().
"""
import argparse
import json
import math
from pathlib import Path
import re
import statistics

from prepare_state_coverage import GATES

SEEDS = ("42", "43", "44")
ARMS = ("s0", "t", "m", "tm")
PAIRS = ("s0->t", "m->tm", "s0->m", "t->tm")
METRICS = {"normal": 12, "read_consent": 3, "main_memory": 8}
PANEL_TOTALS = {"normal": 12, "all_consent": 10, "main_memory": 8}


def keys(value, expected, context):
    if not isinstance(value, dict) or set(value) != set(expected):
        raise ValueError("unexpected " + context + " fields")


def integer(value, context, minimum=None, maximum=None):
    if (type(value) is not int or (minimum is not None and value < minimum)
            or (maximum is not None and value > maximum)):
        raise ValueError("invalid integer: " + context)
    return value


def boolean(value, expected, context):
    if type(value) is not bool or value is not expected:
        raise ValueError("inconsistent " + context)


def identifiers(value, maximum, context):
    if (not isinstance(value, list) or len(value) > maximum
            or any(not isinstance(item, str) or not item for item in value)
            or len(value) != len(set(value))):
        raise ValueError("invalid case identifiers: " + context)
    return set(value)


def changes(value, total, context):
    keys(value, ("gained", "lost", "net"), context)
    gained = identifiers(value["gained"], total, context)
    lost = identifiers(value["lost"], total, context)
    if gained & lost or len(gained | lost) > total:
        raise ValueError("overlapping or excessive paired cases: " + context)
    if integer(value["net"], context, -total, total) != len(gained) - len(lost):
        raise ValueError("paired net differs from gains/losses: " + context)


def validate_review(review):
    """Reject missing seeds, single-seed input and contradictory plotted claims."""
    keys(review, ("scope", "pairs", "panels", "representative_checkpoint_seed",
        "prospective_non_regression_guard", "guard_limit", "new_model_calls", "test_episodes",
        "limit", "source_sha256", "initialization"), "three-seed review")
    if integer(review["representative_checkpoint_seed"], "representative seed") != 42:
        raise ValueError("representative checkpoint must remain seed42")
    for name in ("new_model_calls", "test_episodes"):
        if integer(review[name], name) != 0:
            raise ValueError("plot accepts only zero-call, zero-test development reviews")
    for name in ("scope", "guard_limit", "limit"):
        if not isinstance(review[name], str) or not review[name]:
            raise ValueError("missing review boundary: " + name)
    keys(review["source_sha256"], ("seed" + seed + "_comparison" for seed in SEEDS), "sources")
    for value in review["source_sha256"].values():
        if not isinstance(value, str) or re.fullmatch(r"[0-9a-f]{64}", value) is None:
            raise ValueError("invalid comparison source SHA256")
    initialization = review["initialization"]
    keys(initialization, ("seed42", "seed43", "seed44", "new_seeds_differ"), "initialization")
    if initialization["seed42"] != "not recorded by the historical runner":
        raise ValueError("historical seed42 initialization must stay unrecorded")
    for name in ("seed43", "seed44"):
        if not isinstance(initialization[name], str) or re.fullmatch(r"[0-9a-f]{64}", initialization[name]) is None:
            raise ValueError("invalid new-seed initialization SHA256")
    if initialization["seed43"] == initialization["seed44"]:
        raise ValueError("new seeds must have different initialization fingerprints")
    boolean(initialization["new_seeds_differ"], True, "initialization distinction")

    panels = review["panels"]
    keys(panels, SEEDS, "seed panels")
    for seed in SEEDS:
        keys(panels[seed], ARMS, "arm panels")
        for counts in panels[seed].values():
            keys(counts, (*PANEL_TOTALS, "autonomous_blocked_writes"), "panel counts")
            for name, total in PANEL_TOTALS.items():
                integer(counts[name], name, 0, total)
            integer(counts["autonomous_blocked_writes"], "blocked attempts", 0)

    pairs = review["pairs"]
    keys(pairs, PAIRS, "original pairs")
    for pair in PAIRS:
        record = pairs[pair]
        before, after = pair.split("->")
        factor = "T" if pair in ("s0->t", "m->tm") else "M"
        keys(record, ("per_seed", "effects", "original_screen_pass_count",
                      "original_screen_reproduced_in_all_three"), "pair summary")
        keys(record["per_seed"], SEEDS, "pair seeds")
        for seed, row in record["per_seed"].items():
            keys(row, ("factor", *METRICS, "all_diagnostic_changes", "memory_clarification_gains",
                       "autonomous_blocked_write_delta", "cases_with_added_blocked_writes",
                       "development_gate_passed"), "paired result")
            if row["factor"] != factor:
                raise ValueError("factor does not match original pair")
            for metric, total in (*METRICS.items(), ("all_diagnostic_changes", 19)):
                changes(row[metric], total, pair + "/" + seed + "/" + metric)
            for metric in ("normal", "main_memory"):
                old, new = panels[seed][before][metric], panels[seed][after][metric]
                if (row[metric]["net"] != new - old or len(row[metric]["lost"]) > old
                        or len(row[metric]["gained"]) > METRICS[metric] - old):
                    raise ValueError("paired changes disagree with arm counts")
            read_cases = set(row["read_consent"]["gained"]) | set(row["read_consent"]["lost"])
            memory_cases = set(row["main_memory"]["gained"]) | set(row["main_memory"]["lost"])
            if read_cases & memory_cases:
                raise ValueError("read-consent and main-memory case identifiers must be disjoint")
            for metric in ("read_consent", "main_memory"):
                for direction in ("gained", "lost"):
                    if not set(row[metric][direction]) <= set(row["all_diagnostic_changes"][direction]):
                        raise ValueError("subpanel changes absent from diagnostic changes")
            clarifying = identifiers(row["memory_clarification_gains"], 8, "clarification gains")
            if not clarifying <= set(row["main_memory"]["gained"]):
                raise ValueError("clarification gain absent from main-memory gains")
            added = identifiers(row["cases_with_added_blocked_writes"], 31, "added blocked attempts")
            delta = integer(row["autonomous_blocked_write_delta"], "blocked-attempt delta")
            if delta != panels[seed][after]["autonomous_blocked_writes"] - panels[seed][before]["autonomous_blocked_writes"]:
                raise ValueError("blocked-attempt delta disagrees with arm counts")
            if len(added) > panels[seed][after]["autonomous_blocked_writes"] or (delta > 0 and not added):
                raise ValueError("added blocked-write cases disagree with attempt totals")
            expected = row["normal"]["net"] >= -GATES["max_normal_net_loss"] and (
                (row["read_consent"]["net"] >= GATES["T"]["read_consent_net_gain"] and not added)
                if factor == "T" else
                (row["main_memory"]["net"] >= GATES["M"]["main_memory_net_gain"] and bool(clarifying)))
            boolean(row["development_gate_passed"], expected, "original screening gate")
        passed = sum(row["development_gate_passed"] for row in record["per_seed"].values())
        if integer(record["original_screen_pass_count"], "screen pass count", 0, 3) != passed:
            raise ValueError("screen pass count differs from seed results")
        boolean(record["original_screen_reproduced_in_all_three"], passed == 3, "three-seed screen")
        keys(record["effects"], METRICS, "effect metrics")
        for metric, effect in record["effects"].items():
            keys(effect, ("per_seed", "minimum", "maximum", "mean", "sign_reversal"), "effect")
            keys(effect["per_seed"], SEEDS, "effect seeds")
            values = [record["per_seed"][seed][metric]["net"] for seed in SEEDS]
            for seed, value in zip(SEEDS, values):
                if integer(effect["per_seed"][seed], "per-seed effect") != value:
                    raise ValueError("effect differs from paired net")
            for name, expected in (("minimum", min(values)), ("maximum", max(values)),
                                   ("mean", statistics.mean(values))):
                value = effect[name]
                if type(value) not in (int, float) or not math.isfinite(value) or value != expected:
                    raise ValueError("inconsistent effect statistic: " + name)
            boolean(effect["sign_reversal"], min(values) < 0 < max(values), "effect sign reversal")
    for seed in SEEDS:
        for metric in METRICS:
            net = lambda pair: pairs[pair]["per_seed"][seed][metric]["net"]
            if net("s0->t") + net("t->tm") != net("s0->m") + net("m->tm"):
                raise ValueError("four paired differences do not share consistent arm totals")

    guards = review["prospective_non_regression_guard"]
    keys(guards, ("t", "m", "tm"), "candidate guards")
    for arm, guard in guards.items():
        keys(guard, ("per_seed", "all_three_pass"), "candidate guard")
        keys(guard["per_seed"], SEEDS, "guard seeds")
        for seed, row in guard["per_seed"].items():
            keys(row, ("net_change_vs_s0", "lost_correct_consent_cases", "autonomous_blocked_writes",
                       "necessary_guard_passed"), "per-seed candidate guard")
            keys(row["net_change_vs_s0"], PANEL_TOTALS, "guard changes")
            for metric in PANEL_TOTALS:
                if integer(row["net_change_vs_s0"][metric], "guard net") != panels[seed][arm][metric] - panels[seed]["s0"][metric]:
                    raise ValueError("guard change disagrees with arm counts")
            lost = identifiers(row["lost_correct_consent_cases"], 10, "lost consent cases")
            old, new = panels[seed]["s0"]["all_consent"], panels[seed][arm]["all_consent"]
            if len(lost) > old or not 0 <= new - old + len(lost) <= 10 - old:
                raise ValueError("lost consent cases disagree with consent counts")
            blocked = integer(row["autonomous_blocked_writes"], "guard blocked attempts", 0)
            if blocked != panels[seed][arm]["autonomous_blocked_writes"]:
                raise ValueError("guard blocked attempts disagree with arm counts")
            expected = not lost and blocked == 0 and all(v >= 0 for v in row["net_change_vs_s0"].values())
            boolean(row["necessary_guard_passed"], expected, "necessary candidate guard")
        boolean(guard["all_three_pass"], all(row["necessary_guard_passed"] for row in guard["per_seed"].values()),
                "three-seed candidate guard")
    return review


def _unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate review JSON key")
        result[key] = value
    return result


def read_review(path):
    return validate_review(json.loads(Path(path).read_text(encoding="utf-8"), object_pairs_hook=_unique_object))


def plot(review, output, *, synthetic=False):
    validate_review(review)
    synthetic = synthetic or review["scope"].startswith("SYNTHETIC LAYOUT")
    output = Path(output)
    if output.exists():
        raise ValueError("new figure path required; never overwrite an existing figure")
    if output.suffix.lower() not in (".png", ".pdf", ".svg"):
        raise ValueError("figure format must be PNG, PDF or SVG")
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.lines import Line2D
    from matplotlib.patches import Patch

    colors = ("#526B8A", "#087F78", "#B16420")
    names = {"normal": "Full tasks (12)", "read_consent": "Read consent (3)", "main_memory": "Main memory (8)"}
    with plt.rc_context({"font.family": "DejaVu Sans", "font.size": 10,
                         "axes.spines.top": False, "axes.spines.right": False}):
        fig = plt.figure(figsize=(15, 11.8), facecolor="white")
        grid = fig.add_gridspec(3, 2, height_ratios=(1, 1, .7), hspace=.40, wspace=.17)
        for index, pair in enumerate(PAIRS):
            ax = fig.add_subplot(grid[index // 2, index % 2])
            record = review["pairs"][pair]
            largest = max(len(row[metric][direction]) for row in record["per_seed"].values()
                          for metric in METRICS for direction in ("gained", "lost"))
            limit = max(1, largest)
            for position, metric in enumerate(METRICS):
                for offset, (seed, color) in enumerate(zip(SEEDS, colors)):
                    change = record["per_seed"][seed][metric]
                    gained, lost = len(change["gained"]), len(change["lost"])
                    x = position * 1.3 + (offset - 1) * .30
                    ax.bar(x, gained, width=.26, color=color)
                    ax.bar(x, -lost, width=.26, color=color, hatch="///", edgecolor="white", linewidth=.3)
                    ax.plot(x, change["net"], "D", color="#17252F", markersize=4)
                    ax.text(x, gained + .10, f"+{gained}/-{lost}", ha="center", va="bottom", fontsize=8)
            short_names = {"normal": "full tasks", "read_consent": "read consent", "main_memory": "memory"}
            flips = [short_names[name] for name in METRICS if record["effects"][name]["sign_reversal"]]
            ax.set(title=pair.upper().replace("->", " → ") + "\nSign reversal: " + (", ".join(flips) or "none"),
                   xticks=[i * 1.3 for i in range(3)], xticklabels=list(names.values()),
                   ylim=(-limit - .65, limit + .85), ylabel="Paired case count")
            ax.axhline(0, color="#465763", linewidth=.7)
            ax.yaxis.set_major_locator(plt.MaxNLocator(integer=True))
            ax.grid(axis="y", color="#E4E8EB", linewidth=.6)
            ax.set_axisbelow(True)

        def table(ax, rows, row_labels, title, columns):
            ax.axis("off")
            ax.set_title(title, loc="left", pad=13, fontsize=11)
            cells = ax.table(cellText=rows, rowLabels=row_labels, colLabels=columns,
                             cellLoc="center", loc="upper center", bbox=[.07, .15, .93, .83])
            cells.auto_set_font_size(False)
            cells.set_fontsize(10)
            for (row, column), cell in cells.get_celld().items():
                cell.set_edgecolor("#DBE2E7")
                if row == 0 or column == -1:
                    cell.set_facecolor("#EEF2F5")
                elif ("Fail" in cell.get_text().get_text() or cell.get_text().get_text().startswith("No")
                      or (cell.get_text().get_text().endswith("/3") and cell.get_text().get_text() != "3/3")):
                    cell.set_facecolor("#FCEBE4")
                else:
                    cell.set_facecolor("#E3F2EC")
            return ax

        rows = [["Pass" if review["pairs"][pair]["per_seed"][seed]["development_gate_passed"] else "Fail"
                 for seed in SEEDS] + [str(review["pairs"][pair]["original_screen_pass_count"]) + "/3"] for pair in PAIRS]
        ax = table(fig.add_subplot(grid[2, 0]), rows, [p.upper().replace("->", "→") for p in PAIRS],
                   "Original development screen — report every pair", ["Seed " + s for s in SEEDS] + ["Pass count"])
        ax.text(.07, -.04, "A reproduced screen is a local factor result; it does not admit a candidate.", transform=ax.transAxes, fontsize=9)
        rows = []
        for arm in ("t", "m", "tm"):
            guard = review["prospective_non_regression_guard"][arm]
            rows.append([("Pass" if guard["per_seed"][seed]["necessary_guard_passed"] else "Fail")
                         + " | W=" + str(guard["per_seed"][seed]["autonomous_blocked_writes"]) for seed in SEEDS]
                        + ["Yes" if guard["all_three_pass"] else "No"])
        ax = table(fig.add_subplot(grid[2, 1]), rows, [a.upper() for a in ("t", "m", "tm")],
                   "Candidate non-regression guard — necessary only", ["Seed " + s for s in SEEDS] + ["All three pass"])
        ax.text(.07, -.04, "W = blocked unapproved-write attempts; any attempt vetoes this guard.", transform=ax.transAxes, fontsize=9)
        handles = [Patch(facecolor=color, label="Seed " + seed) for seed, color in zip(SEEDS, colors)]
        handles += [Patch(facecolor="#CCD5DB", hatch="///", label="Losses below zero"),
                    Line2D([], [], marker="D", linestyle="none", color="#17252F", label="Net gain − loss")]
        fig.legend(handles=handles, loc="upper center", bbox_to_anchor=(.5, .953), ncol=5, frameon=False)
        title = "R1 replication: separate training seeds on reused development states"
        if synthetic:
            title = "SYNTHETIC LAYOUT TEST — NO SEED44 RESULT\n" + title
        fig.suptitle(title, y=.989, fontsize=15, color="#A53120" if synthetic else "#17252F")
        fig.text(.5, .025, "Labels show +gained / −lost cases. Sign reversal requires both negative and positive net effects; zero is not a reversal.", ha="center", fontsize=9)
        fig.text(.5, .008, "No pooled independent-task sample, uncertainty estimate or promotion claim. Representative checkpoint stays seed42; full case IDs remain in the review JSON.", ha="center", fontsize=9)
        fig.subplots_adjust(top=.90, bottom=.10, left=.055, right=.985)
        output.parent.mkdir(parents=True, exist_ok=True)
        try:
            # Exclusive creation also prevents an overwrite if another process wins a race.
            with output.open("xb") as stream:
                fig.savefig(stream, format=output.suffix[1:].lower(), dpi=180)
        finally:
            plt.close(fig)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--review", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    plot(read_review(args.review), args.output)
    print(json.dumps({"figure": str(args.output), "input": str(args.review),
        "review_consistency_verified": True, "source_audit_performed_now": False,
        "new_model_calls": 0, "test_episodes": 0}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
