# Wolverine and MassTransit licensing (re-check before quoting)

Licence terms and maintenance dates are the most perishable claim in this skill. Read this file before
telling anyone a library is free, paid, or supported, and verify the current terms against the vendor's
own page in the same sitting - the notes below are a starting point, not an authority.

## Wolverine

- The core is MIT. The open-core commercial piece is the CritterWatch monitoring console, which you do
  not need in order to ship: the bus, outbox, sagas and scheduling are all in the MIT core.

## MassTransit

- v9 onward is commercially licensed.
- v8 stays open source and, as announced, loses official maintenance after 2026 - a v8 estate is on a
  clock, and that clock is the argument for planning a move rather than an emergency.

## What this means for a pick

New code starts on Wolverine. Choose MassTransit only for a deliberate, paid-for reason: an existing
licensed estate, or a transport only it supports. Never present a licence cost as a fact to a user
without re-reading the vendor's current terms first.
