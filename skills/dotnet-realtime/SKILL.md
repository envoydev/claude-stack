---
name: dotnet-realtime
description: "Personal .NET real-time conventions for ASP.NET Core SignalR - server-to-client push over a persistent connection (WebSockets, with fallbacks), connection-scoped, not durable. Covers strongly-typed Hub<TClient>, sending from outside a hub via IHubContext, group/user/presence targeting, the reconnection model (group membership is NOT restored - rejoin explicitly), connection-time JWT-over-query-string auth plus per-message validation, additive client contracts, MessagePack, and multi-server scale-out via a Redis backplane or Azure SignalR Service. Floors at .NET 8 / C# 12. Load when building chat, notifications, live dashboards, collaboration, or any real-time push, or when the user names SignalR, hub, WebSocket, real-time, or live updates. Companions: dotnet-messaging (broker delivers durably, SignalR is the last hop), dotnet-authentication, dotnet-hosted-services (worker pushing via IHubContext), dotnet-web-backend. Do NOT load for broker-backed durable messaging (dotnet-messaging), request/response HTTP (dotnet-minimal-api), or in-process reactive streams (r3-reactive-extensions)."
---

# .NET real-time - ASP.NET Core SignalR

SignalR is server-push over a persistent connection: the server can call methods on connected clients (and they on it) without the client polling. The transport negotiates down a ladder - WebSockets first, then Server-Sent Events, then long-polling. Reach for it for chat, notifications, live dashboards, presence, and collaborative editing - anything where the server has something to say *now* and a client is connected to hear it. Baseline is .NET 8 / C# 12.

The defining trait, and the thing that sets every rule below: a SignalR message is **connection-scoped and best-effort**. The server holds no durable copy; a client that is offline, mid-reconnect, or on another server simply misses it. That is the opposite of `dotnet-messaging`, where the broker persists the message and redelivers until acknowledged. If a notification *must* arrive, the durable guarantee lives in the broker, and SignalR is only the last hop - see the seam below. This skill does not cover broker-backed messaging (`dotnet-messaging`), request/response HTTP (`dotnet-minimal-api`, `dotnet-web-backend`), or in-process reactive streams (`r3-reactive-extensions`).

## The seam with messaging: broker delivers, SignalR pushes

The common architecture is not "SignalR instead of a broker" - it is both. A durable integration event arrives on the bus, a consumer handles it inside its transaction, and *then* it pushes a notification to the relevant browsers. The consumer is `dotnet-messaging` / `dotnet-hosted-services`; the push is here. The bridge is `IHubContext` - the supported way to send from outside a hub, where no `Clients` property exists:

```csharp
public sealed class OrderPlacedConsumer(IHubContext<OrdersHub, IOrdersClient> hub)
{
    // runs inside the durable consumer; the broker already guaranteed delivery to us
    public Task Handle(OrderPlaced placed) =>
        hub.Clients.Group($"customer-{placed.CustomerId}")
           .OrderConfirmed(placed.OrderId, placed.PlacedAt);
}
```

Never inject a `Hub` subclass to send messages - hubs are transient (below). `IHubContext<THub, TClient>` is the injected, long-lived surface.

## Hubs: strongly-typed and thin

Default to the strongly-typed `Hub<TClient>`, where `TClient` is an interface of the methods the server may call on clients. The compiler then checks every client call, so a renamed or mistyped client method fails the build instead of silently never arriving.

```csharp
public interface IOrdersClient                 // the client contract
{
    Task OrderConfirmed(Guid orderId, DateTimeOffset at);
    Task OrderFailed(Guid orderId, string reason);
}

public sealed class OrdersHub : Hub<IOrdersClient>
{
    public override async Task OnConnectedAsync()
    {
        var customerId = Context.User?.FindFirst("sub")?.Value;
        if (customerId is not null)
            await Groups.AddToGroupAsync(Context.ConnectionId, $"customer-{customerId}");
        await base.OnConnectedAsync();
    }
}
```

- **Keep hub methods thin** - translate the call and delegate to an injected application service, exactly as a thin controller or gRPC service does. Business logic does not live in the hub.
- **A hub instance is per-invocation** - it is created for one method call and disposed after. Never store connection or session state in hub fields; it is gone on the next call. Hold per-connection state in a store keyed by `Context.ConnectionId` (or `IMemoryCache` / a database), not on the instance.
- **Always `await` the send.** A fire-and-forget `Clients.X.Method(...)` can let the hub method complete before the message is dispatched.

## Targeting: callers, groups, users

`Clients` selects who receives a call: `All`, `Caller`, `Others`, `Group(name)`, `User(userId)`, `Client(connectionId)`. Two house rules:

