import { StrictMode } from 'react'
import type { ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/design-system.css'
import './index.css'
import App from './App.tsx'
import LivingRoomAssetTest from './components/LivingRoomAssetTest.tsx'
import EnvironmentAssetTest from './components/EnvironmentAssetTest.tsx'

// Dev-only asset visual-test routing (?assetTest=<category>).
// living_room uses its dedicated harness; other categories use the generic one.
const assetTestParam = import.meta.env.DEV
  ? new URLSearchParams(window.location.search).get('assetTest')
  : null

let testContent: ReactNode = null
if (assetTestParam === 'living_room') {
  testContent = <LivingRoomAssetTest />
} else if (assetTestParam) {
  testContent = <EnvironmentAssetTest category={assetTestParam} />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {testContent ?? <App />}
  </StrictMode>
)
