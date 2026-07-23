# Caching, transpilers, profiling

Loaded from the `webpack` skill when builds are slow or the cache misbehaves.

## Filesystem cache - the highest-leverage setting, and its pitfalls

```js
cache: {
  type: 'filesystem',
  cacheDirectory: path.resolve(__dirname, 'node_modules/.cache/webpack'),
  buildDependencies: { config: [__filename] },
},
```

- **`config: [__filename]` is not optional** - without it, edits to your config's own required helpers serve a stale cache; this is the most common stale-cache bug. Webpack follows the require graph from `__filename`, so a shared base config imported by each package's config is tracked automatically.
- The cache keys on mode, Node version, and `cache.version` - an environment variable your config reads does NOT invalidate anything until folded into `cache.version`/`cache.name`.
- **Monorepo trap**: `snapshot.managedPaths` treats all of node_modules as immutable, but linked workspace packages live there and DO change. Exclude your scope, and watch it:

```js
snapshot: { managedPaths: [/^(.+?[\\/]node_modules[\\/])(?!@myscope[\\/])/] },
watchOptions: { ignored: /node_modules\/(?!@myscope\/)/ },
```

## Transpiler ranking (speed multiples are largely vendor-reported - directional, not exact)

1. **swc-loader** (default): near-esbuild speed, mature integration, handles decorators/legacy TS that esbuild does not, plugin support.
2. **esbuild-loader**: fastest; weakest TS edges (no `const enum`, limited decorators).
3. **babel-loader + preset-typescript**: only when existing Babel plugins force it. Helper hygiene: `@babel/plugin-transform-runtime` with `@babel/runtime` as an externalized dependency, never per-file inlined helpers; a library injects NO core-js polyfills - that's the consuming app's call.
4. **ts-loader**: the only loader that type-checks and emits declarations natively, and the slowest on rebuilds - `transpileOnly: true` + fork-ts-checker makes it competitive. For JS alongside TS under ts-loader: `allowJs: true` (swc/esbuild need nothing - they parse JS in the same rule).

All single-file transpilers require `isolatedModules`/`verbatimModuleSyntax` - which forbid `const enum` and demand `export type` re-exports; that's a feature (source stays portable across transpilers).

`thread-loader` only pays for itself on Babel/ts-loader-heavy builds - with swc/esbuild it usually ADDS overhead, and its startup cost hurts small library builds.

## Profiling

- `webpack --profile --json > stats.json` into **Statoscope** (module maps, validation rules, build diffing) or webpack-bundle-analyzer.
- `stats: 'detailed'` / `optimizationBailout: true` - the why-was-this-not-tree-shaken answer.
- `speed-measure-webpack-plugin` wraps plugin internals and breaks with mini-css-extract-plugin and friends - scratch-config only, never the real build; treat its numbers as approximate.
- Minification benchmarks: swc minify lands within ~1-2% of Terser's size at roughly 10x the speed on typical packages (esbuild's gzip can lag Terser 5-9% on some large ones) - hence the skill's rule: Terser for published bytes, `TerserPlugin.swcMinify` when minification dominates CI.
