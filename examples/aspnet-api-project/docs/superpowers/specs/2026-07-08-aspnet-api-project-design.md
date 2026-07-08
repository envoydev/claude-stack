# aspnet-api-project - design spec

- Date: 2026-07-08
- Status: approved (scope Tier A - real linked backend + frontend)
- Lives in: `examples/aspnet-api-project/` (gitignored by the parent agents-stack repo; its own git repo)

## Context and purpose

`examples/` is a local, gitignored playground for stress-testing the personal agent stack. It already
holds `angular-project`, a plain Angular 18 "Task Playground" whose `TaskApiService` is an explicit
*stand-in for a real HTTP backend* (returns seed data via `of(...).pipe(delay(0))`) and whose
`TaskStore` persists to `localStorage`. There is no real backend yet.

This project is the .NET counterpart: a real **.NET 10 Task API** that

1. serves the exact `Task` contract the Angular app already models,
2. is wired to the Angular app as its backend (backend <-> frontend link), and
3. is built idiomatically enough to be a genuine stress target for the agent stack.

Being an API, it naturally spans two house domains - `aspnet` and `data` - which is the one thing the
single-stack Angular testbed cannot exercise (cross-stack contract freeze + the `integration-reviewer`
gate). That is the main reason it exists.

## Locked decisions

- **.NET 10** (SDK 10.0.203 present; `.slnx` is the default solution format).
- **Minimal API + vertical slice** (feature folders, one `Map` entry point per slice).
- **EF Core + SQLite** (file DB `app.db`, `dotnet-ef` migrations).
- **Testbed-for-agents**, not a load-test target. No k6/NBomber. "Stress test" = the stack is run
  against this codebase in a later fresh session.

## Scope

In scope (Tier A):

- The house-quality .NET 10 Task API, GREEN: `dotnet build` clean, `dotnet test` all green.
- Vertical slices for list / get / create / update / delete / stats.
- EF Core + SQLite persistence with a seeded database matching the Angular seed set.
- OpenAPI (built-in), ProblemDetails errors, health endpoint, dev CORS.
- xUnit unit + integration (WebApplicationFactory) tests.
- Its own git repo (`git init`), a `baseline` tag on the first GREEN commit, and the installed stack
  (`.claude/`, `.serena/`, `.mcp.json` with `angular-cli` commented out).
- Rewire the Angular app to consume the API (HttpClient + environment + dev proxy), preserving the
  store's public signal surface, undo, localStorage, and the deliberately grep-noisy symbols.

Out of scope (deferred - the "full measurement testbed" tier):

- The four-part measurement harness (test-prompt + answer-key + run-phases).
- Planted latent bugs and the six workflow fixtures F1-F6.
- Any load-testing tooling.

## Solution layout

```
examples/aspnet-api-project/
|- TaskApi.slnx                         # single .slnx (no .sln)
|- global.json                          # { "sdk": { "version": "10.0.100", "rollForward": "latestFeature" } }
|- Directory.Build.props                # LangVersion latest, Nullable enable, ImplicitUsings enable; NetLibVersion/NetTestVersion; global usings
|- Directory.Packages.props             # CPM: ManagePackageVersionsCentrally + transitive pinning
|- .config/dotnet-tools.json            # dotnet-ef pinned (rollForward:false)
|- .editorconfig                        # house C# style
|- .gitignore                           # bin/ obj/ app.db app.db-wal app.db-shm .serena/ .claude local artifacts
|- src/TaskApi/
|  |- TaskApi.csproj                    # <TargetFramework>$(NetLibVersion)</TargetFramework>, <GenerateDocumentationFile>true</GenerateDocumentationFile>
|  |- Program.cs                        # composition root; ends with `public partial class Program;`
|  |- appsettings.json                  # ConnectionStrings:Default = "Data Source=app.db"
|  |- Properties/launchSettings.json    # applicationUrl http://localhost:5080 (deterministic proxy target)
|  |- Features/Tasks/
|  |  |- ListTasks/    ListTasksEndpoint.cs, ListTasksQuery.cs (+Handle), ListTasksResponse.cs
|  |  |- GetTask/      GetTaskEndpoint.cs, GetTaskQuery.cs (+Handle), (no validator)
|  |  |- CreateTask/   CreateTaskEndpoint.cs, CreateTaskCommand.cs (+Handle), CreateTaskValidator.cs
|  |  |- UpdateTask/   UpdateTaskEndpoint.cs, UpdateTaskCommand.cs (+Handle), UpdateTaskValidator.cs
|  |  |- DeleteTask/   DeleteTaskEndpoint.cs, DeleteTaskCommand.cs (+Handle)
|  |  |- GetTaskStats/ GetTaskStatsEndpoint.cs, GetTaskStatsQuery.cs (+Handle)
|  |  |- Model/        TaskItem.cs (entity), TaskStatus.cs, TaskPriority.cs, TaskDto.cs (wire contract)
|  |- Infrastructure/
|     |- Persistence/  AppDbContext.cs, Configurations/TaskConfiguration.cs, TaskStore.cs, Seed/TaskSeeder.cs, Migrations/
|     |- Errors/       GlobalExceptionHandler.cs, TaskError.cs + ToProblem() map
|     |- Validation/   ValidationFilter.cs (IEndpointFilter)
|- tests/TaskApi.Tests/
   |- TaskApi.Tests.csproj              # xUnit + NSubstitute + FluentAssertions 7.x + Microsoft.AspNetCore.Mvc.Testing + coverlet.collector
   |- Unit/                             # handlers, validators, stats projection
   |- Integration/                      # CustomWebApplicationFactory<Program> + endpoint tests
```

