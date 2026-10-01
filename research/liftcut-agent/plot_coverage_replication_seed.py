"""Plot one genuinely audited R1 seed against seed42; no pooled task sample."""
import argparse
from pathlib import Path

from prepare_coverage_replication import ARMS, RUN_SEEDS
from review_coverage_replication_seed import review
from server_workspace import dump_new


def plot(reviewed, output):
    if output.exists():
        raise ValueError("new figure path required")
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    seed = reviewed["seed"]
    colors = ("#627588", "#007D79")
    with plt.rc_context({"font.family": "DejaVu Sans", "font.size": 10,
                         "axes.spines.top": False, "axes.spines.right": False,
                         "figure.facecolor": "white"}):
        fig, axes = plt.subplots(2, 2, figsize=(11, 7.5))
        panels = [("normal", "Complete development tasks"),
                  ("read_consent", "First decision: consent after a read"),
                  ("main_memory", "First decision: main memory probes"),
                  (None, "Autonomous unapproved-write attempts (all blocked)")]
        for ax, (panel, title) in zip(axes.flat, panels):
            if panel:
                rows = [reviewed["arms"][arm]["counts"][panel] for arm in ARMS]
                total = rows[0]["total"]
                values = [[r[key] for r in rows] for key in ("seed42_correct", "current_correct")]
                if any(r["total"] != total for r in rows) or any(not 0 <= v <= total for group in values for v in group):
                    raise ValueError("invalid paired panel counts")
                ax.set(ylim=(0, total * 1.18), ylabel="Correct cases")
            else:
                total = None
                values = [[reviewed["arms"][arm]["blocked_attempts"][key]["total"] for arm in ARMS]
                          for key in ("seed42", "current")]
                maximum = max(max(group) for group in values)
                ax.set(ylim=(0, max(1, maximum) * 1.35), ylabel="Attempt count; lower is better")
            for index, (group, color) in enumerate(zip(values, colors)):
                positions = [i + (index - .5) * .36 for i in range(len(ARMS))]
                bars = ax.bar(positions, group, width=.34, color=color,
                              label="Seed 42" if index == 0 else f"Seed {seed}")
                labels = [f"{value}/{total}" if total else str(value) for value in group]
                ax.bar_label(bars, labels=labels, padding=3, fontsize=9)
            ax.set(title=title, xticks=range(len(ARMS)), xticklabels=[arm.upper() for arm in ARMS])
            ax.yaxis.set_major_locator(plt.MaxNLocator(integer=True))
            ax.set_axisbelow(True)
            ax.grid(axis="y", color="#E4E8EB", linewidth=.6)
        handles, labels = axes[0, 0].get_legend_handles_labels()
        fig.legend(handles, labels, loc="upper center", bbox_to_anchor=(.5, .925), ncol=2, frameon=False)
        fig.suptitle(f"State coverage: seed 42 and seed {seed}\n"
                     "Reused development states; three-seed review remains separate", fontsize=14, y=.985)
        fig.text(.5, .018, "Panels have separate denominators. Correlated cases are not independent samples; no significance claim.",
                 ha="center", fontsize=9, color="#485563")
        fig.subplots_adjust(top=.84, bottom=.09, hspace=.35, wspace=.24, left=.07, right=.98)
        output.parent.mkdir(parents=True, exist_ok=True)
        fig.savefig(output, dpi=180)
        plt.close(fig)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("run-dir", "prepared-dir", "diagnostic-dir", "replication-dir", "tokenizer-dir", "output"):
        parser.add_argument("--" + name, type=Path, required=True)
    parser.add_argument("--review-output", type=Path)
    parser.add_argument("--seed", type=int, choices=RUN_SEEDS, required=True)
    args = parser.parse_args()
    result = review(args.run_dir, args.prepared_dir, args.diagnostic_dir,
                    args.replication_dir, args.seed, args.tokenizer_dir)
    plot(result, args.output)
    if args.review_output:
        dump_new(args.review_output, result)
    print({"figure": str(args.output), "seed": args.seed, "new_model_calls": 0})
