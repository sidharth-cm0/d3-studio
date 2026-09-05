/**
 * Character Presence Resolver — Test Runner.
 *
 * Compile + run:
 *   npx tsc --module commonjs --target ES2020 --esModuleInterop \
 *     --skipLibCheck --outDir /tmp/d3-presence-test \
 *     src/services/characterPresence.ts \
 *     src/services/characterPresence.test.ts \
 *     src/services/characterPresence.test-runner.ts
 *   node /tmp/d3-presence-test/characterPresence.test-runner.js
 */

import { runCharacterPresenceSelfTest } from './characterPresence.test'

const failures = runCharacterPresenceSelfTest()
if (failures > 0) throw new Error(`${failures} character presence test(s) failed`)
