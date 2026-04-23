import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import { DTYPE_LABELS, DTYPE_SIZES_MB, runDiagnostics } from './diagnostics'
import type { Device, Diagnostics, Dtype, Entity, InMsg, OutMsg } from './types'

const EXAMPLES = [
  'My name is Harry Potter and my email is harry.potter@hogwarts.edu.',
  'Call Alice at +34 600 123 456 or visit https://example.com/user/42.',
  'API key: sk-proj-abc123def456ghijk789, issued 2024-10-03.',
]

const ALL_DTYPES: Dtype[] = ['q4f16', 'q4', 'fp16', 'q8']

type LoadState =
  | { stage: 'detecting' }
  | { stage: 'ready-to-load'; diagnostics: Diagnostics; selectedDtype: Dtype }
  | {
      stage: 'loading'
      device: Device
      dtype: Dtype
      diagnostics: Diagnostics
      files: Record<string, { loaded: number; total: number }>
    }
  | { stage: 'ready'; device: Device; dtype: Dtype; diagnostics: Diagnostics }
  | { stage: 'error'; message: string; diagnostics?: Diagnostics }

interface RunResult {
  entities: Entity[]
  latencyMs: number
  text: string
}

export default function App() {
  const workerRef = useRef<Worker | null>(null)
  const nextId = useRef(0)
  const pendingId = useRef<number | null>(null)
  const [state, setState] = useState<LoadState>({ stage: 'detecting' })
  const [text, setText] = useState(EXAMPLES[0])
  const [result, setResult] = useState<RunResult | null>(null)
  const [running, setRunning] = useState(false)

  useEffect(() => {
    const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
    workerRef.current = worker

    worker.addEventListener('message', (event: MessageEvent<OutMsg>) => {
      const msg = event.data
      if (msg.status === 'progress') {
        setState((prev) => {
          if (prev.stage !== 'loading') return prev
          return {
            ...prev,
            files: {
              ...prev.files,
              [msg.file]: { loaded: msg.loaded, total: msg.total },
            },
          }
        })
      } else if (msg.status === 'ready') {
        setState((prev) => ({
          stage: 'ready',
          device: msg.device,
          dtype: msg.dtype,
          diagnostics:
            prev.stage === 'loading' || prev.stage === 'ready-to-load'
              ? prev.diagnostics
              : prev.stage === 'ready'
                ? prev.diagnostics
                : ({} as Diagnostics),
        }))
      } else if (msg.status === 'result') {
        if (pendingId.current === msg.id) {
          setResult({ entities: msg.entities, latencyMs: msg.latencyMs, text: msg.text })
          setRunning(false)
        }
      } else if (msg.status === 'error') {
        setState((prev) => ({
          stage: 'error',
          message: msg.message,
          diagnostics:
            prev.stage === 'loading' || prev.stage === 'ready' || prev.stage === 'ready-to-load'
              ? prev.diagnostics
              : undefined,
        }))
        setRunning(false)
      }
    })

    ;(async () => {
      const diagnostics = await runDiagnostics()
      setState({ stage: 'ready-to-load', diagnostics, selectedDtype: diagnostics.recommended.dtype })
    })()

    return () => {
      worker.terminate()
    }
  }, [])

  const loadModel = useCallback((device: Device, dtype: Dtype) => {
    const worker = workerRef.current
    if (!worker) return
    setState((prev) => {
      if (prev.stage !== 'ready-to-load') return prev
      return { stage: 'loading', device, dtype, diagnostics: prev.diagnostics, files: {} }
    })
    const init: InMsg = { type: 'init', device, dtype }
    worker.postMessage(init)
  }, [])

  const runInference = useCallback(
    (value: string) => {
      const worker = workerRef.current
      if (!worker || state.stage !== 'ready' || !value.trim()) return
      const id = ++nextId.current
      pendingId.current = id
      setRunning(true)
      const msg: InMsg = { type: 'run', id, text: value }
      worker.postMessage(msg)
    },
    [state.stage],
  )

  useEffect(() => {
    if (state.stage !== 'ready') return
    const handle = window.setTimeout(() => runInference(text), 350)
    return () => window.clearTimeout(handle)
  }, [text, state.stage, runInference])

  return (
    <div className="app">
      <Header state={state} />
      <PrivacyBanner />
      <MonteviveIntro />

      {state.stage === 'detecting' && (
        <section className="panel">
          <p>Detecting hardware capabilities…</p>
        </section>
      )}

      {state.stage === 'ready-to-load' && (
        <DiagnosticsPanel
          diagnostics={state.diagnostics}
          selectedDtype={state.selectedDtype}
          onChangeDtype={(d) =>
            setState((prev) =>
              prev.stage === 'ready-to-load' ? { ...prev, selectedDtype: d } : prev,
            )
          }
          onLoad={() => loadModel(state.diagnostics.recommended.device, state.selectedDtype)}
        />
      )}

      {state.stage === 'loading' && <LoadingPanel state={state} />}

      {state.stage === 'error' && (
        <section className="panel error-panel">
          <strong>Error loading model:</strong>
          <pre>{state.message}</pre>
        </section>
      )}

      {(state.stage === 'ready' || result) && (
        <section className="panel">
          <label className="label" htmlFor="input">
            Input
          </label>
          <textarea
            id="input"
            className="textarea"
            rows={5}
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={state.stage !== 'ready'}
            placeholder="Paste or type text to scan for PII..."
          />
          <div className="actions">
            <button
              className="btn primary"
              disabled={state.stage !== 'ready' || running || !text.trim()}
              onClick={() => runInference(text)}
            >
              {running ? 'Detecting…' : 'Detect'}
            </button>
            <span className="examples-label">Try:</span>
            {EXAMPLES.map((ex, i) => (
              <button
                key={i}
                className="btn chip"
                onClick={() => setText(ex)}
                disabled={state.stage !== 'ready'}
              >
                example {i + 1}
              </button>
            ))}
          </div>
        </section>
      )}

      {result && <ResultsPanel result={result} />}

      <MonteviveAbout />
      <Footer />
    </div>
  )
}

