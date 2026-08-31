import { useEffect, useState, type FormEvent, type MouseEvent } from 'react'
import './LegalPage.css'

type LegalNavigate = (path: string, event?: MouseEvent<HTMLElement>) => void

const TERMS_SECTIONS = [
  { heading: '关于我们', paragraphs: ['OpenAI 的使命是确保通用人工智能造福全人类。我们的服务由 OpenAI OpCo, LLC 及其关联公司提供。', '有关如何联系我们以及适用于您所在地区的实体信息，请参阅本条款末尾的一般条款。'] },
  { heading: '注册和访问', paragraphs: ['您必须年满 13 周岁，或达到您所在国家/地区同意使用服务的最低年龄。如果您未满 18 周岁，必须获得父母或法定监护人的许可。', '您需要提供准确、完整的信息来注册账户。您对账户下发生的活动负责，不得共享账户凭据或让他人使用您的账户。'] },
  { heading: '使用我们的服务', paragraphs: ['在遵守本条款的前提下，您可以访问和使用我们的服务。您必须遵守所有适用法律以及我们提供的任何政策、文档或指南。', '您不得利用服务从事非法、有害或滥用活动，也不得干扰、破坏或规避服务中的安全措施或使用限制。'] },
  { heading: '内容', paragraphs: ['您可以向服务提供输入，并根据输入接收输出。您保留对输入的所有权，并在法律允许的范围内拥有输出。', '由于机器学习的性质，输出可能不准确或不唯一。使用或分享输出前，您应当根据具体用途进行人工核验。'] },
  { heading: '我们的知识产权', paragraphs: ['OpenAI 及其关联方拥有服务中的全部权利、所有权和利益。OpenAI 名称、标识和其他品牌元素受适用法律保护。'] },
  { heading: '付费账户', paragraphs: ['如果您购买服务，我们会按照购买页面显示的价格和计费周期收费。除法律另有要求外，费用通常不予退还。您可以按照账户设置中的说明取消订阅。'] },
  { heading: '终止和暂停', paragraphs: ['如果您违反本条款、法律要求我们采取行动，或您的使用可能给 OpenAI、用户或第三方带来风险，我们可能限制、暂停或终止您对服务的访问。'] },
  { heading: '服务中止', paragraphs: ['我们可能决定停止某项服务。如果发生这种情况，我们会尽可能提前通知，并为预付但未使用的服务提供适用的退款。', '服务可能因维护、安全事件或我们无法合理控制的情况而暂时不可用。'] },
  { heading: '免责声明', paragraphs: ['服务按“原样”提供。除法律禁止的情形外，我们不作任何明示或默示保证，包括对适销性、特定用途适用性和不侵权的保证。', '输出由人工智能生成，可能不完整、不准确或令人不适。您应独立判断输出是否适合您的用途。'] },
  { heading: '责任限制', paragraphs: ['在法律允许的最大范围内，OpenAI 不对任何间接、附带、特殊、后果性或惩罚性损害负责，也不对利润、商誉、使用或数据损失负责。', '某些司法管辖区不允许部分限制，因此这些限制可能不完全适用于您。'] },
  { heading: '赔偿责任', paragraphs: ['如果您代表企业或组织使用服务，该组织同意就因其使用服务或违反本条款产生的第三方索赔，在适用法律允许范围内对 OpenAI 作出赔偿。'] },
  { heading: '争议解决', paragraphs: ['在提起正式程序前，双方同意尝试非正式解决争议。适用仲裁约定时，争议将按照本条款所述规则通过具有约束力的个人仲裁解决。', '您可以在法律规定的期限内按照说明选择退出仲裁。小额索赔和某些禁令救济不受该仲裁约定限制。'] },
  { heading: '版权投诉', paragraphs: ['如果您认为自己的知识产权受到侵犯，请向指定代理提交包含作品、侵权位置、联系方式和诚信声明的通知。', '我们可能删除涉嫌侵权内容，并在适当情况下终止重复侵权者的账户。'] },
  { heading: '一般条款', paragraphs: ['我们可能更新本条款以反映服务或法律变化。重要变更生效前，我们会通过适当方式通知您。继续使用服务表示您接受更新后的条款。', '如果本条款某一部分不可执行，其余部分仍然有效。本条款构成您与 OpenAI 就个人服务达成的完整协议。'] },
]

