"""Plot verified development evidence; matplotlib is an optional analysis dependency."""
import argparse
from pathlib import Path

from liftcut_agent.benchmark import read_jsonl
from publish_state_coverage import verify_publication
from state_coverage import ARMS


def plot(run, reviewed, output):
    if output.exists():
        raise ValueError("new figure path required")
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    colors = ["#345995", "#D17A22", "#26886B", "#9252A1"]
    with plt.rc_context({"font.family": "DejaVu Sans", "font.size": 10, "axes.spines.top": False,
                         "axes.spines.right": False, "figure.facecolor": "white"}):
        fig, axes = plt.subplots(2, 2, figsize=(11, 7.5), constrained_layout=True)
        for arm, color in zip(ARMS, colors):
            rows = read_jsonl(run / "training" / arm / "training.jsonl")
            axes[0, 0].semilogy([r["step"] for r in rows], [r["loss"] for r in rows],
                               color=color, linewidth=1, alpha=.8, label=arm.upper())
        axes[0, 0].axvline(63.5, color="#888888", linestyle="--", linewidth=.8)
        axes[0, 0].set(title="Observed loss per optimizer update", xlabel="Update (126 per arm)",
                       ylabel="Target-token mean loss (log scale)")
        axes[0, 0].legend(ncol=4, fontsize=8)
        panels = [(axes[0, 1], "normal", "Complete development tasks"),
                  (axes[1, 0], "read_consent", "First decision: consent after a read"),
                  (axes[1, 1], "main_memory", "First decision: main memory probes")]
        for ax, key, title in panels:
            counts = [reviewed["arms"][a]["counts"][key] for a in ARMS]
            denominator = counts[0]["total"]
            if any(c["total"] != denominator or not 0 <= c["correct"] <= denominator for c in counts):
                raise ValueError("inconsistent score denominator")
            bars = ax.bar([a.upper() for a in ARMS], [c["correct"] / denominator for c in counts],
                          color=colors, width=.6)
            for bar, count in zip(bars, counts):
                ax.text(bar.get_x() + bar.get_width() / 2, bar.get_height() + .025,
                        f"{count['correct']}/{denominator}", ha="center")
            ax.set(title=title, ylim=(0, 1.13), ylabel="Fraction correct",
                   yticks=[0, .25, .5, .75, 1], yticklabels=["0", ".25", ".50", ".75", "1.00"])
        fig.suptitle("State coverage: matched targets, different outcomes\n"
                     "Seed 42 only; reused development states; correlated probes; no significance claim", fontsize=13)
        output.parent.mkdir(parents=True, exist_ok=True)
        fig.savefig(output, dpi=180)
        plt.close(fig)


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__)
    for name in ("run-dir", "prepared-dir", "diagnostic-dir", "output"):
        p.add_argument("--" + name, type=Path, required=True)
    args = p.parse_args()
    reviewed = verify_publication(args.run_dir, args.prepared_dir, args.diagnostic_dir)
    plot(args.run_dir, reviewed, args.output)
    print("Verified evidence plotted; zero new model calls: " + str(args.output))
