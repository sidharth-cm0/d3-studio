/**
 * Scene Graph Relations — Test Runner.
 *
 * Compile + run:
 *   npx tsc --module commonjs --target ES2020 --esModuleInterop \
 *     --skipLibCheck --outDir /tmp/d3-rel-test \
 *     src/services/sceneGraphTypes.ts \
 *     src/services/sceneGraphValidator.ts \
 *     src/services/sceneGraphParser.ts \
 *     src/services/semanticDimensions.ts \
 *     src/services/spatialLayoutEngine.ts \
 *     src/services/sceneGraphRelations.test.ts \
 *     src/services/sceneGraphRelations.test-runner.ts
 *   node /tmp/d3-rel-test/sceneGraphRelations.test-runner.js
 */

import { runSceneGraphRelationsSelfTest } from './sceneGraphRelations.test'

const failures = runSceneGraphRelationsSelfTest()
if (failures > 0) throw new Error(`${failures} scene graph relation test(s) failed`)
