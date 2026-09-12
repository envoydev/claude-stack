# .NET cryptography on .NET Framework 4.8

The primitive choices in SKILL.md hold on net48, but two Framework defaults are footguns and one API
name differs. The rule is unchanged: pick the primitive correctly, never roll your own.

## PBKDF2 defaults to SHA-1 - override it

- On .NET Framework the `Rfc2898DeriveBytes` constructor defaults to HMAC-SHA-1. Always pass
  `HashAlgorithmName.SHA256` (available on 4.8) explicitly, with a high iteration count - the OWASP
  floor is 600,000 for PBKDF2 over HMAC-SHA-256 - and a unique 16+ byte per-user salt from a CSPRNG.
  Verify with a constant-time comparison. (`Microsoft.AspNetCore.Cryptography.KeyDerivation.Pbkdf2` is
  a more flexible alternative, usable from 4.6.1+.)

## Random numbers: the API name differs

- Modern .NET prefers the static `RandomNumberGenerator.Fill` / `GetBytes` (and
  `RNGCryptoServiceProvider` is obsolete there as SYSLIB0023). On 4.8 use
  `RandomNumberGenerator.Create()` or `RNGCryptoServiceProvider`. Never use `System.Random` for
  anything security-relevant.

## What is in-box, and what needs a package

- In-box on 4.8: SHA-256/384/512 and the RSA / ECDSA primitives. Avoid MD5 / SHA-1 for security, and
  DES / 3DES / RC4 entirely.
- **`AesGcm` is not in-box on 4.8.** It is a .NET Standard 2.1 / .NET Core 3.0+ type, and net48 does
  not implement that standard, so `new AesGcm(...)` does not compile on a stock net48 project. Obtain
  AES-GCM through a package such as `Microsoft.Bcl.Cryptography` (net462+, Windows-only on .NET
  Framework) or a CNG P/Invoke; where you cannot, fall back to AES-CBC + HMAC (encrypt-then-MAC). Still
  prefer authenticated encryption over bare AES-CBC once you have it.

The TLS transport defaults belong to the security-hardening skill's own 4.8 notes. Storing a protected
secret at rest (Windows DPAPI, `ProtectedData`, `CurrentUser` scope) has no net48 delta - it lives in
your secrets / config layer.