function MonteviveIntro() {
  return (
    <section className="mv-intro">
      <span className="mv-intro-kicker">A research demo by</span>
      <a className="mv-intro-brand" href="https://montevive.ai" target="_blank" rel="noreferrer">
        Montevive.ai
      </a>
      <span className="mv-intro-sep">·</span>
      <span className="mv-intro-tagline">Secure AI for secure decisions</span>
    </section>
  )
}

function MonteviveAbout() {
  return (
    <section className="panel mv-about">
      <div className="mv-about-head">
        <span className="label">About Montevive.ai</span>
        <span className="mv-about-motto">100% AI, 99% security</span>
      </div>
      <p className="mv-about-lead">
        We help companies make strategic use of AI safely, with legal compliance and without
        putting their information at risk.
      </p>
      <p className="mv-about-frame dim small">
        This demo is a concrete example of the privacy-first techniques we advocate for: the
        OpenAI Privacy Filter runs entirely on your device — no backend, no data transmission.
      </p>

      <div className="mv-services">
        <div className="mv-service">
          <div className="mv-service-num">01</div>
          <div>
            <div className="mv-service-title">Shadow AI Diagnosis</div>
            <p className="dim small">
              We dive deep into how AI is actually used in your company to identify potential
              vulnerabilities. We evaluate the legal and operational impact and outline an action
              plan for secure and efficient management.
            </p>
          </div>
        </div>
        <div className="mv-service">
          <div className="mv-service-num">02</div>
          <div>
            <div className="mv-service-title">Executive Training</div>
            <p className="dim small">
              We train executives and teams to understand the real risks of AI and learn to
              leverage it responsibly.
            </p>
          </div>
        </div>
        <div className="mv-service">
          <div className="mv-service-num">03</div>
          <div>
            <div className="mv-service-title">Continuous Support</div>
            <p className="dim small">
              We accompany you through audits, regulatory reviews and technical updates so your AI
              remains efficient and legal over time.
            </p>
          </div>
        </div>
      </div>

      <div className="mv-cta-row">
        <a className="btn primary" href="https://montevive.ai" target="_blank" rel="noreferrer">
          Visit montevive.ai →
        </a>
        <a className="btn" href="mailto:info@montevive.ai">
          Contact us · info@montevive.ai
        </a>
      </div>
    </section>
  )
}