const PRIVACY_SECTIONS = [
  { heading: '我们收集的个人数据', paragraphs: ['我们收集您直接提供的信息，例如账户资料、您提交的内容、付款信息以及您与我们的通信。', '当您使用服务时，我们还会收集日志、设备、使用情况和大致位置信息，以运行、保护和改进服务。'] },
  { heading: '我们如何使用个人数据', paragraphs: ['我们使用个人数据来提供和维护服务、处理交易、个性化体验、预防欺诈与滥用、遵守法律义务，并与您沟通。', '对于面向个人的服务，您可以通过数据控制选择是否允许新内容用于改进模型。'] },
  { heading: '披露个人数据', paragraphs: ['我们可能与代表我们处理数据的供应商、关联公司、企业账户管理员以及法律要求的机构分享必要信息。我们不会出售个人数据。'] },
  { heading: '数据保留', paragraphs: ['我们仅在提供服务、解决争议、保障安全和履行法律义务所需的期限内保留个人数据。不同类型的数据可能具有不同保留期限。'] },
  { heading: '数据控制', paragraphs: ['您可以通过 ChatGPT 设置控制聊天记录、模型改进、记忆和已连接应用。您也可以使用隐私门户提出数据请求。', '临时聊天不会出现在历史记录中，也不会用于改进模型，但可能会在有限时间内为安全目的保留。'] },
  { heading: '您的权利', paragraphs: ['根据您所在地区的法律，您可以请求访问、更正、删除、转移个人数据，或反对和限制某些处理。您也可以在 ChatGPT 设置中导出或删除数据。'] },
  { heading: '儿童', paragraphs: ['我们的服务不面向 13 周岁以下儿童。我们不会故意收集低于适用数字同意年龄的儿童个人数据。', '如果您认为儿童在未经适当同意的情况下向我们提供了个人数据，请通过帮助中心联系我们。'] },
  { heading: '安全', paragraphs: ['我们采用合理的技术、管理和组织措施来保护个人数据，但任何互联网传输或存储方式都无法保证绝对安全。', '您应使用强密码并保护账户凭据，在发现可疑活动时及时通知我们。'] },
  { heading: '隐私政策的更改', paragraphs: ['我们可能不时更新本隐私政策。更新版本会发布在本页面，并在适当情况下通过额外方式通知您。'] },
  { heading: '数据控制者', paragraphs: ['负责处理您个人数据的 OpenAI 实体取决于您居住的地区和所使用的服务。适用实体与联系地址会在本政策中列明。'] },
  { heading: '联系我们', paragraphs: ['如果您对本隐私政策有疑问，可以通过本地帮助中心中的支持入口联系我们。'] },
  { heading: '实用资源', paragraphs: ['您可以访问帮助中心的数据控制、账户删除、数据导出和企业隐私页面，了解管理个人数据的更多方式。'] },
]

