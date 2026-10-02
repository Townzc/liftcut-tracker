"""Plot the replayed audit, not synthetic model predictions."""
import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def plot(output):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    report = json.loads((ROOT / "reports/agent-shortfalls-2026-10-02.json").read_text(encoding="utf-8"))
    training = report["training"]["s0"]
    if any(t != training for t in report["training"].values()):
        raise ValueError("figure assumes identical target exposure across four arms")
    observed = [[report["seeds"][str(s)][arm]["planning_with_missing_fields"] for arm in ("s0", "t", "m", "tm")]
                for s in (42, 43, 44)]
    plt.rcParams.update({"font.family": "DejaVu Sans", "font.size": 10, "svg.hashsalt": "liftcut-shortfalls-v1"})
    fig, axes = plt.subplots(1, 3, figsize=(14, 4.6), gridspec_kw={"width_ratios": [1.2, 1, 1.3]})
    fig.patch.set_facecolor("#f7f9fc")
    ax = axes[0]
    matrix = ax.imshow(observed, vmin=0, vmax=5, cmap="Blues", aspect="auto")
    ax.set(xticks=range(4), xticklabels=["S0", "T", "M", "TM"], yticks=range(3), yticklabels=["seed42", "seed43", "seed44"])
    for i, row in enumerate(observed):
        for j, n in enumerate(row):
            ax.text(j, i, f"{n}/12", ha="center", va="center", color="white" if n >= 3 else "#172b4d")
    ax.set_title("A  Planning while fields are missing\nObserved model trajectories", loc="left", pad=14)
    ax.set_xlabel("Same 12 development tasks per arm")
    ax = axes[1]
    fields = training["clarification_fields"]
    names = ["max_minutes", "equipment", "available_days"]
    bars = ax.barh(range(3), [fields[n] for n in names], color=["#3174b5", "#7cafd8", "#7cafd8"])
    ax.set(yticks=range(3), yticklabels=["Time", "Equipment", "Days"], xlim=(0, 29), xlabel="Unique clarification target rows")
    ax.invert_yaxis()
    ax.bar_label(bars, padding=4)
    share = 100 * training["target_tools"]["request_clarification"]["two_epoch_target_tokens"] / training["two_epoch_target_tokens"]
    ax.set_title(f"B  Training coverage\n32/504 decisions; {share:.2f}% target tokens", loc="left", pad=14)
    ax = axes[2]
    counter = report["cpu_intervention_summary"]
    counts = [counter[k] for k in ("same_plan_now_valid", "answered_but_plan_still_invalid", "no_user_answer")]
    bars = ax.barh(range(3), counts, color=["#238b72", "#de9443", "#758298"])
    ax.set(yticks=range(3), yticklabels=["Same plan valid", "Must re-plan days", "Must wait for user"], xlim=(0, 12), xlabel="16 failed validations, unchanged plans")
    ax.invert_yaxis()
    ax.bar_label(bars, padding=4)
    ax.set_title("C  CPU clarification intervention\nNot autonomous model recovery", loc="left", pad=14)
    for ax in axes[1:]:
        ax.spines[["top", "right"]].set_visible(False)
    fig.suptitle("LiftCut R1: missing-information failures and coverage gaps", x=0.025, ha="left", fontsize=16, weight="bold")
    fig.text(0.025, 0.015, "Reused development states • Correlated tasks/arms • No independent generalization or causal training claim", color="#55657b")
    fig.tight_layout(rect=(0, .05, 1, .9), w_pad=3)
    output.parent.mkdir(parents=True, exist_ok=True)
    for extension in ("png", "svg"):
        fig.savefig(output.with_suffix("." + extension), dpi=180, facecolor=fig.get_facecolor(), metadata={"Date": None} if extension == "svg" else {})
    svg = output.with_suffix(".svg")
    svg.write_text("\n".join(line.rstrip() for line in svg.read_text(encoding="utf-8").splitlines()) + "\n",
                   encoding="utf-8", newline="\n")
    plt.close(fig)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    plot(parser.parse_args().output)
