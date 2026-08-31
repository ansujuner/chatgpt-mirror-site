import { useEffect, useMemo, useState, type Dispatch, type FormEvent, type SetStateAction } from 'react'
import {
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  GitBranch,
  Globe2,
  Package,
  Pencil,
  Pin,
  Play,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  X,
} from 'lucide-react'
import './CodexSettingsPrimaryPages.css'

export type CodexPrimaryPageProps = {
  isGithubConnected?: boolean
  onConnectGithub?: () => void
  onNavigate?: (path: string) => void
}

export type GeneralSettingsPageProps = CodexPrimaryPageProps

export type EnvironmentsSettingsPageProps = CodexPrimaryPageProps & {
  path?: string
}

type DiffMode = 'unified' | 'split'
type KeyValue = { id: string; key: string; value: string; domain?: string }
type NetworkPreset = 'common' | 'all' | 'custom'
type HttpMethods = 'safe' | 'all'
type LocalEnvironment = {
  id: string
  name: string
  description: string
  repository: string
  image: string
  setupMode: 'automatic' | 'manual'
  setupScript: string
  maintenanceScript?: string
  workspaceDirectory?: string
  internetAccess: boolean
  networkPreset?: NetworkPreset
  allowedDomains?: string
  httpMethods?: HttpMethods
  cacheEnabled: boolean
  domainScopedSecrets?: boolean
  variables: KeyValue[]
  secrets: KeyValue[]
  createdAt: string
  taskCount: number
  pinned: boolean
}

const PACKAGE_VERSIONS = [
  { name: 'Python', versions: ['3.14', '3.13', '3.12', '3.11', '3.10'], initial: '3.12' },
  { name: 'Node.js', versions: ['22', '20', '18'], initial: '20' },
  { name: 'Ruby', versions: ['3.4.4', '3.3.8', '3.2.3'], initial: '3.4.4' },
  { name: 'Rust', versions: ['1.95.0', '1.94.0', '1.93.0', '1.89.0'], initial: '1.89.0' },
  { name: 'Go', versions: ['1.25.1', '1.24.3', '1.23.8'], initial: '1.24.3' },
  { name: 'Bun', versions: ['1.2.14'], initial: '1.2.14' },
  { name: 'PHP', versions: ['8.5', '8.4', '8.3', '8.2'], initial: '8.4' },
  { name: 'Java', versions: ['25', '24', '21', '17', '11'], initial: '21' },
  { name: 'Swift', versions: ['6.2', '6.1', '5.10'], initial: '6.1' },
] as const

const ENV_STORAGE_KEY = 'codex-replica-environments-v1'

