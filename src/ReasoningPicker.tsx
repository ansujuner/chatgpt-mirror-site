import { useId, type CSSProperties } from 'react'
import './ReasoningPicker.css'

/**
 * These three glyphs use the same 16/20 px paths as the captured ChatGPT
 * intelligence picker.  Lucide's stroked variants are visibly wider at this
 * size and were the largest remaining difference in the compact panel.
 */
function PickerChevronRight() {
  return (
    <svg aria-hidden="true" className="reasoning-picker__chevron" viewBox="0 0 16 16">
      <path d="M5.629 12.629a.525.525 0 1 0 .742.742l4.765-4.765a.86.86 0 0 0 0-1.212L6.37 2.629a.525.525 0 1 0-.742.742L10.258 8z" />
    </svg>
  )
}

function PickerCheck() {
  return (
    <svg aria-hidden="true" className="reasoning-picker__check" viewBox="0 0 16 16">
      <path d="M12.722 2.997a.524.524 0 0 1 .864.595L7.2 12.847a.625.625 0 0 1-.956.09L2.46 9.18a.525.525 0 0 1 .74-.745l3.423 3.397z" />
    </svg>
  )
}

function PickerLightning() {
  return (
    <svg aria-hidden="true" className="reasoning-picker__fast-icon" viewBox="0 0 20 20">
      <path d="M10.539 1.996c.844-.844 2.323-.052 2.03 1.155l-.9 3.71h4.41c1.096 0 1.693 1.282.986 2.121l-7.524 8.935c-.826.981-2.412.178-2.11-1.068l.899-3.71H3.922c-1.097 0-1.694-1.282-.987-2.121l7.524-8.935zM4.008 11.81h4.85c.592 0 1.029.555.889 1.13l-.908 3.747 7.153-8.495h-4.85a.916.916 0 0 1-.89-1.13l.908-3.747z" />
    </svg>
  )
}

/** Zero-based index into the options returned by the active model endpoint. */
export type ReasoningLevel = number

export type ReasoningModelId =
  | 'default'
  | '5.6-sol-pro'
  | '5.6-sol'
  | '5.6-terra'
  | '5.6-luna'
  | '5.5'
  | (string & {})

export type ReasoningPickerView = 'effort' | 'models'

export type ReasoningLevelLabels = readonly string[]

export interface ReasoningSliderOption {
  /** Stable option key. Runtime presets use model/preset/effort in this value. */
  id: string
  label: string
  /** The ChatGPT web picker treats a Pro-lane endpoint as the purple maximum. */
  isMaximumEffort?: boolean
}

export interface ReasoningModelOption {
  id: ReasoningModelId
  label: string
  /** Secondary copy shown below the model name. */
  description?: string
  /** Effective model name shown in the compact view (useful for the default option). */
  triggerLabel?: string
  disabled?: boolean
}

export const DEFAULT_REASONING_LEVEL_LABELS = [
  '\u8f7b\u5ea6',
  '\u8f7b\u5ea6',
  '\u4e2d',
  '\u9ad8',
  '\u6781\u9ad8',
] as const satisfies ReasoningLevelLabels

export const DEFAULT_REASONING_MODELS = [
  {
    id: 'default',
    label: '\u9ed8\u8ba4',
    description: '\u63a8\u8350\u7684\u524d\u6cbf\u6a21\u578b\u7ec4\u5408',
    triggerLabel: '5.6 Sol',
  },
  { id: '5.6-sol', label: '5.6 Sol' },
  { id: '5.6-terra', label: '5.6 Terra' },
  { id: '5.6-luna', label: '5.6 Luna' },
  { id: '5.5', label: '5.5' },
] as const satisfies readonly ReasoningModelOption[]

export interface ReasoningPickerProps {
  level: ReasoningLevel
  selectedModel: ReasoningModelId
  fastMode: boolean
  showFastMode?: boolean
  view: ReasoningPickerView
  onLevelChange: (level: ReasoningLevel) => void
  onModelChange: (model: ReasoningModelId) => void
  onFastModeChange: (enabled: boolean) => void
  /** Called with `models` from the compact header and with `effort` after a model is selected. */
  onViewChange: (view: ReasoningPickerView) => void
  models?: readonly ReasoningModelOption[]
  levelLabels?: ReasoningLevelLabels
  /** Ordered options from `/backend-api/models` or `/backend-api/tpp/models`. */
  sliderOptions?: readonly ReasoningSliderOption[]
  /** Overrides the effective model name in the compact header. */
  modelLabel?: string
  disabled?: boolean
  className?: string
  ariaLabel?: string
}

