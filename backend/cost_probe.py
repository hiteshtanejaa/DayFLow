"""One-off: run a single scenario through both modes, report real token
counts, so we can bound the full benchmark's cost instead of guessing."""
from app.evaluation.scenarios import generate_scenarios
from app.agents.pipeline import run_react, run_hierarchical

scenario = generate_scenarios(50)[0]  # first scenario, deterministic

PRICES = {  # confirmed tiers, $ per 1M tokens (input, output)
    "gpt-5.6-luna": (0.20, 1.20),
    "gpt-5.6-terra": (2.00, 12.00),
    "gpt-5.6-sol": (5.00, 30.00),
}

for mode_name, runner in [("react", run_react), ("hierarchical", run_hierarchical)]:
    schedule, logs = runner(scenario.transcript, scenario.day_start, scenario.day_end, scenario.busy_slots)
    total_in = sum(l.tokens_input or 0 for l in logs)
    total_out = sum(l.tokens_output or 0 for l in logs)
    total_latency = sum(l.latency_ms for l in logs)
    print(f"\n=== {mode_name} ===")
    print(f"Calls: {len(logs)} | latency: {total_latency:.0f}ms")
    print(f"Tokens: {total_in} in, {total_out} out")
    print("Cost if this run priced at each known tier:")
    for tier, (p_in, p_out) in PRICES.items():
        cost = (total_in / 1_000_000) * p_in + (total_out / 1_000_000) * p_out
        print(f"  {tier}: ${cost:.5f}")
