#!/usr/bin/env node
// Bundles kernel + extension sources into a JSON file for the Worker.
// Run: node build-sources.js

import { readFileSync, writeFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '../..')

const kernel = readFileSync(resolve(root, 'src/htmx.kernel.js'), 'utf-8')
const core = readFileSync(resolve(root, 'src/htmx.core.js'), 'utf-8')

// Parse extension names from htmx.register() calls
function getExtensionNames(source) {
    const names = []
    const re = /htmx\.register\(\s*['"]([^'"]+)['"]/g
    let m
    while ((m = re.exec(source)) !== null) names.push(m[1])
    return names
}

const coreNames = getExtensionNames(core)

const bundle = {
    version: '4.0.0',
    kernel,
    extensions: {
        // Core extensions (the "standard" build includes all of these)
        core: { source: core, names: coreNames }
    },
    // Which extensions are included in the "standard" build
    standard: coreNames
}

writeFileSync(resolve(__dirname, 'src/sources.json'), JSON.stringify(bundle))
console.log(`Bundled: kernel (${kernel.length} bytes) + core (${core.length} bytes)`)
console.log(`Extensions: ${coreNames.join(', ')}`)
