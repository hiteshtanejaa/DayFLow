"""Statistical comparison between orchestration modes — matches the
proposal's stated analysis plan: paired t-test / Wilcoxon signed-rank,
Cohen's d, significance threshold p < 0.05.

Both tests are reported rather than pre-choosing one — whether the
parametric t-test or the non-parametric Wilcoxon is the "right" one
depends on whether the paired differences are roughly normal, which you
can only judge once you have real data. Standard practice: report both,
justify the choice you lead with in the write-up based on what the data
actually looks like.
"""
from __future__ import annotations

import numpy as np
from scipy import stats as scipy_stats


def paired_comparison(react_values: list[float], hierarchical_values: list[float]) -> dict:
    if len(react_values) != len(hierarchical_values):
        raise ValueError("paired comparison requires equal-length, matched samples")
    if len(react_values) < 2:
        raise ValueError("need at least 2 paired observations for a meaningful test")

    react_arr = np.array(react_values, dtype=float)
    hier_arr = np.array(hierarchical_values, dtype=float)
    diff = react_arr - hier_arr

    t_stat, t_p = scipy_stats.ttest_rel(react_arr, hier_arr)

    if np.all(diff == 0):
        w_stat, w_p = float("nan"), float("nan")
    else:
        w_stat, w_p = scipy_stats.wilcoxon(react_arr, hier_arr)

    pooled_std = np.sqrt((react_arr.std(ddof=1) ** 2 + hier_arr.std(ddof=1) ** 2) / 2)
    cohens_d = float(diff.mean() / pooled_std) if pooled_std > 0 else 0.0

    return {
        "n": len(react_values),
        "react_mean": float(react_arr.mean()),
        "react_std": float(react_arr.std(ddof=1)),
        "hierarchical_mean": float(hier_arr.mean()),
        "hierarchical_std": float(hier_arr.std(ddof=1)),
        "t_statistic": float(t_stat),
        "t_p_value": float(t_p),
        "wilcoxon_statistic": float(w_stat),
        "wilcoxon_p_value": float(w_p),
        "cohens_d": cohens_d,
        "significant_at_0.05": bool(t_p < 0.05),
    }


def mcnemar_test(react_correct: list[bool], hier_correct: list[bool]) -> dict:
    """McNemar's exact test — the right test for a paired BINARY outcome
    (same 50 scenarios, pass/fail per mode), which scheduling_accuracy is.
    A t-test/Wilcoxon on 0/1 values would be the wrong tool here; McNemar
    looks only at the discordant pairs (scenarios where the two modes
    disagreed) via an exact binomial test on them, which is what the
    proposal's "compare metrics between architectural variants" plan
    actually calls for on a binary metric.
    """
    if len(react_correct) != len(hier_correct):
        raise ValueError("mcnemar_test requires equal-length, matched samples")

    both_correct = sum(1 for r, h in zip(react_correct, hier_correct) if r and h)
    both_wrong = sum(1 for r, h in zip(react_correct, hier_correct) if not r and not h)
    react_only = sum(1 for r, h in zip(react_correct, hier_correct) if r and not h)
    hier_only = sum(1 for r, h in zip(react_correct, hier_correct) if not r and h)

    discordant = react_only + hier_only
    if discordant == 0:
        p_value = 1.0
    else:
        result = scipy_stats.binomtest(min(react_only, hier_only), discordant, 0.5)
        p_value = float(result.pvalue)

    return {
        "n": len(react_correct),
        "both_correct": both_correct,
        "both_wrong": both_wrong,
        "react_only_correct": react_only,
        "hierarchical_only_correct": hier_only,
        "discordant_pairs": discordant,
        "p_value": p_value,
        "significant_at_0.05": bool(p_value < 0.05),
    }
