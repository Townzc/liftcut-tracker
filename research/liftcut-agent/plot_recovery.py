"""Render audited diagnostic data with optional Matplotlib; no model execution."""

import argparse
import json
from pathlib import Path


def plot(report_dir, output_dir):
    # Keep plotting dependencies out of CPU replay/unit-test requirements.
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    import numpy as np

    if output_dir.exists():
        raise ValueError("plot output must be a fresh directory")
    original = json.loads((report_dir / "public-log-audit.json").read_text(encoding="utf-8"))
    probe = json.loads((report_dir / "identifier-probe-audit.json").read_text(encoding="utf-8"))
    arms = ("unadapted", "clean", "mixed")
    before = [sum(s["passed"] for s in original["arms"][a].values()) for a in arms]
    after = [probe["arms"][a]["passed"] for a in arms]
    if any(probe["arms"][a]["total"] != 24 for a in arms):
        raise ValueError("this figure describes only the complete 24-case diagnostic")
    plt.rcParams.update({"font.family": "DejaVu Sans", "font.size": 10,
                         "axes.spines.top": False, "axes.spines.right": False,
                         "svg.hashsalt": "liftcut-recovery-v1"})
    fig, axes = plt.subplots(1, 2, figsize=(12, 4.9), gridspec_kw={"width_ratios": [1.05, 1]})
    for arm, color, label in (("clean", "#2D5DA8", "Ordinary SFT"), ("mixed", "#A04476", "Mixed recovery SFT")):
        rows = [json.loads(line) for line in (report_dir / "training" / arm / "training.jsonl").read_text(encoding="utf-8").splitlines()]
        axes[0].plot([r["step"] for r in rows], [r["loss"] for r in rows], color=color, label=label, linewidth=1.8)
    axes[0].set(title="A. Recorded training loss", xlabel="Optimizer step", ylabel="Target-token mean cross-entropy")
    axes[0].set_yscale("log")
    axes[0].grid(axis="y", alpha=.18)
    axes[0].legend(frameon=False, fontsize=9)
    x = np.arange(3)
    bars = axes[1].bar(x - .19, before, .36, color="#D7C6AB", label="Original: category hints")
    opaque = axes[1].bar(x + .19, after, .36, color="#317B7B", label="Opaque-ID probe")
    for collection in (bars, opaque):
        axes[1].bar_label(collection, labels=[f"{int(b.get_height())}/24" for b in collection], padding=3, fontsize=9)
    axes[1].set(title="B. Task success on reused cases", ylabel="Passed episodes", ylim=(0, 27),
                xticks=x, xticklabels=("Unadapted", "Ordinary SFT", "Mixed SFT"), yticks=(0, 6, 12, 18, 24))
    axes[1].grid(axis="y", alpha=.18)
    axes[1].set_axisbelow(True)
    axes[1].legend(frameon=False, fontsize=8.5, loc="upper center", bbox_to_anchor=(.5, -.17), ncol=2)
    fig.suptitle("Recovery SFT pilot: diagnostic evidence", fontsize=16, fontweight="bold", x=.055, ha="left")
    fig.text(.055, .075, "Single seed; 12,758 supervised tokens per SFT arm. Both adapters trained with category-bearing IDs.", fontsize=9)
    fig.text(.055, .035, "Opaque IDs also change tokenization and proposal IDs. These results do not establish held-out generalization.", fontsize=9)
    fig.subplots_adjust(left=.075, right=.98, top=.82, bottom=.23, wspace=.27)
    output_dir.mkdir(parents=True, exist_ok=False)
    fig.savefig(output_dir / "recovery-diagnostic.png", dpi=170, facecolor="white")
    fig.savefig(output_dir / "recovery-diagnostic.svg", facecolor="white", metadata={"Date": None})
    plt.close(fig)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--report-dir", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()
    plot(args.report_dir, args.output_dir)
