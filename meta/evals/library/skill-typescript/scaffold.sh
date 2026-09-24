#!/bin/bash
# The workspace: a strict TypeScript project with one module to extend, so the case edits a real .ts file.
set -e
mkdir -p src
cat > src/records.ts <<'TS'
export interface Order {
  id: string;
  customer: string;
  region: string;
  total: number;
}
TS
printf '{ "name": "records", "private": true, "devDependencies": { "typescript": "^5.0.0" } }\n' > package.json
printf '{ "compilerOptions": { "strict": true, "target": "ES2022", "module": "ESNext", "noEmit": true }, "include": ["src"] }\n' > tsconfig.json
