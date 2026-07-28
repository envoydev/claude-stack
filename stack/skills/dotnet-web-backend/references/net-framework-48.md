# Classic ASP.NET on .NET Framework 4.8

The cross-cutting baseline in SKILL.md is ASP.NET Core. On .NET Framework 4.8 the classic pipeline (MVC
5, Web API 2, and legacy Web Forms) differs in ways that change the cross-cutting advice materially -
most online 'ASP.NET best practice' silently assumes Core. This is the web hub's net48 delta; the
sharper per-area deltas route out below.

## The request pipeline is single-threaded per context

- Classic ASP.NET installs `AspNetSynchronizationContext`, which allows only one thread in a request's
  context at a time. Blocking on an incomplete `Task` (`.Result` / `.Wait()` /
  `.GetAwaiter().GetResult()`) on the request thread deadlocks - the continuation is queued to the
  context the blocked thread holds. This is the defining 4.8 web footgun; it is safe on ASP.NET Core
  only because Core has no context. The mechanism and the library-code `ConfigureAwait(false)` rule are
  `csharp`'s `references/net-framework-48.md` and its `references/concurrency.md`.
- **Set `<httpRuntime targetFramework="4.8" />` in web.config.** Without it ASP.NET runs in 4.0 quirks
  mode where async/await behavior is undefined - the number-one silent async bug on the full framework.
- Go async all the way: MVC 5 actions return `Task<ActionResult>`, Web API 2 `Task<IHttpActionResult>`.
  Web Forms need `<%@ Page Async="true" %>` plus `RegisterAsyncTask(new PageAsyncTask(...))` (or an
  `HttpTaskAsyncHandler`). The payoff is thread-pool headroom - a blocking app burns a pool thread per
  in-flight request and starves under burst load.

## No IHttpClientFactory - manage HttpClient yourself

- The classic pipeline has no built-in `IHttpClientFactory`. Use a single static / singleton
  `HttpClient` for the app lifetime; never `new HttpClient()` per request in a `using` (it exhausts
  sockets under load, throwing `SocketException`). The tradeoff is DNS staleness - bound it with
  `ServicePoint.ConnectionLeaseTimeout` (paired with `ServicePointManager.DnsRefreshTimeout`), or add
  `Microsoft.Extensions.Http` and resolve `IHttpClientFactory` through MS DI if you have wired one in.
- Raise `ServicePointManager.DefaultConnectionLimit` once at `Application_Start` - it defaults to 10 for
  ASP.NET-hosted apps (2 elsewhere), a classic bottleneck for outbound calls, and does not affect
  already-created `ServicePoint`s.

## Caching, headers, and the OWIN pipeline

- Prefer `System.Runtime.Caching.MemoryCache` over `HttpContext.Cache` for new code - it is not tied to
  `System.Web`, easing later migration. Use MVC `OutputCache` for cacheable actions and Redis for a
  web-farm shared cache; `System.Web.Optimization` bundles and minifies, though a real front-end build
  ports more cleanly.
- There is no headers middleware; add security headers via `<customHeaders>` or the NWebsec library -
  the header set and the TLS story are `dotnet-security`'s `references/net-framework-48.md`.
- Use the OWIN / Katana middleware pipeline (`OwinStartup`) for cross-cutting concerns - the classic
  analog to Core middleware, and the natural home for auth.

## Route out

DI resolvers and controller mechanics -> `dotnet-mvc-controllers`; auth (OWIN / Identity / OAuth) ->
`dotnet-authentication`; ViewState / machineKey / secrets hardening -> `dotnet-security`; EF on 4.8 ->
`dotnet-data-access`; OWIN integration testing -> `dotnet-testing`; the migration path (System.Web
Adapters + YARP) -> `dotnet-migrate`. Each as that owner's `references/net-framework-48.md`. Do not
invest in Web Forms for greenfield - it was never ported to modern .NET and any move there is a UI
rewrite.
