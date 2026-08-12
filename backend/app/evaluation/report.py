"""Aggregates ScenarioResult rows into the RQ1 evaluation report:
per-mode automated metrics plus the paired statistical comparison."""
from __future__ import annotations

from app.evaluation.metrics import (
    conflict_resolved,
    intent_extraction_f1,
    is_hallucination,
    percentiles,
    scheduling_accuracy,
)
from app.evaluation.runner import ScenarioResult
from app.evaluation.stats import mcnemar_test, paired_comparison


def _mode_summary(results: list[ScenarioResult]) -> dict:
    ok = [r for r in results if r.error is None]
    errored = [r for r in results if r.error is not None]

    accuracies = [scheduling_accuracy(r.produced_blocks, r.ground_truth_blocks) for r in ok]
    conflict_scenarios = [r for r in ok if r.had_conflict_risk]
    conflicts_resolved = [conflict_resolved(r.violations) for r in conflict_scenarios]
    hallucinations = [is_hallucination(r.violations) for r in ok]
    f1_scores = [intent_extraction_f1(r.extracted_titles, r.ground_truth_titles) for r in ok]
    latencies = [r.total_latency_ms for r in ok]
    tokens = [r.total_tokens_input + r.total_tokens_output for r in ok if (r.total_tokens_input + r.total_tokens_output) > 0]

    return {
        "n_scenarios": len(results),
        "n_errored": len(errored),
        "scheduling_accuracy_pct": 100 * sum(accuracies) / len(accuracies) if accuracies else float("nan"),
        "conflict_resolution_rate_pct": (
            100 * sum(conflicts_resolved) / len(conflicts_resolved) if conflicts_resolved else float("nan")
        ),
        "n_conflict_scenarios": len(conflict_scenarios),
        "hallucination_rate_pct": 100 * sum(hallucinations) / len(hallucinations) if hallucinations else float("nan"),
        "mean_intent_f1": sum(f1_scores) / len(f1_scores) if f1_scores else float("nan"),
        "latency_ms": percentiles(latencies),
        "mean_tokens_per_call": sum(tokens) / len(tokens) if tokens else float("nan"),
    }


def build_report(results: list[ScenarioResult]) -> dict:
    react = [r for r in results if r.mode == "react"]
    hier = [r for r in results if r.mode == "hierarchical"]

    report = {
        "react": _mode_summary(react),
        "hierarchical": _mode_summary(hier),
    }

    # Paired stats need matched scenario_id pairs present in both modes
    # with no error on either side.
    react_by_id = {r.scenario_id: r for r in react if r.error is None}
    hier_by_id = {r.scenario_id: r for r in hier if r.error is None}
    common_ids = sorted(set(react_by_id) & set(hier_by_id))

    if len(common_ids) >= 2:
        react_latency = [react_by_id[i].total_latency_ms for i in common_ids]
        hier_latency = [hier_by_id[i].total_latency_ms for i in common_ids]
        report["latency_comparison"] = paired_comparison(react_latency, hier_latency)

        react_f1 = [intent_extraction_f1(react_by_id[i].extracted_titles, react_by_id[i].ground_truth_titles) for i in common_ids]
        hier_f1 = [intent_extraction_f1(hier_by_id[i].extracted_titles, hier_by_id[i].ground_truth_titles) for i in common_ids]
        report["intent_f1_comparison"] = paired_comparison(react_f1, hier_f1)

        # Binary paired outcome — McNemar's, not a t-test. See stats.py.
        react_acc = [scheduling_accuracy(react_by_id[i].produced_blocks, react_by_id[i].ground_truth_blocks) for i in common_ids]
        hier_acc = [scheduling_accuracy(hier_by_id[i].produced_blocks, hier_by_id[i].ground_truth_blocks) for i in common_ids]
        report["accuracy_comparison"] = mcnemar_test(react_acc, hier_acc)
    else:
        report["_warning"] = f"only {len(common_ids)} matched scenario pairs — need >=2 for paired stats"

    return report


def print_report(report: dict) -> None:
    for mode in ("react", "hierarchical"):
        s = report[mode]
        print(f"\n=== {mode.upper()} ===")
        print(f"  Scenarios: {s['n_scenarios']} ({s['n_errored']} errored)")
        print(f"  Scheduling accuracy: {s['scheduling_accuracy_pct']:.1f}%")
        print(f"  Conflict resolution: {s['conflict_resolution_rate_pct']:.1f}% (n={s['n_conflict_scenarios']} scenarios with conflict risk)")
        print(f"  Hallucination rate: {s['hallucination_rate_pct']:.1f}%")
        print(f"  Mean intent extraction F1: {s['mean_intent_f1']:.3f}")
        lat = s["latency_ms"]
        print(f"  Latency: P50={lat['p50']:.0f}ms P90={lat['p90']:.0f}ms P99={lat['p99']:.0f}ms")
        print(f"  Mean tokens/call: {s['mean_tokens_per_call']:.0f}")

    if "_warning" in report:
        print(f"\nWARNING: {report['_warning']}")
        return

    print("\n=== STATISTICAL COMPARISON (ReAct vs Hierarchical) ===")
    for metric_name, key in [("Latency", "latency_comparison"), ("Intent F1", "intent_f1_comparison")]:
        c = report[key]
        print(f"\n{metric_name}: react_mean={c['react_mean']:.2f} hier_mean={c['hierarchical_mean']:.2f}")
        print(f"  paired t-test: t={c['t_statistic']:.3f}, p={c['t_p_value']:.4f}")
        print(f"  Wilcoxon: W={c['wilcoxon_statistic']:.3f}, p={c['wilcoxon_p_value']:.4f}")
        print(f"  Cohen's d: {c['cohens_d']:.3f}")
        print(f"  significant at p<0.05: {c['significant_at_0.05']}")

    a = report["accuracy_comparison"]
    print(f"\nScheduling accuracy (McNemar's exact test, n={a['n']}):")
    print(f"  both correct: {a['both_correct']}  both wrong: {a['both_wrong']}")
    print(f"  react-only correct: {a['react_only_correct']}  hierarchical-only correct: {a['hierarchical_only_correct']}")
    print(f"  discordant pairs: {a['discordant_pairs']}, p={a['p_value']:.4f}")
    print(f"  significant at p<0.05: {a['significant_at_0.05']}")
