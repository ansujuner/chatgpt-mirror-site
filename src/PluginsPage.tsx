import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { ALL_PLUGINS, PLUGIN_BY_ID, PLUGIN_SECTIONS, type PluginItem, type PluginSection } from './pluginsData'
import './PluginsPage.css'

const SEARCH_ONLY_PLUGINS: PluginItem[] = [
  {
    id: 'plugin_public_sales_gmail',
    name: 'Sales',
    description: 'Practical workflows for sales',
    href: '/plugins/plugin_public_sales_gmail',
    image: '/plugins-app/search-sales.svg',
  },
  {
    id: 'plugin_public_vera_gmail',
    name: 'Vera',
    description: 'Assistente AI x commercialisti',
    href: '/plugins/plugin_public_vera_gmail',
    image: '/plugins-app/search-vera.svg',
  },
  {
    id: 'plugin_public_streak_gmail',
    name: 'Streak',
    description: 'Streak CRM for Gmail',
    href: '/plugins/plugin_public_streak_gmail',
    image: '/plugins-app/search-streak.svg',
  },
]

const EXTRA_PLUGIN_BY_ID = new Map(SEARCH_ONLY_PLUGINS.map((plugin) => [plugin.id, plugin]))
const pluginByName = new Map(ALL_PLUGINS.map((plugin) => [plugin.name, plugin]))

const FEATURED_PLUGIN_NAMES = [
  'GitHub', 'Notion', 'Slack', 'Outlook Email', 'Granola', 'Fireflies', 'Canva',
  'Superhuman Mail', 'Outlook Calendar', 'PostHog', 'Plaud', 'Datadog (Preview)',
  'Shopify', 'Otter.ai', 'Atlassian Rovo', 'Teams', 'Supabase', 'Zoho CRM',
  'Figma', 'Vercel', 'HubSpot', 'Google Drive', 'Google Calendar', 'Zoom',
  'Readwise', 'BigQuery', 'Mixpanel', 'Webflow', 'Apollo.io', 'Exa',
  'Neon Postgres', 'Product Design', 'HeyGen', 'Data Analytics', 'MotherDuck',
  'Consensus', 'Elicit', 'SciSpace', 'Codex Security', 'Vanta', 'Longbridge',
  'Quartr', 'Health', 'COROS', 'Skyscanner', 'Trip.com', 'Apple Music',
  'LinkedIn', 'Indeed', 'Etsy',
]

const FEATURED_PLUGINS = FEATURED_PLUGIN_NAMES
  .map((name) => pluginByName.get(name))
  .filter((plugin): plugin is PluginItem => Boolean(plugin))

const CATEGORY_COPY: Record<string, { title: string; subtitle: string; searchLabel: string }> = {
  featured: { title: 'Popular', subtitle: '精选实用且值得关注的插件。', searchLabel: '搜索 popular 插件' },
  productivity: { title: '效率', subtitle: '帮助你更快整理工作并完成任务。', searchLabel: '搜索效率插件' },
  creativity: { title: '创意', subtitle: '探索用于设计、图像与内容创作的插件。', searchLabel: '搜索创意插件' },
  'developer-tools': { title: '开发者工具', subtitle: '连接代码、部署与开发工作流。', searchLabel: '搜索开发者工具插件' },
  'business-and-operations': { title: '业务与运营', subtitle: '让业务系统与日常运营协同工作。', searchLabel: '搜索业务与运营插件' },
  'data-and-analytics': { title: '数据与分析', subtitle: '查询、理解并使用你的数据。', searchLabel: '搜索数据与分析插件' },
  communication: { title: '沟通', subtitle: '连接邮件、会议与团队沟通。', searchLabel: '搜索沟通插件' },
  'education-and-research': { title: '教育与研究', subtitle: '查找资料并加速学习与研究。', searchLabel: '搜索教育与研究插件' },
  'scientific-research': { title: '科学研究', subtitle: '用于专业科学发现与分析的插件。', searchLabel: '搜索科学研究插件' },
  security: { title: '安全', subtitle: '检查风险并强化安全工作流。', searchLabel: '搜索安全插件' },
  finance: { title: '金融', subtitle: '研究市场并连接金融工具。', searchLabel: '搜索金融插件' },
  healthcare: { title: '医疗健康', subtitle: '连接健康、健身与医疗信息工具。', searchLabel: '搜索医疗健康插件' },
  travel: { title: '旅行', subtitle: '发现、规划并管理你的旅程。', searchLabel: '搜索旅行插件' },
  entertainment: { title: '娱乐', subtitle: '发现音乐、播客、影视与游戏。', searchLabel: '搜索娱乐插件' },
  other: { title: '其他', subtitle: '浏览更多可与 ChatGPT 配合使用的插件。', searchLabel: '搜索其他插件' },
}

