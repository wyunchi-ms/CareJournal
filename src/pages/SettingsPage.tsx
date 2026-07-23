import { AlertTriangle, CheckCircle2, Database, Download, Eye, EyeOff, KeyRound, LockKeyhole, Moon, Sun, Upload } from 'lucide-react'
import { useRef, useState } from 'react'
import { ChoicePicker } from '../components/ChoicePicker'
import { downloadBlob, exportBackup, importBackup } from '../services/backup'
import { testAzureConnection } from '../services/ocr'
import { useApp } from '../store/AppContext'

export function SettingsPage() {
  const { events, records, pins, preferences, savePreferences, restoreBackup, storageLabel } = useApp()
  const [form, setForm] = useState(preferences)
  const [showKey, setShowKey] = useState(false)
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'testing' | 'success' | 'failed'>('idle')
  const [connectionMessage, setConnectionMessage] = useState('')
  const [backupPassword, setBackupPassword] = useState('')
  const [backupMessage, setBackupMessage] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const updateAzure = (key: keyof typeof form.azure, value: string | number) => setForm((current) => ({ ...current, azure: { ...current.azure, [key]: value } }))

  async function save() { await savePreferences(form); setConnectionMessage('配置已保存在本设备'); setConnectionStatus('success') }
  async function test() { setConnectionStatus('testing'); setConnectionMessage('正在测试连接…'); try { await testAzureConnection(form.azure); setConnectionStatus('success'); setConnectionMessage('连接成功') } catch (error) { setConnectionStatus('failed'); setConnectionMessage(error instanceof Error ? error.message : '连接失败') } }
  async function exportData() { try { const blob = await exportBackup(events, records, pins, preferences, backupPassword); downloadBlob(blob, `carejournal-${new Date().toISOString().slice(0, 10)}.carejournal`); setBackupMessage('加密备份已生成；Azure API Key 未包含在备份中。') } catch (error) { setBackupMessage(error instanceof Error ? error.message : '导出失败') } }
  async function restore(file: File | undefined) { if (!file) return; try { const payload = await importBackup(file, backupPassword); if (!confirm(`备份包含 ${payload.events.length} 个事件和 ${payload.records.length} 份检查，将替换本机现有数据。是否继续？`)) return; await restoreBackup(payload); setBackupMessage('备份恢复成功，Azure API Key 保持当前设备原有配置。') } catch (error) { setBackupMessage(error instanceof Error ? error.message : '导入失败') } }

  return <>
    <div className="settings-layout">
      <section className="settings-section card"><div className="settings-heading"><span className="settings-icon"><KeyRound /></span><div><h2>Azure OpenAI</h2></div></div><div className="callout warning"><AlertTriangle /><span>API Key 仅保存在当前设备且不会进入备份，但对当前应用运行环境可见。</span></div><div className="form-grid"><label className="full-width">Endpoint<input type="url" value={form.azure.endpoint} onChange={(e) => updateAzure('endpoint', e.target.value)} placeholder="https://your-resource.openai.azure.com" /></label><label>Deployment Name<input value={form.azure.deployment} onChange={(e) => updateAzure('deployment', e.target.value)} /></label><label>API Version<input value={form.azure.apiVersion} onChange={(e) => updateAzure('apiVersion', e.target.value)} /></label><label className="full-width">API Key<span className="password-input"><input type={showKey ? 'text' : 'password'} value={form.azure.apiKey} onChange={(e) => updateAzure('apiKey', e.target.value)} autoComplete="off" /><button type="button" className="icon-button" onClick={() => setShowKey((value) => !value)} aria-label={showKey ? '隐藏密钥' : '显示密钥'}>{showKey ? <EyeOff /> : <Eye />}</button></span></label><ChoicePicker label="失败重试次数" options={[1, 2, 3, 4, 5].map((count) => ({ value: String(count), label: `${count} 次` }))} value={String(form.azure.maxRetries)} onChange={(value) => updateAzure('maxRetries', Number(value))} /></div>{connectionMessage && <p className={`connection-status ${connectionStatus}`} role="status">{connectionStatus === 'success' && <CheckCircle2 />}{connectionMessage}</p>}<div className="form-actions"><button className="button secondary" onClick={() => void test()} disabled={connectionStatus === 'testing'}>测试连接</button><button className="button primary" onClick={() => void save()}>保存配置</button></div></section>
      <section className="settings-section card"><div className="settings-heading"><span className="settings-icon"><Database /></span><div><h2>本地数据与家属共享</h2><p>{storageLabel} · {events.length} 个事件 · {records.length} 份检查</p></div></div><div className="callout"><LockKeyhole /><span>备份使用 AES-256-GCM 加密；密码无法找回，请通过安全方式告知接收者。</span></div><label>备份密码<input type="password" value={backupPassword} onChange={(e) => setBackupPassword(e.target.value)} placeholder="至少 8 位" autoComplete="new-password" /></label><input ref={fileRef} className="sr-only" type="file" accept=".carejournal,application/json" onChange={(e) => { void restore(e.target.files?.[0]); e.target.value = '' }} />{backupMessage && <p className="backup-message" role="status">{backupMessage}</p>}<div className="backup-actions"><button className="button secondary" onClick={() => fileRef.current?.click()}><Upload />导入备份</button><button className="button primary" onClick={() => void exportData()}><Download />导出加密备份</button></div></section>
      <section className="settings-section card"><div className="settings-heading"><span className="settings-icon">{form.darkMode ? <Moon /> : <Sun />}</span><div><h2>显示</h2><p>高对比界面支持系统字体放大。</p></div></div><label className="toggle-row"><span>深色模式</span><input type="checkbox" checked={form.darkMode} onChange={async (e) => { const next = { ...form, darkMode: e.target.checked }; setForm(next); await savePreferences(next) }} /></label></section>
    </div>
  </>
}