function navigateTo(path: string, callback?: (path: string) => void) {
  if (callback) {
    callback(path)
    return
  }
  window.history.pushState({}, '', path)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

function loadEnvironments(): LocalEnvironment[] {
  try {
    const raw = window.localStorage.getItem(ENV_STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function saveEnvironments(environments: LocalEnvironment[]) {
  try {
    window.localStorage.setItem(ENV_STORAGE_KEY, JSON.stringify(environments))
  } catch {
    // The replica remains usable when storage is unavailable.
  }
}

function DiffGlyph({ mode }: { mode: DiffMode }) {
  return (
    <span className={`csp-diff-glyph is-${mode}`} aria-hidden="true">
      <i />
      <i />
    </span>
  )
}

export function GeneralSettingsPage({ isGithubConnected = false }: GeneralSettingsPageProps) {
  void isGithubConnected
  const [instructions, setInstructions] = useState('')
  const [instructionsSaved, setInstructionsSaved] = useState('')
  const [branch, setBranch] = useState('codex/{feature}')
  const [branchSaved, setBranchSaved] = useState('codex/{feature}')
  const [diffMode, setDiffMode] = useState<DiffMode>('unified')
  const [diffOpen, setDiffOpen] = useState(false)

  const branchExample = branch
    .replaceAll('{feature}', 'unit-tests-for-feature')
    .replaceAll('{date}', '2026-08-31')
    .replaceAll('{time}', '1423')
  const branchError = useMemo(() => {
    const opens = (branch.match(/{/g) ?? []).length
    const closes = (branch.match(/}/g) ?? []).length
    if (!branch) return '分支格式不能为空'
    if (opens !== closes) return '左花括号数必须与右花括号数相同'
    if (!/{(?:feature|date|time)}/.test(branch)) return '分支格式必须至少包含一个可用标签'
    if (branch.startsWith('/')) return "自定义分支名称不能以“/”开头"
    if (!/^[a-zA-Z0-9./\-_{}]+$/.test(branch)) return '分支格式包含无效字符'
    return ''
  }, [branch])

  return (
    <div className="csp-settings-page csp-general-page">
      <header className="csp-page-header"><h1>常规</h1></header>
      <div className="csp-general-column">
        <section className="csp-general-section csp-instructions-section">
          <label className="csp-field-label" htmlFor="csp-custom-instructions">自定义指令</label>
          <textarea
            id="csp-custom-instructions"
            aria-label="自定义指令"
            maxLength={12_000}
            placeholder="示例：每次代码变更时运行测试和 linter，但修改代码注释或文档时无需执行"
            value={instructions}
            onChange={(event) => setInstructions(event.currentTarget.value)}
          />
          {instructions.length > 10_000 && (
            <p className="csp-warning">过长的自定义指令会占用智能体的上下文窗口，并可能导致性能下降。请考虑缩短指令，或使用 AGENTS.md 文件。</p>
          )}
          <div className="csp-field-footer">
            <p>自定义指令用于定制 Codex 模型的行为。</p>
            {instructions !== instructionsSaved && (
              <button type="button" className="csp-primary-button csp-save-button" onClick={() => setInstructionsSaved(instructions)}>保存</button>
            )}
          </div>
        </section>

        <section className="csp-general-section csp-diff-section">
          <span className="csp-field-label">差异显示格式</span>
          <div className="csp-diff-select">
            <button
              type="button"
              className="csp-select-trigger"
              aria-haspopup="listbox"
              aria-expanded={diffOpen}
              aria-label="打开差异视图显示格式菜单"
              onClick={() => setDiffOpen((open) => !open)}
            >
              <span><DiffGlyph mode={diffMode} />{diffMode === 'unified' ? 'Unified' : 'Split'}</span>
              <ChevronDown size={16} />
            </button>
            {diffOpen && (
              <div className="csp-primary-select-menu" role="listbox" aria-label="差异显示格式">
                {(['unified', 'split'] as const).map((mode) => (
                  <button
                    type="button"
                    role="option"
                    aria-selected={diffMode === mode}
                    className={diffMode === mode ? 'is-selected' : ''}
                    key={mode}
                    onClick={() => { setDiffMode(mode); setDiffOpen(false) }}
                  >
                    <span><DiffGlyph mode={mode} />{mode === 'unified' ? 'Unified' : 'Split'}</span>
                    {diffMode === mode && <Check size={16} />}
                  </button>
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="csp-general-section csp-branch-section">
          <label className="csp-field-label" htmlFor="csp-branch-format">分支格式</label>
          <div className="csp-branch-row">
            <input id="csp-branch-format" aria-label="分支格式" value={branch} onChange={(event) => setBranch(event.currentTarget.value)} />
            {branch !== branchSaved && (
              <button type="button" className="csp-primary-button csp-save-button" disabled={Boolean(branchError)} onClick={() => setBranchSaved(branch)}>保存</button>
            )}
          </div>
          {branchError ? <p className="csp-field-error">{branchError}</p> : <p className="csp-example">示例：{branchExample}</p>}
          <p className="csp-tags">可用标签：{'{feature}'}, {'{date}'}, {'{time}'}</p>
        </section>
      </div>
    </div>
  )
}

function EmptyEnvironments() {
  return (
    <div className="csp-environment-empty-wrap">
      <div className="csp-environment-empty">
        <strong>无环境</strong>
        <span>为 Codex 创建工作环境</span>
      </div>
    </div>
  )
}

function EnvironmentList({
  environments,
  isGithubConnected,
  onNavigate,
  onTogglePin,
}: {
  environments: LocalEnvironment[]
  isGithubConnected: boolean
  onNavigate?: (path: string) => void
  onTogglePin: (id: string) => void
}) {
  const [search, setSearch] = useState('')
  const filtered = environments
    .filter((environment) => environment.name.toLowerCase().includes(search.trim().toLowerCase()))
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.name.localeCompare(b.name))

  return (
    <div className="csp-settings-page csp-environments-page">
      <header className="csp-page-header"><h1>环境</h1></header>
      <div className="csp-environment-toolbar">
        <label className={`csp-search-field${!isGithubConnected ? ' is-disabled' : ''}`}>
          <Search size={16} aria-hidden="true" />
          <input
            type="search"
            aria-label="搜索环境"
            placeholder="搜索环境"
            disabled={!isGithubConnected}
            value={search}
            onChange={(event) => setSearch(event.currentTarget.value)}
          />
        </label>
        <button
          type="button"
          className="csp-create-button"
          disabled={!isGithubConnected}
          aria-label="用于创建新环境的链接"
          onClick={() => navigateTo('/codex/cloud/settings/environment/create', onNavigate)}
        >
          <Plus size={18} /><span>创建环境</span>
        </button>
      </div>

      {environments.length === 0 ? <EmptyEnvironments /> : filtered.length === 0 ? (
        <div className="csp-environment-empty-wrap">
          <div className="csp-environment-empty"><strong>没有与“{search}”匹配的环境</strong><span>为 Codex 创建工作环境</span></div>
        </div>
      ) : (
        <div className="csp-environment-table-wrap">
          <table className="csp-environment-table">
            <thead><tr><th>名称</th><th>代码仓库</th><th>任务数量</th><th>创建者</th><th>创建时间</th><th><span className="sr-only">置顶</span></th></tr></thead>
            <tbody>{filtered.map((environment) => (
              <tr key={environment.id} tabIndex={0} onClick={() => navigateTo(`/codex/cloud/settings/environment/${environment.id}`, onNavigate)} onKeyDown={(event) => event.key === 'Enter' && navigateTo(`/codex/cloud/settings/environment/${environment.id}`, onNavigate)}>
                <td><span className="csp-environment-name">{environment.name}</span></td>
                <td>{environment.repository || 'N/A'}</td>
                <td>{environment.taskCount}</td>
                <td>你</td>
                <td>{new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' }).format(new Date(environment.createdAt))}</td>
                <td><button className={`csp-pin-button${environment.pinned ? ' is-pinned' : ''}`} type="button" aria-label={environment.pinned ? '取消置顶环境' : '置顶环境'} onClick={(event) => { event.stopPropagation(); onTogglePin(environment.id) }}><Pin size={16} /></button></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </div>
  )
}

type EnvironmentFormProps = {
  environment?: LocalEnvironment
  isGithubConnected: boolean
  mode: 'create' | 'edit'
  onCancel: () => void
  onSave: (environment: LocalEnvironment) => void
}

function EnvironmentForm({ environment, isGithubConnected, mode, onCancel, onSave }: EnvironmentFormProps) {
  const [name, setName] = useState(environment?.name ?? '')
  const [description, setDescription] = useState(environment?.description ?? '')
  const [repository, setRepository] = useState(environment?.repository ?? '')
  const [repoSearch, setRepoSearch] = useState('')
  const [image, setImage] = useState(environment?.image ?? 'universal')
  const [cacheEnabled, setCacheEnabled] = useState(environment?.cacheEnabled ?? true)
  const [setupMode, setSetupMode] = useState<'automatic' | 'manual'>(environment?.setupMode ?? 'automatic')
  const [setupScript, setSetupScript] = useState(environment?.setupScript ?? '')
  const [maintenanceScript, setMaintenanceScript] = useState(environment?.maintenanceScript ?? '')
  const [workspaceDirectory, setWorkspaceDirectory] = useState(environment?.workspaceDirectory ?? '/workspace')
  const [internetAccess, setInternetAccess] = useState(environment?.internetAccess ?? false)
  const [networkPreset, setNetworkPreset] = useState<NetworkPreset>(environment?.networkPreset ?? 'common')
  const [allowedDomains, setAllowedDomains] = useState(environment?.allowedDomains ?? '')
  const [httpMethods, setHttpMethods] = useState<HttpMethods>(environment?.httpMethods ?? 'safe')
  const [variables, setVariables] = useState<KeyValue[]>(environment?.variables ?? [])
  const [secrets, setSecrets] = useState<KeyValue[]>(environment?.secrets ?? [])
  const [domainScopedSecrets] = useState(environment?.domainScopedSecrets ?? false)
  const [workspaceModalOpen, setWorkspaceModalOpen] = useState(false)
  const [workspaceDraft, setWorkspaceDraft] = useState(workspaceDirectory)
  const [packagesOpen, setPackagesOpen] = useState(false)
  const [packageVersions, setPackageVersions] = useState<Record<string, string>>(() => Object.fromEntries(PACKAGE_VERSIONS.map((entry) => [entry.name, entry.initial])))
  const [terminalConnected, setTerminalConnected] = useState(false)
  const repositories = ['openai/codex-demo', 'openai/example-app', 'workspace/web-project'].filter((repo) => repo.includes(repoSearch.trim().toLowerCase()))
  const canSave = isGithubConnected && Boolean(repository && name.trim())

  const updatePair = (setter: Dispatch<SetStateAction<KeyValue[]>>, id: string, field: 'key' | 'value', value: string) => {
    setter((items) => items.map((item) => item.id === id ? { ...item, [field]: value } : item))
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!canSave) return
    onSave({
      id: environment?.id ?? `env-${Date.now().toString(36)}`,
      name: name.trim(),
      description: description.trim(),
      repository,
      image,
      cacheEnabled,
      setupMode,
      setupScript,
      maintenanceScript,
      workspaceDirectory,
      internetAccess,
      networkPreset,
      allowedDomains,
      httpMethods,
      variables,
      secrets,
      domainScopedSecrets,
      createdAt: environment?.createdAt ?? new Date().toISOString(),
      taskCount: environment?.taskCount ?? 0,
      pinned: environment?.pinned ?? false,
    })
  }

  return (
    <form className="csp-settings-page csp-environment-editor" onSubmit={submit}>
      <nav className="csp-breadcrumb" aria-label="面包屑">
        <button type="button" onClick={onCancel}>环境</button><ChevronRight size={16} /><span>{mode === 'create' ? '新建' : '编辑'}</span>
      </nav>

      <section className="csp-editor-card csp-basic-card">
        <header><h1>基本</h1></header>
        <div className="csp-editor-card-body csp-basic-grid">
          <div className="csp-editor-fields">
            <label className="csp-form-label">GitHub 组织
              <span className="csp-native-select"><GitBranch size={15} /><select aria-label="打开组织菜单" defaultValue=""><option value="">选择组织</option>{isGithubConnected && <option value="workspace">workspace</option>}</select><ChevronDown size={16} /></span>
            </label>
            <label className="csp-form-label">代码仓库
              <span className="csp-repo-search"><Search size={16} /><input aria-label="搜索" placeholder="搜索" value={repoSearch} onChange={(event) => setRepoSearch(event.currentTarget.value)} /></span>
            </label>
            <div className="csp-repository-picker">
              {!isGithubConnected || repositories.length === 0 ? <span>未找到代码仓库</span> : repositories.map((repo) => (
                <button type="button" className={repository === repo ? 'is-selected' : ''} key={repo} onClick={() => { setRepository(repo); if (!name.trim()) setName(repo.split('/').at(-1) ?? '') }}><GitBranch size={15} />{repo}{repository === repo && <Check size={16} />}</button>
              ))}
            </div>
            <label className="csp-form-label">名称
              <input aria-label="环境名称" maxLength={64} placeholder="名称" value={name} onChange={(event) => setName(event.currentTarget.value)} />
              <small>{name.length}/64</small>
            </label>
            <label className="csp-form-label">描述
              <textarea aria-label="环境描述" maxLength={512} placeholder="1-2 句话描述" value={description} onChange={(event) => setDescription(event.currentTarget.value)} />
              <small>{description.length}/512</small>
            </label>
          </div>
        </div>
      </section>

      <section className="csp-editor-card csp-code-card">
        <header className="csp-code-card-header">
          <div><h2>代码执行</h2><span>设置依赖项、代码检查和测试。</span></div>
          <a href="https://platform.openai.com/docs/codex/overview#environment-configuration" target="_blank" rel="noreferrer"><CircleHelp size={15} />了解更多</a>
        </header>
        <div className="csp-editor-card-body csp-execution-grid">
          <div className="csp-execution-fields">
            <label className="csp-form-label">容器镜像
              <span className="csp-native-select"><select value={image} onChange={(event) => setImage(event.currentTarget.value)}><option value="universal">universal</option><option value="ubuntu">ubuntu</option></select><ChevronDown size={16} /></span>
            </label>
            <button type="button" className="csp-package-button" aria-label="打开预安装的软件包弹窗" onClick={() => setPackagesOpen(true)}><Package size={17} />预安装的软件包</button>
            <p className="csp-form-help">Universal 是基于 Ubuntu 24.04 的镜像，请参阅 <a href="https://github.com/openai/codex-universal" target="_blank" rel="noreferrer">openai/codex-universal</a> 了解更多信息。<br />存储库将被克隆到 {workspaceDirectory}/{repository ? repository.split('/').at(-1) : ''}。 <button type="button" className="csp-inline-link" onClick={() => { setWorkspaceDraft(workspaceDirectory); setWorkspaceModalOpen(true) }}>编辑工作空间目录。</button></p>

            <KeyValueEditor title="环境变量" values={variables} setValues={setVariables} updatePair={updatePair} secret={false} />
            <KeyValueEditor title="密钥" values={secrets} setValues={setSecrets} updatePair={updatePair} secret />

            <fieldset className="csp-setting-fieldset"><legend>容器缓存</legend><p>运行安装脚本后，通过缓存状态数据来加速容器启动。每次任务前均需运行维护脚本。</p><SegmentedBoolean value={cacheEnabled} onChange={setCacheEnabled} off="关闭" on="启用" /></fieldset>
            <fieldset className="csp-setting-fieldset"><legend>设置脚本</legend><SegmentedChoice value={setupMode} onChange={setSetupMode} />{setupMode === 'manual' ? <><textarea className="csp-script-input" aria-label="设置脚本" placeholder={'# 例如：\npip install -r requirements.txt\nnpm install\n./run/setup.sh'} value={setupScript} onChange={(event) => setSetupScript(event.currentTarget.value)} /><p>创建新容器并克隆代码仓库后，将运行设置脚本。<strong>此步骤始终启用网络访问。</strong></p>{cacheEnabled && <><strong className="csp-subfield-title">维护脚本</strong><textarea className="csp-script-input" aria-label="维护设置命令" placeholder={'# 例如：\npip install -r requirements.txt\nnpm install\n./run/maintenance_setup.sh'} value={maintenanceScript} onChange={(event) => setMaintenanceScript(event.currentTarget.value)} /><p>从缓存恢复容器并检出分支后，将运行维护脚本。<strong>此步骤始终启用网络访问。</strong></p></>} </> : <p>执行诸如 npm install 之类的安装命令，适用于常见的包管理器。 <a href="https://platform.openai.com/docs/codex/overview#setup-scripts" target="_blank" rel="noreferrer">了解更多。</a></p>}</fieldset>
            <fieldset className="csp-setting-fieldset"><legend>代理网络访问</legend><SegmentedBoolean value={internetAccess} onChange={setInternetAccess} off="关闭" on="启用" /><p>{internetAccess ? '启用互联网访问会使你的环境面临安全风险。请仅允许必要的域名和方法。' : '设置完成后将禁用网络访问。Codex 只能使用安装脚本所安装的依赖项。'}</p>{internetAccess && <div className="csp-network-options"><label>域名允许列表<span className="csp-native-select"><select aria-label="打开预设允许列表菜单" value={networkPreset} onChange={(event) => setNetworkPreset(event.currentTarget.value as NetworkPreset)}><option value="common">常用依赖项</option><option value="all">所有（不受限制）</option><option value="custom">其他</option></select><ChevronDown size={16} /></span></label>{networkPreset === 'custom' && <label>其他允许的域名<textarea aria-label="添加域名" placeholder="domain1, domain2, domain3" value={allowedDomains} onChange={(event) => setAllowedDomains(event.currentTarget.value)} /></label>}<label>允许的 HTTP 方法<span className="csp-native-select"><select aria-label="打开安全 HTTP 方法菜单" value={httpMethods} onChange={(event) => setHttpMethods(event.currentTarget.value as HttpMethods)}><option value="safe">GET、HEAD 和 OPTIONS</option><option value="all">所有方法</option></select><ChevronDown size={16} /></span></label></div>}</fieldset>
          </div>

          <aside className="csp-terminal-card">
            <header><span>终端</span><button type="button" disabled={!repository} onClick={() => setTerminalConnected(true)}><Play size={14} />连接交互式终端</button></header>
            <div><p>{workspaceDirectory} $ {terminalConnected ? <><span>environment ready</span><i /></> : null}</p></div>
          </aside>
        </div>
      </section>

      <div className="csp-editor-actions">
        <button type="submit" className="csp-primary-button" disabled={!canSave}>{mode === 'create' ? '创建环境' : '保存环境'}</button>
      </div>

      {workspaceModalOpen && <div className="csp-modal-backdrop" role="presentation" onMouseDown={() => setWorkspaceModalOpen(false)}><div className="csp-confirm-modal csp-form-modal" role="dialog" aria-modal="true" aria-labelledby="csp-workspace-dialog-title" onMouseDown={(event) => event.stopPropagation()}><button className="csp-modal-close" type="button" aria-label="关闭" onClick={() => setWorkspaceModalOpen(false)}><X size={18} /></button><h2 id="csp-workspace-dialog-title">编辑工作区目录</h2><input aria-label="工作区目录" value={workspaceDraft} onChange={(event) => setWorkspaceDraft(event.currentTarget.value)} /><p>代码仓库将克隆到 {workspaceDraft || '/workspace'}/{repository ? repository.split('/').at(-1) : 'repository'}。仅当你的代码需要绝对安装路径时才需要调整此项。</p>{(!workspaceDraft.includes('/') || workspaceDraft === '/') && <span className="csp-dialog-error">请输入包含斜杠且不是根目录的路径。</span>}<div><button type="button" className="csp-secondary-button" onClick={() => setWorkspaceModalOpen(false)}>取消</button><button type="button" className="csp-primary-button" disabled={!workspaceDraft.includes('/') || workspaceDraft === '/'} onClick={() => { setWorkspaceDirectory(workspaceDraft.replace(/\/$/, '') || '/workspace'); setWorkspaceModalOpen(false) }}>保存</button></div></div></div>}
      {packagesOpen && <div className="csp-modal-backdrop" role="presentation" onMouseDown={() => setPackagesOpen(false)}><div className="csp-confirm-modal csp-form-modal csp-packages-modal" role="dialog" aria-modal="true" aria-labelledby="csp-packages-dialog-title" onMouseDown={(event) => event.stopPropagation()}><button className="csp-modal-close" type="button" aria-label="关闭" onClick={() => setPackagesOpen(false)}><X size={18} /></button><h2 id="csp-packages-dialog-title">预安装的软件包</h2><p>在设置脚本中配置你自己的软件包。</p><div className="csp-package-list">{PACKAGE_VERSIONS.map((entry) => <label key={entry.name}><span>{entry.name}</span><span className="csp-native-select"><select aria-label={`${entry.name} 版本`} value={packageVersions[entry.name]} onChange={(event) => setPackageVersions((current) => ({ ...current, [entry.name]: event.currentTarget.value }))}>{entry.versions.map((version) => <option value={version} key={version}>{version}</option>)}</select><ChevronDown size={16} /></span></label>)}</div><div><button type="button" className="csp-primary-button" onClick={() => setPackagesOpen(false)}>完成</button></div></div></div>}
    </form>
  )
}

function KeyValueEditor({ title, values, setValues, updatePair, secret, domainScoped = false, onToggleDomainScoped }: {
  title: string
  values: KeyValue[]
  setValues: Dispatch<SetStateAction<KeyValue[]>>
  updatePair: (setter: Dispatch<SetStateAction<KeyValue[]>>, id: string, field: 'key' | 'value', value: string) => void
  secret: boolean
  domainScoped?: boolean
  onToggleDomainScoped?: (value: boolean) => void
}) {
  return (
    <div className="csp-key-value-editor">
      <div><strong>{title}</strong>{secret && onToggleDomainScoped && <span className="csp-domain-toggle"><span>域范围密钥</span><SegmentedBoolean value={domainScoped} onChange={onToggleDomainScoped} off="关闭" on="启用" /></span>}<button type="button" onClick={() => setValues((items) => [...items, { id: `${secret ? 'secret' : 'var'}-${Date.now()}-${items.length}`, key: '', value: '', ...(secret && domainScoped ? { domain: '' } : {}) }])}><Plus size={15} />添加</button></div>
      {secret && domainScoped && <div className="csp-domain-warning"><strong>注入需要域名</strong><span>没有域名的密钥不会注入智能体环境（设置脚本仍会收到真实值）。请添加域名，以便在任务期间使用密钥。</span></div>}
      {values.map((item) => <div className={`csp-key-value-row${secret && domainScoped ? ' has-domain' : ''}`} key={item.id}><input aria-label={`${title}名称`} placeholder="名称" value={item.key} onChange={(event) => updatePair(setValues, item.id, 'key', event.currentTarget.value)} /><input aria-label={`${title}值`} type={secret ? 'password' : 'text'} placeholder="值" value={item.value} onChange={(event) => updatePair(setValues, item.id, 'value', event.currentTarget.value)} />{secret && domainScoped && <input aria-label="密钥域名" placeholder="例如 aws.amazon.com" value={item.domain ?? ''} onChange={(event) => setValues((items) => items.map((entry) => entry.id === item.id ? { ...entry, domain: event.currentTarget.value } : entry))} />}<button type="button" aria-label={`删除${title}`} onClick={() => setValues((items) => items.filter((entry) => entry.id !== item.id))}><X size={16} /></button></div>)}
    </div>
  )
}

function SegmentedBoolean({ value, onChange, off, on }: { value: boolean; onChange: (value: boolean) => void; off: string; on: string }) {
  return <div className="csp-segmented" role="radiogroup"><button type="button" role="radio" aria-checked={!value} className={!value ? 'is-selected' : ''} onClick={() => onChange(false)}>{off}</button><button type="button" role="radio" aria-checked={value} className={value ? 'is-selected' : ''} onClick={() => onChange(true)}>{on}</button></div>
}

function SegmentedChoice({ value, onChange }: { value: 'automatic' | 'manual'; onChange: (value: 'automatic' | 'manual') => void }) {
  return <div className="csp-segmented" role="radiogroup"><button type="button" role="radio" aria-checked={value === 'automatic'} className={value === 'automatic' ? 'is-selected' : ''} onClick={() => onChange('automatic')}>自动</button><button type="button" role="radio" aria-checked={value === 'manual'} className={value === 'manual' ? 'is-selected' : ''} onClick={() => onChange('manual')}>手动</button></div>
}

function EnvironmentDetails({ environment, onNavigate, onDelete, onUpdate }: {
  environment: LocalEnvironment
  onNavigate?: (path: string) => void
  onDelete: () => void
  onUpdate: (environment: LocalEnvironment) => void
}) {
  const [dialog, setDialog] = useState<'delete' | 'reset' | null>(null)
  const [cacheReset, setCacheReset] = useState(false)
  const rows = [
    ['创建者', '你'], ['镜像', environment.image || '无镜像'], ['描述', environment.description || 'N/A'],
    ['智能体网络访问', environment.internetAccess ? (environment.networkPreset === 'all' ? '开启：不受限制' : environment.networkPreset === 'custom' ? '开启：自定义域名' : '开启：常用依赖项') : '关闭'], ['域范围密钥', environment.domainScopedSecrets ? '已启用' : '已禁用'],
    ['设置后缓存', environment.cacheEnabled ? '开启' : '关闭'], ['维护设置脚本', environment.maintenanceScript || 'N/A'],
    ['环境变量', environment.variables.length ? environment.variables.map((item) => item.key).filter(Boolean).join(', ') : '无'],
    ['密钥', environment.secrets.length ? environment.secrets.map((item) => `${item.key} (${item.domain || '任何域名'})`).join(', ') : '无'],
    ['创建时间', new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' }).format(new Date(environment.createdAt))],
    ['设置脚本', environment.setupMode === 'automatic' ? '自动' : environment.setupScript || '手动'], ['代码仓库', environment.repository || '无代码仓库'],
    ['任务数量', String(environment.taskCount)], ['共享', '私有'], ['其他编辑者', '无'],
  ]

  return (
    <div className="csp-settings-page csp-environment-detail">
      <nav className="csp-breadcrumb"><button type="button" onClick={() => navigateTo('/codex/cloud/settings/environments', onNavigate)}>环境</button><ChevronRight size={16} /><span>{environment.name}</span></nav>
      <header className="csp-detail-header">
        <div><h1>{environment.name}</h1><p>{environment.repository}</p></div>
        <div className="csp-detail-actions"><button type="button" className="csp-danger-button" onClick={() => setDialog('delete')}><Trash2 size={16} />删除</button><button type="button" className="csp-secondary-button" onClick={() => navigateTo(`/codex/cloud/settings/environment/${environment.id}/edit`, onNavigate)}><Pencil size={16} />编辑</button><button type="button" className="csp-primary-button" onClick={() => navigateTo('/codex/cloud', onNavigate)}><Play size={16} />使用此环境</button></div>
      </header>

      <div className="csp-detail-grid">{rows.map(([label, value]) => <div className="csp-detail-row" key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</div>
      <section className="csp-cache-section"><div><RotateCcw size={18} /><span><strong>重置缓存</strong><small>使当前缓存的所有容器失效</small></span></div><button type="button" className="csp-secondary-button" onClick={() => setDialog('reset')}>重置缓存</button>{cacheReset && <em>缓存已重置</em>}</section>

      {dialog && <div className="csp-modal-backdrop" role="presentation" onMouseDown={() => setDialog(null)}><div className="csp-confirm-modal" role="dialog" aria-modal="true" aria-labelledby="csp-dialog-title" onMouseDown={(event) => event.stopPropagation()}><button className="csp-modal-close" type="button" aria-label="关闭" onClick={() => setDialog(null)}><X size={18} /></button><div className={`csp-modal-icon${dialog === 'delete' ? ' is-danger' : ''}`}>{dialog === 'delete' ? <Trash2 size={20} /> : <RotateCcw size={20} />}</div><h2 id="csp-dialog-title">{dialog === 'delete' ? '删除环境' : '重置缓存'}</h2><p>{dialog === 'delete' ? '使用此环境的任务将保留，但用户无法创建后续任务。' : '当前缓存的所有容器都将失效。所有用户的缓存都将被清除。'}</p><div><button type="button" className="csp-secondary-button" onClick={() => setDialog(null)}>取消</button><button type="button" className={dialog === 'delete' ? 'csp-danger-solid-button' : 'csp-primary-button'} onClick={() => { if (dialog === 'delete') onDelete(); else { setCacheReset(true); onUpdate(environment); setDialog(null) } }}>{dialog === 'delete' ? '删除' : '重置'}</button></div></div></div>}
    </div>
  )
}

function MissingEnvironment({ onNavigate }: { onNavigate?: (path: string) => void }) {
  return <div className="csp-settings-page csp-missing-environment"><Globe2 size={28} /><h1>未找到环境</h1><button type="button" className="csp-primary-button" onClick={() => navigateTo('/codex/cloud/settings/environments', onNavigate)}>返回环境</button></div>
}

export function EnvironmentsSettingsPage({ path, isGithubConnected = false, onConnectGithub, onNavigate }: EnvironmentsSettingsPageProps) {
  void onConnectGithub
  const currentPath = path ?? window.location.pathname
  const [environments, setEnvironments] = useState<LocalEnvironment[]>(loadEnvironments)

  useEffect(() => saveEnvironments(environments), [environments])

  const editMatch = currentPath.match(/\/environment\/([^/]+)\/edit\/?$/)
  const detailMatch = currentPath.match(/\/environment\/([^/]+)\/?$/)
  const editing = editMatch ? environments.find((item) => item.id === decodeURIComponent(editMatch[1])) : undefined
  const detail = detailMatch ? environments.find((item) => item.id === decodeURIComponent(detailMatch[1])) : undefined

  const upsert = (environment: LocalEnvironment) => {
    setEnvironments((items) => items.some((item) => item.id === environment.id) ? items.map((item) => item.id === environment.id ? environment : item) : [...items, environment])
    navigateTo(`/codex/cloud/settings/environment/${environment.id}`, onNavigate)
  }

  if (/\/environment\/create\/?$/.test(currentPath)) return <EnvironmentForm mode="create" isGithubConnected={isGithubConnected} onCancel={() => navigateTo('/codex/cloud/settings/environments', onNavigate)} onSave={upsert} />
  if (editMatch) return editing ? <EnvironmentForm mode="edit" environment={editing} isGithubConnected={isGithubConnected} onCancel={() => navigateTo(`/codex/cloud/settings/environment/${editing.id}`, onNavigate)} onSave={upsert} /> : <MissingEnvironment onNavigate={onNavigate} />
  if (detailMatch) return detail ? <EnvironmentDetails environment={detail} onNavigate={onNavigate} onUpdate={upsert} onDelete={() => { setEnvironments((items) => items.filter((item) => item.id !== detail.id)); navigateTo('/codex/cloud/settings/environments', onNavigate) }} /> : <MissingEnvironment onNavigate={onNavigate} />

  return <EnvironmentList environments={environments} isGithubConnected={isGithubConnected} onNavigate={onNavigate} onTogglePin={(id) => setEnvironments((items) => items.map((item) => item.id === id ? { ...item, pinned: !item.pinned } : item))} />
}

export default GeneralSettingsPage