function OpenAIHeader({ onNavigate }: { onNavigate: LegalNavigate }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [navMenu, setNavMenu] = useState<'products' | 'login' | null>(null)
  const [query, setQuery] = useState('')
  const submitSearch = (event: FormEvent) => {
    event.preventDefault()
    if (!query.trim()) return
    setSearchOpen(false)
    onNavigate(`/openai/search?q=${encodeURIComponent(query.trim())}`)
  }
  return (
    <>
      <header className="openai-site-header">
        <a className="openai-site-logo" href="/openai" onClick={(event) => onNavigate('/openai', event)}>OpenAI</a>
        <nav className="openai-desktop-nav" aria-label="OpenAI 主导航">
          <a href="/openai/research" onClick={(event) => onNavigate('/openai/research', event)}>研究</a>
          <button type="button" aria-haspopup="menu" aria-expanded={navMenu === 'products'} onClick={() => { setSearchOpen(false); setNavMenu((current) => current === 'products' ? null : 'products') }}>产品</button>
          <a href="/openai/business" onClick={(event) => onNavigate('/openai/business', event)}>企业</a>
          <a href="/openai/developers" onClick={(event) => onNavigate('/openai/developers', event)}>开发人员</a>
          <a href="/openai/company" onClick={(event) => onNavigate('/openai/company', event)}>公司</a>
          <a href="/openai/foundation" onClick={(event) => onNavigate('/openai/foundation', event)}>基金会</a>
        </nav>
        <div className="openai-header-actions">
          <button className="openai-search-trigger" type="button" aria-label={searchOpen ? '关闭搜索' : '打开搜索'} aria-expanded={searchOpen} onClick={() => { setSearchOpen((open) => !open); setNavMenu(null); setMenuOpen(false) }}><svg aria-hidden="true" viewBox="0 0 20 20">{searchOpen ? <path d="M4 4 16 16M16 4 4 16" /> : <><circle cx="8.7" cy="8.7" r="5.4"/><path d="m12.8 12.8 3.8 3.8"/></>}</svg></button>
          <button className="openai-login-link" type="button" aria-haspopup="menu" aria-expanded={navMenu === 'login'} onClick={() => { setSearchOpen(false); setNavMenu((current) => current === 'login' ? null : 'login') }}>登录⌄</button>
          <a className="openai-chatgpt-link" href="/" onClick={(event) => onNavigate('/', event)}>试用 ChatGPT ↗</a>
          <button className="openai-menu-trigger" type="button" aria-label={menuOpen ? '关闭菜单' : '打开菜单'} aria-expanded={menuOpen} onClick={() => { setSearchOpen(false); setNavMenu(null); setMenuOpen((open) => !open) }}><svg aria-hidden="true" viewBox="0 0 20 20"><rect x="3.5" y="4" width="13" height="12" rx="3"/><path d="M10 4v12"/></svg></button>
        </div>
      </header>
      {navMenu === 'products' && <div className="openai-product-menu" role="menu"><a href="/" onClick={(event) => { setNavMenu(null); onNavigate('/', event) }}>ChatGPT</a><a href="/images" onClick={(event) => { setNavMenu(null); onNavigate('/images', event) }}>图像</a><a href="/plugins" onClick={(event) => { setNavMenu(null); onNavigate('/plugins', event) }}>插件</a><a href="/openai/products?product=sora" onClick={(event) => { setNavMenu(null); onNavigate('/openai/products?product=sora', event) }}>Sora</a><a href="/openai/developers" onClick={(event) => { setNavMenu(null); onNavigate('/openai/developers', event) }}>API 平台</a></div>}
      {navMenu === 'login' && <div className="openai-login-menu" role="menu"><a href="/auth/email?callback_path=%2Fopenai" onClick={(event) => { setNavMenu(null); onNavigate('/auth/email?callback_path=%2Fopenai', event) }}>ChatGPT</a><a href="/auth/email?callback_path=%2Fopenai%2Fdevelopers" onClick={(event) => { setNavMenu(null); onNavigate('/auth/email?callback_path=%2Fopenai%2Fdevelopers', event) }}>API 平台</a></div>}
      {searchOpen && <form className="openai-search-panel" role="search" onSubmit={submitSearch}><div className="openai-search-box"><input autoFocus aria-label="搜索 OpenAI" placeholder="搜索" value={query} onChange={(event) => setQuery(event.currentTarget.value)} /><button type="submit" disabled={!query.trim()}>搜索</button><button type="button" aria-label="关闭搜索" onClick={() => setSearchOpen(false)}>×</button></div><div className="openai-search-prompts"><p>热门搜索</p>{['咨询 OpenAI 研究相关问题','咨询定价相关问题','咨询职业机会相关问题','就 OpenAI 提问'].map((prompt) => <button key={prompt} type="button" onClick={() => { setQuery(prompt); setSearchOpen(false); onNavigate(`/openai/search?q=${encodeURIComponent(prompt)}`) }}>{prompt}<span>↗</span></button>)}</div></form>}
      {menuOpen && <aside className="openai-mobile-menu">
        <nav>{[['研究','research'],['产品','products'],['企业','business'],['开发人员','developers'],['公司','company'],['基金会','foundation']].map(([label, slug]) => <a key={slug} href={`/openai/${slug}`} onClick={(event) => { setMenuOpen(false); onNavigate(`/openai/${slug}`, event) }}>{label}<span>↗</span></a>)}</nav>
        <a className="openai-mobile-login" href="/auth/email?callback_path=%2Fopenai" onClick={(event) => onNavigate('/auth/email?callback_path=%2Fopenai', event)}>登录</a>
        <a className="openai-mobile-chatgpt" href="/" onClick={(event) => onNavigate('/', event)}>试用 ChatGPT ↗</a>
      </aside>}
    </>
  )
}

