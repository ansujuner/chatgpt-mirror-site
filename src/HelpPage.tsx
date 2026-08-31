import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type MouseEvent,
  type ReactNode,
} from 'react'
import {
  HELP_COLLECTION_ARTICLES,
  HELP_COLLECTION_ITEMS,
  HELP_NESTED_COLLECTIONS,
} from './helpArticlesData'
import './HelpPage.css'

type HelpNavigate = (path: string, event?: MouseEvent<HTMLElement>) => void

type HelpArticle = {
  slug: string
  title: string
  summary: string
}

type HelpItem = HelpArticle & {
  type: 'article' | 'collection'
  path: string
}

type Language = {
  code: string
  native: string
  english: string
}

type RichPart = string | { label: string; href: string }

type ArticleSection = {
  id: string
  heading: string
  paragraphs: RichPart[][]
}

const HELP_ARTICLES: HelpArticle[] = HELP_COLLECTION_ARTICLES.map((article) => ({ ...article }))
const HELP_ITEMS: HelpItem[] = HELP_COLLECTION_ITEMS.map((item) => ({ ...item }))

const LANGUAGES: Language[] = [
  { code: 'zh-tw', native: '繁體中文', english: 'Traditional Chinese' },
  { code: 'zh-hk', native: '繁體中文 香港', english: 'Traditional Chinese Hong Kong' },
  { code: 'zh-hans-cn', native: '简体中文', english: 'Simplified Chinese' },
  { code: 'ja', native: '日本語', english: 'Japanese' },
  { code: 'sq', native: 'Shqip', english: 'Albanian' },
  { code: 'hy', native: 'Հայերեն', english: 'Armenian' },
  { code: 'bs', native: 'bosanski', english: 'Bosnian' },
  { code: 'bg', native: 'Български', english: 'Bulgarian' },
  { code: 'ca', native: 'Català', english: 'Catalan' },
  { code: 'hr', native: 'Hrvatski', english: 'Croatian' },
  { code: 'cs', native: 'Čeština', english: 'Czech' },
  { code: 'da', native: 'Dansk', english: 'Danish' },
  { code: 'nl', native: 'Nederlands', english: 'Dutch' },
  { code: 'en', native: 'English', english: 'English' },
  { code: 'en-gb', native: 'English (UK)', english: 'English United Kingdom' },
  { code: 'et', native: 'Eesti', english: 'Estonian' },
  { code: 'fi', native: 'Suomi', english: 'Finnish' },
  { code: 'fr', native: 'Français', english: 'French' },
  { code: 'fr-ca', native: 'Français (Canada)', english: 'French Canada' },
  { code: 'ka', native: 'ქართული', english: 'Georgian' },
  { code: 'de', native: 'Deutsch', english: 'German' },
  { code: 'el', native: 'Ελληνικά', english: 'Greek' },
  { code: 'gu', native: 'ગુજરાતી', english: 'Gujarati' },
  { code: 'he', native: 'עברית', english: 'Hebrew' },
  { code: 'hi', native: 'हिन्दी', english: 'Hindi' },
  { code: 'hu', native: 'Magyar', english: 'Hungarian' },
  { code: 'id', native: 'Bahasa Indonesia', english: 'Indonesian' },
  { code: 'it', native: 'Italiano', english: 'Italian' },
  { code: 'kn', native: 'ಕನ್ನಡ', english: 'Kannada' },
  { code: 'kk', native: 'Қазақша', english: 'Kazakh' },
  { code: 'ko', native: '한국어', english: 'Korean' },
  { code: 'lv', native: 'Latviešu', english: 'Latvian' },
  { code: 'lt', native: 'Lietuvių', english: 'Lithuanian' },
  { code: 'ms', native: 'Bahasa Melayu', english: 'Malay' },
  { code: 'ml', native: 'മലയാളം', english: 'Malayalam' },
  { code: 'mr', native: 'मराठी', english: 'Marathi' },
  { code: 'no', native: 'Norsk', english: 'Norwegian' },
  { code: 'fa', native: 'فارسی', english: 'Persian' },
  { code: 'pl', native: 'Polski', english: 'Polish' },
  { code: 'pt', native: 'Português', english: 'Portuguese' },
  { code: 'pt-br', native: 'Português (Brasil)', english: 'Portuguese Brazil' },
  { code: 'ro', native: 'Română', english: 'Romanian' },
  { code: 'ru', native: 'Русский', english: 'Russian' },
  { code: 'sr', native: 'Српски', english: 'Serbian' },
  { code: 'sk', native: 'Slovenčina', english: 'Slovak' },
  { code: 'sl', native: 'Slovenščina', english: 'Slovenian' },
  { code: 'es', native: 'Español', english: 'Spanish' },
  { code: 'es-419', native: 'Español (Latinoamérica)', english: 'Spanish Latin America' },
  { code: 'sw', native: 'Kiswahili', english: 'Swahili' },
  { code: 'sv', native: 'Svenska', english: 'Swedish' },
  { code: 'ta', native: 'தமிழ்', english: 'Tamil' },
  { code: 'te', native: 'తెలుగు', english: 'Telugu' },
  { code: 'th', native: 'ไทย', english: 'Thai' },
  { code: 'tr', native: 'Türkçe', english: 'Turkish' },
  { code: 'uk', native: 'Українська', english: 'Ukrainian' },
  { code: 'ur', native: 'اردو', english: 'Urdu' },
  { code: 'vi', native: 'Tiếng Việt', english: 'Vietnamese' },
  { code: 'ar', native: 'العربية', english: 'Arabic' },
  { code: 'bn', native: 'বাংলা', english: 'Bengali' },
  { code: 'my', native: 'မြန်မာ', english: 'Burmese' },
  { code: 'fil', native: 'Filipino', english: 'Filipino' },
  { code: 'is', native: 'Íslenska', english: 'Icelandic' },
  { code: 'mk', native: 'Македонски', english: 'Macedonian' },
  { code: 'ne', native: 'नेपाली', english: 'Nepali' },
  { code: 'pa', native: 'ਪੰਜਾਬੀ', english: 'Punjabi' },
  { code: 'si', native: 'සිංහල', english: 'Sinhala' },
  { code: 'az', native: 'Azərbaycanca', english: 'Azerbaijani' },
]

