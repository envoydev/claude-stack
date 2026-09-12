# Testing classic ASP.NET on .NET Framework 4.8

The testing strategy in SKILL.md is architecture-neutral and applies unchanged; two net48-specific
mechanics matter for MVC 5 / Web API 2.

## Integration testing through in-memory OWIN

- Host the app in memory with `Microsoft.Owin.Testing.TestServer` (`TestServer.Create<Startup>()`) - it
  runs the full OWIN pipeline (routing, filters, auth, DI) against an `HttpClient`, no network or IIS.
  Spin one up per fixture. For token-protected endpoints, borrow the OAuth middleware's `DataProtector`
  to mint valid test tokens; `WebApp.Start<Startup>()` is the self-host alternative. This is the
  classic-ASP.NET analog of Core's `WebApplicationFactory` - the container-backed integration mechanics
  (`references/testcontainers.md`) are otherwise unchanged.

## Make classic-ASP.NET code testable

- The sealed `HttpContext.Current` is the enemy of a unit test. Depend on `HttpContextBase` /
  `HttpContextWrapper` where you must touch context, but better, keep controllers free of `HttpContext`
  and pass in the data they need. Constructor DI into controllers (the resolver wiring belongs to
  the skill covering controller-based Web APIs, in its own 4.8 notes) lets them test without a web host.
- The real leverage is the same as everywhere: keep business logic in POCO services with no `System.Web`
  dependency, so the bulk of the suite is fast plain-object tests. That structure is also exactly what
  the System.Web Adapters migration needs - see the .NET migration skill's own 4.8 notes.
