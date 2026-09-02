# Raw run logs

Unedited stdout from the two scale runs quoted in the top-level README, so
the numbers there are verifiable rather than asserted.

| Log | Command | Result |
|---|---|---|
| `race_250runs.log` | `python scripts/race_test.py --runs 250` | 250/250 races closed correctly |
| `revocation_50runs.log` | `python scripts/revocation_demo.py --runs 50` | 50/50 aborted before Razorpay was called |

Environment: PostgreSQL 17.6, live Razorpay test mode, single API process
(`DEMO_MODE=false` for the race run, `true` for the revocation run).

Re-run them yourself and you should get the same thing; `--runs` defaults
to 3 for a quick check.