- Use **groups** for any fan-out narrower than everyone (a chat room, a tenant, a customer's open tabs). Manage membership with `Groups.AddToGroupAsync` / `RemoveFromGroupAsync`.
- Use **`Clients.User(id)`** rather than tracking connection ids yourself when you want "this person on all their devices" - SignalR maps a user to all their connections via the authenticated `NameIdentifier`.

## Reconnection: group membership is not restored

The single most common SignalR bug. When a dropped connection re-establishes, it is a **new connection with a new `ConnectionId`**, and SignalR does **not** re-add it to any groups it was in. You must rejoin explicitly - server-side in `OnConnectedAsync` (as above), and the client must re-request anything tied to the old connection. Configure automatic reconnection and treat reconnect as a fresh join:

```javascript
const connection = new signalR.HubConnectionBuilder()
    .withUrl("/hubs/orders", { accessTokenFactory: () => getToken() })
    .withAutomaticReconnect([0, 2000, 5000, 10000])
    .build();

connection.onreconnected(() => rejoinRoomsAndResync());   // groups are gone - rejoin
```

Reconnection only spans a brief window; past it the connection closes and the client must start a new one. Because messages sent while disconnected are simply lost, a client that needs the current state after a gap should **re-fetch over REST**, not assume SignalR replayed anything.

## Auth: at connect, over the query string, and re-validated per message

- SignalR authenticates **once, at connection time**, then the connection is trusted for its lifetime. So authorize the hub (`[Authorize]` on the hub or method, policies as for any endpoint) *and* validate the inputs of every hub method - a connection authenticated as a low-privilege user must not be able to call a method it shouldn't.
- The browser WebSocket API cannot set an `Authorization` header, so the JWT travels in the **query string** and the bearer handler must be taught to read it for hub paths only:

```csharp
options.Events = new JwtBearerEvents
{
    OnMessageReceived = ctx =>
    {
        var token = ctx.Request.Query["access_token"];
        if (!string.IsNullOrEmpty(token) && ctx.HttpContext.Request.Path.StartsWithSegments("/hubs"))
            ctx.Token = token;
        return Task.CompletedTask;
    }
};
```

The full JWT/policy setup is `dotnet-authentication`; this is only the hub-specific wiring.

## Contracts evolve additively

The client interface is a published contract - clients on old versions stay connected. Evolve it the same way `dotnet-messaging` evolves message contracts: add new optional fields (prefer a single request/response object parameter so a new field is not a new method signature), never repurpose or retype an existing one, and version the hub name (a `OrdersHubV2` at a new path) for a genuinely breaking change. Stamp any server-set timestamps from an injected `TimeProvider`, never `DateTime.Now` - see `csharp`.

## Payloads, throughput, transport

- **SignalR carries notifications, not bulk data.** Push the fact that something changed plus an id; let the client pull the heavy payload over REST/gRPC. Large frames create memory pressure and head-of-line stalls.
- **Throttle high-frequency events** (typing indicators, cursor positions, telemetry) on the client - debounce or sample before sending.
- Prefer the **MessagePack** protocol (`AddMessagePackProtocol`) over JSON when message size and serialization cost matter; it is binary and compact.
- Set `MaximumReceiveMessageSize`, `KeepAliveInterval`, and `ClientTimeoutInterval` deliberately rather than leaving defaults under load, and use `EnableDetailedErrors` only in development - it leaks exception text to clients.

## Scale-out: a backplane, and what it does not give you

One server keeps every connection's state in its own memory, so the moment you run more than one instance a message sent from server A never reaches a client connected to server B. Two fixes:

- **Self-hosted: a Redis backplane** (`AddStackExchangeRedis`). Every server publishes outgoing messages to Redis pub/sub and subscribes to the same channel, so a broadcast reaches all connections. You still need **sticky sessions** (the negotiate response and the connection must hit the same server).
- **On Azure: the Azure SignalR Service.** It holds the connections itself, which removes the sticky-session requirement and the backplane wiring.

```csharp
builder.Services.AddSignalR()
    .AddMessagePackProtocol()
    .AddStackExchangeRedis(builder.Configuration.GetConnectionString("redis")!);
```

Crucially, a backplane is a **fan-out layer, not a store** - it does not persist messages or deliver to absent clients. Durable, guaranteed, replayable delivery is the broker's job (`dotnet-messaging`), not the backplane's. Connection strings come from configuration via the options pattern, never a literal - same rule as every other transport.

## Anti-patterns

- Treating SignalR as a durable queue - assuming a message reaches a client that is offline or mid-reconnect. At-most-once; put the guarantee in a broker (`dotnet-messaging`) and use SignalR as the last hop.
- Storing per-connection state in hub fields - the hub instance is gone after the call.
- Constructing or injecting a `Hub` subclass to send from elsewhere instead of `IHubContext<THub, TClient>`.
- Not rejoining groups after a reconnect - the new connection is in no groups.
- Not `await`ing a send, so the hub method returns before the message goes out.
- Running multiple servers with no backplane (messages reach only same-server clients), or a backplane without sticky sessions.
- Trusting the connection after the initial auth - skipping per-message validation, or forgetting the query-string token wiring so WebSocket auth silently fails.
- Pushing large payloads or unthrottled high-frequency events over the hub instead of a notify-then-pull split.
- Exposing ORM entities directly as hub payloads (over-serialization, leak risk) instead of explicit DTOs.
