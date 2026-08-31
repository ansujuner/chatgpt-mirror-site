import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Globe2,
  Menu,
  Search,
  Sparkles,
  UserRound,
  UsersRound,
  X,
} from 'lucide-react'
import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import './PricingPage.css'

type PricingMode = 'personal' | 'business'
type MenuKey = 'features' | 'learn' | 'codex' | 'business' | 'pricing'

type Plan = {
  name: string
  description: string
  prefix?: string
  price: string
  cadence?: string
  cta: string
  href: string
  intro?: string
  features: string[]
  notes?: Array<{ before?: string; label: string; href: string; after?: string }>
}

type MenuLink = { label: string; href: string; note?: string }
type MenuColumn = { title?: string; links: MenuLink[] }

type CompareRow = {
  label: string
  personal: string[]
  business: string[]
}

type CompareGroup = { title: string; rows: CompareRow[] }

function ChatGPTMark({ wordmark = false }: { wordmark?: boolean }) {
  return (
    <span className={`pricing-brand${wordmark ? ' has-wordmark' : ''}`}>
      <svg aria-hidden="true" viewBox="0 0 20 20"><use href="/chatgpt-icons.svg#chatgpt-mark" /></svg>
      {wordmark && <strong>ChatGPT</strong>}
    </span>
  )
}

function Arrow() {
  return <ChevronRight aria-hidden="true" strokeWidth={1.6} />
}

const PERSONAL_PLANS: Plan[] = [
  {
    name: '免费版',
    description: '日常任务的智能解决方案',
    price: 'JP¥0',
    cadence: '/月',
    cta: '获取免费版',
    href: '/',
    features: [
      '无限制使用 GPT-5.6 Luna 进行文本聊天',
      '带上传功能的消息数量受限',
      '图像生成受限，速度较慢',
      '语音聊天数量受限',
      '有限使用深度研究',
      '记忆与上下文支持受限',
      'Codex 的有限使用',
      '桌面端 ChatGPT Work（有限使用）',
    ],
    notes: [
      { before: '已有套餐？请参阅 ', label: '计费帮助', href: '/help/billing' },
      { before: '无限制的文本聊天需遵守防滥用规范。', label: '了解更多', href: '/help/pro-tiers' },
    ],
  },
  {
    name: 'Go',
    description: '扩展访问权限',
    price: 'JP¥1,400',
    cadence: '/月',
    cta: '获取 Go',
    href: '/auth/email?callback_path=%2Fpricing%3Fhighlight_plan%3Dgo&screen_hint=signup',
    intro: '免费套餐中的全部内容，以及：',
    features: [
      '包含工具调用的消息数量更多',
      '更高的上传额度',
      '更高的图片生成额度',
      '语音聊天数量更多',
      '更长的记忆',
    ],
    notes: [
      { before: '此套餐可能包含广告。', label: '了解更多', href: '/help/chatgpt-go-ads' },
      { before: '无限制的文本聊天需遵守防滥用规范。', label: '了解更多', href: '/help/pro-tiers' },
    ],
  },
  {
    name: 'Plus',
    description: '以更先进的智能完成更多工作',
    price: 'JP¥3,000',
    cadence: '/月',
    cta: '获取 Plus',
    href: '/auth/email?callback_path=%2Fpricing%3Fhighlight_plan%3Dplus&screen_hint=signup',
    intro: 'Go 中的全部内容，以及：',
    features: [
      'GPT-5.6 的高级推理模型',
      '更高的消息与上传配额',
      '更复杂、更精准的图像生成',
      '增强版深度研究',
      '记忆与上下文支持更强',
      '项目、计划任务和自定义 GPT',
      '更高的 Codex 使用量',
      '桌面端、网页端和移动端 ChatGPT Work（更高使用权限）',
      '抢先体验新功能',
    ],
    notes: [{ label: '限制条件适用', href: '/help/chatgpt-plus-limits' }],
  },
  {
    name: 'Pro',
    description: '大幅提升工作效率',
    prefix: '起价',
    price: 'JP¥16,800',
    cadence: '/月',
    cta: '获取 Pro 版本',
    href: '/auth/email?callback_path=%2Fpricing%3Fhighlight_plan%3Dpro&screen_hint=signup',
    intro: 'Plus 中的全部内容，以及：',
    features: [
      '5 倍或 20 倍的使用配额',
      'GPT-5.6 Sol Pro 专业推理',
      'Codex 最大任务量',
      '无限制且更快速的图像生成',
      '最高级别的深度研究',
      '最大记忆与上下文支持',
      '更高的项目、任务和自定义 GPT 配额',
      '新功能的研究预览',
    ],
    notes: [{ before: '无限制使用需遵守防滥用规范。', label: '了解更多', href: '/help/what-is-chatgpt-pro' }],
  },
]

const BUSINESS_FEATURES = [
  '涵盖 ChatGPT、“ChatGPT 工作”及 Codex 的所有功能',
  '支持桌面端、网页端和移动端访问',
  '可连接至 Google Workspace、Slack、GitHub、Microsoft 365 等工具',
  '安全的工作空间，支持 SAML、SSO 和 MFA',
  '集中式计费和管理',
  '使用情况分析与支出控制',
  '默认不使用你的业务数据进行模型训练',
  '用于自定义工作流的工作空间智能体',
  '可灵活搭配不同席位类型',
]