function CookieBanner({ onNavigate }: { onNavigate: LegalNavigate }) {
  const [visible, setVisible] = useState(() => localStorage.getItem('openai-cookie-choice') === null)
  const [manageOpen, setManageOpen] = useState(false)
  const [analytics, setAnalytics] = useState(false)
  const [marketing, setMarketing] = useState(false)
  const dismiss = (choice: string) => {
    localStorage.setItem('openai-cookie-choice', choice)
    setVisible(false)
  }
  useEffect(() => {
    const openManager = () => { setVisible(true); setManageOpen(true) }
    window.addEventListener('openai:cookie-manage', openManager)
    return () => window.removeEventListener('openai:cookie-manage', openManager)
  }, [])
  if (!visible) return null
  return (
    <>
      <aside className="legal-cookie-banner" aria-label="Cookie 设置">
        <div><strong>我们使用 Cookie</strong><p>我们使用 Cookie 来确保网站正常运作、了解服务使用情况并支持营销推广。访问 <button type="button" onClick={() => setManageOpen(true)}>管理 Cookie</button> 可随时更改偏好设置。查看我们的 <a href="/openai/policies/cookies" onClick={(event) => onNavigate('/openai/policies/cookies', event)}>Cookie 政策</a>以了解详情。</p></div>
        <nav><button type="button" onClick={() => setManageOpen(true)}>管理 Cookie</button><button type="button" onClick={() => dismiss('necessary')}>拒绝非必要</button><button type="button" onClick={() => dismiss('all')}>全部接受</button></nav>
      </aside>
      {manageOpen && <div className="legal-cookie-modal-layer" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setManageOpen(false) }}><section className="legal-cookie-modal" role="dialog" aria-modal="true" aria-labelledby="cookie-title"><header><h2 id="cookie-title">Cookie 偏好设置</h2><button type="button" aria-label="关闭" onClick={() => setManageOpen(false)}>×</button></header><p>你可以选择允许哪些非必要 Cookie。</p><label><span><strong>必要 Cookie</strong><small>网站运行所必需，无法关闭。</small></span><input type="checkbox" checked disabled /></label><label><span><strong>分析 Cookie</strong><small>帮助我们了解页面和功能的使用情况。</small></span><input type="checkbox" role="switch" checked={analytics} onChange={(event) => setAnalytics(event.currentTarget.checked)} /></label><label><span><strong>营销 Cookie</strong><small>用于衡量并个性化营销内容。</small></span><input type="checkbox" role="switch" checked={marketing} onChange={(event) => setMarketing(event.currentTarget.checked)} /></label><footer><button type="button" onClick={() => { setManageOpen(false); dismiss(`custom:${Number(analytics)}${Number(marketing)}`) }}>保存设置</button><button type="button" onClick={() => dismiss('all')}>全部接受</button></footer></section></div>}
    </>
  )
}

