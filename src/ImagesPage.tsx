import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
} from 'react'
import { IMAGE_IDEAS, type ImageIdea } from './imagesData'
import {
  generateImage,
  imageGenerationErrorMessage,
  type GeneratedImage,
} from './lib/imageTransport'
import './ImagesPage.css'

type ImagesPageProps = {
  onRequestAuth: () => void
  onNotice?: (message: string) => void
  authenticated?: boolean
  model?: string
}

function SpriteIcon({ id, size = 20 }: { id: string; size?: number }) {
  return (
    <svg aria-hidden="true" fill="none" height={size} viewBox={`0 0 ${size} ${size}`} width={size}>
      <use href={`/chatgpt-icons.svg#${id}`} />
    </svg>
  )
}

function ExpandIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg aria-hidden="true" fill="none" height="18" viewBox="0 0 18 18" width="18">
      {expanded ? (
        <>
          <path d="M3.75 7.25h3.5v-3.5M14.25 10.75h-3.5v3.5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" />
          <path d="m7.2 3.8-3.4 3.4m6.95 6.95 3.4-3.4" stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" />
        </>
      ) : (
        <>
          <path d="M6.25 3.75h-2.5v2.5M11.75 14.25h2.5v-2.5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" />
          <path d="m3.8 6.2 3.4-3.4m7 8-3.4 3.4" stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" />
        </>
      )}
    </svg>
  )
}

function ImageIdeaCard({ idea, index, onSelect, authenticated = false }: { idea: ImageIdea; index: number; onSelect: (idea: ImageIdea, index: number) => void; authenticated?: boolean }) {
  return (
    <button
      type="button"
      className={`images-idea-card${!authenticated && index >= 10 ? ' is-desktop-gated' : ''}`}
      aria-label={idea.title}
      data-card-index={index}
      onClick={() => onSelect(idea, index)}
    >
      <span className="images-card-inner">
        <img alt="" decoding="async" loading={index < 4 ? 'eager' : 'lazy'} src={idea.image} />
        <span className="images-card-scrim" />
        <span className="images-card-label">{idea.title}</span>
      </span>
    </button>
  )
}