function Header({ state }: { state: LoadState }) {
  const diag =
    state.stage === 'ready-to-load' ||
    state.stage === 'loading' ||
    state.stage === 'ready' ||
    state.stage === 'error'
      ? state.diagnostics
      : undefined
  return (
    <header className="header">
      <div className="header-row">
        <a
          href="https://montevive.ai"
          target="_blank"
          rel="noreferrer"
          className="logo-link"
          aria-label="Montevive.ai"
        >
          <img src="img/logo-montevive.png" alt="Montevive" className="logo" />
        </a>
        <div className="title-block">
          <h1>OpenAI Privacy Filter · Web Demo</h1>
          <div className="sub">
            <span>transformers.js v4 · on-device inference</span>
            <DevicePill state={state} />
            <DtypePill state={state} />
          </div>
        </div>
        <ThemeToggle />
      </div>
      {diag?.adapterInfo && <div className="adapter">GPU: {diag.adapterInfo}</div>}
    </header>
  )
}

type Theme = 'light' | 'dark'

function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof document === 'undefined') return 'light'
    const attr = document.documentElement.getAttribute('data-theme')
    if (attr === 'light' || attr === 'dark') return attr
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  })

  useEffect(() => {
    const media = window.matchMedia?.('(prefers-color-scheme: dark)')
    if (!media) return
    const handler = (e: MediaQueryListEvent) => {
      if (!localStorage.getItem('theme')) {
        setTheme(e.matches ? 'dark' : 'light')
      }
    }
    media.addEventListener('change', handler)
    return () => media.removeEventListener('change', handler)
  }, [])

  const toggle = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    document.documentElement.setAttribute('data-theme', next)
    try {
      localStorage.setItem('theme', next)
    } catch {
      /* ignore */
    }
  }

  return (
    <button
      type="button"
      className="theme-toggle"
      aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
      title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
      onClick={toggle}
    >
      {theme === 'dark' ? '☀' : '☾'}
    </button>
  )
}

function PrivacyBanner() {
  return (
    <div
      className="privacy-banner"
      title="Model weights are downloaded once from the Hugging Face CDN and cached in your browser. After that, inference runs entirely on your device's GPU/CPU. We never see your input."
    >
      <span className="privacy-icon" aria-hidden>🔒</span>
      <span className="privacy-text">
        100% local inference · <strong>your text never leaves this browser</strong>
      </span>
    </div>
  )
}

function DevicePill({ state }: { state: LoadState }) {
  if (state.stage === 'detecting') return <span className="pill detecting">detecting…</span>
  if (state.stage === 'error') return <span className="pill error">error</span>
  const device = state.stage === 'ready-to-load' ? state.diagnostics.recommended.device : state.device
  return (
    <span className={`pill ${device}`}>{device === 'webgpu' ? 'WebGPU ✓' : 'WASM fallback'}</span>
  )
}

function DtypePill({ state }: { state: LoadState }) {
  if (state.stage === 'detecting' || state.stage === 'error') return null
  const dtype =
    state.stage === 'ready-to-load' ? state.selectedDtype : state.dtype
  return <span className={`pill dtype ${dtype}`}>{dtype}</span>
}