function findPlugin(pluginId: string) {
  return PLUGIN_BY_ID.get(pluginId) ?? EXTRA_PLUGIN_BY_ID.get(pluginId)
}

function SearchIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20">
      <path d="m14.25 14.25 3.15 3.15M9 15.25A6.25 6.25 0 1 1 9 2.75a6.25 6.25 0 0 1 0 12.5Z" />
    </svg>
  )
}

function PlusIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20">
      <path d="M10 3.75v12.5M3.75 10h12.5" />
    </svg>
  )
}

function BackIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20">
      <path d="m11.75 4.25-5.5 5.75 5.5 5.75" />
    </svg>
  )
}

function ExternalIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20">
      <path d="M8 4.5H4.75a1.25 1.25 0 0 0-1.25 1.25v9.5a1.25 1.25 0 0 0 1.25 1.25h9.5a1.25 1.25 0 0 0 1.25-1.25V12M11 3.5h5.5V9M16.2 3.8 9.3 10.7" />
    </svg>
  )
}

type NavigateHandler = (path: string, event?: MouseEvent<HTMLElement>) => void

function PluginCard({ plugin, onNavigate, onRequestAuth, routeContext = '' }: {
  plugin: PluginItem
  onNavigate: NavigateHandler
  onRequestAuth: () => void
  routeContext?: string
}) {
  const detailHref = `/plugins/${plugin.id}${routeContext}`
  return (
    <article className="plugin-card">
      <a
        aria-label={`打开 ${plugin.name}`}
        className="plugin-card-link"
        href={detailHref}
        onClick={(event) => onNavigate(detailHref, event)}
      >
        <span className="sr-only">打开 {plugin.name}</span>
      </a>
      <div className="plugin-card-content">
        <span className="plugin-icon plugin-icon-large"><img alt={plugin.name} src={plugin.image} /></span>
        <span className="plugin-copy">
          <strong>{plugin.name}</strong>
          <small>{plugin.description}</small>
        </span>
      </div>
      <button type="button" className="plugin-add-button" aria-label={`添加 ${plugin.name}`} onClick={onRequestAuth}>
        <PlusIcon />
      </button>
    </article>
  )
}

function MoreLink({ section, onNavigate }: { section: PluginSection; onNavigate: NavigateHandler }) {
  return (
    <a className="plugins-more-link" href={`/plugins?category=${section.slug}`} onClick={(event) => onNavigate(`/plugins?category=${section.slug}`, event)}>
      <span className="plugins-more-icons" aria-hidden="true">
        {section.moreIcons.slice(0, 3).map((item, index) => (
          <span className="plugin-icon plugin-icon-small" key={`${item.name}-${index}`}><img alt="" src={item.image} /></span>
        ))}
      </span>
      <span>{section.moreLabel}</span>
    </a>
  )
}

function PluginSectionBlock({ section, onNavigate, onRequestAuth }: {
  section: PluginSection
  onNavigate: NavigateHandler
  onRequestAuth: () => void
}) {
  return (
    <section className="plugins-section" aria-labelledby={`plugin-section-${section.slug}`}>
      <h2 id={`plugin-section-${section.slug}`}>{section.title}</h2>
      <div className="plugin-grid">
        {section.cards.map((plugin) => <PluginCard key={plugin.id} plugin={plugin} onNavigate={onNavigate} onRequestAuth={onRequestAuth} />)}
      </div>
      <MoreLink section={section} onNavigate={onNavigate} />
    </section>
  )
}

