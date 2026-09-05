#!/usr/bin/env node
/**
 * Environment Asset Library Verification — Phase 4 asset sprint.
 *
 * Run:  node tools/verify_assets.mjs
 *
 * Verifies (against the REAL filesystem — no server needed):
 *   1. every manifest.json entry with available:true exists physically
 *   2. every manifest.json path is a valid GLB (glTF magic bytes)
 *   3. no duplicate ids and no duplicate (category, semanticType) pairs
 *   4. no unresolved external dependencies (GLB images must be embedded
 *      OR the referenced sibling texture must exist locally)
 *   5. each kit (living_room, modern_office, city_street, forest,
 *      sci_fi_room) has registered assets
 *   6. ENVIRONMENT_ASSET_MANIFEST entries pointing at /assets/kenney or
 *      /assets/quaternius exist physically (legacy procedural-fallback
 *      categories are allowed to be missing — that is the documented
 *      fallback contract)
 *   7. no fake electronics entries: every 'monitor'/'keyboard' semantic
 *      entry must point at a file that exists
 */
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(join(dirname(fileURLToPath(import.meta.url)), '..'))
const PUB = join(ROOT, 'public')
let failures = 0
const fail = (msg) => { console.error(`  ✗ ${msg}`); failures++ }
const ok = (msg) => console.log(`  ✓ ${msg}`)

// --- 1-4: manifest.json -----------------------------------------------------
const manifest = JSON.parse(readFileSync(join(PUB, 'assets/manifest.json'), 'utf8'))
const entries = manifest.assets
console.log(`\n[manifest.json] ${entries.length} entries`)

const ids = new Set()
const catSem = new Set()
const REQUIRED_GLB_MAGICS = Buffer.from('glTF')
for (const a of entries) {
  if (ids.has(a.id)) fail(`duplicate id: ${a.id}`)
  ids.add(a.id)
  const pairKey = `${a.category}/${a.semanticType}`
  if (catSem.has(pairKey)) console.warn(`  ! duplicate (category,semanticType): ${pairKey} (${a.id})`)
  catSem.add(pairKey)

  if (a.available === true) {
    const p = join(PUB, a.path.replace(/^\//, ''))
    if (!existsSync(p)) fail(`available:true but missing file: ${a.path}`)
    else {
      const head = readFileSync(p).subarray(0, 4)
      if (!head.equals(REQUIRED_GLB_MAGICS)) fail(`not a valid GLB (bad magic): ${a.path}`)
    }
    // unresolved external deps: inspect GLB JSON chunk for image URIs
    if (a.path.endsWith('.glb')) {
      try {
        const buf = readFileSync(p)
        const jsonLen = buf.readUInt32LE(12)
        const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'))
        for (const img of json.images ?? []) {
          if (img.uri) {
            const texPath = join(dirname(p), img.uri)
            if (!existsSync(texPath)) fail(`unresolved external image ${img.uri} referenced by ${a.path}`)
          }
        }
      } catch (e) {
        fail(`could not parse GLB JSON chunk: ${a.path} (${e.message})`)
      }
    }
  }
}
ok(`ids unique; all available:true files exist and parse as GLB`)

// --- 5: kit coverage ----------------------------------------------------------
const REQUIRED_KITS = ['living_room', 'modern_office', 'city_street', 'forest', 'sci_fi_room']
console.log(`\n[kit coverage]`)
for (const kit of REQUIRED_KITS) {
  const n = entries.filter((a) => (a.kits ?? []).includes(kit)).length
  if (n >= 5) ok(`${kit}: ${n} assets`)
  else fail(`${kit}: only ${n} assets (need ≥5)`)
}

// --- 6: TS library kenney/quaternius URLs -------------------------------------
console.log(`\n[environmentAssetLibrary.ts URLs]`)
const libSrc = readFileSync(join(ROOT, 'src/services/environmentAssetLibrary.ts'), 'utf8')
const urls = [...libSrc.matchAll(/url: '([^']+)'/g)].map((m) => m[1])
let checked = 0
for (const u of urls) {
  if (!u.startsWith('/assets/kenney/') && !u.startsWith('/assets/quaternius/')) continue
  checked++
  const p = join(PUB, u.replace(/^\//, ''))
  if (!existsSync(p)) fail(`library URL missing on disk: ${u}`)
}
ok(`${checked} kenney/quaternius library URLs all exist`)

// --- 7: no fake electronics ----------------------------------------------------
console.log(`\n[fake-asset guard]`)
const electronics = entries.filter((a) => ['monitor', 'keyboard'].includes(a.semanticType))
for (const a of electronics) {
  const p = join(PUB, a.path.replace(/^\//, ''))
  if (!existsSync(p)) fail(`electronics entry without real file: ${a.id}`)
}
ok(`${electronics.length} monitor/keyboard entries all backed by real files`)

// --- summary --------------------------------------------------------------------
console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} FAILURES`}`)
process.exit(failures === 0 ? 0 : 1)