Rationale for a single API project (not a layered Api/Application/Domain/Infrastructure split): the
locked style is vertical slice, and "one internal style per codebase" forbids mixing layering with
slices. The `aspnet` vs `data` domain split lives at the folder level (`Features/**` = aspnet work,
`Infrastructure/Persistence/**` + migrations = data work), which is enough to make a future
cross-domain fixture span both domains.

## The wire contract (API <-> Angular)

The API serializes to the Angular `Task` shape byte-for-byte. `Program.cs` configures
`JsonStringEnumConverter(JsonNamingPolicy.CamelCase)` and the default camelCase property policy.

| Angular field (`task.model.ts`) | C# on `TaskDto` | JSON emitted |
| --- | --- | --- |
| `id: string` | `Guid Id` | `"9f8b..."` (guid as string - opaque to the client) |
| `title: string` | `string Title` | `"..."` |
| `description: string` | `string Description` | `"..."` |
| `status: TaskStatus` | `TaskStatus Status` (enum) | `"todo" \| "active" \| "blocked" \| "done"` |
| `priority: Priority` | `TaskPriority Priority` (enum) | `"low" \| "medium" \| "high" \| "critical"` |
| `dueDate: string \| null` | `DateOnly? DueDate` | `"2026-06-20"` or `null` |
| `createdAt: string` | `DateTimeOffset CreatedAt` | ISO-8601 string |
| `updatedAt: string` | `DateTimeOffset UpdatedAt` | ISO-8601 string |
| `tags: string[]` | `IReadOnlyList<string> Tags` | `["devops"]` |

`NewTask` (create payload) = `Pick<Task,'title'|'description'|'priority'> & Partial<'dueDate'|'tags'|'status'>`,
mapped to `CreateTaskCommand`. Enum names map to the exact lowercase strings under camelCase
(`Todo`->`todo`, `Critical`->`critical`), so no custom naming is needed.

`TaskStats` (dashboard aggregate) mirrors the Angular interface: `total`, `byStatus` (record keyed by
status), `byPriority` (record keyed by priority), `overdue`, `completionRate` (0..1).

## REST surface

Grouped under `MapGroup("/api/tasks")` with `.WithTags("Tasks")`. Handlers are named static methods
(never inline lambdas) returning `Results<...>` unions of `TypedResults`.

| Verb + route | Request | Success | Failure |
| --- | --- | --- | --- |
| `GET /api/tasks` | optional `?status=&priority=&text=&overdueOnly=&sort=&dir=` (`[AsParameters]` readonly record struct) | `200` `TaskDto[]` | - |
| `GET /api/tasks/{id:guid}` | route id | `200` `TaskDto` | `404` |
| `POST /api/tasks` | `CreateTaskRequest` (record) | `201` + `Location`, `TaskDto` | `400` ValidationProblem |
| `PUT /api/tasks/{id:guid}` | `UpdateTaskRequest` (record) | `200` `TaskDto` | `400`, `404` |
| `DELETE /api/tasks/{id:guid}` | route id | `204` | `404` |
| `GET /api/tasks/stats` | - | `200` `TaskStatsDto` | - |
| `GET /health` | - | `200` | - |

The Angular store today only calls the list path (`load()`); the rest exist so the store's mutations
can route through the API and so the surface is a realistic multi-slice target.

## Slice + cross-cutting conventions (applied verbatim from the house skills)