const ENTERPRISE_FEATURES = [
  '扩展版上下文窗口，支持更长的输入和更大的文件',
  '企业级安全和控制，包括 SCIM、EKM、用户分析、域验证和基于角色的访问控制',
  '高级数据隐私 — 支持自定义数据保留策略，静态与传输过程中的加密，并且默认不使用你的业务数据进行模型训练',
  '在十个地区支持数据驻留',
  '7×24 小时优先支持、服务等级协议 (SLA）、自定义法律条款，以及（符合条件的客户可享）AI 顾问服务',
  '发票与账单，批量折扣',
]

const MENU_DATA: Record<MenuKey, { title: string; columns: MenuColumn[] }> = {
  features: {
    title: '功能',
    columns: [{ links: [
      { label: 'ChatGPT Work', href: '/openai/work' },
      { label: '深入研究', href: '/openai/features/deep-research' },
      { label: '图像', href: '/images' },
      { label: '插件', href: '/plugins' },
      { label: '远程', href: '/openai/remote' },
      { label: '购物', href: '/openai/shopping' },
      { label: '学习模式', href: '/openai/features/study-mode' },
      { label: '语音', href: '/openai/features/voice' },
      { label: '语音功能（支持视频）', href: '/openai/features/voice-with-video' },
    ] }],
  },
  learn: {
    title: '学习',
    columns: [
      { title: 'ChatGPT 适用于', links: [
        { label: '学生', href: '/openai/use-cases/students' },
        { label: '大学教师', href: '/openai/use-cases/university-educators' },
        { label: '教师', href: '/openai/use-cases/teachers' },
        { label: '科学与医学', href: '/openai/use-cases/science-medicine' },
        { label: '家长', href: '/openai/parent-resources' },
        { label: '退役军人', href: '/openai/use-cases/veterans' },
      ] },
      { title: '灵感', links: [
        { label: '运动锻炼与保健养生', href: '/openai/use-cases/fitness-wellness-and-health' },
        { label: '个人理财', href: '/openai/use-cases/money-and-finances' },
        { label: '食谱与烹饪', href: '/openai/use-cases/recipes-cooking' },
        { label: '旅行与探索', href: '/openai/use-cases/travel-and-exploration' },
      ] },
      { title: '使用方式', links: [
        { label: 'ChatGPT 中的 Canva', href: '/openai/apps/canva' },
        { label: 'ChatGPT 中的 Spotify', href: '/openai/apps/spotify' },
        { label: 'ChatGPT for PowerPoint', href: '/openai/apps/powerpoint' },
        { label: '与 PDF 对话', href: '/openai/features/chat-with-pdfs' },
        { label: '与演示文稿对话', href: '/openai/use-cases/chat-with-presentations' },
        { label: '与电子表格对话', href: '/openai/use-cases/chat-with-spreadsheets' },
        { label: '适用于大学生', href: '/openai/college-students' },
      ] },
    ],
  },
  codex: {
    title: 'Codex',
    columns: [{ links: [
      { label: '概览', href: '/openai/codex' },
      { label: '定价', href: '/openai/codex/pricing' },
      { label: 'Enterprise', href: '/openai/codex/enterprise' },
      { label: '导入到 ChatGPT', href: '/openai/import-to-chatgpt' },
      { label: '开发者文档', href: '/openai/developers/codex' },
      { label: '活动', href: '/openai/academy/events' },
    ] }],
  },
  business: {
    title: 'Business',
    columns: [{ links: [
      { label: '概览', href: '/openai/business' },
      { label: '联系销售团队', href: '/openai/contact-sales' },
      { label: '商家', href: '/openai/merchants' },
      { label: '数据科学与分析', href: '/openai/business/ai-for-data-science-analytics' },
      { label: '工程', href: '/openai/business/ai-for-engineering' },
      { label: '财务', href: '/openai/business/ai-for-finance' },
      { label: '产品管理', href: '/openai/business/ai-for-product-management' },
      { label: '销售与市场营销', href: '/openai/business/ai-for-sales-marketing' },
    ] }],
  },
  pricing: {
    title: '定价',
    columns: [{ links: [
      { label: '概览', href: '/pricing' },
      { label: '免费版', href: '/openai/plans/free' },
      { label: 'Go', href: '/openai/plans/go' },
      { label: 'Plus', href: '/openai/plans/plus' },
      { label: 'Pro', href: '/openai/plans/pro' },
      { label: 'Enterprise 版', href: '/openai/business/enterprise' },
      { label: '高等教育', href: '/openai/business/education' },
    ] }],
  },
}

const NAV_ITEMS: Array<{ label: string; href?: string; menu?: MenuKey }> = [
  { label: '简介', href: '/openai/overview' },
  { label: '功能', menu: 'features' },
  { label: '学习', menu: 'learn' },
  { label: 'Codex', menu: 'codex' },
  { label: 'Business', menu: 'business' },
  { label: '定价', menu: 'pricing' },
  { label: '下载', href: '/openai/download' },
]

const p = (label: string, personal: string[], business: string[]): CompareRow => ({ label, personal, business })
const ALL = ['✓', '✓', '✓', '✓']
const BIZ = ['✓', '✓']

