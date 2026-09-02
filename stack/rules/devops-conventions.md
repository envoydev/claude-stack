---
paths: ["**/Dockerfile", "**/Dockerfile.*", "**/*.Dockerfile", "**/docker-compose*.yml", "**/docker-compose*.yaml", "**/compose*.yml", "**/compose*.yaml", "**/.github/workflows/*.yml", "**/.github/workflows/*.yaml"]
---

Editing a container build, a compose topology, or a CI/CD pipeline - load `devops` before the edit - skip the load when it is already in context (the devops seats preload it); conventions are the source of truth, not recall. Covers Dockerfiles, compose files, and GitHub Actions workflows - the delivery surface. Deploy scripts and the Aspire AppHost are the same concern but don't match these globs - load `devops` yourself when editing them. Skip one-line tweaks.
