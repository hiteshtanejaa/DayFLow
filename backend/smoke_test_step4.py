"""End-to-end smoke test for Step 4's real LangGraph orchestration modes.

Run from backend/ with OPENAI_API_KEY set in backend/.env:

    python smoke_test_step4.py

Exercises run_hierarchical and run_react directly against the live API —
compiling the graphs proves nothing about the tool-calling loop actually
working; this does.
"""
from datetime import datetime

from app.agents.pipeline import run_hierarchical, run_react

TRANSCRIPT = "I have interview prep, gym, and coursework today, but I am feeling pretty tired."
DAY_START = datetime(2026, 8, 10, 8, 0)
DAY_END = datetime(2026, 8, 10, 20, 0)


def report(label: str, schedule, logs):
    print(f"\n=== {label} ===")
    print(f"Mode: {schedule.orchestration_mode}")
    print(f"Agent actions logged: {len(logs)}")
    for i, log in enumerate(logs):
        print(f"  [{i}] {log.agent_name} / {log.action} — {log.latency_ms:.0f}ms — {log.output_summary}")
    print(f"Reasoning: {schedule.reasoning_summary}")
    print(f"Blocks ({len(schedule.blocks)}):")
    for b in schedule.blocks:
        print(f"  - {b.title}: {b.start.strftime('%H:%M')}-{b.end.strftime('%H:%M')} ({b.status})")
    if schedule.violations:
        print(f"Violations: {[v.reason for v in schedule.violations]}")
    total_ms = sum(l.latency_ms for l in logs)
    print(f"Total pipeline latency: {total_ms:.0f}ms")


print("Testing HIERARCHICAL mode (Intake -> Orchestrator -> Monitor)...")
h_schedule, h_logs = run_hierarchical(TRANSCRIPT, DAY_START, DAY_END, [])
report("Hierarchical", h_schedule, h_logs)

print("\n\nTesting REACT mode (agent <-> tools loop)...")
r_schedule, r_logs = run_react(TRANSCRIPT, DAY_START, DAY_END, [])
report("ReAct", r_schedule, r_logs)

print("\n\nSTEP 4 SMOKE TEST PASSED — both real LangGraph orchestration modes executed end-to-end.")
