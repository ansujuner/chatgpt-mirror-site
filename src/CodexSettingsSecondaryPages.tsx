import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  ExternalLink,
  Info,
  KeyRound,
  Lightbulb,
  MessageSquare,
  MoreHorizontal,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import './CodexSettingsSecondaryPages.css'

type ActionHandler = (message: string) => void

function cn(...names: Array<string | false | null | undefined>) {
  return names.filter(Boolean).join(' ')
}

function notify(handler: ActionHandler | undefined, message: string) {
  handler?.(message)
}

function GithubMark({ size = 18 }: { size?: number }) {
  return (
    <svg aria-hidden="true" fill="currentColor" height={size} viewBox="0 0 24 24" width={size}>
      <path d="M12 .7a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2.23c-3.22.7-3.9-1.37-3.9-1.37-.52-1.34-1.29-1.7-1.29-1.7-1.05-.72.08-.71.08-.71 1.17.08 1.78 1.2 1.78 1.2 1.04 1.78 2.72 1.27 3.38.97.1-.75.4-1.27.74-1.56-2.57-.29-5.27-1.28-5.27-5.69 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.16 1.18A11 11 0 0 1 12 6.11c.98 0 1.95.13 2.86.39 2.2-1.49 3.16-1.18 3.16-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.42-2.71 5.39-5.29 5.68.42.36.79 1.07.79 2.16v3.25c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .7Z" />
    </svg>
  )
}

function GitlabMark() {
  return <span aria-hidden="true" className="cssp-gitlab-mark">◆</span>
}

function LinearMark() {
  return <span aria-hidden="true" className="cssp-linear-mark"><i /><i /><i /></span>
}

function PageHeader({ subtitle, title }: { subtitle?: ReactNode; title: string }) {
  return <header className="cssp-page-header"><h1>{title}</h1>{subtitle ? <p>{subtitle}</p> : null}</header>
}

function Button({
  children,
  danger = false,
  disabled = false,
  onClick,
  primary = false,
}: {
  children: ReactNode
  danger?: boolean
  disabled?: boolean
  onClick?: () => void
  primary?: boolean
}) {
  return <button className={cn('cssp-button', primary && 'is-primary', danger && 'is-danger')} disabled={disabled} onClick={onClick} type="button">{children}</button>
}

function IconButton({ children, label, onClick }: { children: ReactNode; label: string; onClick: () => void }) {
  return <button aria-label={label} className="cssp-icon-button" onClick={onClick} type="button">{children}</button>
}

function Switch({ checked, disabled = false, label, onChange }: { checked: boolean; disabled?: boolean; label: string; onChange: (checked: boolean) => void }) {
  return <button aria-checked={checked} aria-label={label} className="cssp-switch" data-state={checked ? 'checked' : 'unchecked'} disabled={disabled} onClick={() => onChange(!checked)} role="switch" type="button"><span /></button>
}

function Notice({ children, title, tone = 'info' }: { children: ReactNode; title?: string; tone?: 'info' | 'warning' | 'success' }) {
  const Icon = tone === 'success' ? Check : tone === 'warning' ? AlertCircle : Info
  return <div className={cn('cssp-notice', `is-${tone}`)}><Icon size={17} /><div>{title ? <strong>{title}</strong> : null}<div>{children}</div></div></div>
}

function Modal({ children, description, footer, onClose, title }: { children: ReactNode; description?: ReactNode; footer?: ReactNode; onClose: () => void; title: string }) {
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', escape)
    return () => window.removeEventListener('keydown', escape)
  }, [onClose])
  return (
    <div aria-modal="true" className="cssp-modal-layer" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }} role="dialog">
      <section className="cssp-modal">
        <header className="cssp-modal-header"><div><h2>{title}</h2>{description ? <p>{description}</p> : null}</div><IconButton label="关闭" onClick={onClose}><X size={18} /></IconButton></header>
        <div className="cssp-modal-body">{children}</div>
        {footer ? <footer className="cssp-modal-footer">{footer}</footer> : null}
      </section>
    </div>
  )
}

function SettingRow({ action, description, title }: { action: ReactNode; description?: ReactNode; title: ReactNode }) {
  return <div className="cssp-setting-row"><div className="cssp-setting-copy"><div className="cssp-setting-title">{title}</div>{description ? <div className="cssp-setting-description">{description}</div> : null}</div><div className="cssp-setting-action">{action}</div></div>
}

function NativeSelect({ disabled = false, label, onChange, options, value }: { disabled?: boolean; label: string; onChange: (value: string) => void; options: ReadonlyArray<readonly [string, string]>; value: string }) {
  return <label className="cssp-native-select"><select aria-label={label} disabled={disabled} onChange={(event) => onChange(event.currentTarget.value)} value={value}>{options.map(([id, text]) => <option key={id} value={id}>{text}</option>)}</select><ChevronDown size={15} /></label>
}

/* Code review */

type ReviewTrigger = 'pr_open' | 'every_push' | 'smart_detect'
type Severity = 'critical' | 'high' | 'medium' | 'low'
type Provider = 'github' | 'gitlab'

interface RepoPreference {
  archived?: boolean
  autoReview: boolean
  exhaustive: boolean
  id: string
  name: string
  provider: Provider
  securityReview: boolean
  trigger: ReviewTrigger
  visibility: 'private' | 'public'
}

const TRIGGERS: ReadonlyArray<readonly [ReviewTrigger, string]> = [
  ['pr_open', '创建 PR 时'],
  ['every_push', '每次推送时'],
  ['smart_detect', '智能检测（实验性）'],
]

const SEVERITIES: ReadonlyArray<readonly [Severity, string]> = [
  ['critical', '严重'],
  ['high', '高'],
  ['medium', '中'],
  ['low', '低'],
]

const DEMO_REPOS: RepoPreference[] = [
  { autoReview: true, exhaustive: false, id: 'ui', name: 'TaylorBrooks/codex-ui', provider: 'github', securityReview: false, trigger: 'pr_open', visibility: 'private' },
  { autoReview: false, exhaustive: true, id: 'api', name: 'TaylorBrooks/workspace-api', provider: 'github', securityReview: true, trigger: 'smart_detect', visibility: 'private' },
  { archived: true, autoReview: false, exhaustive: false, id: 'design', name: 'TaylorBrooks/design-system', provider: 'github', securityReview: false, trigger: 'every_push', visibility: 'public' },
  { autoReview: true, exhaustive: true, id: 'platform', name: 'taylor-brooks/platform', provider: 'gitlab', securityReview: true, trigger: 'every_push', visibility: 'private' },
]

