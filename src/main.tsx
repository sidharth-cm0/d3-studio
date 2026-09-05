import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/design-system.css'
import './index.css'
import App from './App.tsx'
import LivingRoomAssetTest from './components/LivingRoomAssetTest.tsx'

const isAssetTest =
  import.meta.env.DEV &&
  new URLSearchParams(window.location.search).get('assetTest') === 'living_room'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isAssetTest ? <LivingRoomAssetTest /> : <App />}
  </StrictMode>
)
