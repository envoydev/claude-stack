# Legacy routing: .NET Framework 4.8 (net48)

The second index, split out of the router body because it fires only on a .NET Framework codebase. Same shape as the main table: load the owner skill, then open the net48 reference inside it.

**Availability - required vs optional.** Every row below names an optional specialist, installed only where the project's stack or evidence shows that area. A row whose skill is not in your skill list means the area is absent here, not a broken pointer - work from this table's own description of the delta and skip the row.

Maintaining or hardening a .NET Framework 4.8 codebase - the deltas from the modern floor live as a net48 reference inside each owner skill. Load the owner skill in the second column, then open the reference file that row names inside it.

| You are about to... | Load |
|---|---|
| write C# for net48 - the C# 7.3 language ceiling, compiler-only vs CLR-dependent features, polyfill packages, and the SynchronizationContext / ConfigureAwait async caveat | `csharp` (its `references/net-framework-48.md`) |
| harden a net48 app - TLS registry keys, BinaryFormatter still shipping, ViewState / machineKey rotation, classic-ASP.NET headers, web.config secrets, dependency auditing | `dotnet-security` (its `references/net-framework-48.md`) |
| use crypto on net48 - the PBKDF2 SHA-1 default, the RNG API name, AES-GCM availability | `dotnet-cryptography` (its `references/net-framework-48.md`) |
| optimize on net48 - the 'slow span', NuGet-only fast-path packages, benchmarking on net48 | `dotnet-performance` (its `references/net-framework-48.md`) |
| configure a net48 project - packages.config -> PackageReference, LangVersion pinning, Server GC, binding redirects | `dotnet-project-setup` (its `references/net-framework-48.md`) |
| migrate off net48 - the frozen-platform stance and the upgrade-vs-replace blocker map | `dotnet-migrate` (its `references/net-framework-48.md`) |
| build or maintain classic ASP.NET (MVC 5 / Web API 2 / Web Forms) on net48 - the single-threaded request context, no IHttpClientFactory, OWIN pipeline, caching | `dotnet-web-backend` (its `references/net-framework-48.md`) |
| wire MVC 5 / Web API 2 controllers - the two separate DI resolvers, bind-DTOs-not-entities, anti-forgery | `dotnet-mvc-controllers` (its `references/net-framework-48.md`) |
| add auth to classic ASP.NET - OWIN / Katana, ASP.NET Identity 2.x, OAuth bearer + JWT validation | `dotnet-authentication` (its `references/net-framework-48.md`) |
| pick and scope EF on net48 - EF Core 3.1 vs EF6, DbContext-per-request, the single-operation rule | `dotnet-data-access` (its `references/net-framework-48.md`) |
| test classic ASP.NET on net48 - in-memory OWIN TestServer, HttpContextBase over sealed HttpContext.Current | `dotnet-testing` (its `references/net-framework-48.md`) |
| build or maintain a WPF app on net48 - CommunityToolkit.Mvvm source-generator constraints, Generic Host composition, app-level exception handlers | `dotnet-wpf` (its `references/net-framework-48.md`) |
| maintain a .NET Framework Windows Service - the `ServiceBase` shape, `installutil`, and the migration path to `AddWindowsService` | `dotnet-windows-service` (its `references/framework-services.md`) |

The async deadlock angle (why `ConfigureAwait(false)` is load-bearing here) is in `csharp`'s `references/net-framework-48.md`.
