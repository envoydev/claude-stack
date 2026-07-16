---
name: dotnet-console-apps
description: "House conventions for the console app's interface surface - what a .NET console binary IS to the outside world, on top of the generic host that runs it. Two shapes: a one-shot CLI tool (System.CommandLine 2.0 / Spectre.Console.Cli / Cocona, subcommands, exit codes) and a long-running gateway bot or consumer (Telegram.Bot, Discord.Net, SlackNet, CryptoExchange.Net, broker queue-workers) run inside a BackgroundService. Floors at .NET 8 / C# 12. Load when building a CLI tool, a chat or trading bot, or a bot's command surface, or when the user names System.CommandLine, Spectre.Console, Telegram.Bot, Discord.Net, or a bot. Companions: dotnet-hosted-services (host lifecycle + 24/7 hardening), dotnet-messaging, csharp, dotnet-testing. Do NOT load for the host lifecycle itself (dotnet-hosted-services), a web API or webhook endpoint (dotnet-web-backend), or a desktop GUI (dotnet-wpf)."
---

# .NET console apps - the CLI and bot interface surface

A console binary is one of two things by its external interface: a **one-shot CLI tool** (parse arguments, do the work, return an exit code) or a **long-running gateway app** (a bot or consumer that stays connected and reacts to events). The generic host that runs the long-running kind - lifecycle, `BackgroundService`, graceful shutdown, and the 24/7 hardening: resilience, rate limiting, reconnect, deployment - is `dotnet-hosted-services`. This skill owns the interface layer on top: how a CLI parses its command surface, and how each bot platform's SDK plugs into that host. Floor is .NET 8 / C# 12.

## CLI argument parsing

Three libraries; pick by how much command surface you have.

- **System.CommandLine** - the parser Microsoft's own `dotnet` CLI is built on; reached stable **2.0.0 GA in November 2025**. The default for a real command tree (subcommands, options, arguments, shell tab-completion). **Migration warning:** the API churned hard through the betas - `2.0.0-beta5` (June 2025) landed major breaking changes, and four sub-packages are now deprecated and excluded from all future releases (DragonFruit, Hosting, Rendering, NamingConventionBinder). Treat any tutorial older than beta5 as stale, and do not adopt the deprecated `Hosting` package to bridge to the generic host - wire the host yourself.
- **Spectre.Console.Cli** - opinionated, type-safe command/settings model (`[CommandArgument]` / `[CommandOption]`), DI support, and rich rendering (tables, prompts, progress bars). The best default for a polished, interactive CLI.
- **Cocona** - minimal, attribute/convention-based, ASP.NET-Core-like ergonomics; fastest to stand up a small command surface.

A CLI tool that also needs config, DI, and logging builds the generic host and drives the parser from it - `Host.CreateApplicationBuilder`, resolve the command handler from DI, return its exit code. Do not reach for a parser's abandoned hosting shim to do it. The GA shape - `SetAction` on the command, values read from the `ParseResult` (the beta-era `SetHandler` surface is gone):

```csharp
var builder = Host.CreateApplicationBuilder(args);
builder.Services.AddSingleton<IngestCommand>();
using var host = builder.Build();

var fileOption = new Option<FileInfo>("--file") { Description = "Input file" };
var root = new RootCommand("Ingests a data file");
root.Options.Add(fileOption);
root.SetAction((parseResult, ct) =>
    host.Services.GetRequiredService<IngestCommand>()
        .RunAsync(parseResult.GetValue(fileOption)!, ct));   // Task<int> -> exit code

return await root.Parse(args).InvokeAsync();
```

Signal handling and graceful shutdown for a tool that does real work are `dotnet-hosted-services`.

## Bots and gateway consumers

A bot is a long-running gateway client, so it *is* a hosted service: run the platform client inside a `BackgroundService`, keep command handlers in DI, and lean on `dotnet-hosted-services` for the lifecycle plus the reconnect / rate-limit / idempotency hardening in its `references/resilience-and-io.md`. The per-platform library choice and integration shape live in `references/bot-sdks.md`:

| Building... | Library | Also load |
|---|---|---|
| a Telegram bot | `Telegram.Bot` (long-polling or webhook) | `references/bot-sdks.md` |
| a Discord bot | `Discord.Net` or `DSharpPlus` (gateway) | `references/bot-sdks.md` |
| a Slack bot | `SlackNet` (Socket Mode or Events API) | `references/bot-sdks.md` |
| a trading / exchange bot | `CryptoExchange.Net` + a venue client | `references/bot-sdks.md` |
| a broker queue worker | per-broker client | `dotnet-messaging` (the delivery contract) + `references/bot-sdks.md` |

The one rule that spans all of them: **decouple the receive loop from the work.** The websocket/poll loop writes to a bounded `System.Threading.Channels` channel; a consumer drains it at a controlled concurrency. That keeps a slow handler from stalling the gateway and gives you backpressure - see `dotnet-hosted-services` for the channel-drained-by-a-hosted-service pattern.

## Testing and time

A bot's timed logic (poll intervals, backoff windows, rate limits) is tested by injecting `TimeProvider` and advancing a `FakeTimeProvider` - never real waits. Integration tests run the host against a fake gateway (a fake client, an in-memory channel), never the live Telegram / Discord / exchange endpoint. The full approach is `dotnet-testing`.
