import {
  ChevronDown,
  ChevronRight,
  CircleHelp,
  LockKeyhole,
  MoreHorizontal,
  Plus,
  Sparkles,
} from 'lucide-react'
import { useState, type KeyboardEvent, type ReactNode } from 'react'
import type { PlusSettingsTabId } from './PlusSettingsDialog'
import {
  DEFAULT_ACCOUNT_SETTINGS,
  SHORTCUT_DEFAULTS,
  type AccountSettings,
  type AccountSettingsPatch,
  type SettingCapability,
} from './lib/accountSettings'
import './CurrentSettingsPanels.css'

export interface CurrentSettingsPanelProps {
  tab: PlusSettingsTabId
  onAction?: (message: string) => void
  accountName?: string
  accountEmail?: string
  planLabel?: string
  settings?: AccountSettings
  capabilities?: Record<string, SettingCapability>
  onSettingsChange?: (changes: AccountSettingsPatch) => void
}

interface ToggleProps {
  checked: boolean
  label: string
  disabled?: boolean
  onChange: (checked: boolean) => void
}

function Toggle({ checked, disabled = false, label, onChange }: ToggleProps) {
  return (
    <button
      aria-checked={checked}
      aria-label={label}
      className="csp-toggle"
      data-state={checked ? 'checked' : 'unchecked'}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      role="switch"
      type="button"
    >
      <span />
    </button>
  )
}

function PillButton({
  children,
  className = '',
  danger = false,
  disabled = false,
  onClick,
}: {
  children: ReactNode
  className?: string
  danger?: boolean
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      className={`csp-pill${danger ? ' is-danger' : ''}${className ? ` ${className}` : ''}`}
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  )
}

function Row({
  action,
  className = '',
  description,
  title,
}: {
  action?: ReactNode
  className?: string
  description?: ReactNode
  title: ReactNode
}) {
  return (
    <div className={`csp-row${description ? ' has-description' : ''}${className ? ` ${className}` : ''}`}>
      <div className="csp-row-copy">
        <div className="csp-row-title">{title}</div>
        {description ? <div className="csp-row-description">{description}</div> : null}
      </div>
      {action ? <div className="csp-row-action">{action}</div> : null}
    </div>
  )
}

function Disclosure({
  description,
  disabled = false,
  onClick,
  title,
  value,
}: {
  description?: ReactNode
  disabled?: boolean
  onClick: () => void
  title: ReactNode
  value?: ReactNode
}) {
  const accessibleLabel = [
    typeof title === 'string' ? title : '',
    typeof value === 'string' ? value : '',
  ].filter(Boolean).join(' ')

  return (
    <div className={`csp-disclosure${description ? ' has-description' : ''}${disabled ? ' is-disabled' : ''}`}>
      <button aria-label={accessibleLabel || '打开设置'} className="csp-disclosure-hit" disabled={disabled} onClick={onClick} type="button" />
      <span className="csp-row-copy">
        <span aria-hidden="true" className="csp-row-title">{title}</span>
        {description ? <span className="csp-row-description">{description}</span> : null}
      </span>
      <span aria-hidden="true" className="csp-disclosure-end">
        {value ? <span>{value}</span> : null}
        <ChevronRight aria-hidden="true" size={18} strokeWidth={1.65} />
      </span>
    </div>
  )
}

