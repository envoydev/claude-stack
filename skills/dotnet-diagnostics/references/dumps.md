# Capturing and reading .NET dumps

Capturing a crash, hang, or OOM dump from a CoreCLR process - on demand, on crash, and in a container - plus the first-look SOS pass. When to reach for a dump at all (capture-where-it-reproduces) lives in `SKILL.md`. This covers modern .NET (CoreCLR); .NET Framework and NativeAOT are out of scope.

## Which capture

| Situation | Tool |
|---|---|
| Process is alive - hang, high CPU, suspected leak | `dotnet-dump collect -p <pid>` |
| Managed heap only, smaller file for a leak hunt | `dotnet-gcdump collect -p <pid>` |
| Crash you cannot trigger on demand | `DOTNET_DbgEnableMiniDump` env vars, set before launch |
| Windows, prefer the native tool | `procdump -ma <pid>` |

`dotnet-dump` captures the full runtime state (stacks, heap, threads); `dotnet-gcdump` captures only the managed heap as a `.gcdump` you open in Visual Studio or PerfView - far smaller, and enough to find what is rooting a leak. Reach for the full dump for a hang or crash, the gcdump for a leak.

## On-demand collection

Install the collection tools as global tools once (they need the SDK; without it, download from the dotnet/diagnostics releases):

```bash
dotnet tool install -g dotnet-dump
dotnet tool install -g dotnet-gcdump

dotnet-dump ps                                     # list .NET processes
dotnet-dump collect -p <pid> --type Full           # Full | Heap | Mini
dotnet-gcdump collect -p <pid>                      # managed-heap-only .gcdump
```

On Windows, `procdump -ma <pid> myapp.dmp` writes a full user-mode dump that `dotnet-dump analyze` still opens.

## Automatic crash dumps

For a crash you cannot reproduce on demand, have the runtime write a dump on the fatal exception. Set these before the process starts - the output directory must already exist, the runtime will not create it:

```bash
export DOTNET_DbgEnableMiniDump=1
export DOTNET_DbgMiniDumpType=4        # 1=Mini 2=Heap 3=Triage 4=Full - use 4 for max value
export DOTNET_DbgMiniDumpName=/tmp/dumps/%e_%p_%t.dmp   # %e name %p pid %t timestamp (.NET 5+)
export DOTNET_EnableCrashReport=1      # JSON crash report alongside the dump
```

The `DOTNET_` prefix is preferred; the legacy `COMPlus_` prefix still works. Single-file published apps support only full dumps (type 4). Unset these once you have the dump - left on, they accumulate a dump per crash.

## Containers

A container needs the `SYS_PTRACE` capability for any tool to attach, and a mounted volume so the dump survives the container:

```bash
docker run --cap-add=SYS_PTRACE -v /tmp/dumps:/dumps \
  -e DOTNET_DbgEnableMiniDump=1 \
  -e DOTNET_DbgMiniDumpType=4 \
  -e DOTNET_DbgMiniDumpName="/dumps/%e_%p_%t.dmp" \
  myapp
```

The Kubernetes equivalent adds the capability under `securityContext.capabilities.add: ["SYS_PTRACE"]` and mounts a volume at `/dumps` (an `emptyDir` with a `sizeLimit`, or a PVC in production so dumps survive a pod restart). Collect on demand the same way, then copy the file out:

```bash
kubectl exec <pod> -- dotnet-dump collect -p <pid> --output /dumps/myapp.dmp
kubectl cp <pod>:/dumps/myapp.dmp ./myapp.dmp        # docker cp for plain Docker
```

If the container runs non-root, make `/dumps` writable by that user - `chown` it in the Dockerfile, or set `securityContext.fsGroup` in Kubernetes. On a host with SELinux or AppArmor, `SYS_PTRACE` alone may not be enough; relax the profile for a debugging session only, never in production.

## First-look analysis

Open the dump and load SOS - the managed-debugging extension - which `dotnet-dump analyze` bundles, so no separate install:

```bash
dotnet-dump analyze myapp.dmp
```

Three commands answer the three questions a dump is usually captured to answer:

```
> clrstack -all         # every thread's managed stack - where a hang or crash sits
> dumpheap -stat        # heap object counts and total bytes by type - what a leak is made of
> gcroot <address>      # what is keeping one object alive - the leak's root chain
```

Read `dumpheap -stat` bottom-up: the types with the largest total size are the leak suspects. Take one instance address from `dumpheap -type <TypeName>`, run `gcroot` on it, and follow the chain to the static field, event handler, or captured closure that is pinning it. For a hang, scan `clrstack -all` for many threads parked on the same lock or the same `await`. Keep it to a first look - a root cause that needs live stepping or repeated captures is past what a single dump gives you.