function DiagnosticsPanel({
  diagnostics,
  selectedDtype,
  onChangeDtype,
  onLoad,
}: {
  diagnostics: Diagnostics
  selectedDtype: Dtype
  onChangeDtype: (d: Dtype) => void
  onLoad: () => void
}) {
  const rows: Array<{ label: string; value: string; ok: 'pass' | 'warn' | 'fail' }> = [
    {
      label: 'Environment',
      value: `${diagnostics.os} · ${diagnostics.browser}`,
      ok: 'pass',
    },
    {
      label: 'WebGPU',
      value: diagnostics.webgpu ? 'available' : 'not available — using WASM CPU fallback',
      ok: diagnostics.webgpu ? 'pass' : 'warn',
    },
    {
      label: 'shader-f16',
      value: diagnostics.shaderF16
        ? 'supported (enables the smallest q4f16 variant)'
        : diagnostics.webgpu
          ? 'not exposed — falling back to q4'
          : 'n/a',
      ok: diagnostics.shaderF16 ? 'pass' : diagnostics.webgpu ? 'warn' : 'pass',
    },
    ...(diagnostics.maxBufferSize
      ? [
          {
            label: 'Max GPU buffer',
            value: `${(diagnostics.maxBufferSize / 1024 / 1024 / 1024).toFixed(1)} GB`,
            ok: diagnostics.maxBufferSize >= 1024 * 1024 * 1024 ? ('pass' as const) : ('warn' as const),
          },
        ]
      : []),
    ...(diagnostics.deviceMemoryGB
      ? [
          {
            label: 'Device memory',
            value: `${diagnostics.deviceMemoryGB} GB (coarse estimate)`,
            ok: diagnostics.deviceMemoryGB >= 4 ? ('pass' as const) : ('warn' as const),
          },
        ]
      : []),
    ...(diagnostics.storageQuotaBytes
      ? [
          {
            label: 'Storage quota',
            value: `${(diagnostics.storageQuotaBytes / 1024 / 1024 / 1024).toFixed(1)} GB available`,
            ok: diagnostics.storageQuotaBytes >= 1024 * 1024 * 1024 ? ('pass' as const) : ('warn' as const),
          },
        ]
      : []),
  ]

  const sizeMb = DTYPE_SIZES_MB[selectedDtype]

  return (
    <section className="panel diagnostics">
      <div className="label">System check</div>
      <p className="dim small">
        Nothing has been downloaded yet. No backend, no API calls, no telemetry — when you click{' '}
        <strong>Load model</strong> the weights are fetched from the Hugging Face CDN and cached in
        your browser. Inference then runs entirely on this device.
      </p>
      <ul className="diag-rows">
        {rows.map((r, i) => (
          <li key={i} className={`diag-row diag-${r.ok}`}>
            <span className="diag-icon" aria-hidden>
              {r.ok === 'pass' ? '✓' : r.ok === 'warn' ? '!' : '✗'}
            </span>
            <span className="diag-label">{r.label}</span>
            <span className="diag-value">{r.value}</span>
          </li>
        ))}
      </ul>

      <div className="recommendation">
        <strong>Recommended:</strong> {diagnostics.reason}
      </div>

      <details className="advanced">
        <summary>Advanced: override model precision</summary>
        <div className="advanced-body">
          <select
            className="dtype-select"
            value={selectedDtype}
            onChange={(e) => onChangeDtype(e.target.value as Dtype)}
          >
            {ALL_DTYPES.map((d) => (
              <option key={d} value={d}>
                {DTYPE_LABELS[d]} — ~{DTYPE_SIZES_MB[d]} MB
              </option>
            ))}
          </select>
          <p className="dim small">
            Larger variants may crash weaker devices. <code>q4f16</code> is the default for most
            users; pick <code>q4</code> if your browser doesn't expose <code>shader-f16</code>.
          </p>
        </div>
      </details>

      <div className="actions">
        <button className="btn primary" onClick={onLoad}>
          Load model (~{sizeMb} MB)
        </button>
        <span className="dim small">Cached in your browser for next time.</span>
      </div>
    </section>
  )
}

function LoadingPanel({
  state,
}: {
  state: Extract<LoadState, { stage: 'loading' }>
}) {
  const files = Object.entries(state.files)
  const totalLoaded = files.reduce((n, [, f]) => n + f.loaded, 0)
  const totalTotal = files.reduce((n, [, f]) => n + f.total, 0)
  const pct = totalTotal > 0 ? (totalLoaded / totalTotal) * 100 : 0
  return (
    <section className="panel">
      <p>
        Loading <strong>{state.dtype}</strong> on <strong>{state.device}</strong>…{' '}
        {humanBytes(totalLoaded)} / {humanBytes(totalTotal)}
      </p>
      <div className="progress">
        <div className="progress-bar" style={{ width: `${pct}%` }} />
      </div>
      <details className="files">
        <summary>per-file progress ({files.length})</summary>
        <ul>
          {files.map(([name, f]) => (
            <li key={name}>
              <code>{name}</code> — {humanBytes(f.loaded)} / {humanBytes(f.total)}
            </li>
          ))}
        </ul>
      </details>
    </section>
  )
}