function InlineLink({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return <button className="csp-inline-link" onClick={onClick} type="button">{children}</button>
}

function SectionHeading({ children, description }: { children: ReactNode; description?: ReactNode }) {
  return (
    <header className="csp-section-heading">
      <h3>{children}</h3>
      {description ? <p>{description}</p> : null}
    </header>
  )
}

const SESSION_VALUE_UNAVAILABLE = '未从当前 Session 加载'
const ANALYTICS_PLACEHOLDERS = Array.from({ length: 7 }, (_, index) => index)

function Segmented({
  onChange,
  options,
  value,
}: {
  onChange: (value: string) => void
  options: ReadonlyArray<readonly [string, string]>
  value: string
}) {
  return (
    <div className="csp-segmented" role="radiogroup">
      {options.map(([id, label]) => (
        <button
          aria-checked={value === id}
          className={value === id ? 'is-active' : ''}
          key={id}
          onClick={() => onChange(id)}
          role="radio"
          type="button"
        >
          {label}
        </button>
      ))}
    </div>
  )
}

function UsageChart() {
  return (
    <div aria-label="套餐用量未从当前 Session 加载" className="csp-chart" role="img">
      <h4>套餐用量</h4>
      <div className="csp-chart-plot">
        <i className="csp-chart-grid is-top" />
        <i className="csp-chart-grid is-middle" />
        <i className="csp-chart-grid is-bottom" />
        <div className="csp-bars">
          {ANALYTICS_PLACEHOLDERS.map((index) => (
            <span className="csp-bar-column" key={index}>
              <i className="csp-bar" style={{ height: '0%' }} />
              <small>—</small>
            </span>
          ))}
        </div>
      </div>
      <div className="csp-chart-legend"><i />{SESSION_VALUE_UNAVAILABLE}</div>
    </div>
  )
}

function BillingPanel({ act, planLabel }: { act: (message: string) => void; planLabel: string }) {
  const isFree = planLabel === '免费版' || planLabel.toLocaleLowerCase() === 'free'
  const productName = isFree ? 'ChatGPT 免费版' : `ChatGPT ${planLabel}`
  return (
    <section className="csp-panel csp-billing">
      <section className="csp-plan">
        <div>
          <h3>{productName}</h3>
          <p>{isFree ? '套餐名称来自当前 Session' : '套餐名称来自当前 Session；续订与计费状态未加载'}</p>
        </div>
        <PillButton className="csp-upgrade" onClick={() => act('已打开升级套餐')}><Sparkles size={16} />升级</PillButton>
      </section>

      {!isFree ? <section className="csp-block csp-transactions">
        <SectionHeading>交易记录</SectionHeading>
        <button className="csp-invoice" onClick={() => act('已打开交易记录')} type="button">
          <span>{SESSION_VALUE_UNAVAILABLE}</span><span>—</span><em>—</em><span>—</span><ChevronRight size={17} />
        </button>
      </section> : null}

      <section className="csp-block">
        <SectionHeading>账单信息</SectionHeading>
        <PillButton className="csp-heading-action" onClick={() => act('已打开账单信息编辑')}>编辑</PillButton>
        <div className="csp-stacked-details">
          <div><b>账单电子邮箱</b><span>{SESSION_VALUE_UNAVAILABLE}</span></div>
          <div><b>账单名称</b><span>{SESSION_VALUE_UNAVAILABLE}</span></div>
          <div><b>地址</b><span>{SESSION_VALUE_UNAVAILABLE}</span></div>
        </div>
      </section>

      <section className="csp-block csp-payment-block">
        <SectionHeading>付款方式</SectionHeading>
        <PillButton className="csp-heading-action" onClick={() => act('已打开添加付款方式')}>添加新方式</PillButton>
        <div className="csp-payment-row">
          <span className="csp-payment-copy"><b>{SESSION_VALUE_UNAVAILABLE}</b><small>—</small></span>
          <button aria-label="付款方式操作" className="csp-icon-action" onClick={() => act('已打开付款方式操作')} type="button"><MoreHorizontal size={18} /></button>
        </div>
      </section>

      <section className="csp-cancel-plan">
        <div><h3>取消套餐</h3><p>如果取消，你仍可在当前计费周期结束前继续使用全部套餐功能。</p></div>
        <PillButton danger onClick={() => act('已打开取消套餐确认')}>取消</PillButton>
      </section>
    </section>
  )
}

function UsagePanel({
  act,
  autoRecharge,
  autoRechargeWritable,
  setAutoRecharge,
}: {
  act: (message: string) => void
  autoRecharge: boolean
  autoRechargeWritable: boolean
  setAutoRecharge: (checked: boolean) => void
}) {
  return (
    <section className="csp-panel csp-usage">
      <SectionHeading description={<>由 Codex、Work、工作空间智能体和 ChatGPT for Excel 共用。聊天对话不计入其中。要增加用量，请<InlineLink onClick={() => act('已打开升级套餐')}>升级套餐</InlineLink>。</>}>套餐限额</SectionHeading>
      <div className="csp-usage-alert"><strong>{SESSION_VALUE_UNAVAILABLE}</strong><span>此设置面板尚未加载实时限额、重置时间或额度余额。</span></div>
      <div className="csp-usage-limit-card">
        <div className="csp-limit"><b>5 小时限额</b><div><span>重置时间 —</span><span>剩余 —</span></div><i><u style={{ width: '0%' }} /></i></div>
        <div className="csp-limit"><b>每周限额</b><div><span>重置时间 —</span><span>剩余 —</span></div><i><u style={{ width: '0%' }} /></i></div>
      </div>

      <section className="csp-usage-section">
        <SectionHeading description="使用重置功能可恢复 5 小时限额、每周限额或两者。">使用限额重置</SectionHeading>
        <div className="csp-usage-card-row"><span><b>完全重置（每周 + 5 小时）</b><small>到期时间 —</small></span><PillButton onClick={() => act('已使用重置次数')}>使用重置次数</PillButton></div>
      </section>

      <section className="csp-usage-section">
        <SectionHeading description={<>购买额度或开启自动充值，即可在达到使用限额后继续使用 Work。<InlineLink onClick={() => act('已打开额度说明')}>了解更多</InlineLink></>}>额度</SectionHeading>
        <div className="csp-credit-card">
          <Row action={<PillButton onClick={() => act('已打开添加额度')}>添加更多</PillButton>} title="剩余额度 —" />
          <Row action={autoRechargeWritable ? <Toggle checked={autoRecharge} label="开启或关闭自动充值" onChange={setAutoRecharge} /> : <span className="csp-value">—</span>} title={<span className="csp-inline-title">自动充值 <em>需要独立付款流程</em></span>} />
          <Row action={<PillButton onClick={() => act('已打开赠送额度')}>赠送额度</PillButton>} title="为他人购买额度" />
        </div>
      </section>
    </section>
  )
}

function AnalyticsPanel({ act, settings, change }: { act: (message: string) => void; settings: AccountSettings['analytics']; change: (changes: AccountSettingsPatch) => void }) {
  return (
    <section className="csp-panel csp-analytics">
      <section className="csp-analytics-section">
        <SectionHeading description="查看工作、Codex 和其他智能体任务中的套餐用量和额度消耗情况。聊天中的对话不包括在内。">使用历史</SectionHeading>
        <div className="csp-filter-row">
          <Segmented onChange={(value) => { change({ analytics: { historyRange: value as '7' | '30' } }); act(`已切换为 ${value} 天`) }} options={[["7", "7 天"], ["30", "30 天"]]} value={settings.historyRange} />
          <Segmented onChange={(value) => { change({ analytics: { historyMode: value as 'product' | 'model' } }); act(value === 'product' ? '已按产品显示' : '已按模型显示') }} options={[["product", "按产品"], ["model", "By model"]]} value={settings.historyMode} />
        </div>
        <div className="csp-analytics-resize"><UsageChart /></div>
      </section>
      <section className="csp-analytics-section">
        <SectionHeading description="查看各产品和模型的对话轮次。">产品活动</SectionHeading>
        <Segmented onChange={(value) => { change({ analytics: { productRange: value as '7' | '30' } }); act(`产品活动：${value} 天`) }} options={[["7", "7 天"], ["30", "30 天"]]} value={settings.productRange} />
        <div className="csp-chart-placeholder"><span>{SESSION_VALUE_UNAVAILABLE}</span></div>
      </section>
      <section className="csp-analytics-section">
        <SectionHeading description="查看你在所选时间段内使用过哪些插件和技能。">工具活动</SectionHeading>
        <Segmented onChange={(value) => { change({ analytics: { toolsRange: value as '7' | '30' } }); act(`工具活动：${value} 天`) }} options={[["7", "7 天"], ["30", "30 天"]]} value={settings.toolsRange} />
        <div className="csp-chart-placeholder"><span>{SESSION_VALUE_UNAVAILABLE}</span></div>
      </section>
    </section>
  )
}

function DataPanel({ act, settings, change, writable }: { act: (message: string) => void; settings: AccountSettings['data']; change: (changes: AccountSettingsPatch) => void; writable: (path: string) => boolean }) {
  return (
    <section className="csp-panel csp-data">
      <Disclosure disabled={!writable('data.improveModel')} onClick={() => { change({ data: { improveModel: !settings.improveModel } }); act(`为所有用户改进模型：${settings.improveModel ? '关' : '开'}`) }} title="为所有用户改进模型" value={writable('data.improveModel') ? (settings.improveModel ? '开' : '关') : '—'} />
      <Disclosure description={<>允许 ChatGPT 在提供信息时使用你设备的精确位置信息。<InlineLink onClick={() => act('已打开位置信息说明')}>了解更多</InlineLink></>} disabled={!writable('data.preciseLocation')} onClick={() => { change({ data: { preciseLocation: !settings.preciseLocation } }); act(settings.preciseLocation ? '已关闭位置' : '已启用位置') }} title="位置" value={writable('data.preciseLocation') ? (settings.preciseLocation ? '已启用' : '启用') : '—'} />
      <Disclosure onClick={() => act('已打开与应用共享的信息')} title="与应用共享的信息" />
      <Disclosure disabled={!writable('data.workNetworkAccess')} onClick={() => { change({ data: { workNetworkAccess: !settings.workNetworkAccess } }); act(`工作网络访问：${settings.workNetworkAccess ? '关' : '开'}`) }} title="工作网络访问" value={writable('data.workNetworkAccess') ? (settings.workNetworkAccess ? '开' : '关') : '—'} />
      <Row action={<PillButton danger onClick={() => act('已打开重置 ChatGPT Work 确认')}>重置</PillButton>} title="重置 ChatGPT Work" />
      <Row action={<PillButton onClick={() => act('已打开共享链接管理')}>管理</PillButton>} title="共享链接" />
      <Row action={<PillButton onClick={() => act('已打开已归档聊天')}>管理</PillButton>} title="已归档的聊天" />
      <Row action={<PillButton onClick={() => act('已打开归档所有聊天确认')}>全部归档</PillButton>} title="归档所有聊天" />
      <Row action={<PillButton danger onClick={() => act('已打开删除所有聊天确认')}>全部删除</PillButton>} title="删除所有聊天" />
      <Row action={<PillButton onClick={() => act('已开始导出数据')}>导出</PillButton>} title="导出数据" />
    </section>
  )
}

function CloudBrowserPanel({ act, settings, change, writable }: { act: (message: string) => void; settings: AccountSettings['cloudBrowser']; change: (changes: AccountSettingsPatch) => void; writable: boolean }) {
  const [open, setOpen] = useState(false)
  const labels = { ask: '始终询问', allow: '始终允许', auto: '自动审核' }
  return (
    <section className="csp-panel csp-cloud">
      <Row
        action={(
          <div className="csp-select-wrap">
            <button aria-expanded={open && writable} className="csp-select-button" disabled={!writable} onClick={() => setOpen(!open)} type="button">{writable ? labels[settings.defaultPermission] : '—'}<ChevronDown size={17} /></button>
            {open && writable ? <div className="csp-select-menu">{(['ask', 'allow', 'auto'] as const).map((value) => <button className={settings.defaultPermission === value ? 'is-active' : ''} key={value} onClick={() => { change({ cloudBrowser: { defaultPermission: value } }); setOpen(false); act(`默认权限：${labels[value]}`) }} type="button">{labels[value]}</button>)}</div> : null}
          </div>
        )}
        className="csp-cloud-permission"
        description="选择 ChatGPT 在打开网站前是否先征求你的同意。"
        title="默认权限"
      />
      <Row action={<PillButton onClick={() => act('已打开添加站点')}>添加站点</PillButton>} description="添加站点以覆盖默认权限。" title="站点权限" />
      <div className="csp-section-spacer" />
      <h3 className="csp-subheading">浏览器数据</h3>
      <Disclosure description="管理云浏览器保存的 Cookie。" onClick={() => act('已打开 Cookie 管理')} title="Cookie" />
    </section>
  )
}

function StoragePanel({ act }: { act: (message: string) => void }) {
  return (
    <section className="csp-panel csp-storage">
      <div className="csp-storage-summary">
        <strong>{SESSION_VALUE_UNAVAILABLE}</strong>
        <div aria-label="存储空间未从当前 Session 加载" className="csp-storage-progress" role="status"><span style={{ width: 0 }} /></div>
      </div>
      <section className="csp-storage-management">
        <SectionHeading description="管理你的资料库，释放存储空间">管理存储空间</SectionHeading>
        <button onClick={() => act('已打开文件存储管理')} type="button"><span><b>文件</b><small>{SESSION_VALUE_UNAVAILABLE}</small></span><ChevronRight size={19} /></button>
        <button onClick={() => act('已打开图片存储管理')} type="button"><span><b>图片</b><small>{SESSION_VALUE_UNAVAILABLE}</small></span><ChevronRight size={19} /></button>
      </section>
    </section>
  )
}

function SafetyPanel({ act, settings, change, writable }: { act: (message: string) => void; settings: AccountSettings['safety']; change: (changes: AccountSettingsPatch) => void; writable: boolean }) {
  return (
    <section className="csp-panel csp-safety">
      <Row
        action={writable ? <Toggle checked={settings.reducedSensitiveContent} label="减少敏感内容" onChange={(checked) => { change({ safety: { reducedSensitiveContent: checked } }); act(`减少敏感内容：${checked ? '开' : '关'}`) }} /> : <span className="csp-value">—</span>}
        description={<>针对敏感话题添加额外防护，并限制 ChatGPT 中某些类型的内容。<InlineLink onClick={() => act('已打开安全防护说明')}>了解更多</InlineLink></>}
        title="减少敏感内容"
      />
    </section>
  )
}

function SecurityPanel({ act, settings, change, writable }: { act: (message: string) => void; settings: AccountSettings['security']; change: (changes: AccountSettingsPatch) => void; writable: (path: string) => boolean }) {
  return (
    <section className="csp-panel csp-security">
      <Disclosure onClick={() => act('已打开密码设置')} title="密码" value="—" />
      <Disclosure description="使用硬件安全密钥或通行密钥登录。这些防网络钓鱼的方式比密码更为安全。" onClick={() => act('已打开安全密钥设置')} title="安全密钥和通行密钥" value="添加" />

      <h3 className="csp-subheading">多因素身份验证 (MFA)</h3>
      <div className="csp-mfa-callout"><LockKeyhole size={20} />添加另一种方法以防止锁定</div>
      <Row action={writable('security.authenticatorApp') ? <Toggle checked={settings.authenticatorApp} label="Authenticator app" onChange={(checked) => { change({ security: { authenticatorApp: checked } }); act(`Authenticator app：${checked ? '开' : '关'}`) }} /> : <span className="csp-value">—</span>} description="使用来自身份验证器应用的一次性验证码。" title="Authenticator app" />
      <Row action={writable('security.textMessage') ? <Toggle checked={settings.textMessage} label="Text message" onChange={(checked) => { change({ security: { textMessage: checked } }); act(`Text message：${checked ? '开' : '关'}`) }} /> : <span className="csp-value">—</span>} description="根据你的国家/地区代码，通过短信或 WhatsApp 获取 6 位验证码。" title="Text message" />

      <h3 className="csp-subheading">会话</h3>
      <Disclosure description="查看所有访问过你账户的设备。你可以查看活跃会话、移除受信任设备，或使用“全部退出登录”来结束所有会话。" onClick={() => act('已打开活跃会话')} title="活跃会话" value="—" />

      <h3 className="csp-subheading">高级安全设置</h3>
      <Disclosure description="通过要求使用安全性更强的登录方式并应用更严格的保护措施，来提供最高级别的账户安全，帮助防止未经授权的访问。" onClick={() => act('已打开高级账户安全注册')} title="高级账户安全" value="注册" />
      <Row action={<Toggle checked={settings.lockdownMode} disabled={!writable('security.lockdownMode')} label="锁定模式" onChange={(checked) => { change({ security: { lockdownMode: checked } }); act(`锁定模式：${checked ? '开' : '关'}`) }} />} description={<>通过限制可连接到网络或外部服务的功能，帮助保护敏感数据免受提示注入攻击。<InlineLink onClick={() => act('已打开锁定模式说明')}>了解更多</InlineLink></>} title="锁定模式" />

      <h3 className="csp-subheading csp-developer-heading">开发者模式</h3>
      <Row action={<Toggle checked={settings.developerMode} disabled={!writable('security.developerMode')} label="开发人员模式" onChange={(checked) => { change({ security: { developerMode: checked, ...(!checked ? { enforceCsp: false } : {}) } }); act(`开发人员模式：${checked ? '开' : '关'}`) }} />} description={<>允许你添加未经验证的连接器，这些连接器可能会永久性地修改或删除数据。需自行承担使用风险。<InlineLink onClick={() => act('已打开开发人员模式说明')}>了解更多</InlineLink></>} title={<span className="csp-risk-title">开发人员模式 <em>高风险</em></span>} />
      <Row action={<Toggle checked={settings.enforceCsp} disabled={!settings.developerMode || !writable('security.enforceCsp')} label="在开发者模式下强制执行 CSP" onChange={(checked) => { change({ security: { enforceCsp: checked } }); act(`强制执行 CSP：${checked ? '开' : '关'}`) }} />} description={<>启用后，未声明CSP的开发者模式应用或小组件将使用与生产环境相同的受限默认CSP，而非不受限制的网络访问。<InlineLink onClick={() => act('已打开 CSP 说明')}>了解更多</InlineLink></>} title="在开发者模式下强制执行 CSP" />

      <section className="csp-secure-signin">
        <SectionHeading description={<>通过 ChatGPT 值得信赖的安全防护登录互联网上的网站及应用。<InlineLink onClick={() => act('已打开安全登录说明')}>了解更多</InlineLink></>}>通过 ChatGPT 安全登录</SectionHeading>
        <p>安全登录记录未从当前 Session 加载。</p>
      </section>
      <Row action={<Toggle checked={settings.deviceCodeAuth} disabled={!writable('security.deviceCodeAuth')} label="为 Codex 启用设备代码授权" onChange={(checked) => { change({ security: { deviceCodeAuth: checked } }); act(`设备代码授权：${checked ? '开' : '关'}`) }} />} description="在无法使用常规浏览器流程的无头或远程环境中使用设备代码登录。启用此功能时请谨慎操作，因设备代码可能被网络钓鱼攻击窃取。切勿分享设备代码。" title="为 Codex 启用设备代码授权" />
    </section>
  )
}

function ParentalPanel({ act }: { act: (message: string) => void }) {
  return (
    <section className="csp-panel csp-simple-info">
      <button aria-label="详细了解家长控制" className="csp-panel-help" onClick={() => act('已打开家长控制说明')} type="button"><CircleHelp size={16} /></button>
      <p>家长和青少年可以关联账户，让家长能够调整某些功能、设置限制，并添加适合其家庭的安全保护措施。<InlineLink onClick={() => act('已打开家长控制说明')}>了解更多</InlineLink></p>
      <PillButton className="csp-add-button" onClick={() => act('已打开添加家庭成员')}><Plus size={19} />添加家庭成员</PillButton>
    </section>
  )
}

function TrustedContactsPanel({ act }: { act: (message: string) => void }) {
  return (
    <section className="csp-panel csp-trusted">
      <p>安排一位受信任联系人，将能够更容易地从了解你的人那里获得支持。</p>
      <p>今后，如果你与 ChatGPT 讨论自杀，且相关表述表明可能存在严重的安全风险，我们可能会自动通知你的受信任联系人，以便对方主动联系你并确认你的情况。你和对方都必须年满 19 周岁才能参与。<InlineLink onClick={() => act('已打开受信任联系人说明')}>了解更多</InlineLink></p>
      <PillButton className="csp-add-button" onClick={() => act('已打开添加受信任联系人')}><Plus size={19} />添加联系人</PillButton>
    </section>
  )
}

function AccountPanel({ act, accountEmail, accountName, settings, change, showBuilderNameWritable }: { act: (message: string) => void; accountEmail: string; accountName: string; settings: AccountSettings['account']; change: (changes: AccountSettingsPatch) => void; showBuilderNameWritable: boolean }) {
  return (
    <section className="csp-panel csp-account">
      <Row action={<span className="csp-value">{accountName}</span>} title="姓名" />
      <Disclosure onClick={() => act('已打开用户名设置')} title="用户名" value="—" />
      <Disclosure onClick={() => act('已打开电子邮件设置')} title="电子邮件" value={accountEmail || '—'} />
      <Row action={<PillButton danger onClick={() => act('已打开删除账户确认')}>删除</PillButton>} title="删除账户" />

      <section className="csp-builder">
        <SectionHeading>GPT 构建者个人资料</SectionHeading>
        <p>个性化你的构建者个人资料，以便与你的 GPT 的用户建立联系。这些设置将应用于公开共享的 GPT。</p>
        <div className="csp-builder-preview">
          <span className="csp-preview-label">预览</span>
          <span aria-hidden="true" className="csp-cube">◇</span>
          <strong>—</strong>
          <small>构建者预览未从当前 Session 加载</small>
        </div>
        <Row action={showBuilderNameWritable ? <Toggle checked={settings.showBuilderName} label="在构建者个人资料中显示名字" onChange={(checked) => { change({ account: { showBuilderName: checked } }); act(`显示名字：${checked ? '开' : '关'}`) }} /> : <span className="csp-value">—</span>} description={accountName || '—'} title="名字" />
      </section>
    </section>
  )
}

interface ShortcutDefinition {
  id: string
  label: string
  keys: string[]
}

const INPUT_SHORTCUTS: ShortcutDefinition[] = [
  { id: 'send', label: '发送消息或停止生成', keys: ['⏎'] },
  { id: 'background', label: '在后台发送消息', keys: ['Ctrl', '⏎'] },
  { id: 'model', label: '选择模型', keys: ['Ctrl', 'Shift', 'M'] },
  { id: 'dictation', label: '切换听写', keys: ['Ctrl', 'Shift', 'D'] },
  { id: 'upload', label: '添加照片和文件', keys: ['Ctrl', 'U'] },
]

const APP_SHORTCUTS: ShortcutDefinition[] = [
  { id: 'new-chat', label: '打开新聊天', keys: ['Ctrl', 'Shift', 'O'] },
  { id: 'show-shortcuts', label: '显示快捷键', keys: ['Ctrl', '/'] },
  { id: 'search', label: '搜索', keys: ['Ctrl', 'K'] },
  { id: 'developer', label: '切换开发模式', keys: ['Ctrl', '.'] },
  { id: 'sidebar', label: '切换侧边栏', keys: ['Ctrl', 'Shift', 'S'] },
  { id: 'instructions', label: '设置自定义指令', keys: ['Ctrl', 'Shift', 'I'] },
  { id: 'copy-code', label: '复制最后一个代码块', keys: ['Ctrl', 'Shift', ';'] },
  { id: 'delete-chat', label: '删除聊天', keys: ['Ctrl', 'Shift', '⌫'] },
]

function KeyboardPanel({ act, settings, change }: { act: (message: string) => void; settings: AccountSettings['shortcuts']; change: (changes: AccountSettingsPatch) => void }) {
  const defaults = SHORTCUT_DEFAULTS
  const [editing, setEditing] = useState<string | null>(null)
  const dirty = Object.keys(defaults).some((id) => !settings.enabled[id as keyof typeof SHORTCUT_DEFAULTS] || settings.keys[id as keyof typeof SHORTCUT_DEFAULTS].join('+') !== defaults[id as keyof typeof SHORTCUT_DEFAULTS].join('+'))

  const captureKeys = (event: KeyboardEvent<HTMLInputElement>, id: string) => {
    event.preventDefault()
    if (event.key === 'Escape') { setEditing(null); return }
    if (['Control', 'Shift', 'Alt', 'Meta'].includes(event.key)) return
    const next: string[] = []
    if (event.ctrlKey) next.push('Ctrl')
    if (event.altKey) next.push('Alt')
    if (event.shiftKey) next.push('Shift')
    if (event.metaKey) next.push('⌘')
    const key = event.key === 'Enter' ? '⏎' : event.key === 'Backspace' ? '⌫' : event.key.length === 1 ? event.key.toUpperCase() : event.key
    next.push(key)
    change({ shortcuts: { keys: { [id]: next } } })
    setEditing(null)
    act('快捷键已更新')
  }

  const renderShortcut = (shortcut: ShortcutDefinition) => (
    <li key={shortcut.id}>
      <Toggle checked={settings.enabled[shortcut.id as keyof typeof SHORTCUT_DEFAULTS]} label={`切换“${shortcut.label}”的键盘快捷键状态`} onChange={(checked) => { change({ shortcuts: { enabled: { [shortcut.id]: checked } } }); act(`${shortcut.label}：${checked ? '开' : '关'}`) }} />
      <span className="csp-shortcut-label">{shortcut.label}</span>
      {editing === shortcut.id ? (
        <input aria-label="按下新的按键组合" autoFocus className="csp-key-capture" onBlur={() => setEditing(null)} onKeyDown={(event) => captureKeys(event, shortcut.id)} placeholder="按下组合键" />
      ) : (
        <button aria-label={`更改${shortcut.label}按键组合`} className="csp-key-combo" onClick={() => setEditing(shortcut.id)} type="button">
          {settings.keys[shortcut.id as keyof typeof SHORTCUT_DEFAULTS].map((key, index) => <span key={`${key}-${index}`}>{key}</span>)}
        </button>
      )}
    </li>
  )

  return (
    <section className="csp-panel csp-shortcuts">
      <p className="csp-shortcuts-help">要更改快捷键，请先选中按键组合，然后输入新的按键。</p>
      <section><h3>输入框</h3><ul>{INPUT_SHORTCUTS.map(renderShortcut)}</ul></section>
      <section><h3>应用</h3><ul>{APP_SHORTCUTS.map(renderShortcut)}</ul></section>
      <footer className="csp-shortcut-footer">
        <PillButton disabled={!dirty} onClick={() => { change({ shortcuts: { enabled: Object.fromEntries(Object.keys(defaults).map((key) => [key, true])), keys: Object.fromEntries(Object.entries(defaults).map(([key, value]) => [key, [...value]])) } }); setEditing(null); act('快捷键已恢复默认') }}>恢复默认</PillButton>
      </footer>
    </section>
  )
}

export function CurrentSettingsPanel({ tab, onAction, onSettingsChange, settings = DEFAULT_ACCOUNT_SETTINGS, capabilities = {}, accountName = '—', accountEmail = '', planLabel = '—' }: CurrentSettingsPanelProps) {
  const act = (message: string) => {
    // A number of rows mirror upstream management pages (billing, MFA,
    // destructive account/data operations, etc.).  Until their dedicated
    // redirect/reauth/confirmation flows are implemented, never present a
    // click as a successful action: no request was sent for these rows.
    if (/^已(?:打开|开始|使用)/u.test(message)) {
      const label = message.replace(/^已(?:打开|开始|使用)/u, '').trim() || '此操作'
      onAction?.(`${label}需要独立页面、二次验证或确认流程；当前复刻站未执行任何更改。`)
      return
    }
    onAction?.(message)
  }
  const change = (changes: AccountSettingsPatch) => onSettingsChange?.(changes)
  const writable = (path: string) => capabilities[path]?.writable === true

  switch (tab) {
    case 'billing': return <BillingPanel act={act} planLabel={planLabel} />
    case 'usage': return <UsagePanel act={act} autoRecharge={settings.usage.autoRecharge} autoRechargeWritable={writable('usage.autoRecharge')} setAutoRecharge={(checked) => { change({ usage: { autoRecharge: checked } }); act(`自动充值：${checked ? '开' : '关'}`) }} />
    case 'analytics': return <AnalyticsPanel act={act} change={change} settings={settings.analytics} />
    case 'data': return <DataPanel act={act} change={change} settings={settings.data} writable={writable} />
    case 'cloud-browser': return <CloudBrowserPanel act={act} change={change} settings={settings.cloudBrowser} writable={writable('cloudBrowser.defaultPermission')} />
    case 'storage': return <StoragePanel act={act} />
    case 'safety': return <SafetyPanel act={act} change={change} settings={settings.safety} writable={writable('safety.reducedSensitiveContent')} />
    case 'security': return <SecurityPanel act={act} change={change} settings={settings.security} writable={writable} />
    case 'parental': return <ParentalPanel act={act} />
    case 'trusted-contacts': return <TrustedContactsPanel act={act} />
    case 'account': return <AccountPanel act={act} accountEmail={accountEmail} accountName={accountName} change={change} settings={settings.account} showBuilderNameWritable={writable('account.showBuilderName')} />
    case 'shortcuts': return <KeyboardPanel act={act} change={change} settings={settings.shortcuts} />
    default: return null
  }
}
