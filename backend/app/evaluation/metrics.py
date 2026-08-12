"""Automated metrics for the RQ1 benchmark, matching the proposal's
Evaluation Framework for RQ1 — Orchestration Pattern Comparison.

Known simplification, stated up front rather than hidden: task matching
between LLM-extracted titles and ground-truth titles uses normalized
substring matching (case-insensitive, either-direction containment), not
full NLP alignment. Good enough to validate the harness and get a first
read on the two architectures; worth upgrading to embedding similarity or
manual review before the numbers go in the dissertation's evaluation
chapter.
"""
from __future__ import annotations

from app.models.schemas import ScheduleBlock, ScheduleViolation


def _normalize(title: str) -> str:
    return title.strip().lower()


def _titles_match(a: str, b: str) -> bool:
    na, nb = _normalize(a), _normalize(b)
    return na == nb or na in nb or nb in na


def scheduling_accuracy(produced: list[ScheduleBlock], ground_truth: list[ScheduleBlock], tolerance_minutes: int = 15) -> bool:
    """Scenario-level pass/fail per the proposal: output matches ground
    truth within a 15-minute tolerance on every event boundary."""
    if len(produced) != len(ground_truth):
        return False
    remaining_gt = list(ground_truth)
    for p in produced:
        match = next((g for g in remaining_gt if _titles_match(p.title, g.title)), None)
        if match is None:
            return False
        start_diff = abs((p.start - match.start).total_seconds()) / 60
        end_diff = abs((p.end - match.end).total_seconds()) / 60
        if start_diff > tolerance_minutes or end_diff > tolerance_minutes:
            return False
        remaining_gt.remove(match)
    return True


def conflict_resolved(violations: list[ScheduleViolation]) -> bool:
    """True if no calendar-conflict violation appears — used only on
    scenarios that actually had a pre-existing busy slot to conflict
    with (see `has_conflict_risk` on the scenario)."""
    return not any("conflicts with an existing calendar event" in v.reason for v in violations)


def is_hallucination(violations: list[ScheduleViolation]) -> bool:
    """Any hard-constraint violation at all — outside working hours,
    calendar conflict, or overlap. The proposal's example is working-hours
    violations specifically; this counts every Validator-caught violation
    type, a broader (stricter) reading worth noting in the write-up."""
    return len(violations) > 0


def intent_extraction_f1(extracted_titles: list[str], ground_truth_titles: list[str]) -> float:
    """Task-level F1 (see module docstring re: matching simplification)."""
    if not extracted_titles and not ground_truth_titles:
        return 1.0
    remaining_gt = list(ground_truth_titles)
    matched = 0
    for et in extracted_titles:
        hit = next((gt for gt in remaining_gt if _titles_match(et, gt)), None)
        if hit is not None:
            matched += 1
            remaining_gt.remove(hit)
    precision = matched / len(extracted_titles) if extracted_titles else 0.0
    recall = matched / len(ground_truth_titles) if ground_truth_titles else 0.0
    if precision + recall == 0:
        return 0.0
    return 2 * precision * recall / (precision + recall)


def percentiles(values: list[float], ps: tuple[int, ...] = (50, 90, 99)) -> dict[str, float]:
    if not values:
        return {f"p{p}": float("nan") for p in ps}
    import numpy as np

    arr = np.array(values)
    return {f"p{p}": float(np.percentile(arr, p)) for p in ps}