const LANGUAGE_CODES = new Set(LANGUAGES.map((language) => language.code))

const DATA_USAGE_ARTICLE: HelpArticle = {
  slug: '5722486-how-your-data-is-used-to-improve-model-performance',
  title: 'How your data is used to improve model performance',
  summary: 'Learn more about how OpenAI uses content from our services to improve and train our models.',
}

const DATA_USAGE_INTRO: RichPart[] = [
  'One of the most useful and promising features of AI models is that they can improve over time. We continuously improve our models through research breakthroughs as well as exposure to real-world problems and data. When you allow your content to be used to train our models, it helps our models become more accurate and better at solving your specific problems and it also helps improve their general capabilities and safety. ChatGPT, for instance, improves by further training on the conversations people have with it, unless you ',
  { label: 'opt out', href: '/help/en/articles/7730893-data-controls-faq' },
  '.',
]

const DATA_USAGE_SECTIONS: ArticleSection[] = [
  {
    id: 'services-for-individuals-such-as-chatgpt-and-codex',
    heading: 'Services for individuals, such as ChatGPT and Codex',
    paragraphs: [
      ['When you use our services for individuals such as ChatGPT and Codex, we may use your content to train our models.'],
      [
        'You can opt out of training through our ',
        { label: 'privacy portal', href: '/help/privacy-portal' },
        ' by selecting the option that asks us not to train on your content. To turn off training for your ChatGPT conversations and Codex tasks, follow the instructions in our ',
        { label: 'Data Controls FAQ', href: '/help/en/articles/7730893-data-controls-faq' },
        '. Once you opt out, new conversations will not be used to train our models.',
      ],
      ['You can also turn off model training from ChatGPT settings. Your choice applies to your account across web and mobile devices. Temporary Chats are not used to improve our models and do not appear in history.'],
      [
        'For teen accounts, a parent or guardian can use ',
        { label: 'Parental controls', href: '/help/articles/12315553-managing-parental-controls-in-chatgpt' },
        ' to manage whether conversations can help improve models. These settings are designed to give families clear, understandable control.',
      ],
      [
        'For Codex, you can review the training preference from ',
        { label: 'Codex Settings', href: '/help/local/codex-settings' },
        '. You can change the setting at any time, and the updated choice applies to future content.',
      ],
      [
        'Even if you have opted out, when you choose to provide feedback on a response, the conversation associated with that feedback may be used to improve our models. The same applies when ',
        { label: 'providing feedback in the Playground', href: '/help/en/articles/10306912-sharing-feedback-evals-and-api-data-with-openai' },
        '.',
      ],
    ],
  },
  {
    id: 'services-for-businesses-such-as-chatgpt-business-chatgpt-enterprise-and-our-api-platform',
    heading: 'Services for businesses, such as ChatGPT Business, ChatGPT Enterprise, and our API Platform',
    paragraphs: [
      ['By default, we do not train our models on inputs and outputs from our business offerings, including ChatGPT Business, ChatGPT Enterprise, ChatGPT Edu, and the API Platform.'],
      ['Organizations can choose to share selected data with us, such as by providing explicit feedback. Workspace owners and administrators can manage the controls available to their organization.'],
    ],
  },
  {
    id: 'what-the-process-looks-like',
    heading: 'What the process looks like',
    paragraphs: [
      ['We take steps to reduce the amount of personal information in training datasets before they are used to improve our models. We also apply technical and organizational safeguards that restrict access to this data.'],
      ['Our systems are designed to learn patterns that help them respond more usefully; they do not retain a copy of every training example. We continually evaluate our practices as our products and technologies evolve.'],
      [
        'For more on how we handle data, please see our ',
        { label: 'Privacy Policy', href: '/privacy' },
        ', ',
        { label: 'Terms of Use', href: '/terms' },
        ', and ',
        { label: 'Enterprise Privacy page', href: '/openai/enterprise-privacy' },
        '.',
      ],
    ],
  },
]

