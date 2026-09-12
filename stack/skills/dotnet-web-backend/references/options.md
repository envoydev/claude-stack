# Typed options - the detail behind `ValidateOnStart`

The skill body carries the registration chain and the fail-fast rule; this file carries the rest: what to do when an attribute cannot express the rule, which options lifetime to pick, and the anti-patterns.

`.ValidateOnStart()` is the load-bearing call - without it validation runs lazily on first access, which defeats the point. Put simple rules on the class as data-annotation attributes (`[Required]`, `[Range]`). For anything an attribute cannot express - cross-property rules, conditional rules, or rules that depend on `IHostEnvironment` - implement `IValidateOptions<T>`, register it as a singleton, collect every failure into a list and return `ValidateOptionsResult.Fail`; never throw from a validator, as that breaks the chain. Use `PostConfigure` to normalize a bound value (append a trailing slash, apply a default) after binding but before validation.

Pick the lifetime by how the value changes: `IOptions` is a singleton read once at startup - the default for static config; `IOptionsSnapshot` is scoped and re-reads per request; `IOptionsMonitor` is a singleton that reloads on change and fires an `OnChange` callback, so it is the one for background services and hot reload.

Anti-patterns:
- Injecting `IOptions` where the value must track config changes - that read-once wants `IOptionsMonitor` instead.
- Reading raw `IConfiguration` (`config["Smtp:Host"]`) in a service - it skips binding and validation and resists testing; inject the typed options.
- Validating in a constructor or on first use - that is runtime, not startup; move the rule into a validator behind `ValidateOnStart`.