export interface CodeReviewSettingsPageProps {
  canManageRepositories?: boolean
  initialRepositoryId?: string | null
  isGithubConnected?: boolean
  onAction?: ActionHandler
}

export function CodeReviewSettingsPage({ canManageRepositories = true, initialRepositoryId = null, isGithubConnected = false, onAction }: CodeReviewSettingsPageProps) {
  const [personal, setPersonal] = useState(false)
  const [trigger, setTrigger] = useState<ReviewTrigger>('pr_open')
  const [exhaustive, setExhaustive] = useState(false)
  const [query, setQuery] = useState('')
  const [hideArchived, setHideArchived] = useState(true)
  const [repos, setRepos] = useState(DEMO_REPOS)
  const [selectedId, setSelectedId] = useState<string | null>(initialRepositoryId)
  const selected = repos.find((repo) => repo.id === selectedId) ?? null
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!isGithubConnected) return []
    return repos.filter((repo) => repo.provider === 'github' && (!hideArchived || !repo.archived) && (!needle || repo.name.toLowerCase().includes(needle)))
  }, [hideArchived, isGithubConnected, query, repos])

  const updateRepo = (id: string, patch: Partial<RepoPreference>) => {
    setRepos((current) => current.map((repo) => repo.id === id ? { ...repo, ...patch } : repo))
    notify(onAction, '代码仓库偏好设置已自动保存')
  }

  if (selected) return <RepoDetail canManage={canManageRepositories} onBack={() => setSelectedId(null)} onChange={(patch) => updateRepo(selected.id, patch)} repo={selected} />

  return (
    <div className="cssp-page cssp-code-review-page">
      <PageHeader subtitle="设置 Codex 以自动审查 Pull Request" title="代码审查" />
      <div className="cssp-review-notice"><Lightbulb size={17} /><div>启用代码审查后，Codex 会自动对 Pull Request 提出改进建议，或直接回复 👍。<br />在 Pull Request 中提及 <b>@codex</b> 可启动任务或手动请求审查。</div></div>

      <section className="cssp-section-block">
        <div className="cssp-section-heading"><div><h2>个人代码审查偏好设置</h2><p>控制 Codex 默认如何审查你的 Pull Request。</p></div></div>
        <div className="cssp-settings-card">
          <SettingRow action={<Switch checked={personal} label="切换自动审查" onChange={setPersonal} />} description="启用 Codex 的代码仓库将自动审查你创建的所有 Pull Request。" title="自动审查" />
          <SettingRow action={<NativeSelect label="审查触发条件" onChange={(value) => setTrigger(value as ReviewTrigger)} options={TRIGGERS} value={trigger} />} description="选择 Codex 自动审查 Pull Request 的时机。" title="审查触发条件" />
          <SettingRow action={<Switch checked={exhaustive} label="切换全面代码审查" onChange={setExhaustive} />} description="要求 Codex 继续查找更多结果，直到不再发现新问题。" title="全面代码审查" />
        </div>
      </section>

      <section className="cssp-section-block cssp-repositories-section">
        <div className="cssp-section-heading"><div><h2>代码仓库首选项</h2><p>针对代码仓库的所有贡献者配置代码审查。</p></div></div>
        <div className="cssp-repo-toolbar">
          <label className="cssp-search-field"><Search size={16} /><input aria-label="搜索代码仓库" onChange={(event) => setQuery(event.currentTarget.value)} placeholder="搜索代码仓库或输入 GitHub 组织/代码仓库" value={query} />{query ? <button aria-label="清除搜索" onClick={() => setQuery('')} type="button"><X size={14} /></button> : null}</label>
          <div className="cssp-hide-archived"><span>隐藏已归档的代码仓库</span><Switch checked={hideArchived} label="隐藏已归档的代码仓库" onChange={setHideArchived} /></div>
        </div>

        <div className="cssp-repo-table-wrap">
          <table className="cssp-repo-table">
            <thead><tr><th>代码仓库</th><th>可见性</th><th>自动代码审查</th><th>审查触发条件</th><th>全面代码审查</th><th>最后更新者</th><th aria-label="设置" /></tr></thead>
            <tbody>
              {visible.map((repo) => <RepoRow canManage={canManageRepositories} key={repo.id} onOpen={() => setSelectedId(repo.id)} onUpdate={(patch) => updateRepo(repo.id, patch)} repo={repo} />)}
              {visible.length === 0 ? <tr className="cssp-empty-row"><td colSpan={7}>无代码仓库</td></tr> : null}
            </tbody>
          </table>
        </div>
        <div className="cssp-repo-mobile-list">
          {visible.map((repo) => <button className="cssp-repo-mobile-card" key={repo.id} onClick={() => setSelectedId(repo.id)} type="button"><span className="cssp-repo-icon"><GithubMark size={15} /></span><span><b>{repo.name}</b><small>{repo.visibility === 'private' ? '私有' : '公开'} · {repo.autoReview ? '自动审查已开启' : '自动审查已关闭'}</small></span><ChevronRight size={17} /></button>)}
          {visible.length === 0 ? <div className="cssp-mobile-empty">无代码仓库</div> : null}
        </div>
        {visible.length > 0 ? <p className="cssp-max-note">最多显示 20 条建议</p> : null}
      </section>
    </div>
  )
}

