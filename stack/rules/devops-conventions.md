---
paths: ["**/Dockerfile", "**/Dockerfile.*", "**/*.Dockerfile", "**/docker-compose*.yml", "**/docker-compose*.yaml", "**/compose*.yml", "**/compose*.yaml", "**/.github/workflows/*.yml", "**/.github/workflows/*.yaml"]
---

Editing a container build, a compose topology, or a CI/CD pipeline - load `devops`: the FIRST action after this rule attaches is that Skill call, before the NEXT edit lands (a path-scoped rule attaches ON the touch, so it can never precede its own trigger) - skip the load when it is already in context (the devops seats preload it); conventions are the source of truth, not recall. Name the skill you loaded, or say it was already in context - the receipt is what makes the load happen. Covers Dockerfiles, compose files, and GitHub Actions workflows - the delivery surface. Deploy scripts and the Aspire AppHost are the same concern but don't match these globs - load `devops` yourself when editing them. Skip one-line tweaks.