const COMPARISON_GROUPS: CompareGroup[] = [
  { title: '核心功能', rows: [
    p('日常文本聊天', ['无限制*', '无限制*', '无限制*', '无限制*'], ['无限制*', '无限制*']),
    p('聊天历史记录', ['无限制*', '无限制*', '无限制*', '无限制*'], ['无限制*', '无限制*']),
    p('支持网页、iOS 和 Android 访问', ALL, BIZ),
  ] },
  { title: '模型', rows: [
    p('GPT-5.6 Sol', ['—', '—', '扩展版', '无限制*'], ['灵活**', '灵活**']),
    p('GPT-5.6 Sol Pro', ['—', '—', '扩展版', '无限制*'], ['灵活**', '灵活**']),
    p('GPT-5.6 Terra', ['桌面端 Work 和 Codex（有限使用）', '桌面端 Work 和 Codex（有限使用）', '扩展版', '无限制*'], ['灵活**', '灵活**']),
    p('GPT-5.6 Luna', ['—', '—', '扩展版', '无限制*'], ['灵活**', '灵活**']),
    p('GPT-5 Thinking Mini', ['—', '—', '扩展版', '无限制*'], ['灵活**', '灵活**']),
    p('旧版模型', ['—', '—', '—', '✓'], ['灵活**', '灵活**']),
    p('响应时间', ['带宽和可用性受限', '带宽与可用性受限', '快', '快'], ['快', '最快']),
    p('GPT Instant 总上下文窗口', ['27K', '54K', '54K', '128K'], ['54K', '128K']),
    p('GPT Instant 输入上限***', ['约 12 页文本', '约 40 页文本', '约 40 页文本', '约 250 页文本'], ['约 40 页文本', '约 250 页文本']),
    p('GPT 推理总上下文窗口', ['不定', '256K', '256K', '400K'], ['256K', '256K']),
    p('GPT 推理输入上限***', ['不定', '约 320 页文本', '约 320 页文本', '约 680 页文本'], ['约 320 页文本', '约 320 页文本']),
    p('随着模型的改进，定期进行质量与速度的更新', ALL, BIZ),
  ] },
  { title: '功能', rows: [
    p('ChatGPT Work', ['受限（桌面端应用）', '受限（桌面端应用）', '桌面端、网页端和移动端', '桌面端、网页端和移动端'], ['桌面端、网页端和移动端', '桌面端、网页端和移动端']),
    p('Codex', ['有限', '有限', '扩展版', '✓'], ['灵活**', '✓']),
    p('插件', ['有限', '✓', '✓', '✓'], BIZ),
    p('语音', ['有限', '扩展版', '扩展版', '无限制*'], ['扩展版', '灵活**']),
    p('语音功能（支持视频）', ['—', '—', '✓', '✓'], BIZ),
    p('技能（测试版）', ['—', '—', '扩展版', '✓'], ['灵活**', '✓']),
    p('记忆', ['有限', '扩展版', '扩展版', '✓'], ['扩展版', '扩展版']),
    p('含过去对话的记忆', ['有限', '扩展版', '扩展版', '✓'], ['即将推出', '即将推出']),
    p('记忆来源', ['有限', '扩展版', '扩展版', '✓'], ['即将推出', '即将推出']),
    p('搜索', ALL, BIZ),
    p('在 macOS 上进行代码编辑', ['—', '—', '✓', '✓'], BIZ),
    p('文件上传', ['有限', '✓', '✓', '✓'], BIZ),
    p('项目', ['—', '✓', '✓', '✓'], BIZ),
    p('共享项目', ['—', '—', '✓', '✓'], BIZ),
    p('计划任务', ['—', '—', '✓', '✓'], BIZ),
    p('站点', ['—', '—', '✓', '✓'], BIZ),
    p('内置浏览器', ['—', '—', '✓', '✓'], BIZ),
    p('工作空间智能体', ['—', '—', '—', '✓'], BIZ),
    p('数据分析', ['有限', '✓', '✓', '✓'], BIZ),
    p('视觉', ['有限', '✓', '✓', '✓'], BIZ),
    p('连接内部工具的应用', ['—', '—', '✓', '✓'], BIZ),
    p('互动类应用', ['—', '✓', '✓', '✓'], BIZ),
    p('Excel、PowerPoint 和 Google Sheets 扩展程序', ['有限', '有限', '扩展版', '✓'], BIZ),
    p('公司知识', ['—', '—', '—', '✓'], BIZ),
    p('开发者模式（测试版）', ['—', '—', '✓', '✓'], BIZ),
    p('ChatGPT 录制模式', ['—', '—', '✓', '✓'], BIZ),
    p('发现并使用 GPT', ALL, BIZ),
    p('创建并分享 GPT', ['—', '✓', '✓', '✓'], BIZ),
    p('在工作空间中分享 GPT', ['—', '—', '—', '✓'], BIZ),
    p('测试新功能的机会', ['—', '—', '✓', '✓'], BIZ),
    p('图像生成', ['有限', '✓', '✓', '✓'], BIZ),
    p('结合思考过程的图像生成', ['—', '—', '✓', '✓'], BIZ),
    p('交互式表格和图表', ['—', '—', '✓', '✓'], BIZ),
    p('深度研究', ['有限', '有限', '✓', '✓'], ['灵活**', '✓']),
    p('深度研究类应用', ['有限', '有限', '✓', '✓'], BIZ),
    p('学习模式', ALL, BIZ),
  ] },
  { title: '隐私', rows: [
    p('内容会否用于训练我们的模型', ['可以选择退出', '可以选择退出', '可以选择退出', '可以选择退出'], ['不会。', '不会。']),
  ] },
  { title: '安全与管理', rows: [
    p('SAML SSO', ['—', '—', '—', '—'], BIZ),
    p('统一账单', ['—', '—', '—', '—'], BIZ),
    p('专属工作空间', ['—', '—', '—', '—'], BIZ),
    p('GPT 分析与管理', ['—', '—', '—', '—'], BIZ),
    p('管理员控制台', ['—', '—', '—', '—'], BIZ),
    p('批量成员管理', ['—', '—', '—', '—'], BIZ),
    p('管理员角色', ['—', '—', '—', '—'], BIZ),
    p('Soc 2 Type 2 合规', ['—', '—', '—', '—'], BIZ),
    p('基础用户分析', ['—', '—', '—', '—'], BIZ),
    p('域验证', ['—', '—', '—', '—'], BIZ),
    p('ISO 27001、27017、27018 和 27701 认证', ['—', '—', '—', '—'], BIZ),
    p('SCIM', ['—', '—', '—', '—'], ['—', '✓']),
    p('企业密钥管理', ['—', '—', '—', '—'], ['—', '✓']),
    p('更精细的 GPT 管控与群组权限', ['—', '—', '—', '—'], ['—', '✓']),
    p('基于角色的访问控制', ['—', '—', '—', '—'], ['—', '✓']),
    p('分析控制面板', ['—', '—', '—', '—'], ['—', '✓']),
    p('合规 API 日志平台', ['—', '—', '—', '—'], ['—', '✓']),
    p('IP 白名单', ['—', '—', '—', '—'], ['—', '✓']),
    p('数据驻留地：美国、欧盟、英国、日本、加拿大、韩国、新加坡、印度、澳大利亚、阿联酋', ['—', '—', '—', '—'], ['—', '✓']),
    p('适用于 iOS 的 Intune', ['—', '—', '—', '—'], ['—', '✓']),
    p('品牌化工作空间', ['—', '—', '—', '—'], ['—', '✓']),
    p('全局管理员控制台', ['—', '—', '—', '—'], ['—', '✓']),
    p('连接器注册表', ['—', '—', '—', '—'], ['—', '✓']),
  ] },
  { title: '客户服务', rows: [
    p('高级支持', ['—', '—', '—', '—'], BIZ),
    p('专属启用服务', ['—', '—', '—', '—'], ['—', '✓']),
    p('持续帐户管理', ['—', '—', '—', '—'], ['—', '✓']),
    p('定制安全评估', ['—', '—', '—', '—'], ['—', '✓']),
  ] },
]