function RepoRow({ canManage, onOpen, onUpdate, repo }: { canManage: boolean; onOpen: () => void; onUpdate: (patch: Partial<RepoPreference>) => void; repo: RepoPreference }) {
  return (
    <tr onClick={onOpen}>
      <td><span className="cssp-repo-icon"><GithubMark size={15} /></span><div><b>{repo.name}</b>{repo.archived ? <small>已归档</small> : null}</div></td>
      <td>{repo.visibility === 'private' ? '私有' : '公开'}</td>
      <td onClick={(event) => event.stopPropagation()}><Switch checked={repo.autoReview} disabled={!canManage} label={`切换 ${repo.name} 自动代码审查`} onChange={(checked) => onUpdate({ autoReview: checked })} /></td>
      <td>{TRIGGERS.find(([id]) => id === repo.trigger)?.[1]}</td>
      <td onClick={(event) => event.stopPropagation()}><Switch checked={repo.exhaustive} disabled={!canManage} label={`切换 ${repo.name} 全面代码审查`} onChange={(checked) => onUpdate({ exhaustive: checked })} /></td>
      <td><span className="cssp-updater"><i>TB</i>你</span></td>
      <td><ChevronRight size={17} /></td>
    </tr>
  )
}

function SeveritySelect({ disabled = false, onChange, value }: { disabled?: boolean; onChange: (severity: Severity) => void; value: Severity }) {
  return <label className={cn('cssp-severity-select', `is-${value}`)}><i /><select disabled={disabled} onChange={(event) => onChange(event.currentTarget.value as Severity)} value={value}>{SEVERITIES.map(([id, text]) => <option key={id} value={id}>{text}</option>)}</select><ChevronDown size={14} /></label>
}

function RepoDetail({ canManage, onBack, onChange, repo }: { canManage: boolean; onBack: () => void; onChange: (patch: Partial<RepoPreference>) => void; repo: RepoPreference }) {
  const [tab, setTab] = useState<'code' | 'security'>('code')
  const [threatSource, setThreatSource] = useState<'generated' | 'file'>('generated')
  const [threatPath, setThreatPath] = useState('docs/threat-model.md')
  const [autoSeverity, setAutoSeverity] = useState<Severity>('high')
  const [manualSeverity, setManualSeverity] = useState<Severity>('medium')
  const [mergeProtection, setMergeProtection] = useState(false)
  const [blockingSeverity, setBlockingSeverity] = useState<Severity>('high')
  const [rules, setRules] = useState<Array<{ auto: Severity; manual: Severity; path: string }>>([])

  return (
    <div className="cssp-page cssp-repository-detail">
      <button className="cssp-back-link" onClick={onBack} type="button"><ChevronLeft size={17} />返回存储库偏好设置</button>
      <header className="cssp-repository-title"><span className="cssp-large-repo-icon"><GithubMark size={21} /></span><div><h1>{repo.name}</h1><p>{repo.visibility === 'private' ? '私有' : '公开'}代码仓库</p></div><span className="cssp-autosave"><Check size={14} />更改会自动保存</span></header>
      {!canManage ? <Notice title="没有编辑权限" tone="warning">只有代码仓库管理员可以更改这些偏好设置。</Notice> : null}
      <div className="cssp-tabs" role="tablist"><button aria-selected={tab === 'code'} className={tab === 'code' ? 'is-active' : ''} onClick={() => setTab('code')} role="tab" type="button">代码审查偏好设置</button><button aria-selected={tab === 'security'} className={tab === 'security' ? 'is-active' : ''} onClick={() => setTab('security')} role="tab" type="button">安全审查偏好设置</button></div>

      {tab === 'code' ? (
        <section className="cssp-detail-section">
          <SettingRow action={<Switch checked={repo.autoReview} disabled={!canManage} label="切换自动代码审查设置" onChange={(checked) => onChange({ autoReview: checked })} />} description="选择 Codex 应自动审查此代码仓库中的哪些 Pull Request。" title="自动代码审查设置" />
          <SettingRow action={<NativeSelect disabled={!canManage || !repo.autoReview} label="审查触发时机" onChange={(value) => onChange({ trigger: value as ReviewTrigger })} options={TRIGGERS} value={repo.trigger} />} description="选择 Codex 何时自动审查此代码仓库的 Pull Request。" title="审查触发时机" />
          <SettingRow action={<Switch checked={repo.exhaustive} disabled={!canManage || !repo.autoReview} label="切换全面代码审查" onChange={(checked) => onChange({ exhaustive: checked })} />} description="要求 Codex 继续查找更多结果，直到不再发现新问题。" title="全面代码审查" />
        </section>
      ) : (
        <section className="cssp-detail-section cssp-security-detail">
          <SettingRow action={<Switch checked={repo.securityReview} disabled={!canManage} label="切换自动安全审查" onChange={(checked) => onChange({ securityReview: checked })} />} description="选择 Codex 应自动对该代码仓库中的哪些 Pull Request 进行安全审查。" title="自动安全审查" />
          <SettingRow action={<NativeSelect disabled={!canManage || !repo.securityReview} label="安全审查触发条件" onChange={(value) => onChange({ trigger: value as ReviewTrigger })} options={TRIGGERS} value={repo.trigger} />} description="选择 Codex 何时自动对该代码仓库中的 Pull Request 进行安全审查。" title="安全审查触发条件" />
          <div className="cssp-complex-setting"><div className="cssp-setting-copy"><div className="cssp-setting-title">威胁模型</div><div className="cssp-setting-description">为此代码仓库选择威胁模型来源。如果未指定，我们会在每次审查时重新生成威胁模型。</div></div><div className="cssp-radio-stack"><label><input checked={threatSource === 'generated'} disabled={!canManage} name="threat" onChange={() => setThreatSource('generated')} type="radio" /><span><b>由 Codex 自动生成</b><small>每次审查时生成最新威胁模型</small></span></label><label><input checked={threatSource === 'file'} disabled={!canManage} name="threat" onChange={() => setThreatSource('file')} type="radio" /><span><b>此代码仓库中的威胁模型文件路径</b><small>文件路径相对于代码仓库根目录</small></span></label>{threatSource === 'file' ? <input className="cssp-text-input" disabled={!canManage} onChange={(event) => setThreatPath(event.currentTarget.value)} value={threatPath} /> : null}</div></div>
          <SettingRow action={<SeveritySelect disabled={!canManage} onChange={setAutoSeverity} value={autoSeverity} />} description="选择 Codex 在自动代码审查中应报告的最低严重级别。" title="自动审查报告最低严重级别" />
          <SettingRow action={<SeveritySelect disabled={!canManage} onChange={setManualSeverity} value={manualSeverity} />} description="选择通过“@codex”提及手动请求审查时，应报告的最低严重级别。" title="手动审查最低报告严重级别" />
          <SettingRow action={<Switch checked={mergeProtection} disabled={!canManage} label="切换安全审查合并保护" onChange={setMergeProtection} />} description="发布 GitHub 检查；当发现达到所配置的阻断严重级别时，该检查将失败。" title="合并保护" />
          <SettingRow action={<SeveritySelect disabled={!canManage || !mergeProtection} onChange={setBlockingSeverity} value={blockingSeverity} />} description="选择会导致安全审查 GitHub 检查失败的最低发现严重级别。" title="阻断严重级别" />
          <div className="cssp-path-rules">
            <div className="cssp-path-rules-heading"><div><h3>基于路径的报告严重级别覆盖设置</h3><p>为特定存储库路径覆盖报告严重级别。</p></div><Button disabled={!canManage} onClick={() => setRules((current) => [...current, { auto: 'high', manual: 'medium', path: '' }])}><Plus size={15} />添加路径覆盖规则</Button></div>
            {rules.map((rule, index) => <div className="cssp-path-rule" key={`rule-${index}`}><label><span>路径前缀</span><input disabled={!canManage} onChange={(event) => setRules((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, path: event.currentTarget.value } : item))} placeholder="src/auth/" value={rule.path} /></label><label><span>自动审查</span><SeveritySelect disabled={!canManage} onChange={(value) => setRules((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, auto: value } : item))} value={rule.auto} /></label><label><span>手动审查</span><SeveritySelect disabled={!canManage} onChange={(value) => setRules((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, manual: value } : item))} value={rule.manual} /></label><IconButton label="删除路径覆盖规则" onClick={() => setRules((current) => current.filter((_, itemIndex) => itemIndex !== index))}><Trash2 size={16} /></IconButton></div>)}
            {rules.length === 0 ? <div className="cssp-empty-compact">尚未添加路径覆盖规则。</div> : null}
          </div>
        </section>
      )}
    </div>
  )
}

