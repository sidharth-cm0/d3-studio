/**
 * Living Room Asset Verification — Test Runner.
 *
 * Compile + run (Node, no server needed for registry tests):
 *   npx tsc --module commonjs --target ES2020 --esModuleInterop \
 *     --skipLibCheck --outDir /tmp/d3-lr-test \
 *     src/services/environmentAssetLibrary.ts \
 *     src/services/livingRoomAssetVerify.test.ts
 *   node /tmp/d3-lr-test/livingRoomAssetVerify.test.js
 *
 * For full GLB load verification (requires a running dev server):
 *   npm run dev
 *   # then import livingRoomAssetVerify.test.ts in the browser console
 */

import { runLivingRoomAssetSelfTest } from './livingRoomAssetVerify.test'

runLivingRoomAssetSelfTest()
