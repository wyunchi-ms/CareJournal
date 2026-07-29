import { Activity, AlertTriangle, CalendarDays, ChartNoAxesCombined, ListChecks, Pill, Settings, WalletCards } from 'lucide-react'
import { App as CapacitorApp } from '@capacitor/app'
import { Capacitor, type PluginListenerHandle } from '@capacitor/core'
import { useEffect, useRef, useState } from 'react'
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate, useNavigationType } from 'react-router-dom'
import { closeTopModal } from './components/modalStack'
import { useApp } from './store/AppContext'
import { CalendarPage } from './pages/CalendarPage'
import { ChemotherapyTemplatesPage } from './pages/ChemotherapyTemplatesPage'
import { ChartsPage } from './pages/ChartsPage'
import { ImportPage } from './pages/ImportPage'
import { RecordsPage } from './pages/RecordsPage'
import { ReimbursementPage } from './pages/ReimbursementPage'
import { SettingsPage } from './pages/SettingsPage'
import { PrivacyPage } from './pages/PrivacyPage'
import { addHarmonyEventListener, getHarmonyBridge, isHarmonyPlatform } from './platform/harmonyBridge'

const navItems = [
  { path: '/chemotherapy-templates', label: '方案', icon: Pill },
  { path: '/records', label: '检查', icon: ListChecks },
  { path: '/calendar', label: '病程', icon: CalendarDays },
  { path: '/charts', label: '图表', icon: ChartNoAxesCombined },
  { path: '/reimbursement', label: '报销', icon: WalletCards },
  { path: '/settings', label: '设置', icon: Settings },
]

type PageTransitionDirection = 'forward' | 'backward'

function navIndex(pathname: string) {
  if (pathname === '/import') return navItems.findIndex((item) => item.path === '/records')
  if (pathname === '/privacy') return navItems.findIndex((item) => item.path === '/settings')
  return navItems.findIndex((item) => item.path === pathname)
}