/* Connectors */

export interface ConnectorsSettingsPageProps {
  isGithubConnected?: boolean
  onAction?: ActionHandler
  onGithubConnectionChange?: (connected: boolean) => void
}

export function ConnectorsSettingsPage({ isGithubConnected, onAction, onGithubConnectionChange }: ConnectorsSettingsPageProps) {
  const [localGithubConnected, setLocalGithubConnected] = useState(isGithubConnected ?? false)
  const githubConnected = isGithubConnected ?? localGithubConnected
  const [gitlabConnected, setGitlabConnected] = useState(false)
  const [slackWorkspaces, setSlackWorkspaces] = useState<string[]>([])
  const [linearInstalled, setLinearInstalled] = useState(false)
  const [gitlabModal, setGitlabModal] = useState(false)
  const [gitlabToken, setGitlabToken] = useState('')
  const [gitlabAccess, setGitlabAccess] = useState<'all' | 'groups' | 'projects'>('all')
  const [gitlabSaved, setGitlabSaved] = useState(false)

  const changeGithub = (connected: boolean) => {
    setLocalGithubConnected(connected)
    onGithubConnectionChange?.(connected)
    notify(onAction, connected ? 'GitHub 已连接' : 'GitHub 已断开连接')
  }

  return (
    <div className="cssp-page cssp-connectors-page">
      <PageHeader title="连接器" />
      <div className="cssp-connector-list">
        <ConnectorSection icon={<GithubMark size={22} />} title="GitHub">
          {githubConnected ? (
            <>
              <ConnectedAccount avatar="TB" detail="github.com" name="已连接到 TaylorBrooks"><div className="cssp-connector-buttons"><Button onClick={() => notify(onAction, '已打开 GitHub 安装设置')}><Settings size={15} />设置<ExternalLink size={13} /></Button><Button danger onClick={() => changeGithub(false)}>取消连接</Button></div></ConnectedAccount>
              <SettingRow action={<NativeSelect label="GitHub 连接器" onChange={() => notify(onAction, 'GitHub 连接器已更新')} options={[["github.com", 'GitHub.com'], ['enterprise', 'GitHub Enterprise']]} value="github.com" />} description="打开 GitHub 连接流程时，Codex 会使用此 GitHub 实例。" title="GitHub 连接器" />
            </>
          ) : <Disconnected action={<><GithubMark size={15} />连接到 GitHub</>} description="连接到你的 GitHub 存储库以便在 Codex 中使用" onConnect={() => changeGithub(true)} />}
        </ConnectorSection>

        <ConnectorSection icon={<GitlabMark />} title="GitLab（测试版）">
          {gitlabConnected ? (
            <>
              <ConnectedAccount avatar="TB" detail="gitlab.com" name="已连接到 TaylorBrooks" orange><div className="cssp-connector-buttons"><Button onClick={() => setGitlabModal(true)}>{gitlabSaved ? '管理服务账户' : '配置服务账户'}</Button><Button danger onClick={() => { setGitlabConnected(false); setGitlabSaved(false); notify(onAction, 'GitLab 已断开连接') }}>取消连接</Button></div></ConnectedAccount>
              <div className="cssp-admin-callout"><ShieldCheck size={17} /><div><b>GitLab 服务账户</b><p>{gitlabSaved ? '个人访问令牌已配置。Codex 可以在授权项目中评论和回应。' : '配置一个服务账户，让 Codex 能够在项目中评论和回应。'}</p></div><Button onClick={() => setGitlabModal(true)}>{gitlabSaved ? '管理' : '配置'}</Button></div>
            </>
          ) : <Disconnected action="连接到 GitLab" description={<>连接到你的 GitLab 项目，以便在 Codex 中使用。 <button className="cssp-inline-link" onClick={() => notify(onAction, '已打开 GitLab 帮助')} type="button">了解更多</button></>} onConnect={() => { setGitlabConnected(true); notify(onAction, 'GitLab 已连接') }} />}
        </ConnectorSection>

        <ConnectorSection icon={<MessageSquare size={21} />} title="Slack">
          <p className="cssp-connector-description">连接到 Slack，即可直接在 Slack 中通过 @codex 让 Codex 回答问题或起草 PR。 <button className="cssp-inline-link" onClick={() => notify(onAction, '已打开 Slack 帮助')} type="button">了解更多</button></p>
          {slackWorkspaces.map((workspace) => <ConnectedAccount avatar="#" detail="Slack 工作空间" key={workspace} name={workspace} slack><Button danger onClick={() => setSlackWorkspaces((items) => items.filter((item) => item !== workspace))}>取消连接</Button></ConnectedAccount>)}
          <Button primary={slackWorkspaces.length === 0} onClick={() => setSlackWorkspaces((items) => [...items, items.length ? `Codex Design ${items.length + 1}` : 'Taylor 的工作空间'])}>{slackWorkspaces.length ? <><Plus size={15} />连接更多</> : '连接到 Slack'}</Button>
        </ConnectorSection>

        <ConnectorSection icon={<LinearMark />} title="Linear">
          <p className="cssp-connector-description">要将问题分配给 Codex 或在评论区 @ 提及它，请将 Codex 安装到 Linear，然后关联你的账户。 <button className="cssp-inline-link" onClick={() => notify(onAction, '已打开 Linear 帮助')} type="button">了解更多</button></p>
          {linearInstalled ? <ConnectedAccount avatar="L" detail="Taylor 的 Linear 工作空间" linear name="Codex 已安装"><div className="cssp-connector-buttons"><Button onClick={() => notify(onAction, '已打开 Linear 中的 Codex 管理页面')}>在 Linear 中管理 Codex<ExternalLink size={13} /></Button><Button danger onClick={() => setLinearInstalled(false)}>取消连接</Button></div></ConnectedAccount> : <Button primary onClick={() => setLinearInstalled(true)}>将 Codex 安装到 Linear<ExternalLink size={13} /></Button>}
        </ConnectorSection>
      </div>

      {gitlabModal ? (
        <Modal description="创建一个 GitLab 服务账户，并粘贴具有 api 作用域且有效期至少 30 天的个人访问令牌。" footer={<><Button onClick={() => setGitlabModal(false)}>取消</Button><Button disabled={!gitlabToken.trim()} onClick={() => { setGitlabSaved(true); setGitlabModal(false); notify(onAction, 'GitLab 服务账户设置已保存') }} primary>保存</Button></>} onClose={() => setGitlabModal(false)} title={gitlabSaved ? '管理 GitLab 服务账户' : '配置 GitLab 服务账户'}>
          <div className="cssp-form-stack">
            <label className="cssp-field"><span>个人访问令牌</span><input onChange={(event) => setGitlabToken(event.currentTarget.value)} placeholder="粘贴 GitLab 个人访问令牌" type="password" value={gitlabToken} /><small>必须包含 api 作用域，且剩余有效期至少为 30 天。</small></label>
            <fieldset className="cssp-radio-fieldset"><legend>项目访问权限</legend><RadioOption checked={gitlabAccess === 'all'} detail="允许 Codex 使用此账户可访问的所有项目" group="gitlab-access" label="所有可访问的项目" onChange={() => setGitlabAccess('all')} /><RadioOption checked={gitlabAccess === 'groups'} detail="仅允许来自指定 GitLab 群组的项目" group="gitlab-access" label="所选群组" onChange={() => setGitlabAccess('groups')} /><RadioOption checked={gitlabAccess === 'projects'} detail="逐个选择允许访问的项目" group="gitlab-access" label="所选项目" onChange={() => setGitlabAccess('projects')} /></fieldset>
            {gitlabAccess !== 'all' ? <label className="cssp-search-field cssp-modal-search"><Search size={16} /><input aria-label="搜索 GitLab" placeholder={gitlabAccess === 'groups' ? '搜索 GitLab 群组' : '搜索 GitLab 项目'} /></label> : null}
          </div>
        </Modal>
      ) : null}
    </div>
  )
}

