---
name: dotnet-security
description: "Personal .NET application-security hardening reference, organized by the OWASP Top 10 (2021) and mapped to concrete ASP.NET Core / .NET 8 mitigations: broken access control (fallback authz policy, resource-based ownership checks against IDOR, CORS lockdown), injection and XSS (parameterized data access, Razor output encoding), cryptographic and integrity failures, insecure deserialization, security misconfiguration, vulnerable dependencies, SSRF, and security logging. Owns the do-not-use list for dead-but-tempting APIs (BinaryFormatter, Code Access Security, .NET Remoting). Floors at .NET 8 / C# 12. Load when hardening a feature, threat-modeling an endpoint, or reviewing a change for vulnerabilities. It points at dotnet-authentication for auth implementation, dotnet-cryptography for algorithm choice, and data-security for the SQL / data-layer surface rather than repeating them, and sits alongside the runtime security-guidance plugin without overlapping it. Do NOT load for non-security work."
---

# .NET application security - the OWASP Top 10, applied

This is the hardening reference: how the 2021 OWASP Top 10 categories show up in an ASP.NET Core service and what to do about each. OWASP's 2025 revision reshuffles the ranks, folds SSRF into A01, and adds software-supply-chain and exceptional-conditions categories; the mitigations map either way (supply chain under A06 / A08, exceptional conditions under A04 / A05 and `dotnet-error-handling`), so the sections keep the stable 2021 numbering. It is a static checklist you read while writing or reviewing code, and it pairs with the security-guidance plugin, which reviews a live diff at runtime - that plugin is the moving part, this is the durable map. Two whole areas are deliberately out of scope and live next door: how you actually wire up sign-in and policies is `dotnet-authentication`, and which crypto primitive to reach for is `dotnet-cryptography`. This skill says where those controls belong in the threat model, not how they are built. Floor is .NET 8 / C# 12.

The principle under all of it: treat every byte that crossed a trust boundary as hostile until you have validated it, and make the secure path the default one - a control you have to remember to add is a control you will eventually forget.

## A01 - Broken access control

The most common real-world failure: the user is authenticated, but the app never checks whether *this* user may touch *this* thing.

- **Default-deny.** Set a fallback authorization policy so that an endpoint with no explicit policy is still protected, not open. With `AddAuthorizationBuilder().SetFallbackPolicy(...)` requiring an authenticated user, forgetting an `[Authorize]` fails closed instead of leaking the route. Anonymous endpoints then opt out loudly with `AllowAnonymous`.
- **Kill IDOR.** An id from the route, query string, or body is an *input*, never proof of ownership. `GET /orders/{id}` must confirm the caller owns that order before returning it - otherwise incrementing the id walks the whole table. Enforce this with resource-based authorization: a `AuthorizationHandler<TRequirement, TResource>` that loads the resource and checks the relationship, invoked via `IAuthorizationService.AuthorizeAsync`. Role checks alone do not catch this; two users with the same role still must not read each other's rows.
- **Check on the server, every time.** A hidden field, a disabled button, or a missing menu item is UX, not a control. The authorization decision lives on the server and runs on every request, including the ones a browser would never send.
- **Lock down CORS.** Name the exact allowed origins; never pair `AllowAnyOrigin` with `AllowCredentials` - the framework will reject the combination at runtime precisely because it defeats the same-origin protection.
- **Scope what a token can do.** Least privilege applies to tokens too: an API key or JWT scoped to read should not be accepted on a write. The policy plumbing for this is `dotnet-authentication`; the obligation to actually scope it is here.
- **Antiforgery tokens are the CSRF control for cookie auth, not `SameSite`.** A `SameSite` cookie is a blunt backstop; the real defense for a cookie-authenticated `POST`/`PUT`/`PATCH`/`DELETE` is an antiforgery token - Razor's form tag helper injects it as a hidden field automatically, and AJAX callers read it and send it in the configured request header. Disabling it (`DisableAntiforgery()`) is safe only for endpoints that authenticate by a non-ambient credential - a bearer token, not a cookie - and never for a cookie-auth state change.

## A02 - Cryptographic failures

The category formerly called sensitive-data exposure - the failure is usually that data which should have been protected was not, or was protected with the wrong tool.

