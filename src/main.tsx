import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import { AppProvider } from './store/AppContext'
import App from './App'
import './styles.css'
import { LanSyncPanel } from './components/LanSyncPanel'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <AppProvider>
        <App lanSyncPanel={<LanSyncPanel />} />
      </AppProvider>
    </HashRouter>
  </StrictMode>,
)