function ConnectorSection({ badge, children, icon, title }: { badge?: string; children: ReactNode; icon: ReactNode; title: string }) {
  return <section className="cssp-connector-section"><header><span className="cssp-brand-tile">{icon}</span><h2>{title}</h2>{badge ? <span className="cssp-beta-badge">{badge}</span> : null}</header><div className="cssp-connector-content">{children}</div></section>
}

function Disconnected({ action, description, onConnect }: { action: ReactNode; description: ReactNode; onConnect: () => void }) {
  return <div className="cssp-connector-disconnected"><p>{description}</p><Button onClick={onConnect} primary>{action}</Button></div>
}

function ConnectedAccount({ avatar, children, detail, linear = false, name, orange = false, slack = false }: { avatar: string; children: ReactNode; detail: string; linear?: boolean; name: string; orange?: boolean; slack?: boolean }) {
  return <div className="cssp-connector-connected"><div className="cssp-connector-account"><span className={cn('cssp-account-avatar', orange && 'is-orange', slack && 'cssp-slack-logo', linear && 'cssp-linear-logo')}>{avatar}</span><div><b>{name}</b><small>{detail}</small></div></div>{children}</div>
}

function RadioOption({ checked, detail, group, label, onChange }: { checked: boolean; detail: string; group: string; label: string; onChange: () => void }) {
  return <label><input checked={checked} name={group} onChange={onChange} type="radio" /><span><b>{label}</b><small>{detail}</small></span></label>
}

/* Data controls */

export interface DataSettingsPageProps {
  initialIncludeEnvironments?: boolean
  isBusinessWorkspace?: boolean
  onAction?: ActionHandler
  showExternalGuardrails?: boolean
}