function PluginsDirectory({ locationHref, onNavigate, onRequestAuth }: {
  locationHref: string
  onNavigate: NavigateHandler
  onRequestAuth: () => void
}) {
  const url = new URL(locationHref, window.location.origin)
  const initialCategory = url.searchParams.get('category') ?? ''
  const urlQuery = url.searchParams.get('q') ?? ''
  const [query, setQuery] = useState(urlQuery)
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    document.querySelector<HTMLElement>('.plugins-page-scroll')?.scrollTo({ top: 0 })
  }, [locationHref])

  useEffect(() => {
    // Keep browser back/forward navigation reflected in the controlled search field.
    // eslint-disable-next-line react/set-state-in-effect
    setQuery(urlQuery)
  }, [urlQuery])

  const normalizedQuery = query.trim().toLocaleLowerCase()
  const searchResults = useMemo(() => {
    if (!normalizedQuery) return []
    if (normalizedQuery === 'gmail') {
      const gmail = ALL_PLUGINS.find((plugin) => plugin.name === 'Gmail')
      return gmail ? [gmail, ...SEARCH_ONLY_PLUGINS] : SEARCH_ONLY_PLUGINS
    }
    return [...ALL_PLUGINS, ...SEARCH_ONLY_PLUGINS].filter((plugin) => `${plugin.name} ${plugin.description}`.toLocaleLowerCase().includes(normalizedQuery))
  }, [normalizedQuery])
  const categorySection = initialCategory ? PLUGIN_SECTIONS.find((section) => section.slug === initialCategory) : undefined
  const categoryCopy = initialCategory ? CATEGORY_COPY[initialCategory] : undefined
  const categoryPlugins = initialCategory === 'featured' ? FEATURED_PLUGINS : categorySection?.cards ?? []
  const routeContext = initialCategory
    ? `?category=${encodeURIComponent(initialCategory)}`
    : normalizedQuery ? `?q=${encodeURIComponent(query.trim())}` : ''

  const updateQuery = (nextQuery: string) => {
    setQuery(nextQuery)
    const trimmed = nextQuery.trim()
    onNavigate(trimmed ? `/plugins?q=${encodeURIComponent(trimmed)}` : '/plugins')
  }

  return (
    <div className="plugins-page-scroll" data-page="plugins-directory">
      <div className={`plugins-directory${categorySection ? ' is-category' : ''}`}>
        <div className="plugins-hero">
          <div className="plugins-heading-copy">
            {categorySection ? (
              <>
                <h1>{categoryCopy?.title ?? categorySection.title}</h1>
                <p>{categoryCopy?.subtitle ?? '浏览此类别中的热门插件。'}</p>
              </>
            ) : (
              <>
                <h1>插件</h1>
                <p>在你常用的工具中与 ChatGPT 协作。</p>
              </>
            )}
          </div>
          <form className="plugins-search" role="search" onSubmit={(event) => event.preventDefault()}>
            <SearchIcon />
            <input ref={searchRef} aria-label="搜索插件" autoComplete="off" id="plugin-search" name="plugin-search" placeholder={categoryCopy?.searchLabel ?? '搜索插件'} type="search" value={query} onChange={(event) => updateQuery(event.currentTarget.value)} />
            {query && <button type="button" aria-label="清除搜索" onClick={() => { updateQuery(''); window.setTimeout(() => searchRef.current?.focus(), 0) }}>×</button>}
          </form>
        </div>

        {normalizedQuery ? (
          <section className="plugins-section plugins-search-results" aria-live="polite">
            <h2>{searchResults.length ? '公开' : '未找到插件'}</h2>
            {searchResults.length > 0 ? (
              <div className="plugin-grid">
                {searchResults.map((plugin) => <PluginCard key={plugin.id} plugin={plugin} routeContext={routeContext} onNavigate={onNavigate} onRequestAuth={onRequestAuth} />)}
              </div>
            ) : <p className="plugins-empty-copy">请尝试搜索其他名称或关键词。</p>}
          </section>
        ) : categorySection ? (
          <section className="plugins-section plugins-category-results">
            <div className="plugin-grid">
              {categoryPlugins.map((plugin) => <PluginCard key={plugin.id} plugin={plugin} routeContext={routeContext} onNavigate={onNavigate} onRequestAuth={onRequestAuth} />)}
            </div>
          </section>
        ) : PLUGIN_SECTIONS.map((section) => (
          <PluginSectionBlock key={section.slug} section={section} onNavigate={onNavigate} onRequestAuth={onRequestAuth} />
        ))}
      </div>
    </div>
  )
}