function ResultsPanel({ result }: { result: RunResult }) {
  const masked = useMemo(() => renderMasked(result.text, result.entities), [result])
  return (
    <section className="panel">
      <div className="results-head">
        <span className="label">Masked</span>
        <span className="latency">{result.latencyMs.toFixed(1)} ms</span>
      </div>
      <div className="masked">{masked}</div>

      <div className="label entities-head">Entities ({result.entities.length})</div>
      {result.entities.length === 0 ? (
        <p className="dim">No PII detected.</p>
      ) : (
        <table className="entities">
          <thead>
            <tr>
              <th>label</th>
              <th>text</th>
              <th>score</th>
              <th>range</th>
            </tr>
          </thead>
          <tbody>
            {result.entities.map((e, i) => (
              <tr key={i}>
                <td>
                  <span className={`ent ent-${e.entity_group}`}>{e.entity_group}</span>
                </td>
                <td className="mono">{e.word}</td>
                <td>{e.score.toFixed(3)}</td>
                <td className="mono dim">
                  {e.start}–{e.end}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}

function Footer() {
  return (
    <footer className="footer">
      <div className="footer-row">
        <span>
          Built by{' '}
          <a href="https://montevive.ai" target="_blank" rel="noreferrer">
            Montevive.ai
          </a>
        </span>
        <span className="sep">·</span>
        <span>
          Model:{' '}
          <a href="https://huggingface.co/openai/privacy-filter" target="_blank" rel="noreferrer">
            openai/privacy-filter
          </a>{' '}
          (Apache 2.0) —{' '}
          <a
            href="https://cdn.openai.com/pdf/c66281ed-b638-456a-8ce1-97e9f5264a90/OpenAI-Privacy-Filter-Model-Card.pdf"
            target="_blank"
            rel="noreferrer"
          >
            model card
          </a>
        </span>
      </div>
      <div className="footer-row">
        <span>
          Runtime:{' '}
          <a href="https://github.com/huggingface/transformers.js" target="_blank" rel="noreferrer">
            transformers.js
          </a>{' '}
          v4 · WebGPU / WASM
        </span>
        <span className="sep">·</span>
        <span>
          <a href="https://github.com/montevive" target="_blank" rel="noreferrer">
            GitHub
          </a>{' '}
          ·{' '}
          <a
            href="https://www.linkedin.com/company/montevive-ai"
            target="_blank"
            rel="noreferrer"
          >
            LinkedIn
          </a>
        </span>
      </div>
      <div className="footer-row dim small">
        All inference runs on-device. No text, inputs, or results are transmitted to any server.
      </div>
    </footer>
  )
}

function renderMasked(text: string, entities: Entity[]) {
  if (entities.length === 0) return <span>{text}</span>
  const sorted = [...entities].sort((a, b) => a.start - b.start)
  const nodes: React.ReactNode[] = []
  let cursor = 0
  sorted.forEach((ent, i) => {
    if (ent.start < cursor) return
    if (cursor < ent.start) nodes.push(text.slice(cursor, ent.start))
    nodes.push(
      <span
        key={i}
        className={`ent ent-${ent.entity_group}`}
        title={`score ${ent.score.toFixed(3)}`}
      >
        [{ent.entity_group}:{text.slice(ent.start, ent.end)}]
      </span>,
    )
    cursor = ent.end
  })
  if (cursor < text.length) nodes.push(text.slice(cursor))
  return <>{nodes}</>
}

function humanBytes(n: number) {
  if (!n) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let i = 0
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024
    i++
  }
  return `${n.toFixed(1)} ${units[i]}`
}
