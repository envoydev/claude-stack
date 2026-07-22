'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const SCRIPT = path.join(__dirname, 'scan-evidence.js');
const CATALOG = path.join(__dirname, '..', 'setup-plugin', 'references', 'evidence.json');

// One fixture tree exercising every signal kind, the skip-list, and the depth cap.
function buildFixture()
{
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evscan-'));
    const put = (rel, text) =>
    {
        const p = path.join(root, rel);
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, text);
    };
    put('src/Api/Api.csproj', `<Project Sdk="Microsoft.NET.Sdk.Web">
  <ItemGroup>
    <PackageReference Include="MassTransit" Version="8.0.0" />
    <PackageReference Include="Swashbuckle.AspNetCore" Version="6.5.0" />
  </ItemGroup>
</Project>`);
    put('Directory.Packages.props', `<Project>
  <ItemGroup>
    <PackageVersion Include="Npgsql" Version="8.0.0" />
  </ItemGroup>
</Project>`);
    put('src/Gen/Gen.csproj', `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup><IsRoslynComponent>true</IsRoslynComponent></PropertyGroup>
</Project>`);
    put('web/package.json', JSON.stringify({ dependencies: { '@angular/material': '^17.0.0' }, devDependencies: { '@sentry/angular': '^7.0.0' } }));
    put('nx.json', '{}');
    // skip-list: a signal that exists ONLY under node_modules must not be found
    put('node_modules/somepkg/somepkg.csproj', '<PackageReference Include="BenchmarkDotNet" Version="0.13.0" />');
    // depth cap: a manifest buried deeper than the cap must not be found
    put('a/b/c/d/e/f/g/Deep.csproj', '<PackageReference Include="Grpc.AspNetCore" Version="2.60.0" />');
    return root;
}

function scan(root)
{
    const out = execFileSync('node', [SCRIPT, '--root', root, '--catalog', CATALOG], { encoding: 'utf8' });
    return JSON.parse(out).found;
}

test('scanner finds package, central-package, csproj-property, npm, and file signals with attribution', () => {
    const root = buildFixture();
    try
    {
        const found = scan(root);
        assert.match(found.skills['dotnet-messaging'], /MassTransit in src\/Api\/Api\.csproj/);
        assert.match(found.skills['dotnet-openapi'], /Swashbuckle\.AspNetCore in src\/Api\/Api\.csproj/);
        assert.match(found.skills['dotnet-data-access'], /Npgsql in Directory\.Packages\.props/, 'central package management is read');
        assert.match(found.skills['dotnet-source-generators'], /IsRoslynComponent/, 'csproj property signal');
        assert.match(found.skills['angular-material'], /@angular\/material in web\/package\.json/, 'npm dependency');
        assert.match(found.mcps['sentry'], /@sentry\/angular in web\/package\.json/, 'scoped npm prefix');
        assert.match(found.skills['nx'], /nx\.json/, 'file-existence signal');
    }
    finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('scanner honors the skip-list, the depth cap, and reports nothing for absent signals', () => {
    const root = buildFixture();
    try
    {
        const found = scan(root);
        assert.strictEqual(found.skills['dotnet-performance'], undefined, 'a node_modules-only signal is not found');
        assert.strictEqual(found.skills['dotnet-grpc'], undefined, 'a beyond-depth-cap manifest is not read');
        assert.strictEqual(found.skills['dotnet-realtime'], undefined, 'no signal, no entry - absence is empty, not false');
    }
    finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('scanner on an empty project yields an empty found map', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evscan-empty-'));
    try
    {
        const found = scan(root);
        assert.deepStrictEqual(found, { skills: {}, mcps: {}, plugins: {} });
    }
    finally { fs.rmSync(root, { recursive: true, force: true }); }
});
