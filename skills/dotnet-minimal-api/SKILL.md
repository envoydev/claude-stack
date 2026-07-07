---
name: dotnet-minimal-api
description: "Personal ASP.NET Core minimal API mechanics - how an endpoint is shaped and wired, not what surrounds it. Covers feature-grouped route registration via extension methods and MapGroup, returning TypedResults and Results<> outcome unions, IEndpointFilter for per-endpoint cross-cutting, parameter binding with AsParameters and explicit From-attributes plus custom BindAsync/TryParse, endpoint metadata for the generated document, and hardened IFormFile uploads (dual size limits, magic-byte sniffing, generated filenames, antiforgery). Floors at .NET 8 / C# 12; later additions are flagged optional. Load before writing or editing minimal API endpoints - MapGet, MapPost, MapGroup, endpoint filters. Companions: dotnet-web-backend for pipeline-wide concerns (validation libraries, OpenAPI document, observability, caching, resilience), dotnet-error-handling for the failure-to-ProblemDetails contract, dotnet-openapi for the docs UI, dotnet-authentication for auth setup. Do NOT load for MVC or API controllers, gRPC, SignalR, or non-HTTP code."
---

# ASP.NET Core minimal API - endpoint mechanics

This skill owns the shape of a minimal API endpoint: where it is registered, what it returns, how parameters bind, and how a cross-cutting concern hangs off it. It stops at the endpoint boundary. The pipeline-wide concerns - OpenAPI document generation, validation library choice, resilience, observability, response caching - live in `dotnet-web-backend`. The failure-to-`ProblemDetails` contract is `dotnet-error-handling`. The docs UI is `dotnet-openapi`. Auth configuration is `dotnet-authentication`. The controller-based counterpart - the same HTTP service sliced into classes - is `dotnet-mvc-controllers`. Floor is .NET 8 / C# 12; anything newer is marked optional.

## Where endpoints live

`Program.cs` is for wiring, not for routes. Each feature or resource owns one registration extension method that maps its group:

```csharp
public static class TodoEndpoints
{
    public static IEndpointRouteBuilder MapTodoEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/v1/todos")
            .WithTags("Todos")
            .RequireAuthorization()
            .AddEndpointFilter<ValidationFilter<CreateTodoRequest>>();

        group.MapGet("/{id:guid}", GetTodo);
        group.MapPost("/", CreateTodo);
        return app;
    }
}
```

`Program.cs` then reads as a table of contents: `app.MapTodoEndpoints();`, `app.MapUserEndpoints();`. Never let `MapGet`/`MapPost` calls accumulate inline in `Program.cs` - it becomes an unsearchable wall and there is nowhere to attach feature-level filters.

`MapGroup` (.NET 7+) is the unit of shared configuration. Put the route prefix, tags, auth requirement, and group-wide filters on the group once; do not repeat them per endpoint. Route constraints (`{id:guid}`, `{page:int:min(1)}`) belong in the template - they reject bad input before any handler code runs.

## Keep handlers out of the lambda

The registration line declares the *shape* of an endpoint - verb, route, filters, declared outcomes. The *logic* belongs in a named static method or a handler class, referenced as a method group:

```csharp
group.MapGet("/{id:guid}", GetTodo);

static async Task<Results<Ok<TodoDto>, NotFound>> GetTodo(
    Guid id, ITodoService todos, CancellationToken ct)
{
    var todo = await todos.FindAsync(id, ct);
    return todo is null ? TypedResults.NotFound() : TypedResults.Ok(todo.ToDto());
}
```

A lambda is fine only while the body is a single expression. The moment it needs a local, a branch, or more than a line or two, promote it to a named method - it becomes testable in isolation, readable in a stack trace, and (this matters) eligible for XML-doc-driven OpenAPI summaries, which the inline lambda cannot carry.

Always accept a `CancellationToken` as the last parameter and thread it into every async call. The framework binds the request-aborted token automatically; an endpoint that ignores it keeps working after the client has hung up.