function routePathname(route: string) {
  return route.split(/[?#]/, 1)[0]
}

function Navigation({ onNavigate }: { onNavigate: (path: string) => void }) {
  const location = useLocation()
  const activeIndex = Math.max(0, navIndex(location.pathname))

  return (
    <nav className="app-nav" aria-label="主导航">
      <div className="brand">
        <span className="brand-mark"><Activity aria-hidden="true" /></span>
        <span><strong>病程记</strong><small>CareJournal</small></span>
      </div>
      <div className="nav-items">
        <span className={`nav-selection nav-selection-${activeIndex}`} aria-hidden="true" />
        {navItems.map(({ path, label, icon: Icon }, index) => (
          <NavLink key={path} to={path} onClick={() => onNavigate(path)} className={`nav-item${index === activeIndex ? ' active' : ''}`}>
            <Icon aria-hidden="true" />
            <span>{label}</span>
          </NavLink>
        ))}
      </div>
      <p className="local-note">病程数据默认保存在本设备</p>
    </nav>
  )
}

function OcrBackgroundStatus() {
  const { ocrQueueStats } = useApp()
  const active = ocrQueueStats.queued + ocrQueueStats.processing
  if (active === 0 && ocrQueueStats.failed === 0) return null
  return (
    <NavLink to="/import" className={`background-ocr-status${ocrQueueStats.failed > 0 && active === 0 ? ' failed' : ''}`}>
      {active > 0 ? <span className="spinner" /> : <AlertTriangle />}
      <span><strong>{active > 0 ? `OCR 后台处理中 · ${active} 项待完成` : `${ocrQueueStats.failed} 项 OCR 失败`}</strong><small>{active > 0 ? `总体进度 ${ocrQueueStats.progress}% · 点击查看详情` : '点击查看并重试'}</small></span>
      {active > 0 && <progress max="100" value={ocrQueueStats.progress} />}
    </NavLink>
  )
}

export default function App() {
  const { ready, startupMessage, storageError } = useApp()
  const location = useLocation()
  const navigate = useNavigate()
  const navigationType = useNavigationType()
  const [pageTransition, setPageTransition] = useState<{ target: string; direction: PageTransitionDirection } | null>(null)
  const currentRoute = `${location.pathname}${location.search}${location.hash}`
  const currentRouteRef = useRef(currentRoute)
  const routeTrailRef = useRef<string[]>([])
  const navigatingBackRef = useRef(false)

  useEffect(() => {
    if (currentRouteRef.current === currentRoute) return
    if (navigatingBackRef.current) {
      navigatingBackRef.current = false
    } else if (navigationType === 'PUSH') {
      routeTrailRef.current.push(currentRouteRef.current)
    } else if (navigationType === 'POP') {
      const previousIndex = routeTrailRef.current.lastIndexOf(currentRoute)
      if (previousIndex >= 0) routeTrailRef.current.splice(previousIndex)
      else routeTrailRef.current.push(currentRouteRef.current)
    }
    currentRouteRef.current = currentRoute
  }, [currentRoute, navigationType])

  useEffect(() => {
    if (!Capacitor.isNativePlatform() && !isHarmonyPlatform()) return

    let disposed = false
    let listener: PluginListenerHandle | undefined
    const handleBack = () => {
      if (closeTopModal()) return

      const previousRoute = routeTrailRef.current.pop()
      if (previousRoute) {
        const currentIndex = navIndex(routePathname(currentRouteRef.current))
        const previousIndex = navIndex(routePathname(previousRoute))
        setPageTransition(currentIndex >= 0 && previousIndex >= 0 && currentIndex !== previousIndex
          ? { target: routePathname(previousRoute), direction: previousIndex > currentIndex ? 'forward' : 'backward' }
          : null)
        navigatingBackRef.current = true
        navigate(previousRoute, { replace: true })
        return
      }
      if (isHarmonyPlatform()) void getHarmonyBridge().exitApp()
      else void CapacitorApp.exitApp()
    }
    if (isHarmonyPlatform()) {
      return addHarmonyEventListener((detail) => {
        if (detail.type === 'backPress') handleBack()
      })
    }
    void CapacitorApp.addListener('backButton', handleBack).then((handle) => {
      if (disposed) void handle.remove()
      else listener = handle
    })

    return () => {
      disposed = true
      void listener?.remove()
    }
  }, [navigate])

  function preparePageTransition(target: string) {
    const currentIndex = navIndex(location.pathname)
    const targetIndex = navIndex(target)
    if (currentIndex < 0 || targetIndex < 0 || currentIndex === targetIndex) {
      setPageTransition(null)
      return
    }
    setPageTransition({ target, direction: targetIndex > currentIndex ? 'forward' : 'backward' })
  }

  if (storageError) return (
    <div className="loading-screen storage-error-screen" role="alert">
      <AlertTriangle />
      <div><strong>无法打开本地病程库</strong><p>为保护已有数据，应用没有加载空白数据库：{storageError}</p></div>
      <button className="button primary" onClick={() => window.location.reload()}>重新打开</button>
    </div>
  )
  if (!ready) return <div className="loading-screen"><span className="spinner" />{startupMessage}</div>
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">跳到主要内容</a>
      <Navigation onNavigate={preparePageTransition} />
      <main id="main-content" className="app-main">
        <div
          key={location.key}
          className={`page-transition${pageTransition?.target === location.pathname ? ` page-transition-${pageTransition.direction}` : ''}`}
          onAnimationEnd={(event) => {
            if (event.target === event.currentTarget && pageTransition?.target === location.pathname) setPageTransition(null)
          }}
        >
          <Routes location={location}>
            <Route path="/calendar" element={<CalendarPage />} />
            <Route path="/chemotherapy-templates" element={<ChemotherapyTemplatesPage />} />
            <Route path="/records" element={<RecordsPage />} />
            <Route path="/import" element={<ImportPage />} />
            <Route path="/reimbursement" element={<ReimbursementPage />} />
            <Route path="/charts" element={<ChartsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/privacy" element={<PrivacyPage />} />
            <Route path="*" element={<Navigate to="/calendar" replace />} />
          </Routes>
        </div>
      </main>
      <OcrBackgroundStatus />
    </div>
  )
}
