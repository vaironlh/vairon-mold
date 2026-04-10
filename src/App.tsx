import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import JSZip from 'jszip'
import './App.css'
import {
  getReminderStatus,
  loadRuleCenter,
  markReminderDone,
  saveRuleCenter,
} from './ruleCenter'
import type { ExportFormat, SlotRule, TextInputValues } from './types'

/** 按安全区做 cover 时的未缩放绘制宽高（与 imageToCanvas 内逻辑一致） */
function coverDimensionsForSafeArea(
  imgW: number,
  imgH: number,
  areaW: number,
  areaH: number,
) {
  const areaRatio = areaW / areaH
  const imgRatio = imgW / imgH
  let dw = areaW
  let dh = areaH
  if (imgRatio > areaRatio) {
    dh = areaH
    dw = imgRatio * dh
  } else {
    dw = areaW
    dh = dw / imgRatio
  }
  return { dw, dh }
}

/** 图片绘制尺寸不得小于画布（编辑区域）宽高时的最小缩放倍率（相对「安全区 cover 基准」） */
function minZoomForSlotCover(
  imgW: number,
  imgH: number,
  slot: SlotRule,
): number {
  const { width: aw, height: ah } = slot.safeArea
  const { dw, dh } = coverDimensionsForSafeArea(imgW, imgH, aw, ah)
  return Math.max(slot.width / dw, slot.height / dh)
}