function LegalDocument({ kind, locationHref, onNavigate }: { kind: 'terms' | 'privacy'; locationHref: string; onNavigate: LegalNavigate }) {
  const isTerms = kind === 'terms'
  const sections = isTerms ? TERMS_SECTIONS : PRIVACY_SECTIONS
  const params = new URL(locationHref, window.location.origin).searchParams
  const previousTerms = isTerms && params.get('version') === 'previous'
  const privacyRegion = !isTerms && (params.get('region') === 'eea' || params.get('region') === 'korea')
    ? params.get('region') as 'eea' | 'korea'
    : null
  const versionLabel = previousTerms
    ? '先前版本 · Published: 2024年12月11日'
    : privacyRegion === 'eea'
      ? '欧洲经济区、英国和瑞士版本 · Updated: 2026年7月30日'
      : privacyRegion === 'korea'
        ? '韩国附录 · Updated: 2026年7月30日'
        : isTerms ? 'Published: 2026年1月1日' : 'Updated: 2026年7月30日'
  return (
    <>
      <OpenAIHeader onNavigate={onNavigate} />
      <main className="legal-document">
        <label className="legal-language-select"><span className="sr-only">语言</span><select defaultValue="zh-CN"><option value="zh-CN">中文 (中国)</option><option value="en">English</option><option value="ja">日本語</option><option value="ko">한국어</option></select></label>
        <header className="legal-document-title"><p className={previousTerms || privacyRegion ? 'is-version-label' : undefined}>{versionLabel}</p><h1>{isTerms ? '使用条款' : '隐私政策'}</h1></header>
        <article className="legal-document-body">
          {isTerms ? <>
            {previousTerms
              ? <><p className="legal-regional-note"><strong>先前版本</strong><span>这是 2024 年 12 月 11 日生效的存档版本。</span></p><p>生效日期：2024 年 12 月 11 日（<a href="/terms" onClick={(event) => onNavigate('/terms', event)}>查看当前版本</a>）</p></>
              : <p>生效日期： 2026 年 1 月 1 日（<a href={`/${kind}?version=previous`} onClick={(event) => onNavigate(`/${kind}?version=previous`, event)}>先前版本</a>）</p>}
            <p>感谢您使用 OpenAI!</p>
            <p>本《使用条款》适用于您使用 ChatGPT、DALL·E 及 OpenAI 其他个人服务的行为，包括相关软件应用程序及网站（统称“服务”）。本条款构成您与特拉华州公司 OpenAI OpCo, LLC 之间的协议，且包含我们的服务条款以及通过仲裁解决争议的重要约定。您使用我们的服务，即视为您同意本条款的全部内容。</p>
            <p>如果您居住在欧洲经济区、瑞士或英国，您对服务的使用行为受本条款约束。</p>
            <p>我们的<a href="/terms" onClick={(event) => onNavigate('/terms', event)}>商业条款</a>适用于 ChatGPT Enterprise、我们的 API 以及面向企业与开发人员的其他服务。</p>
            <p>我们的<a href="/privacy" onClick={(event) => onNavigate('/privacy', event)}>隐私政策</a>阐述了我们收集和使用个人信息的具体方式。该隐私政策虽不构成本条款的组成部分，但属于您应仔细阅读的重要文件。</p>
          </> : <>
            {privacyRegion === 'eea' && <p className="legal-regional-note"><strong>欧洲经济区、英国和瑞士版本</strong><span>本地区版本说明适用于这些地区的个人，并补充数据保护权利和跨境传输信息。</span></p>}
            {privacyRegion === 'korea' && <p className="legal-regional-note"><strong>韩国附录</strong><span>本附录包含适用于韩国用户的数据处理、保留期限和本地权利说明。</span></p>}
            {privacyRegion
              ? <p><a href="/privacy" onClick={(event) => onNavigate('/privacy', event)}>返回全球隐私政策</a></p>
              : <><p>如果您位于欧洲经济区、英国或瑞士，可以阅读<a href="/privacy?region=eea" onClick={(event) => onNavigate('/privacy?region=eea', event)}>此版本</a>的隐私政策。</p><p>如果您位于韩国，请参阅<a href="/privacy?region=korea" onClick={(event) => onNavigate('/privacy?region=korea', event)}>韩国附录</a>。</p></>}
            <p>在 OpenAI，我们的使命是确保通用人工智能惠及全人类。我们打造了 ChatGPT 等工具，旨在帮助人们学习、创作并解决问题。OpenAI（连同我们的关联公司，统称为“OpenAI”、“我们”或“我方”）重视您的隐私，并坚定致力于保障我们从您处获得或与您相关的任何信息的安全。本隐私政策阐明了当您使用我们的网站、应用程序和服务（统称为“服务”）时，我们如何收集与您相关的个人数据以及如何使用这些数据。</p>
            <p>本隐私政策不适用于我们代表企业级产品客户处理的内容（例如通过 API 处理的客户数据）。我们对该数据的使用受相关客户协议约束。</p>
          </>}
          {sections.map((section, index) => <section key={section.heading} id={`legal-section-${index + 1}`}><h2>{isTerms ? section.heading : `${index + 1}. ${section.heading}`}</h2>{section.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}</section>)}
        </article>
      </main>
      <footer className="openai-site-footer"><a href="/openai" onClick={(event) => onNavigate('/openai', event)}>OpenAI</a><div className="openai-footer-columns"><nav><strong>OpenAI</strong><a href="/openai/research" onClick={(event) => onNavigate('/openai/research', event)}>研究</a><a href="/openai/company" onClick={(event) => onNavigate('/openai/company', event)}>安全</a><a href="/openai/developers" onClick={(event) => onNavigate('/openai/developers', event)}>API</a><a href="/openai/company?section=news" onClick={(event) => onNavigate('/openai/company?section=news', event)}>新闻</a></nav><nav><strong>条款与政策</strong><a href="/terms" onClick={(event) => onNavigate('/terms', event)}>使用条款</a><a href="/privacy" onClick={(event) => onNavigate('/privacy', event)}>隐私政策</a><a href="/openai/policies/usage" onClick={(event) => onNavigate('/openai/policies/usage', event)}>使用政策</a><a href="/help" onClick={(event) => onNavigate('/help', event)}>其他政策与帮助</a></nav></div><div className="openai-footer-meta"><span>OpenAI © 2015–2026</span><button type="button" onClick={() => window.dispatchEvent(new Event('openai:cookie-manage'))}>管理 Cookie</button><div><a href="/openai/social/x" onClick={(event) => onNavigate('/openai/social/x', event)}>X</a><a href="/openai/social/youtube" onClick={(event) => onNavigate('/openai/social/youtube', event)}>YouTube</a><a href="/openai/social/github" onClick={(event) => onNavigate('/openai/social/github', event)}>GitHub</a></div></div></footer>
      <CookieBanner onNavigate={onNavigate} />
    </>
  )
}

