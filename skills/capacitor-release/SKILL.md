---
name: capacitor-release
description: "Personal release-pipeline conventions for an Ionic / Capacitor app - the gap from a feature-complete build to a signed store submission: cap sync + native build artifacts (.ipa via Xcode, .aab via Gradle), iOS code signing (provisioning profiles, certificates, App Store Connect API key for CI), Android signing (upload key vs Play app-signing key), store submission (TestFlight + Play testing tracks), OTA / live updates and the native-binary boundary, marketing-version vs build-number sync across web + native, the Fastlane / GitHub Actions CI shape with secrets handling, and dSYM / sourcemap upload. Targets Capacitor 6+ (7 current). Load when cutting a release, wiring signing, or building the release CI. Companions: ionic (the app being released), mobile (the router), capacitor-plugins (native feature mechanics). Do NOT load for in-app feature work with no release or signing concern."
---

# Capacitor release pipeline

This skill owns the last mile: turning a feature-complete Ionic/Capacitor app into a signed artifact in TestFlight or a Play testing track, and deciding what ships over-the-air versus through a fresh store binary. The app itself - UI, lifecycle, permissions, plugin wrapping - is `ionic`; native plugin install/use mechanics are `capacitor-plugins`; this file picks up where the build is done. Floored at Capacitor 6, current on 7 - prefer the 7 path and treat anything newer as optional. Native Swift / Kotlin source edits are out of scope: this skill configures the native projects (signing, versions, symbols), it does not write platform code - that boundary stays with the platform tooling, not the agent.

## The artifact - sync then build
- The web build comes first, then the bridge copy, then the native build. Never build native off a stale `www/`: run `npm run build` -> `npx cap sync` (copies web assets and updates native deps) -> the native build. `cap sync` is the step that makes the native shell match the code you just shipped.
- Prefer `npx cap build ios` / `npx cap build android` (stable, not experimental in 6/7) for a one-shot signed artifact: iOS produces an `.ipa`, Android an `.aab` (default) or `.apk`. It wraps the platform tools so local and CI agree on flags.
- In CI, or when you need archive control, drive the platform tools directly: `xcodebuild -workspace ios/App/App.xcworkspace -scheme App -configuration Release archive` then `-exportArchive` for the `.ipa`; `./gradlew bundleRelease` for the `.aab` (`assembleRelease` only when a raw `.apk` is genuinely needed). Ship the `.aab` to Play, not the `.apk` - Play requires the bundle and serves device-optimized splits from it.

## iOS code signing
- Two artifacts sign an iOS build: a distribution **certificate** (identifies you) and a **provisioning profile** (ties the cert + app id + entitlements). For App Store delivery the profile is an App Store distribution profile.
- Local: let Xcode manage it - automatic signing with your team selected. `cap build ios` defaults to automatic signing and the app-store-connect export method, which is what you want for a store build.
- CI: do not ship your personal certificate around. Authenticate with an **App Store Connect API key** (a `.p8` file plus its key id and issuer id) - it removes the 2FA prompt that breaks an unattended pipeline. Pair it with Fastlane match, which keeps the distribution cert + profile in an encrypted store and installs them into the CI keychain on demand, so every runner signs with the same managed identity instead of a hand-copied `.p12`.
- Switch to manual signing (`--xcode-signing-style manual` with an explicit certificate + profile) only when automatic cannot express the setup - a shared enterprise cert, a pinned profile. Reach for it as the exception, not the default.

## Android signing - upload key vs app-signing key
- Use Play App Signing - it is the modern default and the only sane key-loss story. Two distinct keys, do not conflate them: the **upload key** you hold and sign the `.aab` with locally / in CI, and the **app-signing key** Google holds and re-signs the served APKs with. They must differ.
- The upload key lives in a keystore (`.jks`/`.keystore`) you supply via `--keystorepath` / `--keystorepass` / `--keystorealias` / `--keystorealiaspass` (or the Gradle signing config). Sign with `apksigner` (set `--signing-type apksigner`); `jarsigner` is the legacy default and worth overriding.
- Why this split is the point: if the upload key leaks, Google resets it without touching the app-signing key, so your app identity survives. Never check a keystore or its passwords into the repo - they are CI secrets (see below).

## Store submission
- iOS goes through App Store Connect. Upload the `.ipa` (`xcrun altool` / `notarytool`, Fastlane `pilot`/`deliver`, or Transporter), then distribute the build to **TestFlight** for internal or external testers before promoting to App Store review. Internal testers get builds immediately; external testers wait on a Beta App Review.
- Android goes through the Play Console, which has staged testing tracks - promote a build up the ladder rather than straight to users: **internal** (instant, small allowlist) -> **closed** (a named tester group) -> **open** (public opt-in beta) -> **production**. Upload the same `.aab` to a track; promote between tracks in the console without rebuilding.
- The asymmetry is deliberate: TestFlight and the Play internal track are where a release proves itself. Do not promote to production until the build has sat in a testing track.

