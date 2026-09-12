# MVC 5 and Web API 2 controllers on .NET Framework 4.8

SKILL.md is ASP.NET Core controllers. On .NET Framework 4.8, MVC 5 and Web API 2 are two separate stacks
with their own mechanics - these are the deltas that trip up developers who learned the unified Core
model. Read the web hub's own 4.8 notes first for the classic-pipeline baseline, where the project installed
that skill.

## Two DI resolvers, not one (the marquee 4.8 trap)

- MVC 5 and Web API 2 use **different** dependency-resolver abstractions in different assemblies:
  `System.Web.Mvc.IDependencyResolver` (set via `DependencyResolver.SetResolver`) and
  `System.Web.Http.Dependencies.IDependencyResolver` (set via
  `GlobalConfiguration.Configuration.DependencyResolver`). The Web API one adds `BeginScope()` returning
  an `IDependencyScope` disposed at end of request. A project hosting both must wire **both** - container
  packages ship separate integrations for exactly this (`Autofac.Mvc5` + `Autofac.WebApi2`, or
  `Unity.Mvc5` + `Unity.WebApi`).
- Scope `DbContext` and unit-of-work types **per request** (Autofac `InstancePerRequest`, Simple
  Injector's scoped lifestyle) and implement Web API's `BeginScope` as a real child scope so per-request
  services dispose. Avoid captive dependencies - a singleton holding a scoped service is the leading
  cause of leaked contexts.
- Constructor injection into controllers is the goal (it makes them unit-testable); avoid the
  service-locator antipattern (`DependencyResolver.Current.GetService`) outside the composition root.
  Backing the classic resolvers with a `Microsoft.Extensions.DependencyInjection` provider works, but MS
  DI has no per-request scope in classic ASP.NET unless you add an `IHttpModule` that creates and
  disposes an `IServiceScope` per request - doing it now smooths the eventual Core move.

## Model binding: bind DTOs, never entities

- MVC 5 model binding binds every posted field. Binding straight onto an entity is mass-assignment: a caller can over-post a field the form never exposed - an owner id, an `IsAdmin` - and have it persisted.
  Use a separate input / view model rather than `[Bind(Include=...)]` /
  `[Bind(Exclude=...)]` - `[Bind]` resets excluded properties to defaults in edit scenarios and is ignored for
  `[FromBody]` JSON. Reach for `TryUpdateModel` with an explicit allow-list only where a two-model split
  is impractical.
- Anti-forgery: MVC 5 uses `@Html.AntiForgeryToken()` + `[ValidateAntiForgeryToken]` on state-changing
  POSTs (set `AntiForgeryConfig.UniqueClaimTypeIdentifier` with claims). Bearer-token Web API endpoints
  use no cookie and need no anti-forgery; cookie-authenticated ones do. Validate return URLs with
  `Url.IsLocalUrl()` before redirecting.

Thin controllers still delegate to services (SKILL.md's rule, unchanged). Auth wiring belongs to the authentication skill's own 4.8
notes; the deserialization and header hardening to the security-hardening skill's.