function ImagesPage({ onRequestAuth, onNotice, authenticated = false, model = 'auto' }: ImagesPageProps) {
  const [prompt, setPrompt] = useState('')
  const [editorLong, setEditorLong] = useState(false)
  const [editorOverflowing, setEditorOverflowing] = useState(false)
  const [manuallyExpanded, setManuallyExpanded] = useState(false)
  const [attachmentFile, setAttachmentFile] = useState<File | null>(null)
  const [micState, setMicState] = useState<'idle' | 'requesting' | 'listening'>('idle')
  const [generating, setGenerating] = useState(false)
  const [generationStatus, setGenerationStatus] = useState('')
  const [generationError, setGenerationError] = useState('')
  const [generatedImages, setGeneratedImages] = useState<GeneratedImage[]>([])
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const generationAbortRef = useRef<AbortController | null>(null)
  const attachmentName = attachmentFile?.name ?? ''

  const sizeEditor = useCallback(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    const isMobile = window.matchMedia('(max-width: 767px)').matches
    const normalMax = isMobile ? 252.2 : 224
    const expandedMax = Math.max(normalMax, Math.min(window.innerHeight * 0.58, 480))
    const maxHeight = manuallyExpanded ? expandedMax : normalMax

    textarea.style.height = '0px'
    const naturalHeight = textarea.scrollHeight
    const nextHeight = Math.max(42, Math.min(naturalHeight, maxHeight))
    textarea.style.height = `${nextHeight}px`
    setEditorLong(naturalHeight > 120)
    setEditorOverflowing(naturalHeight > maxHeight + 1)
  }, [manuallyExpanded])

  useLayoutEffect(() => {
    sizeEditor()
  }, [prompt, sizeEditor])

  useEffect(() => {
    window.addEventListener('resize', sizeEditor)
    return () => window.removeEventListener('resize', sizeEditor)
  }, [sizeEditor])

  useEffect(() => () => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    generationAbortRef.current?.abort()
  }, [])

  const chooseIdea = (idea: ImageIdea, index: number) => {
    const gated = index >= 10 || (window.matchMedia('(max-width: 767px)').matches && index >= 4)
    if (!authenticated && gated) {
      onRequestAuth()
      return
    }
    // ProseMirror serializes a paragraph break as several newlines. A native
    // textarea would render those as multiple empty rows, so collapse them to
    // the single visual paragraph gap used by the live editor.
    setPrompt(idea.prompt.replace(/\n{3,}/g, '\n\n'))
    setManuallyExpanded(false)
    window.setTimeout(() => {
      const textarea = textareaRef.current
      if (!textarea) return
      textarea.focus({ preventScroll: true })
      textarea.setSelectionRange(textarea.value.length, textarea.value.length)
    }, 0)
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!prompt.trim() && !attachmentName) return
    if (!authenticated) { onRequestAuth(); return }
    if (generationAbortRef.current) return

    const controller = new AbortController()
    generationAbortRef.current = controller
    setGenerating(true)
    setGenerationError('')
    setGenerationStatus('正在创建图片任务…')
    onNotice?.('正在使用已登录账号生成图片…')

    void generateImage(prompt, {
      file: attachmentFile,
      model,
      signal: controller.signal,
      onStatus: (status) => setGenerationStatus(
        status === 'queued' ? '图片任务正在排队…' : '正在生成图片，这可能需要一两分钟…',
      ),
    }).then((result) => {
      if (generationAbortRef.current !== controller) return
      setGeneratedImages((current) => [
        ...result.images,
        ...current.filter((item) => !result.images.some((image) => image.id === item.id)),
      ])
      setAttachmentFile(null)
      setGenerationStatus('')
      onNotice?.(result.message || '图片已生成')
    }).catch((error) => {
      if (generationAbortRef.current !== controller || controller.signal.aborted) return
      const message = imageGenerationErrorMessage(error)
      setGenerationStatus('')
      setGenerationError(message)
      onNotice?.(message)
    }).finally(() => {
      if (generationAbortRef.current !== controller) return
      generationAbortRef.current = null
      setGenerating(false)
    })
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
    event.preventDefault()
    if (prompt.trim() || attachmentName) {
      if (!authenticated) onRequestAuth()
      else submit({ preventDefault() {} } as FormEvent)
    }
  }

  const handleFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0]
    if (!file) return
    setAttachmentFile(file)
    setGenerationError('')
    onNotice?.(`已添加 ${file.name}`)
    event.currentTarget.value = ''
    window.setTimeout(() => textareaRef.current?.focus(), 0)
  }

  const toggleMic = async () => {
    if (micState === 'requesting') return
    if (micState === 'listening') {
      streamRef.current?.getTracks().forEach((track) => track.stop())
      streamRef.current = null
      setMicState('idle')
      onNotice?.('已停止听写')
      return
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      onNotice?.('当前浏览器不支持麦克风听写')
      return
    }
    try {
      setMicState('requesting')
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      stream.getTracks().forEach((track) => track.addEventListener('ended', () => setMicState('idle'), { once: true }))
      setMicState('listening')
      onNotice?.('正在听写，再次点击即可停止')
    } catch {
      setMicState('idle')
      onNotice?.('未获得麦克风权限')
    }
  }

  const ready = Boolean(prompt.trim() || attachmentName)
  const showExpand = editorLong || manuallyExpanded

  return (
    <section className="images-page" data-route-page="images" aria-labelledby="images-page-title">
      <div className="images-page-stage">
        <h1 id="images-page-title">图片</h1>

        <div className="images-composer-slot" id="image-app-composer">
          <form
            className={`images-composer${prompt ? ' has-text' : ''}${attachmentName ? ' has-attachment' : ''}${editorOverflowing ? ' is-overflowing' : ''}${manuallyExpanded ? ' is-manually-expanded' : ''}`}
            onSubmit={submit}
          >
            <div className="images-composer-primary">
              <textarea
                ref={textareaRef}
                aria-label="描述新图片"
                autoCapitalize="sentences"
                autoComplete="off"
                autoCorrect="on"
                enterKeyHint="enter"
                onChange={(event) => setPrompt(event.currentTarget.value)}
                onKeyDown={handleKeyDown}
                placeholder="描述新图片"
                rows={1}
                spellCheck
                value={prompt}
              />
              {showExpand && (
                <button
                  className="images-editor-expand"
                  type="button"
                  aria-label={manuallyExpanded ? '收起编辑器' : '展开编辑器'}
                  aria-expanded={manuallyExpanded}
                  onClick={() => setManuallyExpanded((value) => !value)}
                >
                  <ExpandIcon expanded={manuallyExpanded} />
                </button>
              )}
            </div>

            <div className="images-composer-leading">
              <button className="images-composer-button images-add-button" type="button" aria-label="添加文件等" onClick={() => fileInputRef.current?.click()}>
                <SpriteIcon id="lightweight-composer-actions-paperclip" />
                <span className="images-button-tooltip" role="tooltip">添加照片</span>
              </button>
              {attachmentName && (
                <button className="images-attachment-chip" type="button" title={attachmentName} onClick={() => setAttachmentFile(null)}>
                  <span>{attachmentName}</span><b aria-hidden="true">×</b>
                </button>
              )}
            </div>

            <div className="images-composer-trailing">
              <button
                className={`images-composer-button images-mic-button is-${micState}`}
                disabled={micState === 'requesting'}
                type="button"
                aria-label={micState === 'listening' ? '停止听写' : '开始听写'}
                onClick={toggleMic}
              >
                {micState === 'requesting' ? <span className="images-mic-spinner" /> : <SpriteIcon id="lightweight-composer-microphone" />}
              </button>
              <button
                className={`images-composer-button images-submit-button${ready ? ' is-ready' : ''}${generating ? ' is-generating' : ''}`}
                type="submit"
                disabled={!ready || generating}
                aria-disabled={!ready || generating}
                aria-label={generating ? '正在生成图片' : '发送消息'}
              >
                <SpriteIcon id="lightweight-composer-send" />
              </button>
            </div>
          </form>
          <input ref={fileInputRef} className="sr-only" type="file" accept="image/*" tabIndex={-1} onChange={handleFile} />
        </div>

        {(generating || generationError || generatedImages.length > 0) && (
          <section className="images-results-section" aria-live="polite" aria-busy={generating}>
            <div className="images-results-heading">
              <h2>你的图片</h2>
              {generationStatus && <span>{generationStatus}</span>}
            </div>
            {generationError && (
              <div className="images-generation-error" role="alert">
                <span>{generationError}</span>
                <button type="button" disabled={!ready || generating} onClick={() => submit({ preventDefault() {} } as FormEvent)}>重试</button>
              </div>
            )}
            {generating && generatedImages.length === 0 && (
              <div className="images-generation-skeleton" aria-label="正在生成图片">
                <span />
                <p>{generationStatus || '正在生成图片…'}</p>
              </div>
            )}
            {generatedImages.length > 0 && (
              <div className="images-results-grid">
                {generatedImages.map((image) => (
                  <article className="images-result-card" key={image.id}>
                    <a href={image.url} target="_blank" rel="noreferrer noopener" aria-label="打开生成的图片">
                      <img
                        src={image.url}
                        alt={image.prompt || prompt.trim() || '生成的图片'}
                        width={image.width ?? undefined}
                        height={image.height ?? undefined}
                      />
                    </a>
                    <div className="images-result-actions">
                      <span>{image.width && image.height ? `${image.width} × ${image.height}` : '已生成'}</span>
                      <a href={image.url} download>下载</a>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        )}

        <section className="images-gallery-section" aria-labelledby="images-gallery-title">
          <h2 id="images-gallery-title">生成图片</h2>
          <div className="images-gallery-wrap">
            <div className="images-gallery">
              {IMAGE_IDEAS.map((idea, index) => <ImageIdeaCard authenticated={authenticated} idea={idea} index={index} key={idea.id} onSelect={chooseIdea} />)}
            </div>
            {!authenticated && <><div className="images-gate-scrim" aria-hidden="true" />
            <button className="images-gate-button" type="button" onClick={onRequestAuth}>登录或注册以查看更多</button></>}
          </div>
        </section>
      </div>
    </section>
  )
}

export default ImagesPage