export function DataSettingsPage({ initialIncludeEnvironments = false, isBusinessWorkspace = false, onAction, showExternalGuardrails = false }: DataSettingsPageProps) {
  const [includeEnvironments, setIncludeEnvironments] = useState(initialIncludeEnvironments)
  const [guardrails, setGuardrails] = useState(false)
  const [endpoint, setEndpoint] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [profile, setProfile] = useState('')
  const [enforcement, setEnforcement] = useState<'alert' | 'block'>('alert')
  const [failureMode, setFailureMode] = useState<'allow' | 'block'>('allow')
  const [test, setTest] = useState<'idle' | 'testing' | 'success' | 'error'>('idle')
  const [confirmDisconnect, setConfirmDisconnect] = useState(false)

  const testConnection = () => {
    setTest('testing')
    window.setTimeout(() => setTest(endpoint.startsWith('http') && Boolean(apiKey) ? 'success' : 'error'), 650)
  }

  return (
    <div className="cssp-page cssp-data-page">
      <PageHeader title="数据管理" />
      <section className="cssp-section-block">
        <div className="cssp-section-heading"><div><h2>模型改进</h2></div></div>
        {isBusinessWorkspace ? <Notice>ChatGPT Business 套餐会自动禁用训练。</Notice> : <Notice>模型改进已在 <button className="cssp-inline-link" onClick={() => notify(onAction, '已打开 ChatGPT 数据控制')} type="button">ChatGPT 数据控制</button> 中启用。你的任务可用于改进 Codex。</Notice>}
        <div className="cssp-data-row-card"><SettingRow action={<Switch checked={includeEnvironments} disabled={isBusinessWorkspace} label="用于将环境纳入模型训练数据中的切换开关" onChange={(checked) => { setIncludeEnvironments(checked); notify(onAction, checked ? '已允许包含环境' : '已停止包含环境') }} />} description={<>允许来自你的 Codex 环境的额外上下文以帮助改进我们的模型。我们将采取措施以保护你的隐私。 <button className="cssp-inline-link" onClick={() => notify(onAction, '已打开模型改进和隐私说明')} type="button">了解更多</button>。</>} title="包含环境" /></div>
      </section>

      {showExternalGuardrails ? (
        <section className="cssp-section-block cssp-guardrails-section">
          <div className="cssp-section-heading"><div><h2>外部防护机制</h2><p>使用第三方安全服务扫描 Codex 提示词。</p></div></div>
          <div className="cssp-data-row-card"><SettingRow action={<Switch checked={guardrails} label="启用外部防护机制" onChange={(checked) => { if (!checked && guardrails) setConfirmDisconnect(true); else setGuardrails(checked) }} />} description="将 Codex 提示词发送到配置的安全服务进行检查。" title="启用外部防护机制" /></div>
          {guardrails ? (
            <div className="cssp-guardrail-card">
              <div className="cssp-form-stack">
                <label className="cssp-field"><span>端点 URL</span><input onChange={(event) => { setEndpoint(event.currentTarget.value); setTest('idle') }} placeholder="https://security.example.com/v1/scan" type="url" value={endpoint} /><small>必须是安全服务提供的 HTTPS 扫描端点。</small></label>
                <label className="cssp-field"><span>API 密钥</span><input onChange={(event) => { setApiKey(event.currentTarget.value); setTest('idle') }} placeholder="输入 API 密钥" type="password" value={apiKey} /></label>
                <label className="cssp-field"><span>安全配置文件</span><input onChange={(event) => setProfile(event.currentTarget.value)} placeholder="例如：production-codex" value={profile} /></label>
                <ChoiceRow detail="安全服务检测到风险时应采取的操作。" left="提醒" onChange={(value) => setEnforcement(value as 'alert' | 'block')} right="阻止" title="执行方式" value={enforcement} values={['alert', 'block']} />
                <ChoiceRow detail="外部服务不可用或超时时的行为。" left="允许" onChange={(value) => setFailureMode(value as 'allow' | 'block')} right="阻止" title="服务失败时" value={failureMode} values={['allow', 'block']} />
              </div>
              {test === 'success' ? <Notice tone="success">连接测试成功。</Notice> : null}
              {test === 'error' ? <Notice tone="warning">连接失败。请检查端点 URL 和 API 密钥。</Notice> : null}
              <div className="cssp-card-actions"><Button danger onClick={() => setConfirmDisconnect(true)}>断开连接</Button><span /><Button disabled={!endpoint || !apiKey || test === 'testing'} onClick={testConnection}>{test === 'testing' ? '正在测试…' : '测试连接'}</Button><Button disabled={!endpoint || !apiKey} onClick={() => notify(onAction, '外部防护机制设置已保存')} primary>保存</Button></div>
            </div>
          ) : null}
        </section>
      ) : null}

      {confirmDisconnect ? <Modal footer={<><Button onClick={() => setConfirmDisconnect(false)}>取消</Button><Button danger onClick={() => { setGuardrails(false); setConfirmDisconnect(false); setTest('idle'); notify(onAction, '外部防护机制已断开连接') }}>断开连接</Button></>} onClose={() => setConfirmDisconnect(false)} title="断开外部防护机制？"><p className="cssp-confirm-copy">Codex 提示词将不再由第三方安全服务扫描。你保存的连接信息会从此工作空间中移除。</p></Modal> : null}
    </div>
  )
}

function ChoiceRow({ detail, left, onChange, right, title, value, values }: { detail: string; left: string; onChange: (value: string) => void; right: string; title: string; value: string; values: readonly [string, string] }) {
  return <div className="cssp-choice-row"><div><b>{title}</b><small>{detail}</small></div><div className="cssp-segmented"><button className={value === values[0] ? 'is-active' : ''} onClick={() => onChange(values[0])} type="button">{left}</button><button className={value === values[1] ? 'is-active' : ''} onClick={() => onChange(values[1])} type="button">{right}</button></div></div>
}

/* Access tokens */

export type AccessTokenStatus = 'active' | 'expired' | 'revoked'
export type AccessTokenScope = 'workspace_agents' | 'codex' | 'codex_security'

export interface LocalAccessToken {
  createdAt: string
  createdBy: string
  expiresAt: string | null
  id: string
  lastUsedAt: string | null
  name: string
  scopes: AccessTokenScope[]
  status: AccessTokenStatus
}

export interface AccessTokensSettingsPageProps {
  canCreate?: boolean
  initialTokens?: LocalAccessToken[]
  isWorkspaceAdmin?: boolean
  onAction?: ActionHandler
}

const SAMPLE_TOKENS: LocalAccessToken[] = [{ createdAt: '2026-08-28', createdBy: 'Taylor Brooks', expiresAt: null, id: 'at_codex_demo_7f31', lastUsedAt: '2026-08-30', name: 'Codex CLI', scopes: ['codex'], status: 'active' }]
const SCOPE_TEXT: Record<AccessTokenScope, string> = { codex: 'Codex', codex_security: 'Codex 安全', workspace_agents: '工作区智能体' }