type MarketingCopy = { eyebrow: string; title: string; body: string }

const MARKETING_COPY: Record<string, MarketingCopy> = {
  '/openai': { eyebrow: 'OpenAI', title: '让人工智能造福全人类', body: '我们研究和部署人工智能，帮助人们解决复杂问题、发挥创造力并创造新的机会。' },
  '/openai/research': { eyebrow: '研究', title: '推进智能前沿', body: '探索推理、多模态、安全和现实世界应用方面的最新研究。' },
  '/openai/products': { eyebrow: '产品', title: '为每个人打造的智能工具', body: '了解 ChatGPT、Sora、API 以及帮助个人和团队完成工作的产品。' },
  '/openai/business': { eyebrow: '企业', title: '把 AI 带入你的组织', body: '通过面向团队和企业的安全、可管理工具提升整个组织的工作效率。' },
  '/openai/developers': { eyebrow: '开发人员', title: '使用 OpenAI 平台进行构建', body: '通过模型、工具和开发者资源，将强大的 AI 体验带入你的产品。' },
  '/openai/company': { eyebrow: '公司', title: '构建安全且有益的人工智能', body: '了解我们的使命、结构、团队以及推进负责任 AI 的方式。' },
  '/openai/foundation': { eyebrow: '基金会', title: '支持广泛共享的进步', body: '资助研究、教育和社区项目，让人工智能的益处惠及更多人。' },
}

