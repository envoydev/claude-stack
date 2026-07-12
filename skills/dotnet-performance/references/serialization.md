# Serialization format choice

The format decision for bytes that leave the process. When it matters - and when not to serialize at all - is in `SKILL.md`. Source-gen mechanics are in `dotnet-source-generators`, the gRPC wire in `dotnet-grpc`, broker messaging in `dotnet-messaging`, and the ASP.NET JSON wiring in `dotnet-web-backend`.

## Schema-based over reflection-based

Anything crossing a process boundary should use a schema-based format - Protobuf, MessagePack, or `System.Text.Json` with source generation - not a reflection-based one. Schema-based formats keep type info out of the payload, version by explicit field numbers or keys, need no runtime reflection, and are AOT- and trim-safe. Reflection-based (Newtonsoft.Json, and never `BinaryFormatter`) is slower and breaks on a type rename.

## Pick by destination

| Bytes go to... | Format | Why |
|---|---|---|
| REST/HTTP, config, logs | `System.Text.Json` (source-gen) | standard, human-readable, AOT-safe |
| gRPC or a long-lived wire contract | Protobuf | native to gRPC, first-class versioning |
| a cache or broker messages | MessagePack | compact, fast |
| an event store (read forever) | Protobuf or MessagePack | must decode old events indefinitely |

Avoid: `BinaryFormatter` (never - status and replacement are `dotnet-security`'s A08), Newtonsoft with `TypeNameHandling` (embeds .NET type names), `DataContractSerializer` and XML (verbose, weak versioning). For a hot path, MessagePack or Protobuf beat any JSON on both speed and size.

## System.Text.Json with source generation

Declare a `JsonSerializerContext` listing every serialized type; the generator emits the metadata at compile time, so there is no runtime reflection and it works under Native AOT.

```csharp
[JsonSerializable(typeof(Order))]
[JsonSerializable(typeof(List<Order>))]
[JsonSourceGenerationOptions(
    PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase,
    DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull)]
public partial class AppJsonContext : JsonSerializerContext { }

var json = JsonSerializer.Serialize(order, AppJsonContext.Default.Order);
var back = JsonSerializer.Deserialize(json, AppJsonContext.Default.Order);
```

In ASP.NET Core, register the context (`dotnet-web-backend`):

```csharp
builder.Services.ConfigureHttpJsonOptions(o =>
    o.SerializerOptions.TypeInfoResolverChain.Insert(0, AppJsonContext.Default));
```

The attribute and generator mechanics belong to `dotnet-source-generators`.

## Protobuf

Best for gRPC and any long-lived contract (`dotnet-grpc`). The schema is the source of truth; codegen produces the types.

```protobuf
message Order {
  string id = 1;
  string customer_id = 2;
  repeated OrderItem items = 3;
  string notes = 5;        // added later - old readers ignore it
}
```

Versioning: adding a field with a new number is always safe; removing one is safe if you `reserved` its number. Changing a field's type or reusing a retired number breaks every existing reader.

## MessagePack

Best for caches and broker messages (`dotnet-messaging`) - compact and fast. Annotate contracts with explicit keys, and make the type `partial` to opt into the source generator (AOT-safe).

```csharp
[MessagePackObject]
public sealed partial class Order
{
    [Key(0)] public required string Id { get; init; }
    [Key(1)] public required IReadOnlyList<OrderItem> Items { get; init; }
    [Key(2)] public string? Notes { get; init; }   // new key - old readers skip it
}
```

## Migrating off Newtonsoft.Json

Move to `System.Text.Json`; the attributes and options differ.

| Newtonsoft | System.Text.Json |
|---|---|
| `[JsonProperty("x")]` | `[JsonPropertyName("x")]` |
| `NullValueHandling` / `DefaultValueHandling` | `DefaultIgnoreCondition` |
| private setters (implicit) | `[JsonInclude]` (explicit opt-in) |
| `TypeNameHandling` polymorphism | `[JsonDerivedType]` with an explicit discriminator (.NET 7+) |

```csharp
[JsonDerivedType(typeof(CreditCardPayment), "credit_card")]
[JsonDerivedType(typeof(BankTransferPayment), "bank_transfer")]
public abstract record Payment(decimal Amount);
// serializes with a "$type": "credit_card" discriminator you control
```

## Wire compatibility

Once a format is published or persisted it is hard to change - design for old and new readers coexisting.

- Tolerant reader: old code must ignore unknown fields. Protobuf and MessagePack skip them automatically; for JSON set `UnmappedMemberHandling = JsonUnmappedMemberHandling.Skip`.
- Read before write: deploy the new deserializer everywhere first, then in a later release turn on the new serializer - so no reader ever meets a payload it can't parse.
- Never embed .NET type names. A payload keyed on `MyApp.Order, MyApp` breaks the moment you rename or move the class; use an explicit string discriminator instead.