const FAQS = [
  ['ChatGPT 定价方式是怎样的？', 'ChatGPT 免费版对所有人开放。付费套餐（Go、Plus、Business 和 Enterprise）按每位用户每月收费。我们提供 Go、Plus 和 Business 的月度套餐，以及 Business 和 Enterprise 的年度套餐。'],
  ['ChatGPT 可以免费使用吗？', 'ChatGPT 免费版对所有人开放。升级到 Go、Plus、Business 或 Enterprise 套餐，即可通过更多模型和功能的使用权限，畅享更出色的体验。'],
  ['OpenAI 是否为教育机构提供 ChatGPT 套餐？', '是的。我们提供 ChatGPT for Teachers，这是面向经认证的美国 K–12 教育工作者的免费套餐，有效期至 2027 年 6 月；同时也推出 ChatGPT Edu，一款价格合理的套餐，帮助高校在校园社区广泛部署 AI。两款套餐均配备更出色的安全与隐私保护，为院校、学区和大学提供更多管理功能。'],
  ['OpenAI 是否为非营利组织提供优惠？', '通过 OpenAI for Nonprofits，非营利组织现在可以享受 ChatGPT Business 或 ChatGPT Enterprise 套餐最高 75% 的优惠。联系销售团队即可开始使用。'],
  ['每个订阅套餐支持多少用户？', 'Go、免费版和 Plus 套餐均为个人使用而设计。Business 和 Enterprise 套餐面向企业。Business 套餐从 2 位用户起订。如需了解更多关于 Enterprise 套餐的信息，请联系销售团队。'],
  ['付款选项有哪些？', '你可以使用任何主要信用卡购买 ChatGPT Go、Plus、Pro 或 Business。对于 ChatGPT Enterprise，如需发票等其他付款方式，请联系销售团队。'],
  ['ChatGPT 的安全性如何？', '所有数据在传输过程中均通过 TLS 1.2 加密，静态数据采用 AES-256 加密，并通过严格的访问控制来限制数据访问权限。我们的安全团队全年 7×24 小时待命，一旦出现潜在的安全事件会立即响应。我们还提供漏洞赏金计划，用于负责任地披露在我们的平台和产品中发现的安全漏洞。'],
  ['ChatGPT 如何使用我的数据？', '我们让你掌控自己的数据。详情参阅用户数据使用方式以及我们的企业隐私承诺。'],
] as const