## What an endpoint returns

Return `TypedResults`, not the untyped `Results`. `TypedResults.Ok(dto)`, `TypedResults.Created(uri, dto)`, `TypedResults.NotFound()`, `TypedResults.ValidationProblem(errors)` each carry their status and body type in the return type, which gives the generated document a correct schema for free and lets a unit test assert on a strongly typed result instead of poking at an opaque `IResult`.

When a handler has more than one legitimate outcome, name them all in the signature with the `Results<...>` union (.NET 7+):

```csharp
static async Task<Results<Created<TodoDto>, ValidationProblem, Conflict>> CreateTodo(...)
```

The signature is now the spec - the status codes are visible at a glance and the compiler will not let a return path produce an undeclared one. Each arm must still be a `TypedResults` value implementing `IResult`.

Serialize DTOs, never domain entities or EF Core models. A `record` request and response type maps at the endpoint edge. Sending an entity over the wire leaks the persistence shape, drags lazy-loaded relations into the serializer, and couples the public contract to the schema.

Bind the request to its own DTO too, not the domain entity. A `CreateTodoRequest` / `UpdateTodoRequest` record - distinct from the persisted model, with the validation attributes on it - is the contract in; the response DTO is the contract out. Binding straight onto an entity is mass-assignment: a caller can over-post fields you never meant to expose - an owner id, an `IsAdmin` - so let only mapped fields cross into domain logic.

## Per-endpoint cross-cutting: IEndpointFilter

`IEndpointFilter` (.NET 7+) is the hook for a concern scoped to a route or a group - validation, argument guards, short-circuiting - that does not belong in pipeline middleware. A filter sees the bound arguments and can inspect them, replace the result, or call the next stage:

```csharp
public class ValidationFilter<TRequest> : IEndpointFilter
{
    public async ValueTask<object?> InvokeAsync(
        EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        var request = context.GetArgument<TRequest>(0);
        // resolve a validator, validate, short-circuit on failure
        return await next(context);
    }
}
```

Reach for a filter over middleware when the concern is per-endpoint rather than per-request; middleware sees the raw pipeline and runs for everything, a filter runs only where it is attached and sees model-bound arguments. Attach it on the group (`.AddEndpointFilter<ValidationFilter<TRequest>>()`) when it applies to every route, or on a single endpoint when it does not.

Validation is the canonical filter: it runs before the handler and returns `TypedResults.ValidationProblem(...)` on failure. The error envelope, the global exception handler, and the `ProblemDetails` shape are owned by `dotnet-error-handling` - do not assemble an error body here. The validator library choice is `dotnet-web-backend`. Authorization rides on `.RequireAuthorization("policy")`, but the policies and scheme are configured per `dotnet-authentication`.

## Parameter binding

Minimal APIs infer the binding source per parameter - route values, query string, header, body, and DI services are resolved by name and type. Make it explicit the moment it is ambiguous: `[FromBody]`, `[FromRoute]`, `[FromQuery]`, `[FromHeader]`, `[FromServices]`, and `[FromKeyedServices("name")]` (.NET 8) remove guesswork and prevent a refactor from silently changing where a value comes from.

When a handler grows a long parameter list, collect the inputs into one type and bind it with `[AsParameters]` (.NET 7+):

```csharp
public readonly record struct ListTodosQuery(
    [FromQuery] int Page, [FromQuery] int Size, [FromQuery] string? Filter);

group.MapGet("/", ([AsParameters] ListTodosQuery query, ...) => ...);
```

A `readonly record struct` keeps it allocation-light and immutable. For a custom type bound from the route or query, implement a static `TryParse`; for one bound from the whole request, implement a static `BindAsync`. The framework discovers these by convention - no attribute needed.

## Metadata

