---
paths: ["**/angular.json", "**/*.component.ts", "**/*.component.html", "**/*.spec.ts", "**/*.scss", "**/src/app/**/*.ts", "**/src/lib/**/*.ts"]
---

A broken Angular build or red spec suite (Ionic/Capacitor included - ionic build wraps ng
build) - default to delegating rather than looping in-session: fix-the-build goes to
**`ng-build-error-resolver`**, make-the-tests-pass goes to **`angular-test-resolver`** once
the build is green. The subagent absorbs the repeated build/test output and returns only a
diagnosis. A resolver that stops as BLOCKED_CONTRACT_CHANGE hit a fix needing a
shared-contract change - outside its bounded scope by design; route it through
`project-task-flow`, never edit the contract to go green. A seat with no Agent tool (an implementer or a resolver) does NOT delegate - this routing policy is the orchestrator's, owned by `project-task-flow`; run your own bounded fix loop and report the red per your cap.