const RELATED_ARTICLES: HelpArticle[] = [
  {
    slug: '7039943-data-usage-for-consumer-services-faq',
    title: 'Data Usage for Consumer Services FAQ',
    summary: 'Commonly asked questions about how we treat user data for OpenAI’s non-API consumer services like ChatGPT',
  },
  {
    slug: '11752874-chatgpt-agent',
    title: 'ChatGPT agent',
    summary: 'Learn about the features of ChatGPT agent mode and how to get started',
  },
  {
    slug: '7842364-how-chatgpt-and-our-foundation-models-are-developed',
    title: 'How ChatGPT and our foundation models are developed',
    summary: 'Learn more about how we develop our models and apply them in products like ChatGPT',
  },
]

function groupCollectionItems(items: HelpItem[]) {
  const groups: HelpItem[][] = [[]]
  for (const item of items) {
    if (item.type === 'collection' && groups[groups.length - 1].length) groups.push([])
    groups[groups.length - 1].push(item)
  }
  return groups.filter((group) => group.length)
}

const HELP_GROUPS = groupCollectionItems(HELP_ITEMS)

function localItemPath(item: Pick<HelpItem, 'type' | 'slug'>) {
  return item.type === 'collection' ? `/help/collections/${item.slug}` : `/help/articles/${item.slug}`
}

function parseHelpPath(rawPath: string) {
  const segments = rawPath.split('/').filter(Boolean)
  if (segments[0] !== 'help') return { locale: 'zh-hans-cn', contentPath: rawPath }
  const possibleLocale = segments[1]?.toLocaleLowerCase()
  if (!possibleLocale || !LANGUAGE_CODES.has(possibleLocale)) {
    return { locale: rawPath.includes('/data-usage') ? 'en' : 'zh-hans-cn', contentPath: rawPath }
  }
  const suffix = segments.slice(2).join('/')
  return { locale: possibleLocale, contentPath: suffix ? `/help/${suffix}` : '/help' }
}

function localizedPath(rawPath: string, locale: string) {
  const parsed = parseHelpPath(rawPath)
  let suffix = parsed.contentPath.replace(/^\/help/, '')
  if (!suffix || suffix === '/') suffix = '/collections/3742473-chatgpt'
  if (suffix === '/data-usage') suffix = `/articles/${DATA_USAGE_ARTICLE.slug}`
  return `/help/${locale}${suffix}`
}

function OpenAIWordmark() {
  return <span className="help-openai-wordmark" aria-label="OpenAI">OpenAI</span>
}

function OpenAIMark({ label = 'OpenAI' }: { label?: string }) {
  return <svg aria-label={label} role="img" viewBox="0 0 20 20"><use href="/chatgpt-icons.svg#chatgpt-mark" /></svg>
}

function SearchIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="10.8" cy="10.8" r="6.3"/><path d="m15.5 15.5 4.2 4.2"/></svg>
}

function GlobeIcon() {
  return <svg aria-hidden="true" viewBox="0 0 20 20"><circle cx="10" cy="10" r="6.5"/><path d="M3.8 10h12.4M10 3.5c2.6 2.7 2.6 10.3 0 13M10 3.5c-2.6 2.7-2.6 10.3 0 13"/></svg>
}

function ArrowIcon() {
  return <svg aria-hidden="true" viewBox="0 0 20 20"><path d="m7.5 4.5 5.5 5.5-5.5 5.5"/></svg>
}

function CheckIcon() {
  return <svg aria-hidden="true" viewBox="0 0 20 20"><path d="m5.5 10 3 3 6-7"/></svg>
}

function HelpHeader({ onNavigate, locale, currentPath }: { onNavigate: HelpNavigate; locale: string; currentPath: string }) {
  const [languageOpen, setLanguageOpen] = useState(false)
  const [languageSearch, setLanguageSearch] = useState('')
  const languageRootRef = useRef<HTMLDivElement>(null)
  const currentLanguage = LANGUAGES.find((language) => language.code === locale) ?? LANGUAGES[2]
  const visibleLanguages = useMemo(() => {
    const needle = languageSearch.trim().toLocaleLowerCase()
    return needle ? LANGUAGES.filter((language) => `${language.native} ${language.english}`.toLocaleLowerCase().includes(needle)) : LANGUAGES
  }, [languageSearch])

  useEffect(() => {
    if (!languageOpen) return
    const closeOnOutside = (event: PointerEvent) => {
      if (!languageRootRef.current?.contains(event.target as Node)) setLanguageOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setLanguageOpen(false)
    }
    document.addEventListener('pointerdown', closeOnOutside)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutside)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [languageOpen])

  return (
    <header className="help-header">
      <a href="/help" onClick={(event) => onNavigate('/help', event)}><OpenAIWordmark /></a>
      <nav aria-label={locale === 'en' ? 'Help center account' : '帮助中心账户'}>
        <div className="help-language-root" ref={languageRootRef}>
          <button className="help-language-button" type="button" aria-haspopup="listbox" aria-expanded={languageOpen} onClick={() => setLanguageOpen((open) => !open)}><GlobeIcon />{currentLanguage.native}</button>
          {languageOpen && <div className="help-language-menu" role="dialog" aria-label="Select language">
            <strong className="help-language-title">Select language</strong>
            <div className="help-language-list" role="listbox" aria-label="Languages">
              {visibleLanguages.map((language) => <button className={language.code === currentLanguage.code ? 'is-selected' : ''} key={language.code} type="button" role="option" aria-selected={language.code === currentLanguage.code} onClick={() => {
                setLanguageOpen(false)
                setLanguageSearch('')
                onNavigate(localizedPath(currentPath, language.code))
              }}>
                <span><b>{language.native}</b>{language.native !== language.english && <small>{language.english}</small>}</span>
                {language.code === currentLanguage.code && <i><CheckIcon /></i>}
              </button>)}
              {!visibleLanguages.length && <p className="help-language-empty">No languages found</p>}
            </div>
            <label className="help-language-search"><SearchIcon /><input aria-label="Search languages" placeholder="Search" value={languageSearch} onChange={(event) => setLanguageSearch(event.currentTarget.value)} /></label>
          </div>}
        </div>
        <a href={`/help/auth/login?returnTo=${encodeURIComponent(currentPath)}`} onClick={(event) => onNavigate(`/help/auth/login?returnTo=${encodeURIComponent(currentPath)}`, event)}>{locale === 'en' ? 'Login' : '登录'}</a>
      </nav>
    </header>
  )
}

