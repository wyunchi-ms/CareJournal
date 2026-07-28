import { AlertTriangle, CheckCircle2, Database, Download, Eye, EyeOff, Images, KeyRound, LockKeyhole, Moon, RefreshCw, Sun, Upload } from 'lucide-react'
import { useRef, useState } from 'react'
import { ChoicePicker } from '../components/ChoicePicker'
import { ConfirmSheet } from '../components/ConfirmSheet'
import { downloadBlob, exportBackup, importBackup } from '../services/backup'
import { testAzureConnection } from '../services/ocr'
import { useApp } from '../store/AppContext'
import type { BackupPayload } from '../types'

export function SettingsPage() {
  const { events, chemotherapyTemplates = [], records, pins, reimbursementPlans = [], preferences, savePreferences, restoreBackup, deduplicateImagesGlobally, storageLabel } = useApp()
  const [form, setForm] = useState(preferences)
  const [showKey, setShowKey] = useState(false)
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'testing' | 'success' | 'failed'>('idle')
  const [connectionMessage, setConnectionMessage] = useState('')
  const [backupPassword, setBackupPassword] = useState('')
  const [backupMessage, setBackupMessage] = useState('')
  const [pendingRestore, setPendingRestore] = useState<BackupPayload | null>(null)
  const [restoring, setRestoring] = useState(false)
  const [restoreError, setRestoreError] = useState('')
  const [deduplicating, setDeduplicating] = useState(false)
  const [deduplicationMessage, setDeduplicationMessage] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const updateAzure = (key: keyof typeof form.azure, value: string | number) => setForm((current) => ({ ...current, azure: { ...current.azure, [key]: value } }))

  async function save() { await savePreferences(form); setConnectionMessage('配置已保存在本设备'); setConnectionStatus('success') }
  async function test() { setConnectionStatus('testing'); setConnectionMessage('正在测试连接…'); try { await testAzureConnection(form.azure); setConnectionStatus('success'); setConnectionMessage('连接成功') } catch (error) { setConnectionStatus('failed'); setConnectionMessage(error instanceof Error ? error.message : '连接失败') } }
  async function exportData() { try { const blob = await exportBackup(events, chemotherapyTemplates, records, pins, reimbursementPlans, preferences, backupPassword); const location = await downloadBlob(blob, `carejournal-${new Date().toISOString().slice(0, 10)}.carejournal`); setBackupMessage(`加密备份已保存至 ${location}；Azure API Key 未包含在备份中。`) } catch (error) { setBackupMessage(error instanceof Error ? error.message : '导出失败') } }
  async function prepareRestore(file: File | undefined) {
    if (!file) return
    try {
      const payload = await importBackup(file, backupPassword)
      setRestoreError('')
      setPendingRestore(payload)
    } catch (error) {
      setBackupMessage(error instanceof Error ? error.message : '导入失败')
    }
  }
  async function confirmRestore() {
    if (!pendingRestore) return
    setRestoring(true)
    setRestoreError('')
    try {
      await restoreBackup(pendingRestore)
      setPendingRestore(null)
      setBackupMessage('备份恢复成功，Azure API Key 保持当前设备原有配置。')
    } catch (error) {
      setRestoreError(error instanceof Error ? error.message : '恢复失败，请重试')
    } finally {
      setRestoring(false)
    }
  }
  async function deduplicateImages() {
    setDeduplicating(true)
    setDeduplicationMessage('正在扫描检查与报销素材…')
    try {
      const result = await deduplicateImagesGlobally()
      setDeduplicationMessage(result.imagesRemoved > 0 || result.attachmentsRemoved > 0 || result.filesDeleted > 0
        ? `扫描完成：检查 ${result.recordsScanned} 份记录和 ${result.reimbursementPlansScanned} 个报销计划，移除 ${result.imagesRemoved} 张重复检查图片及 ${result.attachmentsRemoved} 个重复报销附件，回收 ${result.filesDeleted} 个本地文件。`
        : `扫描完成：已检查 ${result.recordsScanned} 份记录和 ${result.reimbursementPlansScanned} 个报销计划，没有发现重复素材。`)
    } catch (error) {
      setDeduplicationMessage(error instanceof Error ? error.message : '图片去重失败，请重试')
    } finally {
      setDeduplicating(false)
    }
  }

  return <>
    <div className="settings-layout">
      <section id="llm-settings" className="settings-section card"><div className="settings-heading"><span className="settings-icon"><KeyRound /></span><div><h2>Azure OpenAI</h2></div></div><div className="callout warning"><AlertTriangle /><span>API Key 仅保存在当前设备且不会进入备份，但对当前应用运行环境可见。</span></div><div className="form-grid"><label className="full-width">Endpoint<input type="url" value={form.azure.endpoint} onChange={(e) => updateAzure('endpoint', e.target.value)} placeholder="https://your-resource.openai.azure.com" /></label><label>Deployment Name<input value={form.azure.deployment} onChange={(e) => updateAzure('deployment', e.target.value)} /></label><label>API Version<input value={form.azure.apiVersion} onChange={(e) => updateAzure('apiVersion', e.target.value)} /></label><label className="full-width">API Key<span className="password-input"><input type={showKey ? 'text' : 'password'} value={form.azure.apiKey} onChange={(e) => updateAzure('apiKey', e.target.value)} autoComplete="off" /><button type="button" className="icon-button" onClick={() => setShowKey((value) => !value)} aria-label={showKey ? '隐藏密钥' : '显示密钥'} title={showKey ? '隐藏密钥' : '显示密钥'}>{showKey ? <EyeOff /> : <Eye />}</button></span></label><ChoicePicker label="失败重试次数" options={[1, 2, 3, 4, 5].map((count) => ({ value: String(count), label: `${count} 次` }))} value={String(form.azure.maxRetries)} onChange={(value) => updateAzure('maxRetries', Number(value))} /></div>{connectionMessage && <p className={`connection-status ${connectionStatus}`} role="status">{connectionStatus === 'success' && <CheckCircle2 />}{connectionMessage}</p>}<div className="form-actions"><button className="button secondary" onClick={() => void test()} disabled={connectionStatus === 'testing'}>测试连接</button><button className="button primary" onClick={() => void save()}>保存配置</button></div></section>
      <section className="settings-section card"><div className="settings-heading"><span className="settings-icon"><Database /></span><div><h2>本地数据与家属共享</h2><p>{storageLabel} · {events.length} 个事件 · {records.length} 份检查 · {chemotherapyTemplates.length} 个模板 · {reimbursementPlans.length} 个报销计划</p></div></div><div className="callout"><LockKeyhole /><span>备份使用 AES-256-GCM 加密；密码无法找回，请通过安全方式告知接收者。</span></div><label>备份密码<input type="password" value={backupPassword} onChange={(e) => setBackupPassword(e.target.value)} placeholder="至少 8 位" autoComplete="new-password" /></label><input ref={fileRef} className="sr-only" type="file" accept=".carejournal,application/json" onChange={(e) => { void prepareRestore(e.target.files?.[0]); e.target.value = '' }} />{backupMessage && <p className="backup-message" role="status">{backupMessage}</p>}<div className="backup-actions"><button className="button secondary" onClick={() => fileRef.current?.click()}><Upload />导入备份</button><button className="button primary" onClick={() => void exportData()}><Download />导出加密备份</button></div><div className="data-maintenance"><div className="data-maintenance-description"><span className="settings-icon"><Images /></span><div><strong>全局素材去重</strong><p>统一扫描检查图片、报销图片和 PDF，清理重复引用并回收无引用文件，不会删除仍在使用的素材。</p></div></div><button type="button" className="button secondary" disabled={deduplicating} onClick={() => void deduplicateImages()}>{deduplicating ? <span className="spinner" /> : <RefreshCw />}{deduplicating ? '去重中…' : '全局素材去重'}</button></div>{deduplicationMessage && <p className="maintenance-message" role="status">{deduplicationMessage}</p>}</section>
      <section className="settings-section card"><div className="settings-heading"><span className="settings-icon">{form.darkMode ? <Moon /> : <Sun />}</span><div><h2>显示</h2><p>高对比界面支持系统字体放大。</p></div></div><label className="toggle-row"><span>深色模式</span><input type="checkbox" checked={form.darkMode} onChange={async (e) => { const next = { ...form, darkMode: e.target.checked }; setForm(next); await savePreferences(next) }} /></label></section>
    </div>
    {pendingRestore && <ConfirmSheet
      title="恢复备份"
      message="确定用这个备份替换本机数据吗？"
      description={`备份包含 ${pendingRestore.events.length} 个事件、${pendingRestore.records.length} 份检查、${pendingRestore.chemotherapyTemplates?.length ?? 0} 个治疗方案和 ${pendingRestore.reimbursementPlans?.length ?? 0} 个报销计划。当前本机数据将被替换。`}
      confirmLabel="继续恢复"
      busyLabel="恢复中…"
      busy={restoring}
      error={restoreError}
      onCancel={() => setPendingRestore(null)}
      onConfirm={() => void confirmRestore()}
    />}
  </>
}
