---
name: mobile-security
description: "Personal Ionic / Capacitor mobile security-hardening reference for the native attack surface a WebView app adds on top of its web risks: secret storage in the Keychain / Keystore (never localStorage or Preferences, which are plaintext on-device), deep links and custom schemes treated as untrusted input, least-privilege native permissions, cleartext-traffic and WebView-debugging disabled in release, an allowNavigation allowlist and no live-reload server.url in production, the iOS backgrounding snapshot and Android FLAG_SECURE, third-party plugin trust, and optional certificate pinning and biometric gating. Targets Capacitor 6+ (8 current). Load when hardening or reviewing an Ionic/Capacitor feature for vulnerabilities, or when the security-auditor sweeps the mobile stack. Points at angular-security for the web-layer XSS/DOM, dotnet-security for the API, and capacitor-release for signing. Do NOT load for non-security work."
---

# Ionic / Capacitor mobile security

An Ionic app is an Angular app running in a native WebView with a bridge to native code. It inherits **every** web risk (see `angular-security` - XSS, CSP, token storage, CSRF) **plus** a native attack surface the browser does not have: on-device storage an attacker with the device can read, deep links other apps can fire, native permissions, and the WebView container itself. This is the native map. Assume the device may be lost, rooted, or shared, and that another app on it is hostile.

## Secret and token storage

- Capacitor `Preferences`, `localStorage`, and IndexedDB are **plaintext** on the device - never store tokens, keys, or PII in them. Use a secure-storage plugin backed by the iOS **Keychain** and Android **Keystore** (a Keychain / secure-storage plugin); the encryption key lives in the Keystore/Keychain, not in JS.
- On the web fallback there is no Keychain - degrade explicitly (a shorter-lived in-memory token, or refuse the sensitive path), never silently fall back to plaintext.
- Clear the secure store on logout, and do not log token values.

## Deep links, custom schemes, universal links

- A deep link - a custom scheme (`myapp://`) or an App / Universal Link - is **attacker-reachable input**. Validate every parameter before it routes, authenticates, or performs an action; never auto-run a state-changing operation from a deep link without a confirmation step.
- Custom schemes can be registered by other apps on the device (scheme hijacking) - prefer verified **App Links (Android) / Universal Links (iOS)** for anything sensitive, since they are domain-bound.

## Native permissions

- Least privilege is the security control here: request only the permissions the feature actually needs - every extra grant widens the native attack surface, and an over-broad manifest is itself a review finding. The point-of-use request cycle and terminal-state handling (`denied`, iOS `limited`, coarse-vs-fine location) are `ionic`'s operational ground; the security review checks the requested set is minimal, not that the prompts are wired.

## Network and transport

- Disable **cleartext traffic** in release: iOS App Transport Security (no `NSAllowsArbitraryLoads`), Android `networkSecurityConfig` (no `cleartextTrafficPermitted`). No `http://` endpoints.
- Consider **certificate pinning** for a high-value API, accepting the rotation/operational cost; a pinned cert that cannot be rotated is its own outage risk.

Android enforces the cleartext ban in `res/xml/network_security_config.xml`, referenced from the manifest's `android:networkSecurityConfig`:
```xml
<network-security-config>
  <base-config cleartextTrafficPermitted="false" />
</network-security-config>
```

## WebView hardening

- Turn **off** WebView debugging in release (`webContentsDebuggingEnabled` false) - a debuggable WebView is a remote inspector into the running app.
- `server.url` / live-reload must **never** ship in a release build - it points the app at a dev machine over http. Release ships the bundled assets.
- `allowNavigation` is an allowlist - keep it tight; do not load arbitrary external URLs into the app WebView. Open external links in the system browser (the `Browser` plugin), not in-app, so untrusted content never runs in the app's WebView context.

## Data at rest and on screen

- Android: set `FLAG_SECURE` on screens showing secrets - it blocks screenshots and the recents-thumbnail capture. iOS: obscure or blank the UI on backgrounding so the app-switcher snapshot does not leak sensitive data.
- Keep sensitive data out of the WebView cache and out of native/JS logs.

## Plugin trust

- A Capacitor plugin runs **native code** with the app's full privileges - a malicious or vulnerable one is a native compromise, not a sandboxed one. Audit any third-party plugin before adding it: check the source and maintenance status, review the native permissions it requests, and pin the version so a later supply-chain push cannot swap the code under you. Sourcing preference and typed-service wrapping are `ionic`'s ground.

## Defense-in-depth, not controls

- Jailbreak / root detection and biometric gating raise the bar but are bypassable on a determined attacker's own device - treat them as friction, never as the security boundary. Biometric auth gates **access to** a secret held in the Keychain; it is not itself the secret, and it does not replace server-side authorization.

## Build and distribution

- Signing and store/OTA integrity is `capacitor-release`'s ground; a security review confirms the release is signed, cleartext/debug flags are off, and any live-update / OTA channel is served over signed HTTPS with an integrity check so an attacker cannot substitute the bundle.

## Where the rest lives

The web layer - XSS, the DomSanitizer bypasses, CSP, token-in-localStorage - is `angular-security` (it all applies inside the WebView too). The API side is `dotnet-security`. Signing and release-channel mechanics are `capacitor-release`.