function HelpSearch({ initialValue = '', onNavigate, locale }: { initialValue?: string; onNavigate: HelpNavigate; locale: string }) {
  const [query, setQuery] = useState(initialValue)
  const [settledQuery, setSettledQuery] = useState(initialValue)
  const loading = Boolean(query.trim()) && query.trim() !== settledQuery

  useEffect(() => {
    const trimmed = query.trim()
    if (!trimmed) return
    if (trimmed === settledQuery) return
    const timer = window.setTimeout(() => {
      setSettledQuery(trimmed)
      onNavigate(`/help?q=${encodeURIComponent(trimmed)}`)
    }, 1000)
    return () => window.clearTimeout(timer)
  }, [onNavigate, query, settledQuery])

  const results = useMemo(() => {
    const needle = settledQuery.trim().toLocaleLowerCase()
    if (!needle) return []
    return HELP_ITEMS.filter((item) => `${item.title} ${item.summary}`.toLocaleLowerCase().includes(needle)).slice(0, 20)
  }, [settledQuery])

  const settleNow = () => {
    const trimmed = query.trim()
    if (!trimmed) {
      setQuery('')
      setSettledQuery('')
      onNavigate('/help')
      return
    }
    setSettledQuery(trimmed)
    onNavigate(`/help?q=${encodeURIComponent(trimmed)}`)
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    settleNow()
  }

  return (
    <div className="help-search-shell">
      <form className="help-search" role="search" onSubmit={submit}>
        <SearchIcon />
        <input aria-label={locale === 'en' ? 'Search for articles' : '搜索文章'} placeholder={locale === 'en' ? 'Search for articles...' : '搜索文章...'} value={query} onChange={(event) => {
          const nextQuery = event.currentTarget.value
          setQuery(nextQuery)
          if (!nextQuery.trim()) setSettledQuery('')
        }} />
        {query && <button type="button" aria-label={locale === 'en' ? 'Clear search' : '清除搜索'} onClick={() => {
          setQuery('')
          setSettledQuery('')
          onNavigate('/help')
        }}>×</button>}
      </form>
      {query.trim() && <div className={`help-search-results${loading ? ' is-loading' : ''}`} role="region" aria-label="Search results" aria-live="polite">
        {results.map((item) => {
          const path = localItemPath(item)
          return <a key={`${item.type}-${item.slug}`} href={path} onClick={(event) => onNavigate(path, event)}><strong>{item.title}</strong><span>{item.summary || (locale === 'en' ? 'Browse related help articles.' : '浏览相关帮助文章。')}</span></a>
        })}
        {!results.length && <div className="help-search-status">{loading ? (locale === 'en' ? 'Searching…' : '正在搜索…') : (locale === 'en' ? 'No results found' : '没有找到结果')}</div>}
      </div>}
    </div>
  )
}

function HelpMessenger({ onNavigate, locale }: { onNavigate: HelpNavigate; locale: string }) {
  const [open, setOpen] = useState(false)
  const [message, setMessage] = useState('')
  const [messages, setMessages] = useState<string[]>([])
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    window.setTimeout(() => inputRef.current?.focus(), 520)
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [open])

  const send = (event: FormEvent) => {
    event.preventDefault()
    const trimmed = message.trim()
    if (!trimmed) return
    setMessages((current) => [...current, trimmed])
    setMessage('')
  }

  return (
    <>
      <div className={`help-chat-layer${open ? ' is-open' : ''}`} aria-hidden={!open}>
        <button className="help-chat-backdrop" type="button" aria-label="Close support" onClick={() => setOpen(false)} />
        <aside className="help-messenger" aria-label="OpenAI support">
          <span className="help-chat-handle" />
          <header>
            <span>{locale === 'en' ? 'Log in for faster, more personalized support.' : '登录以获得更快速、更个性化的支持。'}</span>
            <div>
              <button className="help-chat-login" type="button" onClick={() => onNavigate('/help/auth/login')}>{locale === 'en' ? 'Log in' : '登录'}</button>
              <button className="help-chat-icon" type="button" aria-label="Conversation history"><svg viewBox="0 0 24 24"><path d="M5 7v5h5M5.8 11.5a7 7 0 1 0 2-5"/><path d="M12 8v4l2.8 1.8"/></svg></button>
              <button className="help-chat-icon" type="button" aria-label="Close" onClick={() => setOpen(false)}>×</button>
            </div>
          </header>
          <div className="help-messenger-body">
            {!messages.length ? <h2>{locale === 'en' ? 'Get help from OpenAI Support' : '获取 OpenAI 支持帮助'}</h2> : <div className="help-chat-messages">{messages.map((entry, index) => <div key={`${entry}-${index}`}><span>{entry}</span><p>{locale === 'en' ? 'Thanks — your message was received in this local demo.' : '谢谢，我们已在本地演示中收到你的问题。'}</p></div>)}</div>}
          </div>
          <form onSubmit={send}><button type="button" aria-label="Add attachment">＋</button><input ref={inputRef} aria-label="Support question" placeholder={locale === 'en' ? 'Ask a support question...' : '询问支持问题...'} value={message} onChange={(event) => setMessage(event.currentTarget.value)} /><button className="help-chat-send" type="submit" aria-label="Send">↑</button></form>
          <small>{locale === 'en' ? 'AI support can make mistakes. Learn more.' : 'AI 支持可能会出错。如果您在设置中启用了训练，您的客服对话可能会用于改进 OpenAI 服务，包括我们的模型。了解更多。'}</small>
        </aside>
      </div>
      <button className={`help-messenger-toggle${open ? ' is-chat-open' : ''}`} type="button" aria-label={open ? '关闭帮助对话' : '打开帮助对话'} onClick={() => setOpen((current) => !current)}><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4.5 5.5h15v11h-8l-4.5 3v-3H4.5z"/><circle cx="9" cy="11" r=".8"/><circle cx="12" cy="11" r=".8"/><circle cx="15" cy="11" r=".8"/></svg></button>
    </>
  )
}