- **Algorithm and key choices live in `dotnet-cryptography`.** That skill owns SHA-2 vs the broken hashes, AES-GCM for authenticated encryption, the right password KDF, and how keys are generated and rotated. Do not re-derive any of that here - reach for it.
- **Encrypt in transit, no exceptions.** HTTPS everywhere, HSTS on in production via `app.UseHsts()`, and `UseHttpsRedirection()` so a plaintext request is bounced rather than served.
- **Classify before you store.** Know which fields are secret (passwords, tokens, keys) and which are merely sensitive (PII), and protect each accordingly - hashed-and-salted for credentials, encrypted-at-rest for the rest. Do not log either (see A09).
- **Keys and connection strings are not source.** Nothing secret ships in the repo or in `appsettings.json`. Use user-secrets in development and a managed vault or platform-injected environment variables in production. Secret handling for the data tier is also called out in `database-conventions`.
- **HSTS protects browsers, not machine callers.** `UseHsts()` emits a directive a browser caches and enforces; it does nothing for an API-to-API or other non-browser consumer, so treat it as a defense-in-depth layer for browser clients, never as the transport control itself - TLS on the connection is that. Behind a reverse proxy or load balancer, order the forwarded-headers middleware before `UseHttpsRedirection()` so the app sees the client's original scheme; without it, HTTPS detection reads the proxy's plaintext hop and the redirect and secure-cookie logic misfire.

## A03 - Injection (SQL, command, LDAP) and XSS

Injection happens whenever untrusted input is concatenated into something an interpreter then parses as code. The fix is always the same shape: keep data as data.

- **Parameterize every query.** EF Core's LINQ and `FromSqlInterpolated` parameterize for you; with Dapper or raw ADO.NET, pass values as command parameters - never build SQL with string interpolation or concatenation around user input. The broader data-access rules are `database-conventions`; the security non-negotiable is that no user value ever lands inside the SQL text.
- **The same rule covers OS commands and LDAP.** If you must shell out, pass arguments as an argument array rather than a single string the shell re-parses, and prefer a typed API over spawning a process at all.
- **Encode on output to stop XSS.** Razor HTML-encodes interpolated values by default; that default is the protection, so do not defeat it. `Html.Raw`, `MarkupString`, and `[AllowHtml]` over untrusted input reopen the hole - reserve them for content you generated or sanitized server-side. JSON written through System.Text.Json is encoded correctly; hand-built script or HTML strings are not.
- **Defense in depth at the browser.** A content-security-policy header limits what injected markup can do even if something slips through; it is a backstop, not a substitute for encoding.
- **Validate at the boundary anyway.** Strong typing and allowlist validation (FluentValidation, per `dotnet-error-handling`) shrink the attack surface before any of the above runs. Validation is not a replacement for parameterization or encoding - it is the layer in front of them.

## A04 - Insecure design

Some weaknesses are not bugs in the code but gaps in the plan, and no amount of careful implementation fixes a missing control.

- **Rate-limit the abusable surfaces.** Login, token issuance, password reset, and anything expensive need throttling so they cannot be brute-forced or used to exhaust resources; the built-in rate-limiting middleware (`AddRateLimiter`) covers this.
- **Fail closed by design.** When a dependency the security decision depends on is unavailable - the authorization store, the token validator - deny rather than wave the request through.
- **Enforce business limits server-side.** Quantity caps, ownership rules, and workflow state transitions are part of the threat model; a client that can post any quantity or skip a step is a design hole, not a UI bug.
- **Bind the request to a DTO, never onto an entity.** Model-binding straight onto an EF entity lets a caller over-post a field the form never exposed - an `OwnerId`, an `IsAdmin`, a `Price` - and mass-assign it; returning that same entity across the boundary leaks columns and invites a serialization cycle. Bind to a dedicated command/query DTO in and out and map explicitly, so no entity crosses the HTTP boundary. The binding and mapping mechanics live in `dotnet-web-backend` and `dotnet-data-access`; this is where the control sits in the threat model.

## A05 - Security misconfiguration

The framework's defaults are mostly safe; the failures come from turning them off, leaving development settings in production, or never setting the production ones.

- **Send no detail to the client on error.** Errors surface as `ProblemDetails` with developer messages and stack traces suppressed outside Development - this is owned by `dotnet-error-handling`; the security stake is that an unhandled exception must not leak internals, paths, or SQL.
- **Set the response security headers.** An X-Content-Type-Options of nosniff, a restrictive content-security-policy, a referrer-policy, and dropping the Server header all close small but real gaps; apply them as middleware so every response carries them.
- **Trim what you expose.** Disable Swagger/OpenAPI and detailed health-check payloads in production unless they sit behind auth, and remove sample or debug endpoints before ship.
- **Keep environments honest.** `ASPNETCORE_ENVIRONMENT` must be `Production` in production - the developer exception page, verbose logging, and relaxed settings are all gated on it, and a misset environment is itself the vulnerability.

