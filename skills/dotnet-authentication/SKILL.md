---
name: dotnet-authentication
description: "House ASP.NET Core auth conventions covering both halves - authentication (who the caller is) and authorization (what they may do). Pick the scheme by surface: JWT bearer for stateless APIs, cookies for server-rendered apps, OpenID Connect for delegated SSO. Validate every token field, lean on ASP.NET Identity as the user store, and gate access with named policies and authorization handlers rather than scattered role strings. Floors at .NET 8 / C# 12. Load before standing up a sign-in flow, wiring JWT or OIDC, writing an authorization policy, or protecting an endpoint. Companions: csharp, dotnet-minimal-api, dotnet-web-backend, dotnet-cryptography, dotnet-security. Do NOT load for the OWASP hardening sweep or secret placement (dotnet-security) or crypto primitives (dotnet-cryptography)."
---

# ASP.NET Core authentication and authorization

Two questions, never one. **Authentication** answers who the caller is and hands you a `ClaimsPrincipal`. **Authorization** answers what that principal may do. The framework keeps them as separate middlewares - `UseAuthentication()` then `UseAuthorization()`, in that order - and so should your thinking. A 401 means the framework could not establish identity; a 403 means it knows who you are and the answer is still no.

Baseline is .NET 8 / C# 12. On .NET Framework 4.8 the OWIN / Katana + ASP.NET Identity 2.x auth stack is in `references/net-framework-48.md`.

## Pick the scheme from the surface

The right authentication scheme is decided by what kind of client talks to the endpoint, not by preference:

- **Stateless REST API** -> JWT bearer (`Microsoft.AspNetCore.Authentication.JwtBearer`). The token carries the identity; the server keeps no session.
- **Server-rendered app** (MVC, Razor Pages, Blazor Server) -> cookie authentication. The browser already holds a cookie; use it.
- **Delegated identity / single sign-on** -> OpenID Connect, with an external provider doing the actual sign-in.

Do not invent a user store. ASP.NET Identity already solves password hashing (PBKDF2 by default), account lockout, two-factor, and email confirmation - all the places a hand-rolled store quietly gets wrong. On .NET 8+, `MapIdentityApi<TUser>()` emits ready-made register / login / refresh / 2FA endpoints when those defaults fit; reach past it only when the contract genuinely differs.

## JWT bearer for APIs

Register the scheme and lock down validation:

```csharp
builder.Services
    .AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidateAudience = true,
            ValidateLifetime = true,
            ValidateIssuerSigningKey = true,
            ValidIssuer = config["Jwt:Issuer"],
            ValidAudience = config["Jwt:Audience"],
            IssuerSigningKey = new SymmetricSecurityKey(
                Encoding.UTF8.GetBytes(config["Jwt:Key"]!)),
            ClockSkew = TimeSpan.FromSeconds(30),
        };
    });
```

Every validation flag stays on. Issuer, audience, lifetime, and signing key are the four checks that make a bearer token trustworthy - turning one off to make a test or a local run pass is how an environment ships with validation disabled. Trim the default five-minute `ClockSkew` to something small; it exists for clock drift, not as a free grace period on expired tokens.

Mint tokens from explicit claims rather than dumping a whole user object in:

```csharp
var claims = new[]
{
    new Claim(ClaimTypes.NameIdentifier, user.Id.ToString()),
    new Claim(ClaimTypes.Email, user.Email),
    new Claim(ClaimTypes.Role, user.Role),
};
var now = timeProvider.GetUtcNow();   // injected TimeProvider, never DateTime.Now - see csharp
var token = new JwtSecurityToken(
    issuer: config["Jwt:Issuer"],
    audience: config["Jwt:Audience"],
    claims: claims,
    notBefore: now.UtcDateTime,
    expires: now.AddMinutes(15).UtcDateTime,
    signingCredentials: new SigningCredentials(key, SecurityAlgorithms.HmacSha256));
```

Symmetric `HmacSha256` is fine when one service issues and validates. The moment a second party must verify a token it did not mint, switch to asymmetric signing (RSA / ECDSA) so the verifier holds only the public key. Keep access tokens short-lived and pair them with a refresh token if sessions must outlive fifteen minutes - a long-lived access token is a long-lived liability with no way to revoke it. The signing key is a secret: it comes from configuration, never source.

## Cookies for server-rendered apps

For an app the browser navigates, `AddAuthentication().AddCookie()` is the simpler and safer default - the token never leaves the server, and the cookie is `HttpOnly` and `SameSite=Lax` by default. The `Secure` flag only follows the request scheme (the default is `SecurePolicy = SameAsRequest`, so a plain-HTTP request gets an unprotected cookie); pin `SecurePolicy = CookieSecurePolicy.Always` in production. Set a sliding or absolute expiration, and point `LoginPath` / `AccessDeniedPath` at your own pages. Reserve bearer tokens for clients that cannot hold a cookie.

