# Docker runtime hardening - past non-root

The image already runs as a non-root USER (see SKILL.md); these are the runtime caps that stop a compromised or leaking process from escalating, exhausting PIDs, or starving the host. Compose spelling shown - the docker-run flags are the same switches.

```yaml
services:
  api:
    cap_drop: [ALL]              # drop every Linux capability; add back one at a time only when proven needed
    security_opt:
      - no-new-privileges:true   # setuid/setgid binaries cannot escalate
      # keep the DEFAULT seccomp profile (never seccomp:unconfined);
      # add an AppArmor or SELinux profile where the host supports one
    read_only: true              # root filesystem read-only where the app allows
    tmpfs: [/tmp]                # scratch space for the read-only rootfs
    pids_limit: 256              # fork-bomb guard
    mem_limit: 512m
    cpus: "1.0"
```

- Never reach for `--privileged` - it disables every isolation mechanism at once; grant a single capability back instead, with the reason recorded. A service that 'needs' many capabilities usually needs a different design.
- The memory / CPU / PID caps are per-service circuit breakers: a runaway process becomes one dead container instead of a starved host.
