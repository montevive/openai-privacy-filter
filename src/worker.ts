/// <reference lib="webworker" />
import { pipeline, env, type TokenClassificationPipeline } from '@huggingface/transformers'
import type { Device, Dtype, Entity, InMsg, OutMsg } from './types'

function attachOffsets(
  text: string,
  raw: Array<{ entity_group: string; score: number; word: string; start?: number; end?: number }>,
): Entity[] {
  const out: Entity[] = []
  let cursor = 0
  for (const r of raw) {
    if (typeof r.start === 'number' && typeof r.end === 'number') {
      out.push({ entity_group: r.entity_group, score: r.score, word: text.slice(r.start, r.end), start: r.start, end: r.end })
      cursor = r.end
      continue
    }
    const stripped = r.word.replace(/^\s+/, '')
    const found = stripped ? text.indexOf(stripped, cursor) : -1
    if (found >= 0) {
      out.push({ entity_group: r.entity_group, score: r.score, word: stripped, start: found, end: found + stripped.length })
      cursor = found + stripped.length
    } else {
      out.push({ entity_group: r.entity_group, score: r.score, word: stripped || r.word, start: cursor, end: cursor })
    }
  }
  return out
}

env.allowLocalModels = false

const MODEL_ID = 'openai/privacy-filter'

let pipePromise: Promise<TokenClassificationPipeline> | null = null
let activeDevice: Device = 'webgpu'
let activeDtype: Dtype = 'q4f16'

function send(msg: OutMsg) {
  ;(self as unknown as DedicatedWorkerGlobalScope).postMessage(msg)
}

async function getPipeline(device: Device, dtype: Dtype) {
  if (pipePromise) return pipePromise
  activeDevice = device
  activeDtype = dtype
  pipePromise = pipeline('token-classification', MODEL_ID, {
    device,
    dtype,
    progress_callback: (p: unknown) => {
      const progress = p as {
        status?: string
        file?: string
        loaded?: number
        total?: number
        progress?: number
      }
      if (progress?.status === 'progress' && progress.file) {
        send({
          status: 'progress',
          file: progress.file,
          loaded: progress.loaded ?? 0,
          total: progress.total ?? 0,
          progress: progress.progress ?? 0,
        })
      }
    },
  }) as Promise<TokenClassificationPipeline>
  return pipePromise
}

self.addEventListener('message', async (event: MessageEvent<InMsg>) => {
  const msg = event.data
  try {
    if (msg.type === 'init') {
      await getPipeline(msg.device, msg.dtype)
      send({ status: 'ready', device: activeDevice, dtype: activeDtype })
    } else if (msg.type === 'run') {
      const classifier = await getPipeline(activeDevice, activeDtype)
      const t0 = performance.now()
      const output = await classifier(msg.text, { aggregation_strategy: 'simple' })
      const latencyMs = performance.now() - t0
      const raw = output as Array<{
        entity_group: string
        score: number
        word: string
        start?: number
        end?: number
      }>
      const entities = attachOffsets(msg.text, raw)
      send({ status: 'result', id: msg.id, text: msg.text, entities, latencyMs })
    }
  } catch (err) {
    send({ status: 'error', message: err instanceof Error ? err.message : String(err) })
  }
})
