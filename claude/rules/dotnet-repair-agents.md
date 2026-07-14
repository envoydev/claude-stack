---
paths: ["**/*.cs", "**/*.csproj", "**/*.sln", "**/*.slnx", "**/*.xaml"]
---

A broken .NET build or red test suite - default to delegating rather than looping in-session:
fix-the-build goes to **`dotnet-build-error-resolver`** (MC#### errors = WPF XAML markup
compile are its scope too), make-the-tests-pass goes to **`dotnet-test-failure-resolver`**
once the build is green. The subagent absorbs the repeated build/test output and returns
only a diagnosis. A resolver that stops as BLOCKED_CONTRACT_CHANGE hit a fix needing a
shared-contract change - outside its bounded scope by design; route it through
`project-task-flow`, never edit the contract to go green. A seat with no Agent tool (an implementer or a resolver) does NOT delegate - this routing policy is the orchestrator's, owned by `project-task-flow`; run your own bounded fix loop and report the red per your cap.