function PluginDetail({ pluginId, onNavigate, onRequestAuth }: {
  pluginId: string
  onNavigate: NavigateHandler
  onRequestAuth: () => void
}) {
  const plugin = findPlugin(pluginId)

  useEffect(() => {
    document.querySelector<HTMLElement>('.plugins-page-scroll')?.scrollTo({ top: 0 })
  }, [pluginId])

  if (!plugin) {
    return (
      <div className="plugins-page-scroll plugin-detail-scroll">
        <div className="plugin-detail plugin-detail-missing">
          <h1>找不到此插件</h1>
          <p>该插件可能已被移动或暂时不可用。</p>
          <button type="button" onClick={() => onNavigate('/plugins')}>返回插件</button>
        </div>
      </div>
    )
  }

  const isGmail = plugin.name === 'Gmail'
  const prompts = isGmail ? [
    'Summarize the last 5 messages in [subject line] and capture decisions, open questions, and what I should follow up on next',
    'Draft a polite, firm reply to our auditor’s latest email, with a short bullet list of exactly what we’ll provide',
    'Turn my latest customer escalation thread into an action tracker with owners, deadlines, and an email reference for each item',
  ] : [
    `Find the most useful information in ${plugin.name} for my current project`,
    `Create a concise update using the latest context from ${plugin.name}`,
    `Help me organize the next steps and follow-ups in ${plugin.name}`,
  ]
  const description = isGmail
    ? 'Use Gmail to summarize inbox activity, draft replies, and organize email threads through the connected Gmail app.'
    : `Use ${plugin.name} with ChatGPT to find information, take action, and bring useful context into your conversation.`
  const category = PLUGIN_SECTIONS.find((section) => section.cards.some((item) => item.id === plugin.id))?.title ?? '插件'

  return (
    <div className="plugins-page-scroll plugin-detail-scroll" data-page="plugin-detail">
      <div className="plugin-detail">
        <section className="plugin-detail-hero">
          <span className="plugin-icon plugin-detail-icon"><img alt={plugin.name} src={plugin.image} /></span>
          <div className="plugin-detail-title-row">
            <div>
              <h1>{plugin.name}</h1>
              <p>{plugin.description}</p>
            </div>
            <button className="plugin-detail-add" type="button" onClick={onRequestAuth}>安装插件</button>
          </div>
          <div className="plugin-detail-showcase" aria-label={`${plugin.name} 示例提示`}>
            <div className="plugin-detail-prompt-list">
              {prompts.map((prompt) => (
                <button type="button" key={prompt} onClick={onRequestAuth}>
                  <span><strong>@{plugin.name}</strong> {prompt}</span><i aria-hidden="true">→</i>
                </button>
              ))}
            </div>
          </div>
          <p className="plugin-detail-description">{description}</p>
        </section>

        <section className="plugin-detail-section plugin-information">
          <h2>信息</h2>
          <dl>
            <div><dt>功能</dt><dd>{isGmail ? 'Interactive, Write' : 'Interactive'}</dd></div>
            <div><dt>开发人员</dt><dd>{isGmail ? 'OpenAI' : plugin.name}</dd></div>
            <div><dt>类别</dt><dd>{isGmail ? 'Communication' : category}</dd></div>
            <div className="plugin-information-link-row"><dt>网站</dt><dd><a aria-label={`${plugin.name} 网站`} href={`/plugins/${plugin.id}/website`} onClick={(event) => onNavigate(`/plugins/${plugin.id}/website`, event)}><ExternalIcon /></a></dd></div>
            <div><dt>版本</dt><dd>{isGmail ? '0.1.10' : '1.0.0'}</dd></div>
            <div className="plugin-information-link-row"><dt>隐私</dt><dd><a aria-label={`${plugin.name} 隐私政策`} href={`/plugins/${plugin.id}/privacy`} onClick={(event) => onNavigate(`/plugins/${plugin.id}/privacy`, event)}><ExternalIcon /></a></dd></div>
            <div className="plugin-information-link-row"><dt>服务条款</dt><dd><a aria-label={`${plugin.name} 服务条款`} href={`/plugins/${plugin.id}/terms`} onClick={(event) => onNavigate(`/plugins/${plugin.id}/terms`, event)}><ExternalIcon /></a></dd></div>
          </dl>
        </section>
      </div>
    </div>
  )
}

