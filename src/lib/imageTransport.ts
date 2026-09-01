export type GeneratedImage = {
  id: string
  url: string
  width: number | null
  height: number | null
  mimeType: string | null
  prompt: string | null
}

export type ImageGenerationResult = {
  id: string
  status: 'succeeded'
  conversationId: string | null
  message: string
  images: GeneratedImage[]
}

type ImageGenerationState = {
  id: string
  status: 'queued' | 'running' | 'succeeded' | 'failed'
  conversationId: string | null
  message: string
  images: GeneratedImage[]
  errorCode: string | null
}

type JsonRecord = Record<string, unknown>

export class ImageGenerationError extends Error {
  readonly status: number
  readonly code: string

  constructor(message: string, status = 0, code = 'image_generation_failed') {
    super(message)
    this.name = 'ImageGenerationError'
    this.status = status
    this.code = code
  }
}

function asRecord(value: unknown): JsonRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : null
}

function optionalText(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function optionalDimension(value: unknown) {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 100_000
    ? value
    : null
}

function normalizeImage(value: unknown): GeneratedImage | null {
  const item = asRecord(value)
  const id = optionalText(item?.id)
  const url = optionalText(item?.url)
  if (!id?.startsWith('imgasset-') || !url || url !== `/api/images/assets/${id}`) return null
  const mimeType = optionalText(item?.mimeType)
  if (mimeType && !mimeType.toLowerCase().startsWith('image/')) return null
  return {
    id,
    url,
    width: optionalDimension(item?.width),
    height: optionalDimension(item?.height),
    mimeType,
    prompt: optionalText(item?.prompt),
  }
}

function normalizeState(value: unknown): ImageGenerationState {
  const payload = asRecord(value)
  const id = optionalText(payload?.id)
  const status = payload?.status
  if (
    !id?.startsWith('imgjob-')
    || !['queued', 'running', 'succeeded', 'failed'].includes(String(status))
    || !Array.isArray(payload?.images)
  ) {
    throw new ImageGenerationError('图片生成接口返回了无效数据。', 502, 'image_invalid_response')
  }
  const error = asRecord(payload?.error)
  return {
    id,
    status: status as ImageGenerationState['status'],
    conversationId: optionalText(payload?.conversationId),
    message: optionalText(payload?.message) ?? '',
    images: payload.images.flatMap((item) => {
      const image = normalizeImage(item)
      return image ? [image] : []
    }),
    errorCode: optionalText(error?.code),
  }
}

async function responseError(response: Response) {
  const payload: unknown = await response.json().catch(() => null)
  const root = asRecord(payload)
  const error = asRecord(root?.error)
  const code = optionalText(error?.code) ?? 'image_generation_failed'
  const message = optionalText(error?.message)
    ?? (response.status === 401
      ? '当前登录已失效，请重新登录后再试。'
      : response.status === 403
        ? '当前账号暂时无法使用图片生成。'
        : `图片生成请求失败（HTTP ${response.status}）。`)
  return new ImageGenerationError(message, response.status, code)
}

function fileToDataUrl(file: File, signal?: AbortSignal) {
  return new Promise<string>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'))
      return
    }
    const reader = new FileReader()
    const abort = () => reader.abort()
    signal?.addEventListener('abort', abort, { once: true })
    reader.onload = () => {
      signal?.removeEventListener('abort', abort)
      if (typeof reader.result === 'string') resolve(reader.result)
      else reject(new ImageGenerationError('无法读取参考图片。', 400, 'image_reference_invalid'))
    }
    reader.onerror = () => {
      signal?.removeEventListener('abort', abort)
      reject(new ImageGenerationError('无法读取参考图片。', 400, 'image_reference_invalid'))
    }
    reader.onabort = () => {
      signal?.removeEventListener('abort', abort)
      reject(new DOMException('Aborted', 'AbortError'))
    }
    reader.readAsDataURL(file)
  })
}

