/**
 * Spatial Layout Engine — Test Runner.
 *
 * Compile + run:
 *   npx tsc --module commonjs --target ES2020 --esModuleInterop \
 *     --skipLibCheck --outDir /tmp/d3-layout-test \
 *     src/services/sceneGraphTypes.ts \
 *     src/services/spatialLayoutEngine.ts \
 *     src/services/spatialLayoutEngine.test.ts
 *   node /tmp/d3-layout-test/spatialLayoutEngine.test.js
 */

import { runSpatialLayoutSelfTest } from './spatialLayoutEngine.test'

runSpatialLayoutSelfTest()