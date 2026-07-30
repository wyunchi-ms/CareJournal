import { AlertTriangle, Check, CheckCircle2, ChevronRight, Eye, EyeOff, KeyRound, Moon, ScanText, ShieldCheck, Sun } from 'lucide-react'
import { useState } from 'react'
import { ChoicePicker } from '../components/ChoicePicker'
import { LanSyncPanel } from '../components/LanSyncPanel'
import { SettingsCollapsibleCard } from '../components/SettingsCollapsibleCard'
import { createProviderSettings, getLlmProvider, LLM_PROVIDERS } from '../services/llmProviders'
import { testLlmConnection } from '../services/ocr'
import { useApp } from '../store/AppContext'
import type { LlmProviderId, LlmProviderSettings } from '../types'

export function SettingsPage({ lanSyncManagedGlobally = false }: { lanSyncManagedGlobally?: boolean }) {
  const { preferences, savePreferences } = useApp()
  const [form, setForm] = useState(preferences)
  const [llmExpanded, setLlmExpanded] = useState(() => window.location.hash.endsWith('#llm-settings'))
  const [privacyExpanded, setPrivacyExpanded] = useState(false)
  const [displayExpanded, setDisplayExpanded] = useState(false)
  const [showKey, setShowKey] = useState(false)
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'testing' | 'success' | 'failed'>('idle')
  const [connectionMessage, setConnectionMessage] = useState('')
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

  return <>
    <div className="settings-layout">
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
  </>
}
