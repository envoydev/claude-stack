#!/bin/bash
# The workspace: a plain CommonJS package with an empty module, so the case edits a real .js file.
set -e
mkdir -p src
printf "'use strict';\n\nmodule.exports = {};\n" > src/debounce.js
printf '{ "name": "timing", "private": true, "type": "commonjs", "main": "src/debounce.js" }\n' > package.json
