import { ArrowLeft, CloudUpload, Database, HeartHandshake, LockKeyhole, Network, ShieldCheck, Trash2 } from 'lucide-react'

export function PrivacyPage() {
  return (
    <article className="privacy-page">
      <header className="privacy-page-header">
        <a className="button ghost privacy-back-link" href="#/settings">
          <ArrowLeft aria-hidden="true" />
          返回设置
        </a>
        <div>
          <span>更新日期：2026年8月4日</span>
          <h1>隐私说明</h1>
          <p>CareJournal 是个人维护的公益开源工具，不提供账号、广告或开发者运营的云端服务。</p>
        </div>
      </header>

      <section className="privacy-hero card">
        <span className="privacy-hero-icon"><ShieldCheck aria-hidden="true" /></span>
        <div>
          <h2>你的数据由你掌控</h2>
          <p>病程、检查、报销素材和配置默认保存在当前设备。项目维护者无法查看、恢复或远程删除这些数据。</p>
        </div>
      </section>

      <div className="privacy-section-grid">
        <section className="privacy-section card">
          <div className="privacy-section-heading"><Database aria-hidden="true" /><h2>本地保存</h2></div>
          <p>事件、检查结果、图片、PDF、报销材料和已保存图表均保存在本机。项目没有账号系统，也未集成广告、行为统计或崩溃上报服务。</p>
        </section>

        <section className="privacy-section card">
          <div className="privacy-section-heading"><CloudUpload aria-hidden="true" /><h2>LLM 与 OCR</h2></div>
          <p>只有你主动导入并执行识别时，应用才会连接你自行选择的 LLM 服务商。未开启本地脱敏时，图片识别会发送原图；PDF 会先在本机提取文字，再发送提取结果。</p>
          <p>开启 PaddleOCR 本地脱敏后，图片或 PDF 会先在本机提取文字，并尝试删除姓名、病案号、住院号、身份证号和电话等信息，仅将处理后的文字发送给 LLM。自动识别与脱敏可能存在遗漏。</p>
          <p>API Key 只保存在当前设备且不进入局域网同步。数据的处理区域、保留期限和安全措施由你选择的 LLM 服务商及其配置决定。</p>
          <p>你可以主动导出未加密的 ZIP 完整备份，其中包含结构化记录和原始图片/PDF，但不包含 LLM API Key。备份可能含有敏感医疗资料，请只保存在可信位置。</p>
        </section>

        <section className="privacy-section card">
          <div className="privacy-section-heading"><Network aria-hidden="true" /><h2>局域网同步</h2></div>
          <p>局域网同步只在你主动开启、选择设备并确认后发生，不经过项目维护者的服务器。当前同步数据没有额外的应用层加密，请只在可信 Wi-Fi 下使用；iOS 使用 Bonjour 在应用保持前台时发现并同步设备。LLM 配置和 OCR 队列不会同步。</p>
        </section>

        <section className="privacy-section card">
          <div className="privacy-section-heading"><LockKeyhole aria-hidden="true" /><h2>设备权限</h2></div>
          <p>相机仅在你选择拍照时使用；文件访问仅用于你选择的导入和预览操作；本地网络仅用于你主动开启的局域网同步。应用不会在无关场景中使用这些权限。</p>
        </section>

        <section className="privacy-section card">
          <div className="privacy-section-heading"><Trash2 aria-hidden="true" /><h2>删除与保留</h2></div>
          <p>你可以在应用中删除记录和素材。需要彻底清除时，可通过系统设置清除应用数据或卸载应用；Web 版可清除该站点的浏览器数据。</p>
        </section>

        <section className="privacy-section card">
          <div className="privacy-section-heading"><HeartHandshake aria-hidden="true" /><h2>医疗免责声明</h2></div>
          <p>本应用仅用于个人资料记录、整理和可视化，不提供诊断、治疗建议、风险预测或紧急医疗服务。识别结果可能不完整或不准确，重要信息请以医疗机构原始材料和专业医务人员意见为准。</p>
        </section>
      </div>

      <section className="privacy-contact card">
        <h2>开源项目与联系</h2>
        <p>如对隐私说明或实现有疑问，请通过 CareJournal 代码仓库的 Issue 联系项目维护者。Issue 是公开区域，请勿上传病历、检查图片、密钥或其他个人信息。</p>
        <p>本说明随功能变化更新；涉及数据流的重要变化会在版本说明和本页面中同步标明。</p>
      </section>
    </article>
  )
}