function App() {
  const EXPORT_SCALE = 3
  const FIXED_VERSION = 'v1'
  const [ruleCenter, setRuleCenter] = useState(loadRuleCenter)
  const [selectedProduct] = useState('app-main')
  const [selectedPage, setSelectedPage] = useState('home')
  const [selectedSlotId, setSelectedSlotId] = useState('home-banner-top')
  const [selectedStyle, setSelectedStyle] = useState('样式A')
  const [exportFormat, setExportFormat] = useState<ExportFormat>('jpeg')
  const [texts, setTexts] = useState<TextInputValues>({
    title: '',
    subtitle: '',
  })
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [imageUrl, setImageUrl] = useState<string>('')
  const [status, setStatus] = useState('')
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const [imageOffset, setImageOffset] = useState({ x: 0, y: 0 })
  const [imageZoom, setImageZoom] = useState(1)
  const [minImageZoom, setMinImageZoom] = useState(1)
  const [maskColor, setMaskColor] = useState('#595959')
  const [maskOpacity, setMaskOpacity] = useState(1)
  const dragRef = useRef<{ dragging: boolean; x: number; y: number }>({
    dragging: false,
    x: 0,
    y: 0,
  })
  const [showReminder, setShowReminder] = useState(!getReminderStatus())
  const [figmaUrl, setFigmaUrl] = useState(
    'https://www.figma.com/design/YTzfbXXVL3Khz3aU2hCS7i/Design-Code%E6%B5%8B%E8%AF%95?node-id=112-3805',
  )

  const pages = useMemo(
    () => ruleCenter.pages.filter((p) => p.productId === selectedProduct),
    [ruleCenter.pages, selectedProduct],
  )
  const slots = useMemo(
    () => ruleCenter.slots.filter((s) => s.pageId === selectedPage),
    [ruleCenter.slots, selectedPage],
  )
  const selectedSlot =
    slots.find((slot) => slot.id === selectedSlotId) ?? slots[0]

  function today() {
    const now = new Date()
    const month = String(now.getMonth() + 1).padStart(2, '0')
    const day = String(now.getDate()).padStart(2, '0')
    return `${now.getFullYear()}${month}${day}`
  }

  function normalizedFilename(slot: SlotRule, ext: ExportFormat) {
    const name = slot.namingRule
      .replace('{slotName}', slot.slotName)
      .replace('{version}', FIXED_VERSION)
      .replace('{date}', today())
      .replaceAll(' ', '')
    return `${name}.${ext === 'jpeg' ? 'jpg' : ext}`
  }

  function validateText(slot: SlotRule) {
    for (const rule of slot.textRules) {
      const value = texts[rule.id]
      if (value.length > rule.maxLength) {
        return `${rule.label}超出字数限制（最大${rule.maxLength}）`
      }
    }
    return ''
  }

  function hexToRgb(hex: string) {
    const clean = hex.replace('#', '')
    const full =
      clean.length === 3
        ? clean
            .split('')
            .map((s) => s + s)
            .join('')
        : clean
    const value = Number.parseInt(full, 16)
    return {
      r: (value >> 16) & 255,
      g: (value >> 8) & 255,
      b: value & 255,
    }
  }

  const imageToCanvas = useCallback(async (slot: SlotRule, scale = 1) => {
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(slot.width * scale)
    canvas.height = Math.round(slot.height * scale)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas不可用')
    ctx.scale(scale, scale)

    ctx.fillStyle = '#0f172a'
    ctx.fillRect(0, 0, slot.width, slot.height)

    if (imageUrl) {
      const img = new Image()
      img.src = imageUrl
      await new Promise((resolve, reject) => {
        img.onload = resolve
        img.onerror = reject
      })
      const area = slot.safeArea
      const areaRatio = area.width / area.height
      const imgRatio = img.width / img.height
      let dw = area.width
      let dh = area.height
      if (imgRatio > areaRatio) {
        dh = area.height
        dw = imgRatio * dh
      } else {
        dw = area.width
        dh = dw / imgRatio
      }
      dw *= imageZoom
      dh *= imageZoom
      const dx = area.x - (dw - area.width) / 2 + imageOffset.x
      const dy = area.y - (dh - area.height) / 2 + imageOffset.y
      ctx.drawImage(img, dx, dy, dw, dh)
    }

    const sx = slot.width / 335
    const sy = slot.height / 166

    const rgb = hexToRgb(maskColor)
    const grad = ctx.createLinearGradient(0, 0, 160 * sx, 0)
    grad.addColorStop(0, `rgba(${rgb.r},${rgb.g},${rgb.b},${maskOpacity})`)
    grad.addColorStop(1, `rgba(${rgb.r},${rgb.g},${rgb.b},0)`)
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, 160 * sx, 166 * sy)

    const textX = 20 * sx
    const titleTop = 24 * sy
    const subtitleTop = 53.86666679382324 * sy
    ctx.fillStyle = '#ffffff'
    ctx.textBaseline = 'top'
    ctx.font = `${Math.round(18 * sy)}px "GEELY Design", "PingFang SC", sans-serif`
    ctx.fillText(texts.title || '标题占位', textX, titleTop)
    ctx.font = `${Math.round(13 * sy)}px "PingFang SC", sans-serif`
    ctx.fillText(texts.subtitle || '查看更多', textX, subtitleTop)

    const iconBoxX = textX + 68 * sx
    const iconBoxY = subtitleTop + 1 * sy
    const iconX = iconBoxX + 5 * sx
    const iconY = iconBoxY + 3 * sy
    ctx.beginPath()
    ctx.moveTo(iconX, iconY)
    ctx.lineTo(iconX + 6 * sx, iconY + 5 * sy)
    ctx.lineTo(iconX, iconY + 10 * sy)
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = Math.max(1.2, 1.4 * sy)
    ctx.stroke()
    return canvas
  }, [imageOffset.x, imageOffset.y, imageUrl, imageZoom, maskColor, maskOpacity, texts.title, texts.subtitle])

  useEffect(() => {
    let cancelled = false
    async function refreshPreview() {
      if (!selectedSlot || !previewCanvasRef.current) return
      const rendered = await imageToCanvas(selectedSlot, 1)
      if (cancelled || !previewCanvasRef.current) return
      const target = previewCanvasRef.current
      target.width = selectedSlot.width
      target.height = selectedSlot.height
      const targetCtx = target.getContext('2d')
      if (!targetCtx) return
      targetCtx.clearRect(0, 0, target.width, target.height)
      targetCtx.drawImage(rendered, 0, 0)
    }
    refreshPreview()
    return () => {
      cancelled = true
    }
  }, [selectedSlot, imageToCanvas])

  useEffect(() => {
    if (!imageUrl || !selectedSlot) {
      return
    }
    const img = new Image()
    img.decoding = 'async'
    img.src = imageUrl
    let cancelled = false
    img.onload = () => {
      if (cancelled) return
      const minZ = minZoomForSlotCover(
        img.naturalWidth,
        img.naturalHeight,
        selectedSlot,
      )
      setMinImageZoom(minZ)
      setImageZoom((z) => Math.max(minZ, z))
    }
    return () => {
      cancelled = true
    }
  }, [imageUrl, selectedSlot])

  function handleCanvasWheel(event: React.WheelEvent<HTMLCanvasElement>) {
    event.preventDefault()
    const factor = event.deltaY < 0 ? 1.05 : 0.95
    const floor = imageUrl ? minImageZoom : 1
    setImageZoom((prev) => {
      const next = Number((prev * factor).toFixed(3))
      return Math.min(4, Math.max(floor, next))
    })
  }

  function canvasPointToDesignPoint(
    event: React.PointerEvent<HTMLCanvasElement>,
    slot: SlotRule,
  ) {
    const rect = event.currentTarget.getBoundingClientRect()
    const x = ((event.clientX - rect.left) / rect.width) * slot.width
    const y = ((event.clientY - rect.top) / rect.height) * slot.height
    return { x, y }
  }

  async function exportSingle() {
    if (!selectedSlot) return
    const textError = validateText(selectedSlot)
    if (textError) {
      setStatus(textError)
      return
    }
    const canvas = await imageToCanvas(selectedSlot, EXPORT_SCALE)
    const dataUrl = canvas.toDataURL(`image/${exportFormat}`, selectedSlot.quality)
    const link = document.createElement('a')
    link.href = dataUrl
    link.download = normalizedFilename(selectedSlot, exportFormat)
    link.click()
    setStatus('已导出单个点位素材')
  }

  async function exportBatch() {
    if (!slots.length) return
    const zip = new JSZip()
    for (const slot of slots) {
      const canvas = await imageToCanvas(slot, EXPORT_SCALE)
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob((b) => resolve(b), `image/${exportFormat}`, slot.quality),
      )
      if (!blob) continue
      zip.file(normalizedFilename(slot, exportFormat), blob)
    }
    const content = await zip.generateAsync({ type: 'blob' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(content)
    link.download = `APP_${selectedPage}_${today()}.zip`
    link.click()
    URL.revokeObjectURL(link.href)
    setStatus('已导出当前页面全部点位ZIP')
  }

  function onUpload(file: File) {
    setImageFile(file)
    setImageUrl(URL.createObjectURL(file))
    setImageOffset({ x: 0, y: 0 })
    setMinImageZoom(1)
    setImageZoom(1)
    setStatus(`已上传素材：${file.name}`)
  }

  function parseFigmaUrl(input: string) {
    try {
      const url = new URL(input)
      const parts = url.pathname.split('/')
      const designIdx = parts.findIndex((item) => item === 'design')
      const fileKey = designIdx >= 0 ? parts[designIdx + 1] : ''
      const nodeIdRaw = url.searchParams.get('node-id') ?? ''
      return {
        fileKey,
        nodeId: nodeIdRaw.replace('-', ':'),
      }
    } catch {
      return { fileKey: '', nodeId: '' }
    }
  }

  function applyFigmaTestSync() {
    const parsed = parseFigmaUrl(figmaUrl)
    if (
      parsed.fileKey !== 'YTzfbXXVL3Khz3aU2hCS7i' ||
      parsed.nodeId !== '112:3805'
    ) {
      setStatus('当前仅接入了这个测试节点，请先使用你提供的示例链接')
      return
    }
    if (!selectedSlot) return
    const nextSlots = ruleCenter.slots.map((slot) =>
      slot.id === selectedSlot.id
        ? {
            ...slot,
            slotName: 'Figma测试位_112_3805',
            width: 335,
            height: 166,
            format: 'png' as const,
            safeArea: { x: 20, y: 24, width: 295, height: 118 },
          }
        : slot,
    )
    const nextRuleCenter = { ...ruleCenter, slots: nextSlots }
    setRuleCenter(nextRuleCenter)
    saveRuleCenter(nextRuleCenter)
    setTexts({
      title: '银河E8试驾之旅',
      subtitle: '',
    })
    setStatus('已从Figma测试节点同步规则并填充文案')
  }

  return (
    <main className="app">
      <header className="topBar">
        <h1>Varion Mold</h1>
        <p>汽车APP资源位规范化编辑器（MVP）</p>
      </header>

      {showReminder && (
        <section className="reminder">
          <div>
            ⚠️ 重要提示：权益素材设计时，先做完展厅详情长图后，延展金刚区和M端权益素材！
          </div>
          <button
            onClick={() => {
              markReminderDone()
              setShowReminder(false)
            }}
          >
            已知晓
          </button>
        </section>
      )}

      <section className="layout">
        <aside className="panel resourcePanel">
          <div className="resourceSelectSection">
            <h2>选择资源位</h2>
            <label>
              产品
              <select value={selectedProduct} disabled>
                <option value="app-main">APP</option>
              </select>
            </label>
            <label>
              页面
              <select
                value={selectedPage}
                onChange={(e) => {
                  const pageId = e.target.value
                  setSelectedPage(pageId)
                  const nextSlot = ruleCenter.slots.find((s) => s.pageId === pageId)
                  if (nextSlot) setSelectedSlotId(nextSlot.id)
                }}
              >
                {pages.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              点位
              <select
                value={selectedSlot?.id}
                onChange={(e) => setSelectedSlotId(e.target.value)}
              >
                {slots.map((slot) => (
                  <option key={slot.id} value={slot.id}>
                    {slot.slotName}
                  </option>
                ))}
              </select>
            </label>
            <label>
              样式
              <select
                value={selectedStyle}
                onChange={(e) => setSelectedStyle(e.target.value)}
              >
                <option value="样式A">样式A</option>
                <option value="样式B">样式B</option>
                <option value="样式C">样式C</option>
                <option value="样式D">样式D</option>
              </select>
            </label>
          </div>
          <div className="uploadSection">
            <h3>上传素材与文案输入</h3>
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) onUpload(file)
              }}
            />
          </div>
          <div className="textInputSection">
            <h4>文案输入</h4>
            {selectedSlot?.textRules.map((rule) => (
              <label key={rule.id}>
                {rule.label}（{texts[rule.id].length}/{rule.maxLength}）
                <input
                  value={texts[rule.id]}
                  onChange={(e) =>
                    setTexts((prev) => ({ ...prev, [rule.id]: e.target.value }))
                  }
                  placeholder={`请输入${rule.label}`}
                />
              </label>
            ))}
          </div>
        </aside>

        <section className="panel corePanel">
          <h2>核心编辑区</h2>

          <div className="subBlock previewSmall">
            <h3>图片编辑区域</h3>
            {selectedSlot && (
              <div
                className="preview"
                style={{
                  aspectRatio: `${selectedSlot.width}/${selectedSlot.height}`,
                }}
              >
                <canvas
                  ref={previewCanvasRef}
                  className="previewCanvas"
                  onPointerDown={(event) => {
                    const point = canvasPointToDesignPoint(event, selectedSlot)
                    dragRef.current = { dragging: true, x: point.x, y: point.y }
                    event.currentTarget.setPointerCapture(event.pointerId)
                  }}
                  onPointerMove={(event) => {
                    if (!dragRef.current.dragging) return
                    const point = canvasPointToDesignPoint(event, selectedSlot)
                    const dx = point.x - dragRef.current.x
                    const dy = point.y - dragRef.current.y
                    dragRef.current.x = point.x
                    dragRef.current.y = point.y
                    setImageOffset((prev) => ({ x: prev.x + dx, y: prev.y + dy }))
                  }}
                  onPointerUp={() => {
                    dragRef.current.dragging = false
                  }}
                  onPointerLeave={() => {
                    dragRef.current.dragging = false
                  }}
                  onWheel={handleCanvasWheel}
                />
              </div>
            )}
          </div>

          <div className="subBlock">
            <h3>遮罩调整</h3>
            <div className="grid2">
              <label>
                遮罩颜色
                <input
                  type="color"
                  value={maskColor}
                  onChange={(e) => setMaskColor(e.target.value)}
                />
              </label>
              <label>
                遮罩强度（0-1）
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={maskOpacity}
                  onChange={(e) => setMaskOpacity(Number(e.target.value))}
                />
              </label>
            </div>
          </div>

          <button
            onClick={() => {
              setImageZoom(Math.max(1, minImageZoom))
              setImageOffset({ x: 0, y: 0 })
            }}
          >
            重置图片位置与缩放
          </button>
        </section>

        <section className="panel exportPanel">
          <h2>点位规则与导出</h2>
          {selectedSlot && (
            <>
              <div className="grid2">
                <div className="presetItem">
                  <strong>导出尺寸</strong>
                  <span>
                    {selectedSlot.width * EXPORT_SCALE} x{' '}
                    {selectedSlot.height * EXPORT_SCALE}（固定）
                  </span>
                </div>
                <div className="presetItem">
                  <strong>导出格式</strong>
                  <select
                    value={exportFormat}
                    onChange={(e) =>
                      setExportFormat(e.target.value as 'png' | 'jpeg')
                    }
                  >
                    <option value="png">PNG</option>
                    <option value="jpeg">JPG</option>
                  </select>
                </div>
                <div className="presetItem">
                  <strong>版本号</strong>
                  <span>{FIXED_VERSION}（固定展示）</span>
                </div>
                <div className="presetItem">
                  <strong>样式</strong>
                  <span>{selectedStyle}</span>
                </div>
              </div>

              <div className="safeAreaBox">
                <div>
                  安全区：x={selectedSlot.safeArea.x}, y={selectedSlot.safeArea.y},
                  w={selectedSlot.safeArea.width}, h={selectedSlot.safeArea.height}
                </div>
                <p className="muted">
                  规则中心支持后台可编辑（作为 Figma 读取失败兜底）。
                </p>
              </div>

              <div className="buttons">
                <button onClick={exportSingle}>导出当前点位</button>
                <button onClick={exportBatch}>批量导出当前页面</button>
              </div>

              <p className="muted">
                预览文件名：{normalizedFilename(selectedSlot, exportFormat)}
              </p>
            </>
          )}
          <h3>Figma 二期同步（占位）</h3>
          <label>
            Figma 链接（先接入测试节点）
            <input
              value={figmaUrl}
              onChange={(e) => setFigmaUrl(e.target.value)}
              placeholder="粘贴 Figma 设计链接"
            />
          </label>
          <button onClick={applyFigmaTestSync}>同步这个测试节点</button>
        </section>
      </section>
      <p className="status">{status}</p>
    </main>
  )
}

export default App
