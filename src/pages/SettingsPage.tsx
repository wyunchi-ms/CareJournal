import { AlertTriangle, Archive, Check, CheckCircle2, ChevronRight, Download, Eye, EyeOff, KeyRound, Moon, ScanText, ShieldCheck, Sun, Upload } from 'lucide-react'
import { useRef, useState } from 'react'
import { ChoicePicker } from '../components/ChoicePicker'
import { ConfirmSheet } from '../components/ConfirmSheet'
import { LanSyncPanel } from '../components/LanSyncPanel'
import { SettingsCollapsibleCard } from '../components/SettingsCollapsibleCard'
import { BackupPasswordRequiredError, downloadBlob, exportAndroidBackupZip, exportBackup, importBackup } from '../services/backup'
import { createProviderSettings, getLlmProvider, LLM_PROVIDERS } from '../services/llmProviders'
import { testLlmConnection } from '../services/ocr'
import { useApp } from '../store/AppContext'
import type { BackupPayload, LlmProviderId, LlmProviderSettings } from '../types'
import { isTauriPlatform, tauriInvoke } from '../platform/tauriBridge'
import { Capacitor } from '@capacitor/core'

export function SettingsPage({ lanSyncManagedGlobally = false }: { lanSyncManagedGlobally?: boolean }) {
  const { preferences, savePreferences, events, chemotherapyTemplates, records, pins, reimbursementPlans, restoreBackup } = useApp()
  const [form, setForm] = useState(preferences)
  const [llmExpanded, setLlmExpanded] = useState(() => window.location.hash.endsWith('#llm-settings'))
  const [privacyExpanded, setPrivacyExpanded] = useState(false)
  const [displayExpanded, setDisplayExpanded] = useState(false)
  const [backupExpanded, setBackupExpanded] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const [backupError, setBackupError] = useState('')
  const [backupSuccess, setBackupSuccess] = useState('')
  const [showPasswordPrompt, setShowPasswordPrompt] = useState(false)
  const [importPassword, setImportPassword] = useState('')
  const [pendingImportFile, setPendingImportFile] = useState<File | null>(null)
  const [confirmImportData, setConfirmImportData] = useState<BackupPayload | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [showKey, setShowKey] = useState(false)
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'testing' | 'success' | 'failed'>('idle')
  const [connectionMessage, setConnectionMessage] = useState('')
  const isParsingBackup = isImporting && !confirmImportData
  const activeProvider = getLlmProvider(form.llm.activeProvider)
  const activeProviderSettings = createProviderSettings(activeProvider.id, form.llm.providers[activeProvider.id])
  const providerConfigured = Boolean(activeProviderSettings.endpoint.trim() && activeProviderSettings.apiKey.trim() && activeProviderSettings.model.trim())
  const updateProvider = (key: keyof LlmProviderSettings, value: string | number) => setForm((current) => ({
    ...current,
    llm: {
      ...current.llm,
      providers: {
        ...current.llm.providers,
        [current.llm.activeProvider]: {
          ...createProviderSettings(current.llm.activeProvider, current.llm.providers[current.llm.activeProvider]),
          [key]: value,
        },
      },
    },
  }))
  const selectProvider = (providerId: LlmProviderId) => {
    setConnectionStatus('idle')
    setConnectionMessage('')
    setShowKey(false)
    setForm((current) => ({
      ...current,
      llm: {
        activeProvider: providerId,
        providers: {
          ...current.llm.providers,
          [providerId]: createProviderSettings(providerId, current.llm.providers[providerId]),
        },
      },
    }))
  }

  async function save() { await savePreferences(form); setConnectionMessage('配置已保存在本设备'); setConnectionStatus('success') }
  async function test() { setConnectionStatus('testing'); setConnectionMessage('正在测试连接…'); try { await testLlmConnection(form.llm); setConnectionStatus('success'); setConnectionMessage(`${activeProvider.label} 连接成功`) } catch (error) { setConnectionStatus('failed'); setConnectionMessage(error instanceof Error ? error.message : '连接失败') } }

  const handleExport = async () => {
    setIsExporting(true)
    setBackupError('')
    setBackupSuccess('')
    try {
      const now = new Date()
      const pad = (n: number) => n.toString().padStart(2, '0')
      const filename = `carejournal-backup-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}.zip`
      if (Capacitor.getPlatform() === 'android') {
        const result = await exportAndroidBackupZip(filename, events, chemotherapyTemplates, records, pins, reimbursementPlans, form)
        if (result.cancelled) return
        setBackupSuccess(`备份已保存至：${result.filename ?? result.path ?? filename}`)
      } else {
        const blob = await exportBackup(events, chemotherapyTemplates, records, pins, reimbursementPlans, form)
        const path = await downloadBlob(blob, filename)
        setBackupSuccess(`备份已保存至：${path}`)
      }
    } catch (error) {
      setBackupError(error instanceof Error ? error.message : '导出备份失败')
    } finally {
      setIsExporting(false)
    }
  }

  const performImport = async (file: File, password?: string) => {
    setIsImporting(true)
    setBackupError('')
    setBackupSuccess('')
    try {
      const payload = await importBackup(file, { password })
      setConfirmImportData(payload)
      setShowPasswordPrompt(false)
    } catch (error) {
      if (error instanceof BackupPasswordRequiredError) {
        setShowPasswordPrompt(true)
        setPendingImportFile(file)
        setBackupError('')
      } else {
        setBackupError(error instanceof Error ? error.message : '读取备份失败')
        setPendingImportFile(null)
      }
    } finally {
      setIsImporting(false)
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }

  const handleFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    void performImport(file)
  }

  const handleImportClick = async () => {
    if (!isTauriPlatform()) {
      fileInputRef.current?.click()
      return
    }
    setBackupError('')
    try {
      const opened = await tauriInvoke<{ filename: string; mimeType: string; base64: string } | null>('desktop_open_file')
      if (!opened) return
      const bytes = Uint8Array.from(atob(opened.base64), (character) => character.charCodeAt(0))
      await performImport(new File([bytes], opened.filename, { type: opened.mimeType }))
    } catch (error) {
      setBackupError(error instanceof Error ? error.message : '打开备份失败')
    }
  }

  const handlePasswordSubmit = () => {
    if (pendingImportFile) {
      void performImport(pendingImportFile, importPassword)
    }
  }

  const handleConfirmImport = async () => {
    if (!confirmImportData) return
    setIsImporting(true)
    setBackupError('')
    try {
      await restoreBackup(confirmImportData)
      setBackupSuccess('已成功恢复备份数据')
      setConfirmImportData(null)
      setPendingImportFile(null)
      setImportPassword('')
    } catch (error) {
      setBackupError(error instanceof Error ? error.message : '恢复备份失败')
    } finally {
      setIsImporting(false)
    }
  }

  return <>
    <div className="settings-layout" aria-busy={isParsingBackup}>
      <SettingsCollapsibleCard
        id="llm-settings"
        className="llm-settings-card"
        icon={<KeyRound />}
        title="智能识别服务"
        summary={`${activeProvider.label} · ${providerConfigured ? activeProviderSettings.model : '尚未配置'}`}
        expanded={llmExpanded}
        onToggle={() => setLlmExpanded((value) => !value)}
      >
        <div className={`callout llm-data-notice${form.localPrivacyOcrEnabled ? '' : ' warning'}`}>
          {form.localPrivacyOcrEnabled ? <ShieldCheck /> : <AlertTriangle />}
          <span>
            <strong>{form.localPrivacyOcrEnabled ? '当前会先在本机脱敏' : '当前图片识别会发送原图'}</strong>
            <small>{form.localPrivacyOcrEnabled
              ? '图片和 PDF 会先在本机提取并尝试删除身份信息，仅将处理后的文字发送给你配置的 LLM。'
              : '只有主动识别时才会发送；PDF 会在本机提取文字后发送。需要降低暴露范围时，请开启下方本地脱敏。'}</small>
          </span>
        </div>
        <div className="llm-provider-mobile">
          <ChoicePicker
            label="模型服务商"
            options={LLM_PROVIDERS.map((provider) => ({ value: provider.id, label: provider.label, description: provider.description }))}
            value={form.llm.activeProvider}
            onChange={(value) => selectProvider(value as LlmProviderId)}
            orderByRecent={false}
          />
        </div>
        <div className="llm-provider-workspace">
          <nav className="llm-provider-list" aria-label="模型服务商">
            <span>服务商</span>
            {LLM_PROVIDERS.map((provider) => {
              const configured = form.llm.providers[provider.id]
              const complete = Boolean(configured?.endpoint.trim() && configured.apiKey.trim() && configured.model.trim())
              return <button key={provider.id} type="button" className={provider.id === form.llm.activeProvider ? 'active' : ''} aria-pressed={provider.id === form.llm.activeProvider} onClick={() => selectProvider(provider.id)}>
                <span><strong>{provider.label}</strong><small>{provider.description}</small></span>
                {complete && <Check aria-label="已配置" />}
              </button>
            })}
          </nav>
          <div className="llm-provider-detail">
            <div className="llm-provider-detail-heading">
              <div><span>当前使用</span><h3>{activeProvider.label}</h3><p>{activeProvider.description}</p></div>
            </div>
            <div className="llm-provider-form">
              <label>API Key<span className="password-input"><input type={showKey ? 'text' : 'password'} value={activeProviderSettings.apiKey} onChange={(e) => updateProvider('apiKey', e.target.value)} autoComplete="off" /><button type="button" className="icon-button" onClick={() => setShowKey((value) => !value)} aria-label={showKey ? '隐藏密钥' : '显示密钥'} title={showKey ? '隐藏密钥' : '显示密钥'}>{showKey ? <EyeOff /> : <Eye />}</button></span></label>
              <label>API 地址<input type="url" value={activeProviderSettings.endpoint} onChange={(e) => updateProvider('endpoint', e.target.value)} placeholder={activeProvider.endpointPlaceholder} /></label>
              <label>模型<input value={activeProviderSettings.model} onChange={(e) => updateProvider('model', e.target.value)} placeholder={activeProvider.modelPlaceholder} /><small>{activeProvider.id === 'azure-openai' ? '填写 Azure 中的部署名称；API 地址以 /openai/v1 结尾，不再需要 API Version。' : '一个服务商只使用这里填写的一个模型。模型需要支持图片时，请在服务商控制台选择视觉模型。'}</small></label>
            </div>
            <p className="llm-model-note">如果所选模型不支持图片，可开启下方 PaddleOCR 本地脱敏，应用会先提取文字再交给模型整理。</p>
            {connectionMessage && <p className={`connection-status ${connectionStatus}`} role="status">{connectionStatus === 'success' && <CheckCircle2 />}{connectionMessage}</p>}
            <div className="form-actions"><button className="button secondary" onClick={() => void test()} disabled={connectionStatus === 'testing'}>测试连接</button><button className="button primary" onClick={() => void save()}>保存配置</button></div>
          </div>
        </div>
        <label className="privacy-ocr-setting"><span className="settings-icon"><ScanText /></span><span><strong>PaddleOCR 本地脱敏</strong><small>先在设备上提取文字并删除患者姓名、病案号、住院号、身份证号和电话等信息；医院与科室会保留。开启后，原始图片不会发送给 LLM。</small></span><input type="checkbox" aria-label="PaddleOCR 本地脱敏" checked={form.localPrivacyOcrEnabled} onChange={(e) => setForm((current) => ({ ...current, localPrivacyOcrEnabled: e.target.checked }))} /></label>
      </SettingsCollapsibleCard>
      {!lanSyncManagedGlobally && <LanSyncPanel />}
      <SettingsCollapsibleCard
        className="backup-entry-card"
        icon={<Archive />}
        title="备份与恢复"
        summary="导出未加密的 ZIP 备份或导入旧版备份"
        expanded={backupExpanded}
        onToggle={() => setBackupExpanded((value) => !value)}
      >
        <div className="form-actions backup-actions">
          <button className="button secondary" onClick={() => void handleExport()} disabled={isExporting || isImporting}>
            <Download aria-hidden="true" /> {isExporting ? '正在导出…' : '导出备份'}
          </button>
          <button className="button secondary" onClick={() => void handleImportClick()} disabled={isExporting || isImporting}>
            <Upload aria-hidden="true" /> {isImporting ? '正在读取…' : '导入备份'}
          </button>
          <input
            type="file"
            ref={fileInputRef}
            style={{ display: 'none' }}
            accept=".zip,application/zip,.json,application/json,application/x-carejournal+json"
            onChange={handleFileSelected}
          />
        </div>
        {backupError && <p className="connection-status failed" role="alert">{backupError}</p>}
        {backupSuccess && <p className="connection-status success" role="status"><CheckCircle2 />{backupSuccess}</p>}

        {showPasswordPrompt && (
          <div className="password-prompt">
            <p>该旧版备份文件需要密码才能解密：</p>
            <label>
              备份密码
              <input
                type="password"
                value={importPassword}
                onChange={(e) => setImportPassword(e.target.value)}
                placeholder="请输入密码"
              />
            </label>
            <div className="form-actions">
              <button className="button secondary" onClick={() => { setShowPasswordPrompt(false); setPendingImportFile(null); setImportPassword(''); setBackupError('') }}>取消</button>
              <button className="button primary" onClick={() => void handlePasswordSubmit()} disabled={!importPassword}>重试导入</button>
            </div>
          </div>
        )}
      </SettingsCollapsibleCard>

      {confirmImportData && (
        <ConfirmSheet
          title="确认覆盖本地数据？"
          message="当前设备上的所有现有数据将被永久覆盖且无法恢复。"
          description={`即将导入 ${confirmImportData.events?.length ?? 0} 个事件、${confirmImportData.chemotherapyTemplates?.length ?? 0} 个方案、${confirmImportData.records?.length ?? 0} 份检查、${confirmImportData.reimbursementPlans?.length ?? 0} 个报销记录和 ${confirmImportData.assets?.length ?? 0} 个素材。`}
          confirmLabel="确认覆盖"
          busyLabel="恢复中…"
          busy={isImporting}
          error={backupError || undefined}
          onConfirm={() => void handleConfirmImport()}
          onCancel={() => { setConfirmImportData(null); setPendingImportFile(null) }}
        />
      )}
      <SettingsCollapsibleCard
        className="privacy-entry-card"
        icon={<ShieldCheck />}
        title="隐私与数据"
        summary="数据默认留在本机 · 查看使用边界与说明"
        expanded={privacyExpanded}
        onToggle={() => setPrivacyExpanded((value) => !value)}
      >
        <ul className="privacy-entry-points">
          <li>项目维护者无法查看你的病程、素材或密钥。</li>
          <li>只有主动识别或同步时，数据才按你的操作流转。</li>
          <li>本应用仅整理资料，不提供诊断或治疗建议。</li>
        </ul>
        <a className="settings-link-row" href="#/privacy"><span>查看完整隐私说明</span><ChevronRight aria-hidden="true" /></a>
      </SettingsCollapsibleCard>
      <SettingsCollapsibleCard
        icon={form.darkMode ? <Moon /> : <Sun />}
        title="显示"
        summary={`深色模式：${form.darkMode ? '已开启' : '未开启'}`}
        expanded={displayExpanded}
        onToggle={() => setDisplayExpanded((value) => !value)}
      >
        <label className="toggle-row"><span>深色模式</span><input type="checkbox" checked={form.darkMode} onChange={async (e) => { const next = { ...form, darkMode: e.target.checked }; setForm(next); await savePreferences(next) }} /></label>
      </SettingsCollapsibleCard>
    </div>
    {isParsingBackup && (
      <div className="modal-backdrop backup-import-progress" role="presentation">
        <section className="modal-card backup-import-progress-card" role="dialog" aria-modal="true" aria-labelledby="backup-import-progress-title" aria-describedby="backup-import-progress-description">
          <div className="backup-import-progress-content" role="status" aria-live="assertive">
            <span className="spinner" aria-hidden="true" />
            <div>
              <h2 id="backup-import-progress-title">正在解析备份</h2>
              <p id="backup-import-progress-description">正在校验备份索引和素材，请勿关闭应用。文件较大时可能需要一些时间。</p>
            </div>
          </div>
        </section>
      </div>
    )}
  </>
}
