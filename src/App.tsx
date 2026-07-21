import { Activity, AlertTriangle, CalendarDays, ChartNoAxesCombined, FileScan, ListChecks, Settings } from 'lucide-react'
import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { useApp } from './store/AppContext'
import { CalendarPage } from './pages/CalendarPage'
import { ChartsPage } from './pages/ChartsPage'
import { ImportPage } from './pages/ImportPage'
import { RecordsPage } from './pages/RecordsPage'
import { SettingsPage } from './pages/SettingsPage'

const navItems = [
  { path: '/calendar', label: '病程', icon: CalendarDays },
  { path: '/records', label: '检查', icon: ListChecks },
  { path: '/import', label: '导入', icon: FileScan },
  { path: '/charts', label: '图表', icon: ChartNoAxesCombined },
  { path: '/settings', label: '设置', icon: Settings },
]

function Navigation() {
  const { ocrQueueStats } = useApp()
  const unfinished = ocrQueueStats.queued + ocrQueueStats.processing
  return (
    <nav className="app-nav" aria-label="主导航">
      <div className="brand">
        <span className="brand-mark"><Activity aria-hidden="true" /></span>
        <span><strong>病程记</strong><small>CareJournal</small></span>
      </div>
      <div className="nav-items">
        {navItems.map(({ path, label, icon: Icon }) => (
          <NavLink key={path} to={path} className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
            <Icon aria-hidden="true" />
            <span>{label}</span>
            {path === '/import' && unfinished > 0 && <b className="nav-badge" aria-label={`${unfinished} 个 OCR 任务未完成`}>{unfinished > 99 ? '99+' : unfinished}</b>}
          </NavLink>
        ))}
      </div>
      <p className="local-note">所有病程数据仅保存在本设备</p>
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
  const { ready, storageError } = useApp()
  if (storageError) return (
    <div className="loading-screen storage-error-screen" role="alert">
      <AlertTriangle />
      <div><strong>无法打开本地病程库</strong><p>为保护已有数据，应用没有加载空白数据库：{storageError}</p></div>
      <button className="button primary" onClick={() => window.location.reload()}>重新打开</button>
    </div>
  )
  if (!ready) return <div className="loading-screen"><span className="spinner" />正在打开本地病程库…</div>
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">跳到主要内容</a>
      <Navigation />
      <main id="main-content" className="app-main">
        <Routes>
          <Route path="/calendar" element={<CalendarPage />} />
          <Route path="/records" element={<RecordsPage />} />
          <Route path="/import" element={<ImportPage />} />
          <Route path="/charts" element={<ChartsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/calendar" replace />} />
        </Routes>
      </main>
      <OcrBackgroundStatus />
    </div>
  )
}
