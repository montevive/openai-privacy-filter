import type { Device, Diagnostics, Dtype } from './types'

interface GPUAdapterLike {
  features: { has: (name: string) => boolean }
  limits?: { maxBufferSize?: number }
  info?: {
    vendor?: string
    architecture?: string
    device?: string
    description?: string
    isFallbackAdapter?: boolean
  }
}

interface GPULike {
  requestAdapter: () => Promise<GPUAdapterLike | null>
}

export const DTYPE_SIZES_MB: Record<Dtype, number> = {
  q4f16: 772,
  q4: 875,
  q8: 1500,
  fp16: 2600,
}

export const DTYPE_LABELS: Record<Dtype, string> = {
  q4f16: 'q4f16 — 4-bit + fp16 (smallest, fastest on WebGPU)',
  q4: 'q4 — 4-bit (no fp16 shaders needed)',
  q8: 'q8 — int8 quantized',
  fp16: 'fp16 — half precision',
}

export async function runDiagnostics(): Promise<Diagnostics> {
  const ua = navigator.userAgent
  const nav = navigator as unknown as {
    gpu?: GPULike
    deviceMemory?: number
    storage?: { estimate?: () => Promise<{ quota?: number; usage?: number }> }
  }

  let webgpu = false
  let shaderF16 = false
  let maxBufferSize: number | undefined
  let adapterInfo: string | undefined
  let isFallbackAdapter: boolean | undefined

  if (nav.gpu) {
    try {
      const adapter = await nav.gpu.requestAdapter()
      if (adapter) {
        webgpu = true
        shaderF16 = adapter.features.has('shader-f16')
        maxBufferSize = adapter.limits?.maxBufferSize
        isFallbackAdapter = adapter.info?.isFallbackAdapter
        const info = adapter.info
        if (info) {
          adapterInfo = [info.vendor, info.architecture, info.device, info.description]
            .filter(Boolean)
            .join(' ')
            .trim() || undefined
        }
      }
    } catch {
      webgpu = false
    }
  }

  let storageQuotaBytes: number | undefined
  try {
    const est = await nav.storage?.estimate?.()
    storageQuotaBytes = est?.quota
  } catch {
    storageQuotaBytes = undefined
  }

  const device: Device = webgpu ? 'webgpu' : 'wasm'
  const dtype: Dtype = webgpu && !shaderF16 ? 'q4' : 'q4f16'

  const reason = explainChoice({ device, dtype, webgpu, shaderF16 })

  return {
    webgpu,
    shaderF16,
    maxBufferSize,
    adapterInfo,
    isFallbackAdapter,
    deviceMemoryGB: nav.deviceMemory,
    storageQuotaBytes,
    os: detectOS(ua),
    browser: detectBrowser(ua),
    recommended: { device, dtype },
    reason,
  }
}

function explainChoice(p: { device: Device; dtype: Dtype; webgpu: boolean; shaderF16: boolean }): string {
  if (p.device === 'webgpu' && p.dtype === 'q4f16')
    return 'WebGPU with shader-f16 — using the smallest, fastest variant.'
  if (p.device === 'webgpu' && p.dtype === 'q4')
    return 'WebGPU available but shader-f16 is not — using q4 (int4) to avoid fp16 shader errors.'
  if (p.device === 'wasm' && p.dtype === 'q4f16')
    return 'No WebGPU — falling back to WASM CPU. Inference will be noticeably slower.'
  return 'Selected based on detected capabilities.'
}

function detectOS(ua: string): string {
  if (/iPhone|iPad|iPod/i.test(ua)) return 'iOS'
  if (/Android/i.test(ua)) return 'Android'
  if (/Mac OS X|Macintosh/i.test(ua)) {
    const arm = /Apple Silicon|ARM/i.test(ua)
    return arm ? 'macOS (Apple Silicon)' : 'macOS'
  }
  if (/Windows NT/i.test(ua)) return 'Windows'
  if (/Linux/i.test(ua)) return 'Linux'
  return 'Unknown'
}

function detectBrowser(ua: string): string {
  const m = (re: RegExp) => {
    const r = ua.match(re)
    return r?.[1]
  }
  if (/Edg\//.test(ua)) return `Edge ${m(/Edg\/(\d+)/) ?? ''}`.trim()
  if (/Chrome\//.test(ua) && !/Chromium/.test(ua)) return `Chrome ${m(/Chrome\/(\d+)/) ?? ''}`.trim()
  if (/Firefox\//.test(ua)) return `Firefox ${m(/Firefox\/(\d+)/) ?? ''}`.trim()
  if (/Safari\//.test(ua) && !/Chrome/.test(ua)) return `Safari ${m(/Version\/(\d+)/) ?? ''}`.trim()
  return 'Unknown'
}
