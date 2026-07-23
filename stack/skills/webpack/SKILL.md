---
name: webpack
description: "Webpack 5 build engineering, library-in-monorepo focus (TS + JS): the transpile/type-check split (swc-loader + fork-ts-checker + tsc --emitDeclarationOnly), externals from package.json, the tree-shaking preconditions, ESM output state and the fullySpecified/extensionAlias resolution traps, filesystem-cache pitfalls, the shared config-factory pattern. Fires on webpack.config work, loader/plugin choices, 'bundle this library', tree-shaking or 'failed to resolve as fully specified' errors, slow webpack builds. NOT for Vite/Rollup projects, Angular CLI builds (angular-conventions), or package publishing mechanics (npm skill)."
---

# Webpack 5 - library builds that stay fast and correct

Webpack earns its keep where its loader/plugin ecosystem, Module Federation, or an existing monorepo standard demands it - for a pure library with no such constraint, a Rollup-class tool gives cleaner ESM+types output; say so rather than defaulting here. Once webpack is the tool, these are the rules. Pin `webpack@~5.108` (tilde, not caret) whenever any `experiments.*` flag is on - experimental flags carry relaxed semver - with webpack-cli 7 (Node >= 20.9, native TS configs, `--config-node-env`).

## The three correctness rules

- **Transpilation and type-checking are separate concerns.** The loader transpiles fast and single-file (swc-loader recommended - one rule covering `/\.[cm]?[jt]sx?$/` handles TS and JS uniformly); type safety comes from `fork-ts-checker-webpack-plugin` (async in dev, blocking in CI) and declarations from `tsc --emitDeclarationOnly` - webpack never emits `.d.ts`. Single-file transpilers make `isolatedModules` (or `verbatimModuleSyntax`, which implies it) mandatory - the `typescript` skill's flag set already carries them.
- **A library never bundles its dependencies.** Externalize everything in `dependencies` + `peerDependencies`, computed from package.json (name + subpath regexes), never hand-listed. The failure mode is not bloat, it's breakage: a bundled React means two React copies in the consumer - `Invalid hook call`, broken context singletons. Node libraries also externalize built-ins (the `node` target does it automatically).
- **Tree shaking is a chain of preconditions - any broken link kills it silently**: production mode; ESM preserved end-to-end (Babel `modules: false`, tsconfig `module: esnext`/`preserve` - a transpiler emitting CommonJS is the classic silent killer); accurate `sideEffects` in package.json (list the CSS/polyfill/register files - `sideEffects` prunes whole subtrees and outworks statement-level `usedExports`); a barrel without `sideEffects: false` forces consumers to pull the whole surface. `stats.optimizationBailout` tells you *why* a module survived.

## The resolution traps (mixed TS/JS + ESM)

- `resolve.extensionAlias: { '.js': ['.ts', '.tsx', '.js'], ... }` - so NodeNext-style `import './foo.js'` resolves to `foo.ts` source.
- Strict-ESM files (`.mjs`, or `.js` under `"type": "module"`) demand fully-specified imports; extensionless ESM inside node_modules throws `failed to resolve ... fully specified`. Fix with a rule-scoped `{ test: /\.m?js$/, resolve: { fullySpecified: false } }` - it must sit under `module.rules[].resolve`, NOT top-level `resolve` (the wrong placement is why 'it does not work' reports exist).
- Keep `resolve.extensions` short and most-common-first; in a workspace monorepo prefer package-manager symlinks over `resolve.alias`-to-source, and leave `resolve.symlinks: true`.

## Output for libraries

ESM primary: `output.library.type: 'module'` + `experiments.outputModule` - **still experimental** (the roadmap says so; sharp edges around ESM externals and splitChunks) - so pin `~5.108` and test the published tarball in a real ESM and bundler consumer before trusting it; fall back to `commonjs2` (boring, solid) if consumers break. Add a CJS build via a multi-compiler array only when a real CJS consumer exists - the exports-map shape and the dual-vs-ESM-only decision are the `npm` skill's publishing reference. Ship real source maps (`devtool: 'source-map'`; `hidden-source-map` for error-reporting-only). Keep Terser for a published library (best bytes); switch to `swcMinify` only when minification dominates CI time.

## Structure and speed

One shared, typed config-factory package (`defineConfig`, 5.108+ - a typing identity function, zero runtime behavior) that every package consumes - the full factory example, cache invalidation pitfalls (the `buildDependencies: { config: [__filename] }` rule, monorepo `managedPaths` exclusion for workspace packages, env vars folded into `cache.version`), transpiler tradeoffs, and the profiling toolbox: `references/library-config.md` and `references/caching-and-speed.md`. Instrument before optimizing - `--profile --json` into Statoscope or bundle-analyzer, a size budget failing CI.