function imageDimensions(file: File, signal?: AbortSignal) {
  return new Promise<{ width: number; height: number }>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'))
      return
    }
    const objectUrl = URL.createObjectURL(file)
    const image = new Image()
    const cleanup = () => {
      URL.revokeObjectURL(objectUrl)
      signal?.removeEventListener('abort', abort)
    }
    const abort = () => {
      cleanup()
      image.src = ''
      reject(new DOMException('Aborted', 'AbortError'))
    }
    signal?.addEventListener('abort', abort, { once: true })
    image.onload = () => {
      const width = image.naturalWidth
      const height = image.naturalHeight
      cleanup()
      if (width > 0 && height > 0) resolve({ width, height })
      else reject(new ImageGenerationError('参考图片尺寸无效。', 400, 'image_reference_invalid'))
    }
    image.onerror = () => {
      cleanup()
      reject(new ImageGenerationError('无法解析参考图片。', 400, 'image_reference_invalid'))
    }
    image.src = objectUrl
  })
}

function delay(milliseconds: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'))
      return
    }
    const timer = globalThis.setTimeout(() => {
      signal?.removeEventListener('abort', abort)
      resolve()
    }, milliseconds)
    const abort = () => {
      globalThis.clearTimeout(timer)
      reject(new DOMException('Aborted', 'AbortError'))
    }
    signal?.addEventListener('abort', abort, { once: true })
  })
}

async function pollJob(
  initial: ImageGenerationState,
  signal?: AbortSignal,
  onStatus?: (status: ImageGenerationState['status']) => void,
) {
  let state = initial
  const deadline = Date.now() + 6 * 60 * 1_000
  while (state.status === 'queued' || state.status === 'running') {
    onStatus?.(state.status)
    if (Date.now() >= deadline) {
      throw new ImageGenerationError('图片生成等待超时，请稍后重试。', 504, 'image_generation_timeout')
    }
    await delay(1_250, signal)
    let response: Response
    try {
      response = await fetch(`/api/images/generations/${encodeURIComponent(state.id)}`, {
        cache: 'no-store',
        credentials: 'include',
        headers: { Accept: 'application/json' },
        signal,
      })
    } catch (error) {
      if (signal?.aborted) throw error
      await delay(750, signal)
      continue
    }
    if (!response.ok) throw await responseError(response)
    if (response.headers.get('X-ChatGPT-Identity-Mode') !== 'verified-session') {
      throw new ImageGenerationError('图片生成接口未使用已登录 Session。', 502, 'identity_mode_mismatch')
    }
    state = normalizeState(await response.json())
  }
  if (state.status === 'failed') {
    throw new ImageGenerationError(
      state.message || '图片生成失败，请稍后重试。',
      502,
      state.errorCode ?? 'image_generation_failed',
    )
  }
  if (state.images.length === 0) {
    throw new ImageGenerationError('图片生成完成，但没有返回可显示的图片。', 502, 'image_generation_no_result')
  }
  return state
}

export async function generateImage(
  prompt: string,
  {
    file,
    model = 'auto',
    signal,
    onStatus,
  }: {
    file?: File | null
    model?: string
    signal?: AbortSignal
    onStatus?: (status: ImageGenerationState['status']) => void
  } = {},
): Promise<ImageGenerationResult> {
  const content: Array<Record<string, unknown>> = []
  const text = prompt.trim()
  if (text) content.push({ type: 'text', text })
  if (file) {
    if (!file.type.startsWith('image/')) {
      throw new ImageGenerationError('参考文件必须是图片。', 400, 'image_reference_invalid')
    }
    const [{ width, height }, dataUrl] = await Promise.all([
      imageDimensions(file, signal),
      fileToDataUrl(file, signal),
    ])
    content.push({
      type: 'image_url',
      image_url: {
        url: dataUrl,
        filename: file.name || 'reference-image',
        width,
        height,
      },
    })
  }
  if (content.length === 0) {
    throw new ImageGenerationError('请输入图片描述。', 400, 'image_prompt_missing')
  }
  const response = await fetch('/api/images/generations', {
    method: 'POST',
    cache: 'no-store',
    credentials: 'include',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content }],
      stream: false,
    }),
    signal,
  })
  if (!response.ok) throw await responseError(response)
  if (response.headers.get('X-ChatGPT-Identity-Mode') !== 'verified-session') {
    throw new ImageGenerationError('图片生成接口未使用已登录 Session。', 502, 'identity_mode_mismatch')
  }
  const state = await pollJob(normalizeState(await response.json()), signal, onStatus)
  return {
    id: state.id,
    status: 'succeeded',
    conversationId: state.conversationId,
    message: state.message,
    images: state.images,
  }
}

export function imageGenerationErrorMessage(error: unknown) {
  return error instanceof ImageGenerationError
    ? error.message
    : '图片生成暂时不可用，请稍后重试。'
}
