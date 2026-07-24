# Windows Service operations - install, upgrade, secrets, diagnostics

Loaded from the `dotnet-windows-service` skill when installing, deploying, hardening, or debugging a service. Everything here is SCM-level and identical for modern .NET and .NET Framework unless marked.

## Publish shape (modern .NET)

Self-contained, single-file, ReadyToRun - one artifact, no runtime dependency on the box:

```
dotnet publish -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:PublishReadyToRun=true
```

Trimming and Native AOT are usually not worth it for a service: AOT restricts reflection and breaks packages, and steady-state throughput matters more than a startup cost paid once. ReadyToRun costs nothing in capability. Enable Server GC deliberately (`<ServerGarbageCollection>true</ServerGarbageCollection>`; Framework: `<gcServer enabled="true"/>` in app.config) for throughput on multi-core hosts - but measure: Workstation GC can cut a small service's footprint by more than half with no visible throughput change.

## The install script (both runtimes)

```powershell
sc.exe create "Contoso Ingest Service" `
    binpath= "\"C:\Services\Contoso\Contoso.Ingest.exe\"" `
    start= delayed-auto `
    obj= "DOMAIN\svcContoso$" `
    DisplayName= "Contoso Ingest"
sc.exe description "Contoso Ingest Service" "Ingests and normalizes partner feeds."
sc.exe config "Contoso Ingest Service" depend= "MSSQL$INST01"
sc.exe failure "Contoso Ingest Service" reset= 86400 actions= restart/60000/restart/60000/restart/60000
```

- `sc.exe` demands a space after each `=`; the binpath carries escaped inner quotes - that IS the unquoted-path fix.
- `New-Service` / `Set-Service` are equivalents but cannot set a gMSA - use `sc.exe config obj= "DOMAIN\gmsa$" password= ""` for that.
- Recovery (`sc.exe failure`) fires only on non-zero exits - pair it with the exit-code discipline in the skill.
- Framework only: `installutil.exe` is still supported and its installers create event sources and counters transactionally - but scripted `sc.exe` is the CI/CD default on both runtimes because it is declarative, idempotent, and does not couple install behavior to code inside the assembly. For a shippable installer: WiX (free), Advanced Installer/InstallShield (commercial), Inno Setup (simple cases).

## ACLs and service permissions

- `icacls` the binary + config directory: admins write, service account reads, standard users get no modify rights.
- `sc sdshow <name>` - confirm non-admins hold no `SERVICE_CHANGE_CONFIG` (on a `LocalSystem` service that right is a direct privilege escalation).

## Upgrades

Stop, wait for the process to fully release its binaries, swap files, start. For a minimal gap, install side-by-side into a versioned folder and retarget binpath. There is no true zero-downtime for a single-instance service - needing it means two instances behind a queue with idempotent processing.

## Secrets, ranked (both runtimes)

1. **Azure Key Vault** - works off-Azure via Arc-enabled servers (`DefaultAzureCredential` picks up the local HIMDS identity). Modern .NET: `AddAzureKeyVault` into configuration; Framework: the `Azure.Security.KeyVault.Secrets` SDK directly.
2. **ASP.NET Core Data Protection** (Framework too, via the package). Trap: specifying an explicit key-persistence location DEREGISTERS default at-rest encryption - keys land unencrypted unless you add `ProtectKeysWithDpapi(protectToLocalMachine: true)` / `ProtectKeysWithCertificate` / `ProtectKeysWithAzureKeyVault`.
3. **DPAPI** (`ProtectedData`, Windows-only): use `DataProtectionScope.LocalMachine` for services - `CurrentUser` needs a loaded user profile, which gMSA / `LocalService` accounts often lack (key-not-found errors). Blobs are machine-bound.
4. **Windows Credential Manager** - per-user, so a secret an admin writes interactively is invisible to the service identity; rarely the right fit for headless services.
5. Framework-native: `aspnet_regiis -pef` config-section encryption - clunky, machine-bound, still better than plaintext.

Never: plaintext in appsettings/app.config, secrets in source control, environment variables as a secure store (unencrypted, readable on process compromise, present in crash dumps).

## Diagnostics and debugging a live service

- Best default: run the exe as a console app (the dual-mode binary; Framework needs the `Environment.UserInteractive` branch from `framework-services.md`).
- Attach the debugger to the running PID; `Debugger.Launch()` behind a config flag for startup-only problems.
- Modern .NET: `dotnet-counters` / `dotnet-trace` / `dotnet-dump` / `dotnet-gcdump` all work against a service PID. Framework: WinDbg + SOS, DebugDiag, or a Task Manager full dump.
- Event Log: modern .NET wires `EventLogLoggerProvider` via `AddWindowsService()` (default minimum `Warning`, configurable under the `Logging:EventLog` section); Framework uses `ServiceBase.EventLog`. Register sources at install time.
- Structured logging (Serilog/NLog + Seq or OTLP) with ABSOLUTE file paths or `AppContext.BaseDirectory`-derived ones - relative paths resolve to System32. `Serilog.Debugging.SelfLog` when logs mysteriously do not appear.
- Metrics: OpenTelemetry (`OpenTelemetry.Extensions.Hosting`; the SDK also supports `net462`+) + health checks evaluated by a lightweight hosted service writing to a file/event log/metric. Alert on no-progress, not on the SCM state.