function CookieDialog({ onClose }: { onClose: () => void }) {
  const [analytics, setAnalytics] = useState(false)
  const [personalization, setPersonalization] = useState(true)
  return <div className="help-cookie-layer" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section className="help-cookie-dialog" role="dialog" aria-modal="true" aria-labelledby="help-cookie-title">
      <button className="help-cookie-close" type="button" aria-label="关闭" onClick={onClose}>×</button>
      <h2 id="help-cookie-title">Cookie Preferences</h2>
      <p>选择此本地镜像站可以使用的 Cookie 类型。必要 Cookie 始终启用。</p>
      <label><span><b>Strictly necessary</b><small>用于页面导航和基本功能</small></span><input type="checkbox" checked disabled /></label>
      <label><span><b>Analytics</b><small>帮助了解页面的本地使用情况</small></span><input type="checkbox" checked={analytics} onChange={(event) => setAnalytics(event.currentTarget.checked)} /></label>
      <label><span><b>Personalization</b><small>记住界面选择</small></span><input type="checkbox" checked={personalization} onChange={(event) => setPersonalization(event.currentTarget.checked)} /></label>
      <button className="help-cookie-save" type="button" onClick={onClose}>保存偏好</button>
    </section>
  </div>
}

function HelpFooter({ onNavigate, locale }: { onNavigate: HelpNavigate; locale: string }) {
  const [cookieOpen, setCookieOpen] = useState(false)
  return <>
    <footer className="help-footer">
      <div className="help-footer-mark"><OpenAIMark /></div>
      <nav aria-label="Footer">
        <a href="/" onClick={(event) => onNavigate('/', event)}>ChatGPT</a>
        <a href="/help/platform/docs" onClick={(event) => onNavigate('/help/platform/docs', event)}>API</a>
        <a href="/help/status" onClick={(event) => onNavigate('/help/status', event)}>{locale === 'en' ? 'Service Status' : '服务状态'}</a>
        <button type="button" onClick={() => setCookieOpen(true)}>{locale === 'en' ? 'Cookie Preferences' : 'Cookie 设置'}</button>
      </nav>
    </footer>
    {cookieOpen && <CookieDialog onClose={() => setCookieOpen(false)} />}
  </>
}

function HelpShell({ children, onNavigate, locale, currentPath }: { children: ReactNode; onNavigate: HelpNavigate; locale: string; currentPath: string }) {
  return <><HelpHeader onNavigate={onNavigate} locale={locale} currentPath={currentPath} />{children}<HelpFooter onNavigate={onNavigate} locale={locale} /><HelpMessenger onNavigate={onNavigate} locale={locale} /></>
}

function CollectionRow({ item, onNavigate }: { item: HelpItem; onNavigate: HelpNavigate }) {
  const path = localItemPath(item)
  if (item.type === 'collection') {
    return <a className="help-collection-heading" href={path} onClick={(event) => onNavigate(path, event)}><span><strong>{item.title}</strong><small>{item.summary || `${item.title} 相关帮助文章`}</small></span></a>
  }
  return <a href={path} onClick={(event) => onNavigate(path, event)}><span><strong>{item.title}</strong><small>{item.summary || `${item.title} 相关帮助文章`}</small></span><ArrowIcon /></a>
}