const LANGUAGES = [
  ['Հայերեն', 'Armenian'], ['বাংলা', 'Bangla'], ['Bosanski', 'Bosnian'], ['Български', 'Bulgarian'], ['မြန်မာ', 'Burmese'],
  ['Català', 'Catalan'], ['中文  中国', 'Chinese · China'], ['中文  香港', 'Chinese · Hong Kong'], ['中文  台灣', 'Chinese · Taiwan'],
  ['Hrvatski', 'Croatian'], ['Čeština', 'Czech'], ['Dansk', 'Danish'], ['Nederlands', 'Dutch'], ['English', 'English'],
  ['Suomi', 'Finnish'], ['Français', 'French'], ['Deutsch', 'German'], ['Ελληνικά', 'Greek'], ['עברית', 'Hebrew'],
  ['हिन्दी', 'Hindi'], ['Magyar', 'Hungarian'], ['Bahasa Indonesia', 'Indonesian'], ['Italiano', 'Italian'], ['日本語', 'Japanese'],
  ['한국어', 'Korean'], ['Norsk', 'Norwegian'], ['Polski', 'Polish'], ['Português', 'Portuguese'], ['Română', 'Romanian'],
  ['Русский', 'Russian'], ['Español', 'Spanish'], ['Svenska', 'Swedish'], ['ไทย', 'Thai'], ['Türkçe', 'Turkish'], ['Українська', 'Ukrainian'], ['Tiếng Việt', 'Vietnamese'],
] as const

function LocalLink({ href, onNavigate, className, children, ariaLabel }: {
  href: string
  onNavigate: (path: string) => void
  className?: string
  children: ReactNode
  ariaLabel?: string
}) {
  const click = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    onNavigate(href)
  }
  return <a className={className} href={href} aria-label={ariaLabel} onClick={click}>{children}</a>
}

function MenuLinks({ columns, onNavigate, mobile = false }: { columns: MenuColumn[]; onNavigate: (path: string) => void; mobile?: boolean }) {
  return (
    <div className={`pricing-menu-columns${mobile ? ' is-mobile' : ''}`}>
      {columns.map((column, index) => <div className="pricing-menu-column" key={`${column.title ?? 'links'}-${index}`}>
        {column.title && <p>{column.title}</p>}
        {column.links.map((link) => <LocalLink href={link.href} onNavigate={onNavigate} key={`${link.label}-${link.href}`}>
          <span>{link.label}</span>{link.note && <small>{link.note}</small>}
        </LocalLink>)}
      </div>)}
    </div>
  )
}

function PersonalCard({ plan, onNavigate }: { plan: Plan; onNavigate: (path: string) => void }) {
  return (
    <article className="pricing-plan">
      <div className="pricing-plan-top"><h3>{plan.name}</h3><p>{plan.description}</p></div>
      <div className="pricing-price"><small>{plan.prefix}</small><span>{plan.price}</span><em>{plan.cadence}</em></div>
      <LocalLink className="pricing-plan-cta" href={plan.href} onNavigate={onNavigate}>{plan.cta}<Arrow /></LocalLink>
      <div className="pricing-features">
        {plan.intro && <strong><Sparkles aria-hidden="true" />{plan.intro}</strong>}
        <ul>{plan.features.map((feature) => <li key={feature}><Check aria-hidden="true" /><span>{feature}</span></li>)}</ul>
        {plan.notes && <div className="pricing-plan-notes">{plan.notes.map((note, index) => <p key={`${note.label}-${index}`}>
          {note.before}<LocalLink href={note.href} onNavigate={onNavigate}>{note.label}</LocalLink>{note.after}
        </p>)}</div>}
      </div>
    </article>
  )
}

function BusinessCards({ onNavigate }: { onNavigate: (path: string) => void }) {
  return <>
    <article className="pricing-plan pricing-business-plan">
      <div className="pricing-plan-top"><h3>Business <span>ChatGPT 和 Codex</span></h3><p>一个安全的工作空间，具备公司上下文信息和灵活的席位类型，适合各种预算</p></div>
      <LocalLink className="pricing-plan-cta" href="/auth/team-sign-up?callback_path=%2Fpricing" onNavigate={onNavigate}>开始使用<Arrow /></LocalLink>
      <div className="pricing-seat-list">
        <div><h4>标准席位</h4><div><b>JP¥3,050</b><span>/月</span></div><p>日常工作的理想之选</p><small>JP¥3,050/月（按年计费）。JP¥3,850/月（按月计费）。</small></div>
        <div><h4>高级席位</h4><div><b>JP¥15,250</b><span>/月</span></div><p>用量是标准席位的 5 倍，且无 5 小时限制</p><small>JP¥15,250/月（按年计费）。JP¥19,250/月（按月计费）。</small></div>
      </div>
      <div className="pricing-features business-features"><strong>包含内容：</strong><ul>{BUSINESS_FEATURES.map((feature) => <li key={feature}><Check aria-hidden="true" /><span>{feature}</span></li>)}</ul>
        <div className="pricing-plan-notes"><p>适用于 2–200 名员工的团队。无限制使用需遵守防滥用规范。<LocalLink href="/help/business-plan" onNavigate={onNavigate}>了解更多</LocalLink></p></div>
      </div>
    </article>
    <article className="pricing-plan pricing-business-plan is-enterprise">
      <div className="pricing-plan-top"><h3>大型企业</h3><p>面向大规模组织的企业级 AI、安全性及支持服务</p></div>
      <LocalLink className="pricing-plan-cta" href="/openai/contact-sales" onNavigate={onNavigate}>联系销售团队<Arrow /></LocalLink>
      <div className="pricing-enterprise-price"><h4>自定义价格</h4><p>请联系销售团队洽谈企业定价。*</p></div>
      <div className="pricing-features business-features"><strong>包含内容：</strong><ul>{ENTERPRISE_FEATURES.map((feature) => <li key={feature}><Check aria-hidden="true" /><span>{feature}</span></li>)}</ul>
        <div className="pricing-plan-notes"><p>*Enterprise 套餐支持按<LocalLink href="/help/business-credits" onNavigate={onNavigate}>额度</LocalLink>计费和按 <LocalLink href="/help/token-billing" onNavigate={onNavigate}>Token</LocalLink> 计费。</p></div>
      </div>
    </article>
  </>
}