## A06 - Vulnerable and outdated components

Most of the code in a service is other people's, and that code has its own published vulnerabilities.

- **Audit dependencies in CI, not by hand.** `dotnet list package --vulnerable --include-transitive` fails the build when a known-bad package (direct or pulled in beneath one) is present; transitive coverage matters because the flaw is usually two levels down.
- **Patch on a schedule, not on incident.** Keep packages current and the runtime supported - a framework past end-of-life stops getting security fixes entirely.
- **Pin and verify.** Lock files plus package source mapping (a nuget.config `packageSourceMapping` section) stop a dependency-confusion swap, where a malicious public package shadows an internal one.

## A07 - Identification and authentication failures

How tokens, cookies, and sessions are actually issued and validated is `dotnet-authentication`. The security obligations that sit on top of that machinery are:

- **Validate tokens completely.** Signature, issuer, audience, and expiry all checked; clock skew kept tight. The configuration is `dotnet-authentication`'s; the requirement that none of those validations is switched off is here.
- **Harden cookies.** Session cookies are `HttpOnly`, `Secure`, and `SameSite` - that combination is what blunts session theft and CSRF.
- **Defend the credential flows.** Lockout or throttling on repeated failures, no enumeration (the response for an unknown user matches the one for a wrong password), and password rules that lean on length over forced complexity.

## A08 - Software and data integrity failures

This category is where insecure deserialization lives - the moment untrusted bytes are turned back into objects that can carry behavior.

- **Never deserialize untrusted input with a type-permissive formatter.** `BinaryFormatter` is unsafe by design - a crafted payload reaches gadget chains during deserialization and executes. Calling it became a compile error in .NET 7, the methods throw by default at runtime from .NET 8, and the in-box implementation was removed in .NET 9 (a legacy-compat package is the only way back). On the .NET 8 floor the type is present but throws, so any working call had to opt back in deliberately - treat that opt-in as the vulnerability and delete it. Use System.Text.Json with a known, constrained set of types; do not enable polymorphic deserialization over data you did not produce, and bind to concrete DTOs rather than `object` or `dynamic`.
- **Verify what you load.** Check integrity (a signature or hash) on plugins, updates, and serialized state before trusting them, and pull build dependencies only from sources you control.
- **Treat the supply chain as in-scope.** A compromised build step or unverified artifact is an integrity failure even when your own code is clean.

## A09 - Security logging and monitoring failures

You cannot respond to what you never recorded, and you cannot trust logs that leak what they were meant to protect.

- **Log the security-relevant events.** Authentication success and failure, authorization denials, and high-value actions, each carrying a correlation/trace id so a single request can be reconstructed end to end. The observability wiring - Serilog, the correlation id, structured fields - is `dotnet-web-backend`; this skill says which events are worth logging.
- **Never log a secret or PII.** Passwords, tokens, keys, full card or account numbers, and personal data stay out of logs - redact or omit them at the source, because a log aggregator is a far softer target than the database.
- **Make logs actionable.** Alert on the patterns that signal an attack (a spike of authorization denials, repeated login failures from one source); a log nobody watches is not monitoring.

## A10 - Server-side request forgery (SSRF)

When the server fetches a URL the user influenced, the attacker can aim that fetch at the internal network - cloud metadata endpoints, internal admin panels, anything the server can reach but the user cannot.

- **Allowlist outbound destinations.** Any URL built from user input (webhooks, image fetches, link previews) is validated against an allowlist of permitted hosts or schemes before the request goes out; an allowlist is the control, a denylist of bad hosts is not.
- **Block the internal ranges.** Reject loopback, link-local, private, and cloud-metadata addresses, and resolve-then-check so a DNS name cannot rebind to an internal IP after validation.
- **Constrain the client itself.** A dedicated `HttpClient` with redirects disabled and a tight timeout stops a 302 from bouncing an allowlisted host to an internal one.

## Do not use - dead but still tempting

- **`BinaryFormatter`** - the unsafe deserializer; full floor-aware statement and replacement are under A08 above. Listed here only as a dead-but-tempting API.
- **Code Access Security and APTCA** - not a security boundary on .NET (Core) and unsupported; never rely on them to sandbox anything.
- **.NET Remoting and DCOM** - legacy, unsafe transports; use a modern, authenticated transport instead.
- **Suppressing a security analyzer to ship** - a `#pragma warning disable` or suppression over a security rule is a decision to ship the vulnerability; fix the finding rather than silence it.
