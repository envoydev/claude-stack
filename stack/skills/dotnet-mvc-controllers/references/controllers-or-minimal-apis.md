# Controllers or minimal APIs - the decision

The full fit argument the skill body reduces to a two-line verdict.

Both produce the same HTTP service; the choice is about fit, not capability.

- **Greenfield, default to minimal APIs.** Less ceremony, the endpoint contract reads in one place, `TypedResults` and `Results<>` are first-class, and the per-endpoint filter model is lighter than the filter pipeline. For a new service with no constraint pulling the other way, that is the recommendation.
- **Reach for controllers when something concrete calls for them:**
  - An **existing controller-based codebase** - match it exactly. A repo with both styles has neither; the established pattern wins - the pick-one-architecture rule the web hub owns.
  - **MVC views or Razor alongside the API** - the controller already exists for the view; the API actions belong on the same base.
  - A feature whose tooling is **convention-bound to controllers** - OData, or an attribute-and-convention API-versioning setup that targets controllers and actions.
  - A team or codebase standard that mandates the controller idiom - the filter pipeline, `[ApiController]` inference, and per-action attributes are familiar ground for an MVC-trained team.

Do not run a third pattern in one repo to get one feature. If the bulk is minimal APIs and one slice needs OData, that is a real reason to add controllers there - a deliberate, scoped exception, not a free-for-all.
