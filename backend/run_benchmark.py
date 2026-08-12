"""RQ1 benchmark CLI — Step 6.

Usage:
    # $0, validates the whole scoring/stats pipeline against ground truth
    # as fake predictions. Run this first.
    python run_benchmark.py --dry-run

    # Small paid pilot — get real cost/timing before committing to the
    # full run. 2 scenarios per type x 2 modes = 16 live calls.
    python run_benchmark.py --pilot 2

    # The real thing — 50 scenarios x 2 modes = 100 live calls.
    python run_benchmark.py

Results are saved incrementally to the output JSON and re-running skips
anything already completed, so an interrupted run can just be re-launched.
"""
import argparse

from app.evaluation.report import build_report, print_report
from app.evaluation.runner import run_benchmark

parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
parser.add_argument("--dry-run", action="store_true", help="Skip the API; score ground truth against itself for $0")
parser.add_argument("--pilot", type=int, default=None, metavar="N", help="Only run N scenarios per disruption type")
parser.add_argument("--output", default="benchmark_results.json", help="Where to save/resume results")
parser.add_argument("--modes", nargs="+", default=["react", "hierarchical"], help="Which modes to run")
args = parser.parse_args()

results = run_benchmark(
    output_path=args.output,
    dry_run=args.dry_run,
    scenario_limit_per_type=args.pilot,
    modes=tuple(args.modes),
)

report = build_report(results)
print_report(report)