export function AccessTokensSettingsPage({ canCreate = true, initialTokens, isWorkspaceAdmin = true, onAction }: AccessTokensSettingsPageProps) {
  const [tokens, setTokens] = useState<LocalAccessToken[]>(initialTokens ?? SAMPLE_TOKENS)
  const [query, setQuery] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [detail, setDetail] = useState<LocalAccessToken | null>(null)
  const [menuId, setMenuId] = useState<string | null>(null)
  const [revoke, setRevoke] = useState<LocalAccessToken | null>(null)
  const [toast, setToast] = useState('')
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return tokens.filter((token) => !needle || token.name.toLowerCase().includes(needle))
  }, [query, tokens])

  const flash = (message: string) => {
    setToast(message)
    window.setTimeout(() => setToast(''), 2200)
  }
  const confirmRevoke = () => {
    if (!revoke) return
    setTokens((current) => current.map((token) => token.id === revoke.id ? { ...token, status: 'revoked' } : token))
    if (detail?.id === revoke.id) setDetail((token) => token ? { ...token, status: 'revoked' } : null)
    setRevoke(null)
    setMenuId(null)
    flash('访问令牌已撤销')
    notify(onAction, '访问令牌已撤销')
  }

  return (
    <div className="cssp-page cssp-access-page">
      <PageHeader subtitle="创建并管理供 Codex 程序化调用的访问令牌。" title="访问令牌" />
      {!canCreate ? <Notice title="访问令牌创建已禁用">{isWorkspaceAdmin ? <>在 ChatGPT &gt; 管理员 &gt; 权限与角色 &gt; 访问令牌中启用“允许用户创建个人访问令牌”，以便工作空间成员创建访问令牌。 <button className="cssp-inline-link" onClick={() => notify(onAction, '前往权限与角色')} type="button">前往“权限与角色”</button></> : '请让管理员在 ChatGPT > 管理员 > 权限与角色 > 访问令牌中启用“允许用户创建个人访问令牌”。'}</Notice> : null}
      {canCreate || isWorkspaceAdmin ? (
        <>
          <div className="cssp-token-toolbar"><label className="cssp-search-field"><Search size={16} /><input aria-label="按名称筛选" onChange={(event) => setQuery(event.currentTarget.value)} placeholder="按名称筛选" value={query} />{query ? <button aria-label="清除搜索" onClick={() => setQuery('')} type="button"><X size={14} /></button> : null}</label><Button disabled={!canCreate} onClick={() => setCreateOpen(true)} primary><Plus size={15} />创建</Button></div>
          <div className="cssp-token-table-wrap">
            <table className="cssp-token-table"><thead><tr><th>名称</th><th>创建者</th><th>添加日期</th><th>上次使用</th><th>状态</th><th /></tr></thead><tbody>
              {visible.map((token) => (
                <tr key={token.id} onClick={() => setDetail(token)}>
                  <td><span className="cssp-token-icon"><KeyRound size={15} /></span><div><b>{token.name}</b><ScopePills scopes={token.scopes} /></div></td><td>{token.createdBy}</td><td>{formatDate(token.createdAt)}</td><td>{token.lastUsedAt ? formatDate(token.lastUsedAt) : '无使用记录'}</td><td><StatusBadge status={token.status} /></td>
                  <td className="cssp-menu-cell" onClick={(event) => event.stopPropagation()}><IconButton label={`${token.name} 的操作`} onClick={() => setMenuId((current) => current === token.id ? null : token.id)}><MoreHorizontal size={17} /></IconButton>{menuId === token.id ? <div className="cssp-action-menu"><button disabled={token.status === 'revoked'} onClick={() => setRevoke(token)} type="button"><Trash2 size={15} />撤销</button></div> : null}</td>
                </tr>
              ))}
              {visible.length === 0 ? <tr className="cssp-empty-row"><td colSpan={6}>{query ? '没有符合筛选条件的访问令牌' : '尚未创建访问令牌'}</td></tr> : null}
            </tbody></table>
          </div>
          <div className="cssp-token-mobile-list">{visible.map((token) => <button className="cssp-token-mobile-card" key={token.id} onClick={() => setDetail(token)} type="button"><span className="cssp-token-icon"><KeyRound size={15} /></span><span><b>{token.name}</b><small>{formatDate(token.createdAt)} · {SCOPE_TEXT[token.scopes[0]]}</small></span><StatusBadge status={token.status} /><ChevronRight size={16} /></button>)}{visible.length === 0 ? <div className="cssp-mobile-empty">{query ? '没有符合筛选条件的访问令牌' : '尚未创建访问令牌'}</div> : null}</div>
        </>
      ) : null}

      {createOpen ? <CreateTokenModal onClose={() => setCreateOpen(false)} onCreated={(token) => { setTokens((current) => [token, ...current]); notify(onAction, '访问令牌已创建') }} onToast={flash} /> : null}
      {revoke ? <Modal footer={<><Button onClick={() => setRevoke(null)}>取消</Button><Button danger onClick={confirmRevoke}>撤销</Button></>} onClose={() => setRevoke(null)} title="撤销访问令牌？"><p className="cssp-confirm-copy">撤销“{revoke.name}”后，任何使用此令牌的应用都会立即失去访问权限。此操作无法撤消。</p></Modal> : null}
      {detail ? <TokenDrawer onClose={() => setDetail(null)} onRevoke={() => setRevoke(detail)} token={detail} /> : null}
      {toast ? <div aria-live="polite" className="cssp-toast"><Check size={16} />{toast}</div> : null}
    </div>
  )
}

