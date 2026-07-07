# CRAP-score risk hotspots

Finding the methods most dangerous to change - high complexity, low coverage - and ranking them so tests land where they pay. Whether coverage gates a build, and the reward-hacks around coverage thresholds, live in the parent skill; this file owns only the risk-hotspot pipeline.

## What CRAP is

CRAP (Change Risk Anti-Patterns) combines a method's cyclomatic complexity with its uncovered fraction: `complexity^2 x (1 - coverage)^3 + complexity`. A method that is both branch-heavy and untested is the top risk, because it is hard to reason about and nothing catches a regression when you touch it. The exponents are the point: complexity is squared and the uncovered fraction cubed, so an untested thicket scores enormously - but the trailing complexity term is a floor no coverage can beat. A complexity-5 method at 0% coverage scores 30 and drops to 5 fully covered; a complexity-32 method scores over 1000 untested and still 32 when fully covered, so coverage cannot rescue genuine complexity - only refactoring lowers that floor. The score therefore ranks refactor/test targets by danger, not raw size - a simple getter at 0% coverage is harmless (`1^2 x 1 + 1 = 2`) and never surfaces, while a thicket of branches with no tests floats to the top.

## Generate it

CRAP needs per-method cyclomatic complexity, which cobertura alone does not carry - the OpenCover format does. Emit both from coverlet, then let ReportGenerator compute the hotspots. A minimal `coverage.runsettings` at the repo root:

```xml
<?xml version="1.0" encoding="utf-8" ?>
<RunSettings>
  <DataCollectionRunSettings>
    <DataCollectors>
      <DataCollector friendlyName="XPlat code coverage">
        <Configuration>
          <!-- opencover carries the cyclomatic complexity CRAP needs -->
          <Format>cobertura,opencover</Format>
          <Exclude>[*.Tests]*,[*.Benchmark]*,[*.Migrations]*</Exclude>
          <ExcludeByAttribute>GeneratedCodeAttribute,CompilerGeneratedAttribute,ExcludeFromCodeCoverageAttribute</ExcludeByAttribute>
          <ExcludeByFile>**/obj/**/*,**/*.g.cs,**/*.designer.cs,**/Migrations/**/*</ExcludeByFile>
          <IncludeTestAssembly>false</IncludeTestAssembly>
          <SkipAutoProps>true</SkipAutoProps>       <!-- don't count trivial auto-property branches -->
        </Configuration>
      </DataCollector>
    </DataCollectors>
  </DataCollectionRunSettings>
</RunSettings>
```

Install ReportGenerator as a local tool (pin it in `.config/dotnet-tools.json`, never global - same reproducibility rule as CSharpier), run the tests, then generate:

```bash
dotnet tool install dotnet-reportgenerator-globaltool   # or 'dotnet tool restore' if already pinned

dotnet test --settings coverage.runsettings \
  --collect:"XPlat Code Coverage" --results-directory ./TestResults

dotnet reportgenerator \
  -reports:"TestResults/**/coverage.opencover.xml" \
  -targetdir:"coverage" \
  -reporttypes:"Html;MarkdownSummaryGithub"
```

Point `-reports` at the `coverage.opencover.xml` file, not the cobertura one - the hotspot table needs the complexity metrics only OpenCover carries. Open `coverage/index.html` and find the Risk Hotspots section: methods sorted by CRAP, each row showing cyclomatic complexity, coverage, and the resulting score.

## Read it

A hotspot table reads top-down as a work queue:

```
Method                        Complexity  Coverage  CRAP
AuthService.ValidateToken()   32          0%        1056   <- test now
DataImporter.ParseRecord()    35          90%       36.2   <- refactor, not tests
OrderProcessor.Calculate()    4           95%       4.0    <- safe to change
```

Act on CRAP above 30, and treat it as a stop-ship on any method you are about to modify. The two ways down map to the two factors: write tests to raise coverage (usually the cheaper move - it collapses the cubed uncovered term fast), or refactor to cut complexity. Coverage alone only buys the score down toward the complexity floor, so a method whose complexity itself tops 30 (`ParseRecord` above, still 36 at 90% coverage) stays crappy no matter how well tested - it needs the knife, not more tests. Prioritize the top of the list; do not chase a uniform coverage percentage, chase the risky methods.

| CRAP | Read |
|---|---|
| < 5 | well-tested or trivial - leave it |
| 5 - 30 | acceptable, but watch complexity growth |
| > 30 | test or refactor before changing it |