function CollectionPage({ locationHref, onNavigate, locale, currentPath }: { locationHref: string; onNavigate: HelpNavigate; locale: string; currentPath: string }) {
  const query = (new URL(locationHref, window.location.origin).searchParams.get('q') ?? '').trim()
  return <HelpShell onNavigate={onNavigate} locale={locale} currentPath={currentPath}>
    <main className="help-main">
      <HelpSearch initialValue={query} onNavigate={onNavigate} locale={locale} />
      <div className="help-breadcrumb"><a href="/help" onClick={(event) => onNavigate('/help', event)}>所有系列</a><ArrowIcon /><span>ChatGPT</span></div>
      <section className="help-collection-hero"><div className="help-collection-mark"><OpenAIMark label="ChatGPT" /></div><div><h1>ChatGPT</h1><p>All things about ChatGPT</p></div></section>
      <div className="help-collection-groups">{HELP_GROUPS.map((group, index) => <section className="help-article-list" aria-label={index ? group[0].title : 'ChatGPT 文章'} key={`${index}-${group[0].slug}`}>{group.map((item) => <CollectionRow key={`${item.type}-${item.slug}`} item={item} onNavigate={onNavigate} />)}</section>)}</div>
    </main>
  </HelpShell>
}

function NestedCollectionPage({ slug, locationHref, onNavigate, locale, currentPath }: { slug: string; locationHref: string; onNavigate: HelpNavigate; locale: string; currentPath: string }) {
  const collection = HELP_NESTED_COLLECTIONS.find((item) => item.slug === slug)
  const title = collection?.title ?? 'ChatGPT'
  const query = (new URL(locationHref, window.location.origin).searchParams.get('q') ?? '').trim()
  const matchingGroup = HELP_GROUPS.find((group) => group[0]?.type === 'collection' && group[0].slug === slug)
  const articles = matchingGroup?.slice(1) ?? HELP_ITEMS.slice(0, 20)
  return <HelpShell onNavigate={onNavigate} locale={locale} currentPath={currentPath}>
    <main className="help-main">
      <HelpSearch initialValue={query} onNavigate={onNavigate} locale={locale} />
      <div className="help-breadcrumb"><a href="/help" onClick={(event) => onNavigate('/help', event)}>所有系列</a><ArrowIcon /><a href="/help" onClick={(event) => onNavigate('/help', event)}>ChatGPT</a><ArrowIcon /><span>{title}</span></div>
      <section className="help-collection-hero"><div className="help-collection-mark"><OpenAIMark label="ChatGPT" /></div><div><h1>{title}</h1><p>{collection?.summary || `All things about ${title}`}</p></div></section>
      <div className="help-collection-groups"><section className="help-article-list" aria-label={`${title} 文章`}>{articles.map((item) => <CollectionRow key={`${item.type}-${item.slug}`} item={item} onNavigate={onNavigate} />)}</section></div>
    </main>
  </HelpShell>
}

function renderRichParts(parts: RichPart[]) {
  return parts.map((part, index) => typeof part === 'string' ? <span key={`${part.slice(0, 12)}-${index}`}>{part}</span> : <a key={`${part.href}-${index}`} href={part.href} target="_blank" rel="noreferrer">{part.label}</a>)
}

function ThumbIcon({ down = false }: { down?: boolean }) {
  return <svg aria-hidden="true" viewBox="0 0 24 24" className={down ? 'is-down' : ''}><path d="M7.5 10.2 10.8 3c.3-.7 1.2-1 1.9-.6.6.3.9.9.8 1.5l-.5 3.4h4.4c1.6 0 2.8 1.5 2.4 3l-1.5 6.8c-.3 1.1-1.3 1.9-2.4 1.9H7.5zM3.5 10.2h4v9h-4z"/></svg>
}

