---
name: dotnet-diagnostics
description: "Measure and diagnose a live .NET process - the layer that decides whether to benchmark a hot path or capture a dump, then routes to the depth. Microbenchmarking: BenchmarkDotNet in a separate Release console project, [MemoryDiagnoser], [Benchmark]/[Params]/baseline, reading mean/alloc/ratio, comparing two implementations or runtimes. Dumps: capture a crash/hang/OOM dump with dotnet-dump or DOTNET_DbgEnableMiniDump (CoreCLR, Linux, containers), managed-heap-only with dotnet-gcdump, then first-look SOS analysis (clrstack, dumpheap, gcroot). Load when timing a hot path, comparing two implementations, or when a process crashed, hung, or is leaking - CoreCLR only, not .NET Framework or NativeAOT dumps. Measure before you optimize; capture in the environment that reproduces. Companions: `csharp` (language baseline), `dotnet` (router), `dotnet-performance` (the design layer this measures), `dotnet-testing`."
metadata:
  type: reference
  sources: "Distilled 2026-07 from aaronontheweb/dotnet-skills (microbenchmarking, dump-collect). Decision layer here; BDN authoring and dump capture/analysis depth in references/. Dropped the NativeAOT dump branch and the deep BDN internals/tuning reference; design lives in dotnet-performance, language baseline in csharp."
---

# dotnet-diagnostics (decision layer)

Two ways to put numbers on a .NET process instead of guessing: benchmark a hot path in isolation, or capture a dump of a process that crashed, hung, or is leaking. This hub decides which one the task needs and routes to the depth - it does not restate it.

- Time a hot path / compare two implementations -> `references/microbenchmarking.md`
- A process crashed, hung, or is leaking - capture and read a dump -> `references/dumps.md`

The design decisions these measurements justify live in `dotnet-performance`; the language baseline is `csharp`; the full .NET map is `dotnet`.

## Measure first

A benchmark exists to earn or refute a change, not to decorate one. Before you tune, confirm the hot path is actually hot - most 'slow' code is a bad query or an N+1, not a struct-vs-class problem, and a microbenchmark of the wrong method buys nothing. Reach for `references/microbenchmarking.md` when the comparison is CPU/allocation on a tight in-process path; reach for a profiler or trace when the cost is I/O, contention, or spread across a request.

## Capture where it reproduces

A dump is only as good as the process it came from. Capture in the environment that reproduces the fault - the same runtime, the same container, under the same load - because a crash that only shows up in production will not surface in a local run. Enable automatic crash dumps ahead of time (`DOTNET_DbgEnableMiniDump`) for a fault you cannot trigger on demand; collect on demand (`dotnet-dump collect`) for a hang or a leak you can catch live. Load `references/dumps.md` for the capture matrix, the container setup, and the first-look SOS pass.