function PluginResourcePage({ pluginId, kind, onNavigate }: {
  pluginId: string
  kind: 'website' | 'privacy' | 'terms'
  onNavigate: NavigateHandler
}) {
  const plugin = findPlugin(pluginId)
  if (!plugin) return <PluginDetail pluginId={pluginId} onNavigate={onNavigate} onRequestAuth={() => undefined} />
  const title = kind === 'website' ? plugin.name : kind === 'privacy' ? '隐私政策' : '服务条款'
  return (
    <div className="plugins-page-scroll plugin-resource-scroll" data-page={`plugin-${kind}`}>
      <article className="plugin-resource-page">
        <a href={`/plugins/${plugin.id}`} onClick={(event) => onNavigate(`/plugins/${plugin.id}`, event)}><BackIcon /><span>返回 {plugin.name}</span></a>
        <header>
          <span className="plugin-icon plugin-detail-icon"><img alt={plugin.name} src={plugin.image} /></span>
          <div><p>{plugin.name}</p><h1>{title}</h1></div>
        </header>
        {kind === 'website' ? (
          <>
            <h2>借助 {plugin.name} 在 ChatGPT 中完成更多工作</h2>
            <p>{plugin.description}。连接此插件后，你可以在对话中查找相关信息、整理上下文并执行受支持的操作。</p>
            <section><h3>关于此插件</h3><p>此本地复刻页面保留了原目标的界面与导航结构；所有操作均停留在本地演示环境。</p></section>
          </>
        ) : (
          <>
            <p className="plugin-resource-updated">最后更新：2026 年 8 月</p>
            <section><h2>{kind === 'privacy' ? '我们如何处理数据' : '使用本插件'}</h2><p>{kind === 'privacy' ? `只有在你明确连接并使用 ${plugin.name} 时，相关请求所需的信息才会被发送给插件。你可以随时断开连接。` : `使用 ${plugin.name} 即表示你同意遵守适用规则，并仅在你有权访问相关内容时调用插件。`}</p></section>
            <section><h2>{kind === 'privacy' ? '你的选择' : '可用性与变更'}</h2><p>{kind === 'privacy' ? '你可以选择不连接插件，也可以在设置中撤销授权。此纯前端演示不会上传或保存任何账户数据。' : '插件能力可能会发生变化。此纯前端复刻不提供真实外部服务，也不会代表你执行交易或提交数据。'}</p></section>
          </>
        )}
      </article>
    </div>
  )
}

export default function PluginsPage({ locationHref, onNavigate, onRequestAuth }: {
  locationHref: string
  onNavigate: NavigateHandler
  onRequestAuth: () => void
}) {
  const url = new URL(locationHref, window.location.origin)
  const resourceMatch = url.pathname.match(/^\/plugins\/([^/]+)\/(website|privacy|terms)\/?$/)
  if (resourceMatch) {
    return <PluginResourcePage pluginId={decodeURIComponent(resourceMatch[1])} kind={resourceMatch[2] as 'website' | 'privacy' | 'terms'} onNavigate={onNavigate} />
  }
  const detailMatch = url.pathname.match(/^\/plugins\/([^/]+)\/?$/)
  if (detailMatch) {
    return <PluginDetail pluginId={decodeURIComponent(detailMatch[1])} onNavigate={onNavigate} onRequestAuth={onRequestAuth} />
  }
  return <PluginsDirectory locationHref={locationHref} onNavigate={onNavigate} onRequestAuth={onRequestAuth} />
}