Tag every endpoint so the generated document and the test suite can address it: `.WithName(...)` for a stable operation id and link generation, `.WithTags(...)` to group it, `.WithSummary(...)` / `.WithDescription(...)` for human-readable docs. Declare outcomes the framework cannot infer with `.Produces<TodoDto>(StatusCodes.Status200OK)` and `.ProducesProblem(StatusCodes.Status404NotFound)`, so the document matches what the handler actually returns. Most of this is inferred when you use `TypedResults` and a `Results<>` union - the explicit calls fill the gaps. The document itself is produced per `dotnet-openapi`.

## File uploads

Bind an upload with `IFormFile` (or `IFormFileCollection` for several). For a large upload, do not let the whole body buffer into memory - stream it with `MultipartReader` and copy section by section to the destination. Treat every upload as hostile:

- **Cap the size in two places.** Kestrel's `MaxRequestBodySize` bounds the whole request; `FormOptions.MultipartBodyLengthLimit` bounds the multipart body. Set both - one without the other leaves a gap.
- **Do not trust the declared type.** The `Content-Type` header and the file extension are attacker-controlled. Sniff the real type from the leading magic bytes / file signature and reject anything not on an allowlist.
- **Do not trust the filename.** A supplied name like `../../etc/passwd` is a path-traversal attempt. Save under a server-generated name (`Guid.NewGuid()`), store the original separately if you need it for display, and never use it to build a path.
- **Keep antiforgery on.** An upload is a form post, so `UseAntiforgery()` applies. Only `.DisableAntiforgery()` on an endpoint that is genuinely not cookie/CSRF-exposed (for instance a bearer-token API), and know why before you do.

The error/`ProblemDetails` shape for a rejected upload stays in `dotnet-error-handling`; auth posture in `dotnet-authentication`.

## Anti-patterns

- A `try`/`catch`, an EF Core query, or any business logic inside the route lambda. Move the logic to a handler or service and let the global exception handler own the failure path - per `dotnet-error-handling`.
- A domain entity or EF model serialized straight to the client, or a mutable request `class` where a `record` belongs.
- The untyped `Results.*` where `TypedResults` would give the document and the tests a real type.
- Re-implementing validation, the error envelope, the OpenAPI document, or auth here - each is owned by a companion skill. This skill stops at the endpoint.
- A pile of inline `MapGet`/`MapPost` calls in `Program.cs` instead of feature extension methods.

## Newer versions (optional)

- **.NET 9+:** the built-in OpenAPI generator (`AddOpenApi()` / `MapOpenApi()`) supersedes Swashbuckle - see `dotnet-openapi`.
- **.NET 10+:** first-party validation (`AddValidation()`) runs `[Required]` and friends from `DataAnnotations` without a third-party library, and honors type-level `ValidationAttribute`s and `IValidatableObject.Validate` for cross-field rules. The real gap is async: no async or DI-resolved rule (a uniqueness check against the database) is supported on that path. For those the validator-in-a-filter approach above still carries the case and is what `dotnet-web-backend` assumes.
- Rate limiting (`AddRateLimiter`, .NET 7+) and output caching (`AddOutputCache`, .NET 7+) both attach to a group with a single fluent call - configure them per `dotnet-web-backend`.
- **.NET 8+ Native AOT:** minimal APIs are the only AOT-friendly HTTP stack (MVC is not). To stay AOT-clean, publish with `PublishAot`, let the request-delegate generator source-generate the endpoint plumbing instead of reflection-emitting it, and register a `System.Text.Json` `JsonSerializerContext` source generator to cover both bind-in and serialize-out. Reflection-based (de)serialization and reflection-heavy libraries in the request path break AOT - build with the AOT-analysis warnings on to catch them. Payoff is faster startup, lower memory, and a small self-contained binary.
- **.NET 10+:** `TypedResults.ServerSentEvents(...)` is a first-class return type for one-way server-to-client push - progress, live feeds, token streaming - over a plain HTTP connection, lighter than SignalR or raw WebSockets when you need push, not a duplex channel. This skill owns only the return type; the streaming design is `dotnet-realtime`.