type PickerCssProperties = CSSProperties & {
  '--reasoning-picker-position': string
}

function tickPosition(index: number, count: number) {
  if (count <= 1) return 'calc(0% + 13px)'
  const progress = index / (count - 1)
  const percent = progress * 100
  const pixelOffset = 13 - progress * 26
  if (Math.abs(percent - 50) < 0.001 && Math.abs(pixelOffset) < 0.001) return '50%'
  const sign = pixelOffset < 0 ? '-' : '+'
  return `calc(${percent}% ${sign} ${Math.abs(pixelOffset)}px)`
}

export function ReasoningPicker({
  level,
  selectedModel,
  fastMode,
  showFastMode = true,
  view,
  onLevelChange,
  onModelChange,
  onFastModeChange,
  onViewChange,
  models = DEFAULT_REASONING_MODELS,
  levelLabels = DEFAULT_REASONING_LEVEL_LABELS,
  sliderOptions,
  modelLabel,
  disabled = false,
  className,
  ariaLabel = '\u6a21\u578b\u4e0e\u601d\u8003\u5f3a\u5ea6',
}: ReasoningPickerProps) {
  const modelListId = useId()
  const selectedOption = models.find((option) => option.id === selectedModel)
  const effectiveSliderOptions: readonly ReasoningSliderOption[] = sliderOptions?.length
    ? sliderOptions
    : levelLabels.map((label, index) => ({ id: `level:${index}`, label }))
  const safeLevel = Math.min(
    Math.max(Number.isFinite(level) ? Math.trunc(level) : 0, 0),
    Math.max(effectiveSliderOptions.length - 1, 0),
  )
  const selectedSliderOption = effectiveSliderOptions[safeLevel]
  const isMaximumEffort = selectedSliderOption?.isMaximumEffort === true
  const currentModelLabel =
    modelLabel ?? selectedOption?.triggerLabel ?? selectedOption?.label ?? selectedModel
  const currentLevelLabel = selectedSliderOption?.label ?? ''
  const defaultModel = models.find((option) => option.id === 'default')
  const namedModels = models.filter((option) => option.id !== 'default')
  const pickerClassName = ['reasoning-picker', className].filter(Boolean).join(' ')
  const sliderStyle = {
    // Some Pro model snapshots expose the maximum lane as one standalone
    // preset. It is still the right-hand endpoint of the real picker, not a
    // minimum-strength value merely because the local list has one item.
    '--reasoning-picker-position': isMaximumEffort
      ? tickPosition(Math.max(effectiveSliderOptions.length - 1, 1), Math.max(effectiveSliderOptions.length, 2))
      : tickPosition(safeLevel, effectiveSliderOptions.length),
  } as PickerCssProperties

  const selectModel = (model: ReasoningModelId) => {
    onModelChange(model)
    onViewChange('effort')
  }

  return (
    <div
      aria-label={ariaLabel}
      className={pickerClassName}
      data-disabled={disabled}
      data-maximum={isMaximumEffort}
      data-view={view}
      role="group"
    >
      {view === 'effort' ? (
        <div className="reasoning-picker__effort-view">
          <div className="reasoning-picker__controls">
            <button
              aria-controls={modelListId}
              aria-expanded="false"
              aria-label={'\u9009\u62e9\u6a21\u578b'}
              className="reasoning-picker__model-toggle"
              disabled={disabled}
              onClick={() => onViewChange('models')}
              type="button"
            >
              <span className="reasoning-picker__model-label">{currentModelLabel}</span>
              <span className="reasoning-picker__level-label" data-max={isMaximumEffort}>
                {currentLevelLabel}
              </span>
              <PickerChevronRight />
            </button>

            {showFastMode ? (
              <button
                aria-label={fastMode ? '\u5173\u95ed\u5feb\u901f\u6a21\u5f0f' : '\u542f\u7528\u5feb\u901f\u6a21\u5f0f'}
                aria-pressed={fastMode}
                className="reasoning-picker__fast-mode"
                data-enabled={fastMode}
                disabled={disabled}
                onClick={() => onFastModeChange(!fastMode)}
                title={
                  fastMode
                    ? '\u5173\u95ed\u5feb\u901f\u6a21\u5f0f'
                    : '1.5x \u901f\u5ea6\uff0c\u4f1a\u6d88\u8017\u66f4\u591a\u7528\u91cf'
                }
                type="button"
              >
                <PickerLightning />
              </button>
            ) : null}
          </div>

          <div className="reasoning-picker__slider-panel">
            <div className="reasoning-picker__slider-container">
              <div
                className="reasoning-picker__slider"
                data-fast-mode={fastMode}
                data-max={isMaximumEffort}
                style={sliderStyle}
              >
                <div aria-hidden="true" className="reasoning-picker__track">
                  <span className="reasoning-picker__range" />
                  <span className="reasoning-picker__ticks">
                    {effectiveSliderOptions.map((option, tick) => (
                      <span
                        className="reasoning-picker__tick"
                        data-selected={tick <= safeLevel}
                        key={option.id}
                        style={{ left: tickPosition(tick, effectiveSliderOptions.length) }}
                      />
                    ))}
                  </span>
                </div>

                <input
                  aria-label={'\u80fd\u529b'}
                  aria-valuetext={currentLevelLabel}
                  className="reasoning-picker__slider-input"
                  disabled={disabled}
                  max={Math.max(effectiveSliderOptions.length - 1, 0)}
                  min={0}
                  onChange={(event) => {
                    const nextLevel = Number(event.currentTarget.value) as ReasoningLevel
                    onLevelChange(nextLevel)
                  }}
                  step={1}
                  type="range"
                  value={safeLevel}
                />
                <span aria-hidden="true" className="reasoning-picker__thumb" />
              </div>
            </div>
            <span aria-live="polite" className="reasoning-picker__announcement">
              {currentLevelLabel}，第 {safeLevel + 1} 项，共 {effectiveSliderOptions.length} 项。
            </span>
          </div>
        </div>
      ) : (
        <div
          aria-label={'\u9009\u62e9\u6a21\u578b'}
          className="reasoning-picker__model-view"
          id={modelListId}
          role="radiogroup"
        >
          {defaultModel ? (
            <ModelChoice
              model={defaultModel}
              onSelect={selectModel}
              selected={selectedModel === defaultModel.id}
              pickerDisabled={disabled}
              prominent
            />
          ) : null}

          {defaultModel && namedModels.length > 0 ? (
            <div className="reasoning-picker__separator" role="separator" />
          ) : null}

          <div className="reasoning-picker__named-models">
            {namedModels.map((model) => (
              <ModelChoice
                key={model.id}
                model={model}
                onSelect={selectModel}
                pickerDisabled={disabled}
                selected={selectedModel === model.id}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

interface ModelChoiceProps {
  model: ReasoningModelOption
  selected: boolean
  prominent?: boolean
  pickerDisabled: boolean
  onSelect: (model: ReasoningModelId) => void
}

function ModelChoice({
  model,
  selected,
  prominent = false,
  pickerDisabled,
  onSelect,
}: ModelChoiceProps) {
  return (
    <button
      aria-checked={selected}
      className={`reasoning-picker__model-choice${prominent ? ' is-prominent' : ''}`}
      data-state={selected ? 'checked' : 'unchecked'}
      disabled={pickerDisabled || model.disabled}
      onClick={() => onSelect(model.id)}
      role="radio"
      type="button"
    >
      <span className="reasoning-picker__model-copy">
        <span className="reasoning-picker__choice-label">{model.label}</span>
        {model.description ? (
          <span className="reasoning-picker__choice-description">{model.description}</span>
        ) : null}
      </span>
      <span aria-hidden="true" className="reasoning-picker__check-slot">
        {selected ? <PickerCheck /> : null}
      </span>
    </button>
  )
}