function CookieDialog({ onClose }: { onClose: () => void }) {
  const [marketing, setMarketing] = useState(true)
  const [personalized, setPersonalized] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)
  const entries = [
    { key: 'necessary', title: '严格必要', description: '这些 Cookie 是网站正常运行所必需的，无法关闭。它们支持安全、用户身份验证和客户支持等核心功能。', value: true, disabled: true },
    { key: 'marketing', title: '营销效果衡量', description: '这些 Cookie 可帮助我们衡量营销活动效果。', value: marketing, setValue: setMarketing },
    { key: 'personalized', title: '个性化营销', description: '这些 Cookie 可帮助我们在第三方平台上对 OpenAI 自有营销内容进行个性化设置并衡量效果。', value: personalized, setValue: setPersonalized },
  ]
  return (
    <div className="pricing-modal-layer" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose() }}>
      <section className="pricing-cookie-dialog" role="dialog" aria-modal="true" aria-labelledby="cookie-title">
        <header><h2 id="cookie-title">Cookie 偏好设置</h2><button type="button" onClick={onClose} aria-label="关闭 Cookie 偏好设置"><X /></button></header>
        <p className="pricing-cookie-intro">网站和应用会使用 Cookie 及其他标识符在你的设备上存储并读取信息。部分信息可能会因不同目的与第三方共享。你可通过下方工具管理偏好设置，并随时进行更改。 <u>了解更多</u></p>
        <div className="pricing-cookie-options">
          {entries.map((entry) => <div className={`pricing-cookie-option${expanded === entry.key ? ' is-expanded' : ''}`} key={entry.key}>
            <button type="button" className="pricing-cookie-copy" onClick={() => setExpanded((old) => old === entry.key ? null : entry.key)} aria-expanded={expanded === entry.key}>
              <span>{entry.title}</span><small>{entry.description}</small><ChevronRight aria-hidden="true" />
            </button>
            <button className="pricing-cookie-switch" type="button" role="switch" aria-checked={entry.value} disabled={entry.disabled} onClick={() => entry.setValue?.(!entry.value)}><span /></button>
          </div>)}
        </div>
      </section>
    </div>
  )
}

function LanguageDialog({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState('')
  const shown = LANGUAGES.filter((language) => language.join(' ').toLowerCase().includes(query.trim().toLowerCase()))
  return (
    <div className="pricing-language-layer" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose() }}>
      <section className="pricing-language-dialog" role="dialog" aria-modal="true" aria-labelledby="language-title">
        <header><h2 id="language-title">选择语言</h2><button type="button" onClick={onClose} aria-label="关闭语言选择"><X /></button></header>
        <div className="pricing-language-list">{shown.map(([native, english]) => <button type="button" key={`${native}-${english}`} className={english === 'Chinese · China' ? 'is-current' : ''} onClick={onClose}><span><b>{native}</b><small>{english}</small></span>{english === 'Chinese · China' && <Check />}</button>)}</div>
        <label className="pricing-language-search"><Search aria-hidden="true" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索" aria-label="搜索语言" /></label>
      </section>
    </div>
  )
}