## OTA / live updates - the native-binary boundary
This is the load-bearing rule of the whole pipeline: **a live update ships the web layer only**. HTML, CSS, JavaScript, and bundled web assets can go over-the-air with no store review. Anything that touches the native binary - adding or upgrading a Capacitor plugin, changing a native dependency, editing native config or native code - requires a fresh store submission. Push web-layer fixes over-the-air for speed; cut a native release when, and only when, the binary actually changed.
- Use the capawesome live-update plugin (`@capawesome/capacitor-live-update`). Ionic Appflow's live updates are sunsetting (end of 2027), so do not start new work on it - capawesome is the recommended path, with the official live-update mechanism as the alternative.
- Gate OTA bundles to the native versions they are compatible with. An OTA bundle built against a newer plugin set must not land on an older binary that lacks it - a web bundle expecting a native capability the installed binary does not have is a white-screen in production. Bind each live-update channel to a native version range.
- Run both layers together: a live-update channel for rapid web iteration, plus an app-update check that nudges users to the store when a native release is required.

## Versioning - one source, four sinks, kept in sync
Two numbers, and they mean different things on every platform - keep them straight and keep them synced:
- **Marketing version** (the human-facing `1.4.0`): iOS `MARKETING_VERSION` / `CFBundleShortVersionString`, Android `versionName`, web `package.json` `version`.
- **Build number** (the monotonic integer the stores order by, must increase every upload): iOS `CFBundleVersion`, Android `versionCode`.
- The failure this section prevents is drift: a marketing version that disagrees across iOS, Android, and web, or a build number a store rejects as already-used. Bump from one source of truth in the release script - hand-editing the pbxproj and `build.gradle` separately is how they desync. A small CLI (capver, capacitor-set-version) or a Fastlane lane that writes all sinks from the `package.json` version keeps them in lockstep; the build number is the thing CI auto-increments per upload.

## CI/CD shape
- Recommend **Fastlane** as the release engine even when GitHub Actions is the trigger: its `match` (signing), `gym`/`build_app` (archive), `pilot`/`deliver` (App Store), and `supply` (Play) lanes encode the steps once and run identically on a laptop and a runner. A bare Actions workflow ends up re-implementing the same steps in YAML - let Fastlane own the release logic and let Actions own the trigger and the secrets.
- Secrets are injected, never committed: the App Store Connect API `.p8` (base64 in a secret), the Android upload keystore (base64) plus its passwords, the match passphrase / repo token. Decode into the runner at job start, use, and let the ephemeral runner discard them. A keystore, a `.p8`, or a signing password in the repo is a release-blocking leak.
- Build the matrix off the boundary above: a web-only change runs a lint/test/OTA-publish lane; a native change runs the full archive-sign-upload lane. Don't cut a store binary for a CSS fix.

## Crash + symbol upload is a release step
- iOS: upload the **dSYM** for every store/TestFlight build so crash reports symbolicate - automate it in the CI lane (Sentry's sentry-cli, Crashlytics upload-symbols, or Fastlane) rather than pulling it from App Store Connect by hand after a crash arrives. An unsymbolicated production crash is a wasted release.
- Web layer: upload the **sourcemaps** for the same build to your error tracker so an OTA-shipped JS error maps back to real source - then keep the maps out of the shipped bundle.
- Treat both as part of the release, gated on the same build number, not an afterthought - a symbol file that does not match the uploaded build is useless.

## Anti-patterns
- Building native off a stale web build (skipping `cap sync`); shipping a `.apk` to Play where an `.aab` is required.
- A signing certificate, keystore, `.p8`, or password committed to the repo or pasted into a workflow file instead of an injected secret; reusing the upload key as the app-signing key.
- Trying to ship a native change (new plugin, native dependency) over-the-air - it cannot work and white-screens; an OTA bundle pushed to an incompatible native version with no version gate.
- A marketing version or build number edited in one platform's project but not the others; a non-incrementing build number the store rejects.
- Promoting straight to production with no TestFlight / Play testing-track soak; uploading a build with no dSYM / sourcemap and discovering it when the first crash is unreadable.
- Starting new live-update work on the sunsetting Appflow path; writing native Swift / Kotlin source to force a release through (out of scope - fix it in the web layer or the project config).

<!-- House release-pipeline conventions for Ionic/Capacitor; the app under release is `ionic`, native plugin mechanics are the capawesome-team `capacitor-plugins` skill. -->
