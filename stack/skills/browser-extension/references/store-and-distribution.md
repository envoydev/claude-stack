# Store review, distribution, monetization

Loaded from the `browser-extension` skill when preparing a listing, handling a rejection, or designing the business model.

## Chrome Web Store

- **Single-purpose policy**: one narrow purpose; supporting features are fine, a second unrelated feature is not.
- **Limited Use data policy** with a required privacy disclosure; remote code ban; obfuscated or undisclosed-remote code is a zero-tolerance auto-rejection. Minified code is allowed but be ready to hand over readable source or source maps.
- Rejections arrive as color+element codes (Blue Argon = MV3 additional requirements, Yellow Magnesium = does not behave as expected). Review: often days, 3-7+ for edge cases; live-item policy warnings give 7-30 days before takedown.

## Firefox AMO

- Mandatory human review for listed add-ons. If the code is minified/bundled/transpiled, submitting **readable source + build instructions** in 'Notes to reviewers' is required.
- Since Aug 2025: all dependencies must be in the source package or fetched only from official package managers during build; unmaintained build tools are rejected; third-party library source links required; obfuscation banned outright.
- Initial review often ~48h; simple no-build extensions clear the automated path faster.

## Safari

Standard Apple App Store review of the container app; Apple Developer account required. Plan the native wrapper from the start if Safari/iOS is a primary target, not as a port.

## Distribution modes

Public store listing; unlisted/private Web Store listings; enterprise force-install by ID + update URL via policy (bypasses the store) for managed orgs.

## Monetization

- The Web Store has NO billing (payments shut down in 2021). The standard model: freemium with your own backend - free tier local, paid features gated by a license/subscription token stored in `chrome.storage` and verified against your API on load.
- Payments through a merchant-of-record (Paddle-class) to offload VAT/tax; ExtensionPay is the popular open-source drop-in for purchases/subscriptions/trials.
- Enforcement risk signal (forum-sourced, not official policy): extensions bundling third-party subscription SDKs have been removed under the Spam policy - keep billing logic clean, disclosed, and in your backend rather than a bundled SDK.

## Account security

Large-user-base extensions get acquisition offers and account-takeover attempts precisely because an update pushes silently to every user: locked-down publisher account (2FA), minimal maintainer list, signed release pipeline from CI only.