- Each slice: a single `public static void Map(IEndpointRouteBuilder app)`; every other type `internal`.
  Handler method named `Handle`. No cross-slice imports (a slice never references another slice's types).
- `Program.cs` is wiring only - reads as a table of contents calling each slice's `Map(app)`.
- Return `TypedResults`, never untyped `Results.*`. Declare every outcome in the `Results<...>` return type.
- Serialize DTO records, never the EF entity. Bind requests to dedicated request records (no over-posting).
- Validation is an `IEndpointFilter` (`ValidationFilter<TRequest>`) on the group, short-circuiting with
  `TypedResults.ValidationProblem(...)` before the handler; FluentValidation validators per command.
- Errors: RFC 9457 ProblemDetails only. `AddProblemDetails()` + one `GlobalExceptionHandler :
  IExceptionHandler` for the unexpected; a single `TaskError -> IResult` map for expected failures
  (404/409/422). No per-endpoint try/catch, no bespoke error envelope.
- Every handler takes `CancellationToken` last and threads it through.
- Every endpoint carries `.WithName(...)`, `.Produces<T>(...)`, `.ProducesProblem(...)` metadata.

## Persistence

- `AddDbContext<AppDbContext>(o => o.UseSqlite(cs))` (scoped). `NoTracking` default in the ctor; reads
  project to DTOs and are bounded; writes go through explicit `SaveChangesAsync(ct)`.
- `TaskItem` entity mapped by `IEntityTypeConfiguration<TaskItem>`: `ToTable("Tasks")`, `HasKey(Id)`,
  `Title` required max 200, `Description` max 2000, `Status`/`Priority` stored as strings
  (`HasConversion<string>()`), indexes on `Status` and `CreatedAt`. `Tags` stored as a JSON/text column
  via a value converter (SQLite has no array type).
- `dotnet-ef` (pinned tool) for the initial migration; `dotnet ef database update` in dev. `app.db` and
  its `-wal`/`-shm` sidecars are gitignored.
- `TaskSeeder` seeds the six Angular seed tasks on first run (dev only) so the frontend shows the same
  data it does today.
- Naming note: the entity is `TaskItem` (not `Task`) to avoid the `System.Threading.Tasks.Task` clash;
  the table stays `Tasks`.

## Testing

- House trio: xUnit + NSubstitute (loose) + FluentAssertions 7.x. `TimeProvider`/`FakeTimeProvider`
  for the clock; never `DateTimeOffset.UtcNow` directly in code under test.
- Unit tests: handlers (ports substituted), validators, the stats projection. AAA, `Do_X_When_Y` naming.
- Integration tests: `CustomWebApplicationFactory<Program>` over a fresh SQLite DB per class; assert
  status codes, `Location`, the exact JSON contract, and the 404 deny paths. Requires
  `public partial class Program;`.
- Coverage exclusions: `Program.cs`, DI registration, EF migrations + `OnModelCreating`, pure DTOs.

## Frontend link (Angular changes)

Add / change:

- `src/environments/environment.ts` (`{ production:false, apiUrl:'/api' }`) + `environment.production.ts`.
- `proxy.conf.json` at project root: `{ "/api": { "target": "http://localhost:5080", "secure": false, "changeOrigin": true } }`.
- `angular.json`: dev serve `proxyConfig: proxy.conf.json`; prod build `fileReplacements` env swap.
- `src/app/app.config.ts`: add `provideHttpClient(withFetch())` (keep existing providers).
- `src/app/services/task-api.service.ts`: real `HttpClient`, base `${environment.apiUrl}/tasks`, typed
  generics; **keep** the class name, `providedIn:'root'`, and `load(): Observable<Task[]>` signature;
  **add** `create/update/remove`.
- `src/app/services/task-store.service.ts`: minimal edits - `load()` and the command methods route
  through the API with the existing optimistic `mutate(...)` + rollback-on-error via `NotificationService`.
- `src/app/services/task-api.service.spec.ts`: `HttpTestingController` assertions.

Must NOT change: the public read-only signals (names/order/types), the undo stack + `STORAGE_KEY`
effect, the `task-sort.util` functions, the model types, and the zone-based change detection. Stay on
classic `HttpClient` + Observables (no `httpResource`/`rxResource` - this workspace is v18.2). No
absolute `http://localhost:5080` in client code; the proxy owns the host.

## Cross-cutting

- **OpenAPI**: built-in `AddOpenApi()` + `MapOpenApi()` (`/openapi/v1.json`); Scalar UI dev-only. Not
  Swashbuckle (that is the .NET 8 path).
- **Health**: `GET /health` liveness. Readiness deferred (no orchestrator here).
- **CORS (honestly flagged)**: no house convention exists for CORS in the skills read. In dev the proxy
  makes it moot (same-origin `/api`). I will add a **dev-only** permissive policy
  (`AllowAnyOrigin/Method/Header`, `IsDevelopment()` guarded) and mark it clearly as ungrounded rather
  than invent a house rule. Do not treat it as a convention.

## Runbook

- API: `cd examples/aspnet-api-project && dotnet run --project src/TaskApi` -> `http://localhost:5080`.
- Frontend: `cd examples/angular-project && npm start` -> `http://localhost:4200`, `/api` proxied to `:5080`.

## Build approach

Built directly by following the house skills (the stack is run *against* this project later - that is
the measurement). Constructed as its own git repo, first GREEN commit tagged `baseline`, then the stack
is installed into it (`claude-stack.sh install`, `angular-cli` MCP commented out). Nothing is committed
to the public `agents-stack` repo; everything is under gitignored `examples/`.

## Open risks

- `id` is a server Guid serialized as a string; the Angular seed used human-readable string ids. The
  client treats `id` as opaque, so this is compatible, but the seeded ids will differ from today's.
- Stack install into the project is a separate step after the GREEN baseline; until then serena/context7
  are not bound inside the project.
- CORS policy is ungrounded (see above).
