export type Device = 'webgpu' | 'wasm'
export type Dtype = 'q4f16' | 'q4' | 'fp16' | 'q8'

export interface Entity {
  entity_group: string
  score: number
  word: string
  start: number
  end: number
}

export interface Diagnostics {
  webgpu: boolean
  shaderF16: boolean
  maxBufferSize?: number
  adapterInfo?: string
  isFallbackAdapter?: boolean
  deviceMemoryGB?: number
  storageQuotaBytes?: number
  os: string
  browser: string
  recommended: { device: Device; dtype: Dtype }
  reason: string
}

export type InMsg =
  | { type: 'init'; device: Device; dtype: Dtype }
  | { type: 'run'; id: number; text: string }

export type OutMsg =
  | { status: 'progress'; file: string; loaded: number; total: number; progress: number }
  | { status: 'ready'; device: Device; dtype: Dtype }
  | { status: 'result'; id: number; text: string; entities: Entity[]; latencyMs: number }
  | { status: 'error'; message: string }