## Authorization: policies, not role strings

Express access rules as named policies and apply the name. A policy is testable in isolation, composable, and changes in one place; `[Authorize(Roles = "Admin")]` sprinkled across handlers is a string match you cannot refactor.

```csharp
builder.Services.AddAuthorizationBuilder()   // fluent, .NET 8+
    .AddPolicy("CanPublish", p => p.RequireRole("Editor", "Admin"))
    .AddPolicy("AdultsOnly", p => p.AddRequirements(new MinimumAgeRequirement(18)));
```

On targets before .NET 8, use `AddAuthorization(options => options.AddPolicy(...))` - same policies, older registration call.

When a rule needs more than a claim check - comparing a date, reading the resource being acted on, calling a service - write a requirement and a handler:

```csharp
public sealed record MinimumAgeRequirement(int Age) : IAuthorizationRequirement;

public sealed class MinimumAgeHandler(TimeProvider clock) : AuthorizationHandler<MinimumAgeRequirement>
{
    protected override Task HandleRequirementAsync(
        AuthorizationHandlerContext context, MinimumAgeRequirement requirement)
    {
        var dob = context.User.FindFirst(c => c.Type == ClaimTypes.DateOfBirth);
        var today = DateOnly.FromDateTime(clock.GetUtcNow().UtcDateTime);   // injected TimeProvider, never DateTime.UtcNow - see csharp
        if (dob is not null && DateOnly.Parse(dob.Value) <= today.AddYears(-requirement.Age))
        {
            context.Succeed(requirement);
        }
        return Task.CompletedTask;
    }
}
```

Register the handler as a singleton and the policy resolves it automatically. For rules that depend on the specific entity (this caller may edit *this* document), use resource-based authorization via `IAuthorizationService.AuthorizeAsync(user, resource, policy)` inside the handler rather than trying to encode the entity into a static policy.

## Protecting endpoints and reading the caller

Attach the policy where the routes are grouped:

```csharp
var admin = app.MapGroup("/admin").RequireAuthorization("CanPublish");
```

`RequireAuthorization` on a minimal API group is the chokepoint - see `dotnet-minimal-api` for how groups carry filters and metadata. Read the authenticated caller from the injected `ClaimsPrincipal`, never from a header you trust by hand:

```csharp
app.MapGet("/me", (ClaimsPrincipal user) =>
    Results.Ok(new { id = user.FindFirstValue(ClaimTypes.NameIdentifier) }));
```

`FindFirstValue` returns the string or null; treat null as unauthenticated, not as a default user.

## OpenID Connect for delegated identity

When an external provider owns sign-in, pair a cookie scheme for the local session with the OIDC handler for the challenge:

```csharp
builder.Services
    .AddAuthentication(options =>
    {
        options.DefaultScheme = CookieAuthenticationDefaults.AuthenticationScheme;
        options.DefaultChallengeScheme = OpenIdConnectDefaults.AuthenticationScheme;
    })
    .AddCookie()
    .AddOpenIdConnect(options =>
    {
        options.Authority = config["Oidc:Authority"];
        options.ClientId = config["Oidc:ClientId"];
        options.ClientSecret = config["Oidc:ClientSecret"];
        options.ResponseType = "code";          // authorization code flow
        options.Scope.Add("openid");
        options.Scope.Add("profile");
        options.SaveTokens = true;
    });
```

Use the authorization code flow (`response_type=code`), not the deprecated implicit flow. The client secret is a secret like any other.

## API keys

API keys are the weakest credential - a single static string with no identity, expiry, or scope - so use them only for service-to-service or webhook callers that cannot do a real handshake, and never as your primary user auth. When you must:

- Store a **hash** of the key, not the key itself; a leaked database must not leak working credentials.
- Compare in **constant time** so the check leaks no timing information about how many characters matched.

The hashing and constant-time-compare primitives belong to `dotnet-cryptography` - call them, do not reimplement them. Implement the check as an authentication handler or a small middleware that sets a `ClaimsPrincipal` on success, so the rest of the pipeline treats an API-key caller exactly like any other authenticated principal.

## Where secrets live

The signing key, client secret, and connection strings are secrets and must never touch a tracked file. The dev-vs-prod placement rule is owned by `dotnet-security`; reach for it rather than restating it here.

The broader access-control and SSRF threat model - what an attacker does once past the front door - is also owned by `dotnet-security`.

## Anti-patterns

- Magic role strings (`[Authorize(Roles = "Admin")]`) scattered in place of named, testable policies.
- Rolling your own password hashing or user store instead of ASP.NET Identity.
- Long-lived or non-expiring access tokens with no refresh-and-revoke story.
