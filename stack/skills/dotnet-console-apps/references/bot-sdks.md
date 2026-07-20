# Bot and gateway SDKs - per-platform integration

Every bot below is a long-running gateway client that runs *inside* a `BackgroundService`, with command handlers in DI and the connection hardening (keepalive, reconnect/backoff, rate limiting) taken from `dotnet-hosted-services` (`references/resilience-and-io.md`). This note only adds what differs per platform.

## Telegram - `Telegram.Bot`

Two receive modes, one per bot token at a time:

- **Long polling** (`StartReceiving`) - no public URL needed, fits a `BackgroundService` directly. The simplest choice and the right default for most bots.
- **Webhooks** - an ASP.NET Core endpoint the Telegram servers call; scales better and cuts latency, but needs a public HTTPS URL (so it is a web app, not a pure console host - `dotnet-web-backend`).

Throttling (honor `429` + Retry-After, cap outbound sends) is the standard treatment in `dotnet-hosted-services`' `references/resilience-and-io.md`; the Telegram-specific part is that limits apply per chat, so partition any rate limiter by chat id.

## Discord - `Discord.Net` or `DSharpPlus`

Both are mature, gateway-websocket-based, and integrate with the generic host. Default to `Discord.Net` (the most widely used, the larger ecosystem); reach for `DSharpPlus` only when you need the newest Discord API features it tracks more aggressively. Run the gateway client inside a `BackgroundService` and keep the command/interaction handlers in DI. The gateway drops and re-sessions - the reconnect + re-subscribe loop is the standard one in `dotnet-hosted-services`' `references/resilience-and-io.md`.

## Slack - `SlackNet`

Socket Mode (a websocket, no public URL) for a self-contained bot, or the Events API (HTTP) when you already run a web surface. Same rule: client in a `BackgroundService`, handlers in DI.

## Trading / exchange bots - `CryptoExchange.Net`

Use `CryptoExchange.Net` (by JKorf) and its venue clients (`Binance.Net`, `Bybit.Net`, `Kucoin.Net`, ...). They provide REST + websocket streams, automatic reconnection, client-side rate limiting, and local order-book maintenance (v7+ use native `ClientWebSocket`, not the old Websocket4Net). Beyond the library:

- **Model the order lifecycle as a state machine** - New -> PartiallyFilled -> Filled / Cancelled / Rejected - with the `Stateless` library (GitHub: dotnet-state-machine/stateless): `PermitDynamic` for fill-quantity-dependent transitions, and `Activate` / `Deactivate` with external state persistence to rehydrate an order from the database after a restart.
- **Decouple the websocket receive loop from order logic** - the bounded-channel rule from the skill body - so a stalled order handler never blocks market-data receive.
- **GC mode:** the Server-GC-for-a-single-dominant-latency-sensitive-process choice is `dotnet-hosted-services`' `references/deployment-and-observability.md`.
- **Idempotent retries:** the persist-the-key-first discipline (here the key is the `clientOrderId`) is `dotnet-hosted-services`' `references/resilience-and-io.md`; the venue-specific part is the duplicate-rejection window - check it per venue.

## Broker queue workers

RabbitMQ (`RabbitMQ.Client` raw, or the bus library per `dotnet-messaging` - Wolverine first), Kafka (`Confluent.Kafka`), Azure Service Bus (`Azure.Messaging.ServiceBus`, with built-in dead-lettering), or Redis streams (`StackExchange.Redis`). Consume inside a `BackgroundService`, dispatch through a bounded channel to a controlled concurrency, ack **only after** successful processing, and route a poison message to a dead-letter queue after N attempts. The delivery contract itself - at-least-once, idempotent consumers, the transactional outbox - is `dotnet-messaging`; this skill only fixes that the consumer lives in a hosted service and feeds a channel.