export default function PricingPage({ onNavigate }: { onNavigate: (path: string) => void }) {
  const [mode, setMode] = useState<PricingMode>('personal')
  const [menuOpen, setMenuOpen] = useState(false)
  const [desktopMenu, setDesktopMenu] = useState<MenuKey | null>(null)
  const [mobilePanel, setMobilePanel] = useState<MenuKey | null>(null)
  const [openFaq, setOpenFaq] = useState(0)
  const [comparePlan, setComparePlan] = useState(0)
  const [compareDockVisible, setCompareDockVisible] = useState(false)
  const [cookieOpen, setCookieOpen] = useState(false)
  const [languageOpen, setLanguageOpen] = useState(false)
  const pageRef = useRef<HTMLElement>(null)
  const comparisonRef = useRef<HTMLElement>(null)
  const comparePlans = mode === 'personal' ? PERSONAL_PLANS.map(({ name, cta, href }) => ({ name, cta: cta.replace(' 版本', ''), href })) : [
    { name: 'Business', cta: '获取 Business', href: '/auth/team-sign-up?callback_path=%2Fpricing' },
    { name: 'Enterprise', cta: '联系销售团队', href: '/openai/contact-sales' },
  ]

  useEffect(() => {
    document.title = '定价 | ChatGPT 镜像站'
    return () => { document.title = 'ChatGPT 镜像站' }
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setDesktopMenu(null)
      setMenuOpen(false)
      setMobilePanel(null)
      setCookieOpen(false)
      setLanguageOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    const scroller = pageRef.current
    const comparison = comparisonRef.current
    if (!scroller || !comparison) return
    const update = () => {
      const rect = comparison.getBoundingClientRect()
      setCompareDockVisible(rect.top < window.innerHeight - 110 && rect.bottom > 190)
    }
    update()
    scroller.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)
    return () => { scroller.removeEventListener('scroll', update); window.removeEventListener('resize', update) }
  }, [mode])

  const navigate = (path: string) => {
    setMenuOpen(false)
    setMobilePanel(null)
    setDesktopMenu(null)
    onNavigate(path)
  }

  const switchMode = (next: PricingMode) => {
    if (next === mode) return
    setMode(next)
    setComparePlan(0)
    setDesktopMenu(null)
  }

  const openAuth = (screenHint: 'login' | 'signup') => navigate(`/auth/email?callback_path=%2Fpricing&screen_hint=${screenHint}`)

  const toggleDesktopMenu = (menu: MenuKey) => setDesktopMenu((current) => current === menu ? null : menu)

  return (
    <main ref={pageRef} className={`pricing-page${menuOpen ? ' menu-is-open' : ''}`}>
      <header className="pricing-header">
        <LocalLink href="/" ariaLabel="ChatGPT 首页" onNavigate={navigate}><ChatGPTMark wordmark /></LocalLink>
        <nav aria-label="主导航">
          {NAV_ITEMS.map((item) => item.menu ? <button type="button" key={item.label} aria-expanded={desktopMenu === item.menu} onClick={() => toggleDesktopMenu(item.menu!)}>{item.label}</button> : <LocalLink key={item.label} href={item.href!} onNavigate={navigate}>{item.label}</LocalLink>)}
        </nav>
        <div className="pricing-header-actions">
          <button className="pricing-login" type="button" onClick={() => openAuth('login')}>登录</button>
          <button className="pricing-signup" type="button" onClick={() => openAuth('signup')}>免费注册</button>
          <button className="pricing-menu-button" type="button" aria-label={menuOpen ? '关闭菜单' : '打开菜单'} aria-expanded={menuOpen} onClick={() => { setMenuOpen((value) => !value); setMobilePanel(null) }}>{menuOpen ? <X /> : <Menu />}</button>
        </div>
        {desktopMenu && <div className={`pricing-desktop-menu is-${desktopMenu}`}>
          <MenuLinks columns={MENU_DATA[desktopMenu].columns} onNavigate={navigate} />
        </div>}
      </header>

      {menuOpen && <div className="pricing-mobile-menu" role="dialog" aria-modal="true" aria-label="导航菜单">
        {!mobilePanel ? <nav className="pricing-mobile-menu-main">
          {NAV_ITEMS.map((item) => item.menu ? <button key={item.label} type="button" onClick={() => setMobilePanel(item.menu!)}>{item.label}</button> : <LocalLink key={item.label} href={item.href!} onNavigate={navigate}>{item.label}</LocalLink>)}
        </nav> : <div className="pricing-mobile-submenu">
          <button type="button" className="pricing-mobile-back" onClick={() => setMobilePanel(null)}><ChevronLeft />返回</button>
          <h2>{MENU_DATA[mobilePanel].title}</h2>
          <MenuLinks columns={MENU_DATA[mobilePanel].columns} onNavigate={navigate} mobile />
        </div>}
      </div>}

      <div className="pricing-page-content" onClick={() => setDesktopMenu(null)}>
        <section className="pricing-hero">
          <p>ChatGPT</p>
          <h1>定价</h1>
          <h2>查看我们的个人、Business 和 Enterprise 套餐定价</h2>
        </section>

        <div className="pricing-mode-switch" role="tablist" aria-label="套餐类型">
          <button type="button" role="tab" aria-selected={mode === 'personal'} onClick={(event) => { event.stopPropagation(); switchMode('personal') }}><UserRound aria-hidden="true" />个人</button>
          <button type="button" role="tab" aria-selected={mode === 'business'} onClick={(event) => { event.stopPropagation(); switchMode('business') }}><UsersRound aria-hidden="true" />商业与企业</button>
        </div>

        <section className={`pricing-plans-grid is-${mode}`} id="pricing-plans" aria-live="polite">
          {mode === 'personal' ? PERSONAL_PLANS.map((plan) => <PersonalCard key={plan.name} plan={plan} onNavigate={navigate} />) : <BusinessCards onNavigate={navigate} />}
        </section>

        <section className="pricing-trust" aria-label="客户">
          <p>深受各类组织与团队的信赖</p>
          <div aria-hidden="true"><b>asana</b><b>zendesk</b><b>RIOT</b><b>shopify</b><b>Klarna.</b></div>
        </section>

        <section ref={comparisonRef} className={`pricing-comparison is-${mode}`}>
          <h2>比较各个套餐的功能</h2>
          <div className="pricing-comparison-shell">
            <div className={`pricing-compare-head cols-${comparePlans.length}`}>
              <span />
              {comparePlans.map((plan) => <div key={plan.name}><strong>{plan.name}</strong><LocalLink href={plan.href} onNavigate={navigate}>{plan.cta}<Arrow /></LocalLink></div>)}
            </div>
            <div className="pricing-comparison-mobile-tabs" role="tablist" aria-label="选择要比较的套餐">
              {comparePlans.map((plan, index) => <button type="button" role="tab" aria-selected={comparePlan === index} onClick={() => setComparePlan(index)} key={plan.name}>{plan.name}</button>)}
            </div>
            <div className="pricing-compare-groups">
              {COMPARISON_GROUPS.map((group) => <section className="pricing-compare-group" key={group.title}>
                <h3>{group.title}</h3>
                {group.rows.map((row) => {
                  const values = mode === 'personal' ? row.personal : row.business
                  return <div className={`pricing-compare-row cols-${values.length}`} key={row.label}>
                    <strong>{row.label}</strong>
                    <div className="pricing-compare-values">{values.map((value, index) => <span key={`${value}-${index}`}>{value}</span>)}</div>
                    <span className="pricing-compare-mobile-value">{values[comparePlan] ?? '—'}</span>
                  </div>
                })}
              </section>)}
            </div>
            <div className="pricing-comparison-notes">
              <p>*使用方式必须合理并符合我们的<LocalLink href="/openai/policies/usage-policies" onNavigate={navigate}>政策</LocalLink></p>
              <p>**Enterprise 和 Business 客户可购买额度以提升使用量</p>
              <p>***ChatGPT 维护一个共享的上下文窗口，用于理解你的请求、追踪对话内容、检索相关信息并生成回复。可用于用户输入的空间小于窗口的总容量，因为部分空间还需用于系统指令、记忆功能以及内部处理。系统报告的用户输入空间仅为近似值，并可能根据正在使用的功能及记忆内容而动态变化。</p>
            </div>
          </div>
        </section>

        <section className="pricing-faq">
          <h2>常见问题解答</h2>
          <div>{FAQS.map(([question, answer], index) => <article className={openFaq === index ? 'is-open' : ''} key={question}>
            <button type="button" aria-expanded={openFaq === index} onClick={() => setOpenFaq(index)} disabled={openFaq === index}><span>{question}</span><i>{openFaq === index ? '−' : '+'}</i></button>
            <div className="pricing-faq-answer"><p>{answer}</p></div>
          </article>)}</div>
        </section>

        <footer className="pricing-footer">
          <LocalLink href="/" ariaLabel="ChatGPT" onNavigate={navigate}><ChatGPTMark /></LocalLink>
          <div className="pricing-footer-groups">
            <div><h2>OpenAI</h2><LocalLink href="/openai/research" onNavigate={navigate}>研究</LocalLink><LocalLink href="/openai/safety" onNavigate={navigate}>安全</LocalLink><LocalLink href="/openai/api" onNavigate={navigate}>API</LocalLink><LocalLink href="/openai/news" onNavigate={navigate}>新闻</LocalLink></div>
            <div><h2>条款与政策</h2><LocalLink href="/terms" onNavigate={navigate}>使用条款</LocalLink><LocalLink href="/privacy" onNavigate={navigate}>隐私政策</LocalLink><LocalLink href="/openai/policies/usage-policies" onNavigate={navigate}>使用政策</LocalLink><LocalLink href="/openai/policies" onNavigate={navigate}>其他政策</LocalLink></div>
          </div>
          <div className="pricing-footer-bottom">
            <span>OpenAI © 2015–2026</span>
            <button type="button" onClick={() => setCookieOpen(true)}>管理 Cookie</button>
            <div className="pricing-socials" aria-label="社交媒体"><LocalLink href="/openai/social/x" onNavigate={navigate}>X</LocalLink><LocalLink href="/openai/social/youtube" onNavigate={navigate}>▶</LocalLink><LocalLink href="/openai/social/linkedin" onNavigate={navigate}>in</LocalLink><LocalLink href="/openai/social/github" onNavigate={navigate}>◉</LocalLink><LocalLink href="/openai/social/instagram" onNavigate={navigate}>◎</LocalLink><LocalLink href="/openai/social/tiktok" onNavigate={navigate}>♪</LocalLink></div>
            <button className="pricing-language-button" type="button" onClick={() => setLanguageOpen(true)}><Globe2 />中文 <span>中国</span><ChevronDown /></button>
          </div>
        </footer>
      </div>

      {compareDockVisible && <div className="pricing-mobile-compare-dock">
        <div role="tablist" aria-label="比较套餐">{comparePlans.map((plan, index) => <button type="button" role="tab" aria-selected={comparePlan === index} onClick={() => setComparePlan(index)} key={plan.name}>{plan.name}</button>)}</div>
        <LocalLink href={comparePlans[comparePlan]?.href ?? '/pricing'} onNavigate={navigate}>{comparePlans[comparePlan]?.cta}<Arrow /></LocalLink>
      </div>}
      {cookieOpen && <CookieDialog onClose={() => setCookieOpen(false)} />}
      {languageOpen && <LanguageDialog onClose={() => setLanguageOpen(false)} />}
    </main>
  )
}