const MARKETING_TITLES: Record<string, string> = {
  '/openai/academy/events': 'OpenAI 学院活动',
  '/openai/api': '使用 OpenAI API 构建',
  '/openai/apps/canva': '在 ChatGPT 中使用 Canva',
  '/openai/apps/powerpoint': '在 ChatGPT 中使用 PowerPoint',
  '/openai/apps/spotify': '在 ChatGPT 中使用 Spotify',
  '/openai/business/ai-for-data-science-analytics': '面向数据科学与分析的 AI',
  '/openai/business/ai-for-engineering': '面向工程团队的 AI',
  '/openai/business/ai-for-finance': '面向金融团队的 AI',
  '/openai/business/ai-for-product-management': '面向产品管理的 AI',
  '/openai/business/ai-for-sales-marketing': '面向销售与营销的 AI',
  '/openai/business/education': '面向教育机构的 ChatGPT',
  '/openai/business/enterprise': 'ChatGPT Enterprise',
  '/openai/codex': 'Codex：软件开发智能体',
  '/openai/codex/enterprise': '面向企业的 Codex',
  '/openai/codex/pricing': 'Codex 定价',
  '/openai/college-students': '面向大学生的 ChatGPT',
  '/openai/contact-sales': '联系销售团队',
  '/openai/developers/codex': '使用 Codex 开发',
  '/openai/download': '下载 ChatGPT',
  '/openai/enterprise-privacy': '企业隐私与数据保护',
  '/openai/features/chat-with-pdfs': '与 PDF 对话',
  '/openai/features/deep-research': '深度研究',
  '/openai/features/study-mode': '学习模式',
  '/openai/features/voice': '语音模式',
  '/openai/features/voice-with-video': '视频与语音对话',
  '/openai/import-to-chatgpt': '导入到 ChatGPT',
  '/openai/merchants': '面向商家的 ChatGPT',
  '/openai/news': 'OpenAI 新闻',
  '/openai/overview': 'ChatGPT 概览',
  '/openai/parent-resources': '家长资源',
  '/openai/plans/free': 'ChatGPT 免费版',
  '/openai/plans/go': 'ChatGPT Go',
  '/openai/plans/plus': 'ChatGPT Plus',
  '/openai/plans/pro': 'ChatGPT Pro',
  '/openai/policies': '政策与条款',
  '/openai/policies/cookies': 'Cookie 政策',
  '/openai/policies/usage': '使用政策',
  '/openai/policies/usage-policies': 'OpenAI 使用政策',
  '/openai/remote': '远程工作与协作',
  '/openai/safety': '安全地构建 AI',
  '/openai/shopping': '使用 ChatGPT 购物',
  '/openai/social/github': 'OpenAI GitHub',
  '/openai/social/instagram': 'OpenAI Instagram',
  '/openai/social/linkedin': 'OpenAI LinkedIn',
  '/openai/social/tiktok': 'OpenAI TikTok',
  '/openai/social/x': 'OpenAI on X',
  '/openai/social/youtube': 'OpenAI YouTube',
  '/openai/use-cases/chat-with-presentations': '与演示文稿对话',
  '/openai/use-cases/chat-with-spreadsheets': '与电子表格对话',
  '/openai/use-cases/fitness-wellness-and-health': '健身、健康与生活方式',
  '/openai/use-cases/money-and-finances': '资金与财务',
  '/openai/use-cases/recipes-cooking': '食谱与烹饪',
  '/openai/use-cases/science-medicine': '科学与医学',
  '/openai/use-cases/students': '面向学生的 ChatGPT',
  '/openai/use-cases/teachers': '面向教师的 ChatGPT',
  '/openai/use-cases/travel-and-exploration': '旅行与探索',
  '/openai/use-cases/university-educators': '面向高校教育工作者的 ChatGPT',
  '/openai/use-cases/veterans': '面向退伍军人的资源',
  '/openai/work': '使用 ChatGPT 工作',
}

const SECTION_META: Record<string, { eyebrow: string; body: string }> = {
  academy: { eyebrow: 'OpenAI 学院', body: '参加活动、课程和实践交流，学习如何负责任地使用人工智能。' },
  api: { eyebrow: 'API 平台', body: '使用模型、工具和开发资源，为你的产品构建可靠的 AI 体验。' },
  apps: { eyebrow: 'ChatGPT 应用', body: '把你常用的应用带入 ChatGPT，在同一个对话中查找上下文并完成工作。' },
  business: { eyebrow: '企业', body: '为团队提供安全、可管理的 AI 工作空间，并把智能能力融入日常业务。' },
  codex: { eyebrow: 'Codex', body: '借助能够理解代码库、执行任务并与你协作的软件开发智能体，更快交付软件。' },
  developers: { eyebrow: '开发人员', body: '探索构建、测试和部署 AI 产品所需的模型、平台能力与开发工具。' },
  features: { eyebrow: 'ChatGPT 功能', body: '了解这项 ChatGPT 功能如何帮助你理解内容、创建作品并完成复杂任务。' },
  plans: { eyebrow: 'ChatGPT 套餐', body: '比较此套餐的功能与适用场景，选择符合个人或团队需求的使用方式。' },
  policies: { eyebrow: '政策', body: '了解使用 OpenAI 产品与服务时适用的规则、选择和透明度说明。' },
  social: { eyebrow: '关注 OpenAI', body: '通过这个官方频道关注 OpenAI 的研究、产品更新与社区动态。' },
  'use-cases': { eyebrow: '使用场景', body: '探索人们如何在这一场景中使用 ChatGPT 来学习、规划、分析和创作。' },
}