function ArticlePage({ article, locationHref, onNavigate, locale, currentPath, dataUsage = false }: { article: HelpArticle; locationHref: string; onNavigate: HelpNavigate; locale: string; currentPath: string; dataUsage?: boolean }) {
  const [vote, setVote] = useState<'up' | 'down' | null>(null)
  const [feedback, setFeedback] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [activeSection, setActiveSection] = useState(dataUsage ? DATA_USAGE_SECTIONS[0].id : 'overview')
  const articleRef = useRef<HTMLElement>(null)
  const query = (new URL(locationHref, window.location.origin).searchParams.get('q') ?? '').trim()
  const genericSections = useMemo<ArticleSection[]>(() => [
    { id: 'overview', heading: '概览', paragraphs: [[article.summary], ['本文介绍相关功能的使用方式、可用性和常见问题。你可以通过页面中的步骤开始使用，并在需要时返回帮助中心继续查找答案。']] },
    { id: 'getting-started', heading: '开始使用', paragraphs: [['打开 ChatGPT，选择相应功能并按照页面提示继续。某些功能可能需要先登录账户或选择支持的套餐。'], ['功能和可用性可能会因账户、设备和地区而异。请确保正在使用最新版本的应用。']] },
    { id: 'frequently-asked-questions', heading: '常见问题', paragraphs: [['如果操作没有完成，请刷新页面、确认浏览器支持情况，并再次尝试。你也可以通过右下角的帮助对话继续查找答案。']] },
  ], [article.summary])
  const sections = dataUsage ? DATA_USAGE_SECTIONS : genericSections

  useEffect(() => {
    const update = () => {
      let next = sections[0]?.id ?? ''
      for (const section of sections) {
        const element = document.getElementById(section.id)
        if (element && element.getBoundingClientRect().top <= 180) next = section.id
      }
      setActiveSection(next)
    }
    update()
    window.addEventListener('scroll', update, { passive: true })
    return () => window.removeEventListener('scroll', update)
  }, [article.slug, sections])

  return <HelpShell onNavigate={onNavigate} locale={locale} currentPath={currentPath}>
    <main className="help-main help-article-main">
      <HelpSearch initialValue={query} onNavigate={onNavigate} locale={locale} />
      {dataUsage ? <div className="help-breadcrumb help-article-breadcrumb"><a href="/help" onClick={(event) => onNavigate('/help', event)}>All Collections</a><ArrowIcon /><a href="/help/collections/privacy-and-policies" onClick={(event) => onNavigate('/help/collections/privacy-and-policies', event)}>Privacy and policies</a><ArrowIcon /><a href="/help/collections/policy-faq" onClick={(event) => onNavigate('/help/collections/policy-faq', event)}>Policy FAQ</a><ArrowIcon /><span className="help-breadcrumb-current">{article.title}</span></div> : <div className="help-breadcrumb help-article-breadcrumb"><a href="/help" onClick={(event) => onNavigate('/help', event)}>所有系列</a><ArrowIcon /><a href="/help" onClick={(event) => onNavigate('/help', event)}>ChatGPT</a><ArrowIcon /><span className="help-breadcrumb-current">{article.title}</span></div>}
      <div className="help-article-layout">
        <article className={`help-article-page${dataUsage ? ' is-data-usage' : ''}`} ref={articleRef}>
          <h1>{article.title}</h1>
          <p className="help-article-summary">{article.summary}</p>
          <p className="help-article-meta">{dataUsage ? 'Updated: 12 days ago' : '更新于 2026 年 8 月 30 日'}</p>
          <div className="help-article-body">
            {dataUsage && <p className="help-article-intro">{renderRichParts(DATA_USAGE_INTRO)}</p>}
            {sections.map((section) => <section id={section.id} key={section.id}><h2>{section.heading}</h2>{section.paragraphs.map((paragraph, index) => <p key={`${section.id}-${index}`}>{renderRichParts(paragraph)}</p>)}</section>)}
          </div>
          {dataUsage && <section className="help-related"><h2>Related articles</h2><div>{RELATED_ARTICLES.map((related) => {
            const path = `/help/en/articles/${related.slug}`
            return <a key={related.slug} href={path} onClick={(event) => onNavigate(path, event)}><span><strong>{related.title}</strong><small>{related.summary}</small></span><ArrowIcon /></a>
          })}</div></section>}
          <form className="help-article-feedback" onSubmit={(event) => { event.preventDefault(); if (feedback.trim()) setSubmitted(true) }}>
            <h2>{dataUsage ? 'Was this article helpful?' : '这篇文章有帮助吗？'}</h2>
            <div className="help-vote-buttons"><button className={vote === 'up' ? 'is-selected' : ''} type="button" aria-label="Helpful" aria-pressed={vote === 'up'} onClick={() => setVote((current) => current === 'up' ? null : 'up')}><ThumbIcon /></button><button className={vote === 'down' ? 'is-selected' : ''} type="button" aria-label="Not helpful" aria-pressed={vote === 'down'} onClick={() => setVote((current) => current === 'down' ? null : 'down')}><ThumbIcon down /></button></div>
            <textarea aria-label="Additional feedback" placeholder={dataUsage ? 'Additional feedback (optional)' : '其他反馈（可选）'} value={feedback} onChange={(event) => { setFeedback(event.currentTarget.value); setSubmitted(false) }} />
            <button className="help-feedback-submit" type="submit" disabled={!feedback.trim()}>{submitted ? (dataUsage ? 'Submitted' : '已提交') : (dataUsage ? 'Submit' : '提交')}</button>
          </form>
        </article>
        <aside className="help-article-toc" aria-label="Table of contents">{sections.map((section) => <a className={activeSection === section.id ? 'is-active' : ''} key={section.id} href={`#${section.id}`} onClick={(event) => {
          event.preventDefault()
          document.getElementById(section.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
          window.history.replaceState({}, '', `${currentPath}#${section.id}`)
        }}>{section.heading}</a>)}</aside>
      </div>
    </main>
  </HelpShell>
}

function HelpLogin({ onNavigate, locale, currentPath }: { onNavigate: HelpNavigate; locale: string; currentPath: string }) {
  const [email, setEmail] = useState('')
  const [continued, setContinued] = useState(false)
  return <><HelpHeader onNavigate={onNavigate} locale={locale} currentPath={currentPath} /><main className="help-login-page"><div className="help-login-mark"><OpenAIMark /></div><h1>{locale === 'en' ? 'Log in to OpenAI Help Center' : '登录 OpenAI 帮助中心'}</h1><p>{locale === 'en' ? 'View support requests and contact our help team.' : '查看支持请求并联系帮助团队。'}</p>{continued ? <div className="help-login-notice">{locale === 'en' ? 'A local demo login link has been sent.' : '已发送本地演示登录链接。'}<button type="button" onClick={() => onNavigate('/help')}>{locale === 'en' ? 'Back to Help Center' : '返回帮助中心'}</button></div> : <form onSubmit={(event) => { event.preventDefault(); if (email.trim()) setContinued(true) }}><label htmlFor="help-login-email">{locale === 'en' ? 'Email' : '电子邮件'}</label><input id="help-login-email" type="email" required value={email} onChange={(event) => setEmail(event.currentTarget.value)} /><button type="submit">{locale === 'en' ? 'Continue' : '继续'}</button></form>}</main></>
}

function LocalTargetPage({ title, description, onNavigate, locale, currentPath }: { title: string; description: string; onNavigate: HelpNavigate; locale: string; currentPath: string }) {
  return <HelpShell onNavigate={onNavigate} locale={locale} currentPath={currentPath}><main className="help-simple-page"><div className="help-simple-mark"><OpenAIMark /></div><p>{locale === 'en' ? 'OpenAI' : 'OpenAI 本地页面'}</p><h1>{title}</h1><span>{description}</span><button type="button" onClick={() => onNavigate('/help')}>{locale === 'en' ? 'Back to Help Center' : '返回帮助中心'}</button></main></HelpShell>
}

export default function HelpPage({ locationHref, onNavigate }: { locationHref: string; onNavigate: HelpNavigate }) {
  const rawPath = new URL(locationHref, window.location.origin).pathname.replace(/\/+$/, '') || '/help'
  const { locale, contentPath } = parseHelpPath(rawPath)
  const siteRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    document.body.classList.add('help-page-active')
    window.scrollTo({ top: 0 })
    return () => document.body.classList.remove('help-page-active')
  }, [contentPath])

  let page: ReactNode
  if (contentPath === '/help/login' || contentPath === '/help/auth/login') {
    page = <HelpLogin onNavigate={onNavigate} locale={locale} currentPath={rawPath} />
  } else if (contentPath === '/help/data-usage' || contentPath === `/help/articles/${DATA_USAGE_ARTICLE.slug}`) {
    page = <ArticlePage article={DATA_USAGE_ARTICLE} locationHref={locationHref} onNavigate={onNavigate} locale="en" currentPath={rawPath} dataUsage />
  } else if (contentPath === '/help/platform/docs') {
    page = <LocalTargetPage title="API Documentation" description="Build with OpenAI models, tools, and APIs. This destination remains inside the local mirror site." onNavigate={onNavigate} locale={locale} currentPath={rawPath} />
  } else if (contentPath === '/help/status') {
    page = <LocalTargetPage title="All systems operational" description="The local ChatGPT mirror site and Help Center are available." onNavigate={onNavigate} locale={locale} currentPath={rawPath} />
  } else if (contentPath === '/help/privacy-portal') {
    page = <LocalTargetPage title="Privacy Portal" description="Manage local privacy and model-training preferences." onNavigate={onNavigate} locale={locale} currentPath={rawPath} />
  } else if (contentPath.startsWith('/help/local/')) {
    page = <LocalTargetPage title="Codex Settings" description="Manage general settings for this local mirror site." onNavigate={onNavigate} locale={locale} currentPath={rawPath} />
  } else {
    const articleMatch = contentPath.match(/^\/help\/articles\/([^/]+)$/)
    const collectionMatch = contentPath.match(/^\/help\/collections\/([^/]+)$/)
    const directArticleMatch = contentPath.match(/^\/help\/([^/]+)$/)
    if (articleMatch) {
      const slug = decodeURIComponent(articleMatch[1])
      const article = HELP_ARTICLES.find((item) => item.slug === slug) ?? RELATED_ARTICLES.find((item) => item.slug === slug) ?? {
        slug,
        title: slug.replace(/^\d+-/, '').split('-').map((word) => word ? `${word[0].toUpperCase()}${word.slice(1)}` : '').join(' '),
        summary: locale === 'en' ? 'Guidance and answers from the OpenAI Help Center.' : '来自 OpenAI 帮助中心的指南与解答。',
      }
      page = <ArticlePage article={article} locationHref={locationHref} onNavigate={onNavigate} locale={locale} currentPath={rawPath} />
    } else if (collectionMatch && collectionMatch[1] !== '3742473-chatgpt') {
      page = <NestedCollectionPage slug={decodeURIComponent(collectionMatch[1])} locationHref={locationHref} onNavigate={onNavigate} locale={locale} currentPath={rawPath} />
    } else if (directArticleMatch) {
      const slug = decodeURIComponent(directArticleMatch[1])
      const directArticles: Record<string, HelpArticle> = {
        'business-plan': { slug, title: 'ChatGPT Business plan', summary: 'Learn about ChatGPT Business features, workspace billing, and plan options.' },
        'business-credits': { slug, title: 'Credits in ChatGPT Business', summary: 'Learn how credits, usage, and spend controls work in a ChatGPT Business workspace.' },
        'token-billing': { slug, title: 'Flexible pricing and token billing', summary: 'Understand token billing, included usage, and flexible purchasing options.' },
      }
      const article = directArticles[slug] ?? {
        slug,
        title: slug.split('-').map((word) => word ? `${word[0].toUpperCase()}${word.slice(1)}` : '').join(' '),
        summary: locale === 'en' ? 'Guidance and answers from the OpenAI Help Center.' : '来自 OpenAI 帮助中心的指南与解答。',
      }
      page = <ArticlePage article={article} locationHref={locationHref} onNavigate={onNavigate} locale={locale} currentPath={rawPath} />
    } else {
      page = <CollectionPage locationHref={locationHref} onNavigate={onNavigate} locale={locale} currentPath={rawPath} />
    }
  }

  return <div className="help-site" ref={siteRef}>{page}</div>
}
