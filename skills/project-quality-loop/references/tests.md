# Tests stage

A GATE-based stage, not a judged audit - it names a verifiable command and the bar is that command exiting 0. Run this stage last: it has the narrowest blast radius and it verifies everything the earlier stages changed.

Replace the placeholder below with this project's real test invocation (add the coverage flag if the project enforces a threshold):

    <test command, e.g. the project's test runner with coverage>

Rules:
- The command is the bar. A passing command beats opinion; do not judge the suite by eye.
- A failing test is a finding to fix in the CODE. Never weaken, skip, delete, or loosen a test, an assertion, or a coverage threshold to make the gate go green.
- If a behavior changed legitimately in an earlier stage and a test encoded the old behavior, update the test to assert the new correct behavior and add a DECISIONS note. That is a fix, not a weakening.
- If the command still fails and no new fix is available, re-running the identical command is a PLATEAU - stop and report it instead of burning the remaining passes.

Bar: the named command exits 0.