function titleFromPath(path: string) {
  const slug = path.split('/').filter(Boolean).at(-1) ?? 'openai'
  return slug.split('-').map((word) => word ? `${word[0].toUpperCase()}${word.slice(1)}` : word).join(' ')
}

function marketingCopyFor(path: string): MarketingCopy {
  const direct = MARKETING_COPY[path]
  if (direct) return direct
  const section = path.split('/').filter(Boolean)[1] ?? 'openai'
  const meta = SECTION_META[section] ?? { eyebrow: 'OpenAI', body: '了解 OpenAI 在研究、产品、安全和现实世界应用方面的最新内容。' }
  const title = MARKETING_TITLES[path] ?? titleFromPath(path)
  return { eyebrow: meta.eyebrow, title, body: `${meta.body} 本页介绍“${title}”的主要内容与可用入口。` }
}

function MarketingPage({ path, locationHref, onNavigate }: { path: string; locationHref: string; onNavigate: LegalNavigate }) {
  const params = new URL(locationHref, window.location.origin).searchParams
  const searchQuery = params.get('q') ?? ''
  const copy = path === '/openai/search'
    ? { eyebrow: '搜索', title: searchQuery ? `“${searchQuery}”的搜索结果` : '搜索 OpenAI', body: searchQuery ? '在研究、产品、公司信息和帮助内容中找到相关页面。' : '输入关键词以查找内容。' }
    : path === '/openai/products' && params.get('product') === 'sora'
      ? { eyebrow: '产品', title: 'Sora：把想法变成视频', body: '使用 Sora 从文字与图像创作视频，并通过直观工具探索、调整和分享你的构想。' }
      : path === '/openai/company' && params.get('section') === 'news'
        ? { eyebrow: '公司新闻', title: 'OpenAI 最新消息', body: '浏览来自 OpenAI 的研究进展、产品发布、公司公告和安全更新。' }
        : marketingCopyFor(path)
  return <><OpenAIHeader onNavigate={onNavigate} /><main className="openai-marketing-page"><p>{copy.eyebrow}</p><h1>{copy.title}</h1><div><p>{copy.body}</p><a href="/" onClick={(event) => onNavigate('/', event)}>试用 ChatGPT ↗</a></div>{path === '/openai/search' && <section className="openai-search-results"><a href="/openai/products" onClick={(event) => onNavigate('/openai/products', event)}><strong>OpenAI 产品</strong><span>探索 ChatGPT 与其他智能工具。</span></a><a href="/help" onClick={(event) => onNavigate('/help', event)}><strong>帮助中心</strong><span>查找常见问题和使用指南。</span></a></section>}</main><footer className="openai-site-footer"><a href="/openai" onClick={(event) => onNavigate('/openai', event)}>OpenAI</a><nav><a href="/terms" onClick={(event) => onNavigate('/terms', event)}>条款</a><a href="/privacy" onClick={(event) => onNavigate('/privacy', event)}>隐私</a><a href="/help" onClick={(event) => onNavigate('/help', event)}>帮助</a></nav></footer></>
}

export default function LegalPage({ locationHref, onNavigate }: { locationHref: string; onNavigate: LegalNavigate }) {
  const path = new URL(locationHref, window.location.origin).pathname.replace(/\/+$/, '') || '/openai'
  return <div className="openai-site">{path === '/terms' || path === '/privacy' ? <LegalDocument kind={path.slice(1) as 'terms' | 'privacy'} locationHref={locationHref} onNavigate={onNavigate} /> : <MarketingPage path={path} locationHref={locationHref} onNavigate={onNavigate} />}</div>
}