function CreateTokenModal({ onClose, onCreated, onToast }: { onClose: () => void; onCreated: (token: LocalAccessToken) => void; onToast: (message: string) => void }) {
  const [step, setStep] = useState<'details' | 'generated'>('details')
  const [name, setName] = useState('')
  const [expiration, setExpiration] = useState<'30' | '90' | 'custom' | 'none'>('30')
  const [customDate, setCustomDate] = useState('')
  const [scopes, setScopes] = useState<AccessTokenScope[]>(['codex'])
  const [generated, setGenerated] = useState('')
  const nameRef = useRef<HTMLInputElement>(null)
  useEffect(() => nameRef.current?.focus(), [])

  const toggleScope = (scope: AccessTokenScope) => setScopes((current) => current.includes(scope) ? current.filter((item) => item !== scope) : [...current, scope])
  const create = () => {
    const bytes = new Uint8Array(18)
    globalThis.crypto?.getRandomValues(bytes)
    const suffix = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('') || Math.random().toString(36).slice(2).padEnd(36, '0')
    const today = new Date()
    const expiresAt = expiration === 'none' ? null : expiration === 'custom' ? customDate || null : new Date(today.getTime() + Number(expiration) * 86_400_000).toISOString().slice(0, 10)
    const token: LocalAccessToken = { createdAt: today.toISOString().slice(0, 10), createdBy: 'Taylor Brooks', expiresAt, id: `at_${suffix.slice(0, 12)}`, lastUsedAt: null, name: name.trim(), scopes, status: 'active' }
    setGenerated(`sk-codex-${suffix}`)
    onCreated(token)
    setStep('generated')
  }
  const copy = async () => {
    try { await navigator.clipboard.writeText(generated) } catch {
      const area = document.createElement('textarea')
      area.value = generated
      document.body.append(area)
      area.select()
      document.execCommand('copy')
      area.remove()
    }
    onToast('访问令牌已复制')
  }
  const valid = Boolean(name.trim()) && scopes.length > 0 && (expiration !== 'custom' || Boolean(customDate))

  return (
    <Modal description={step === 'details' ? '为此访问令牌命名并选择过期时间。' : '立即复制此访问令牌。之后你将无法再次查看它。'} footer={step === 'details' ? <><Button onClick={onClose}>取消</Button><Button disabled={!valid} onClick={create} primary>创建</Button></> : <Button onClick={onClose} primary>完成</Button>} onClose={onClose} title={step === 'details' ? '创建访问令牌' : '复制访问令牌'}>
      {step === 'details' ? (
        <div className="cssp-form-stack cssp-token-form">
          <label className="cssp-field"><span>名称</span><input maxLength={80} onChange={(event) => setName(event.currentTarget.value)} placeholder="访问令牌" ref={nameRef} value={name} /></label>
          <label className="cssp-field"><span>过期时间</span><span className="cssp-full-select"><select onChange={(event) => setExpiration(event.currentTarget.value as typeof expiration)} value={expiration}><option value="30">30 天</option><option value="90">90 天</option><option value="custom">自定义</option><option value="none">永不过期</option></select><ChevronDown size={15} /></span></label>
          {expiration === 'custom' ? <label className="cssp-field"><span>选择日期</span><input min={new Date().toISOString().slice(0, 10)} onChange={(event) => setCustomDate(event.currentTarget.value)} type="date" value={customDate} /></label> : null}
          <fieldset className="cssp-scope-fieldset"><legend>作用域</legend><ScopeChoice checked={scopes.includes('workspace_agents')} description="用于工作区智能体 API 触发器" label="工作区智能体" onChange={() => toggleScope('workspace_agents')} /><ScopeChoice checked={scopes.includes('codex')} description="用于 Codex CLI 及自动化。" label="Codex" onChange={() => toggleScope('codex')} /><ScopeChoice checked={scopes.includes('codex_security')} description="用于 Codex 安全 API 和安全自动化。" label="Codex 安全" onChange={() => toggleScope('codex_security')} /></fieldset>
        </div>
      ) : <div className="cssp-generated-token"><Notice tone="warning">此值只会显示一次。请将它安全地存储在密码管理器或密钥保险库中。</Notice><label><span>访问令牌</span><div><code>{generated}</code><Button onClick={() => void copy()}><Copy size={15} />复制</Button></div></label><p>将此值用作 Codex 自动化的访问令牌。请妥善保管。</p></div>}
    </Modal>
  )
}

function ScopeChoice({ checked, description, label, onChange }: { checked: boolean; description: string; label: string; onChange: () => void }) {
  return <label className="cssp-scope-choice"><input checked={checked} onChange={onChange} type="checkbox" /><span className="cssp-checkbox-art"><Check size={13} /></span><span><b>{label}</b><small>{description}</small></span></label>
}

function TokenDrawer({ onClose, onRevoke, token }: { onClose: () => void; onRevoke: () => void; token: LocalAccessToken }) {
  return <div className="cssp-drawer-layer" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><aside aria-label={`${token.name} 详情`} className="cssp-token-drawer"><header><span /><IconButton label="关闭" onClick={onClose}><X size={19} /></IconButton></header><div className="cssp-token-drawer-identity"><span><KeyRound size={23} /></span><h2>{token.name}</h2></div><dl><Detail label="访问令牌 ID" value={<code>{token.id}</code>} /><Detail label="适用于" value={<ScopePills scopes={token.scopes} />} /><Detail label="创建者" value={token.createdBy} /><Detail label="添加日期" value={formatDate(token.createdAt)} /><Detail label="上次使用" value={token.lastUsedAt ? formatDate(token.lastUsedAt) : '无使用记录'} /><Detail label="到期时间" value={token.expiresAt ? formatDate(token.expiresAt) : '永不过期'} /><Detail label="状态" value={<StatusBadge status={token.status} />} /></dl><Button danger disabled={token.status === 'revoked'} onClick={onRevoke}>撤销访问令牌</Button></aside></div>
}

function Detail({ label, value }: { label: string; value: ReactNode }) {
  return <div><dt>{label}</dt><dd>{value}</dd></div>
}

function ScopePills({ scopes }: { scopes: AccessTokenScope[] }) {
  return <span className="cssp-scope-pills">{scopes.map((scope) => <small key={scope}>{SCOPE_TEXT[scope]}</small>)}</span>
}

function StatusBadge({ status }: { status: AccessTokenStatus }) {
  const labels: Record<AccessTokenStatus, string> = { active: '有效', expired: '已过期', revoked: '已撤销' }
  return <span className={cn('cssp-status', `is-${status}`)}><i />{labels[status]}</span>
}

function formatDate(value: string) {
  const date = new Date(value.length === 10 ? `${value}T00:00:00` : value)
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('zh-CN', { day: 'numeric', month: 'short', year: 'numeric' }).format(date)
}
