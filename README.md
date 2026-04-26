<p align="center">
  <a href="https://montevive.ai">
    <img src="public/img/logo-montevive.png" alt="Montevive.ai" height="48" />
  </a>
</p>

<h1 align="center">OpenAI Privacy Filter — Web Demo</h1>

<p align="center">
  <strong>Run OpenAI's PII detector entirely in your browser.</strong><br>
  100% local inference · WebGPU · no backend · no data transmission.
</p>

<p align="center">
  <a href="https://labs.montevive.ai/openai-privacy-demo/">
    <img alt="Live demo" src="https://img.shields.io/badge/live_demo-labs.montevive.ai-0056a7?style=for-the-badge&logo=vercel&logoColor=white">
  </a>
</p>

<p align="center">
  <a href="https://opensource.org/licenses/Apache-2.0">
    <img alt="License: Apache 2.0" src="https://img.shields.io/badge/license-Apache_2.0-0056a7.svg">
  </a>
  <a href="https://huggingface.co/openai/privacy-filter">
    <img alt="Model: openai/privacy-filter" src="https://img.shields.io/badge/model-openai%2Fprivacy--filter-ff9d00.svg">
  </a>
  <a href="https://github.com/huggingface/transformers.js">
    <img alt="transformers.js v4" src="https://img.shields.io/badge/transformers.js-v4-yellow.svg">
  </a>
  <img alt="WebGPU" src="https://img.shields.io/badge/WebGPU-enabled-45d0bd.svg">
  <img alt="Built with Vite + React + TS" src="https://img.shields.io/badge/vite-react%20%2B%20ts-646cff.svg">
</p>

<p align="center">
  <a href="https://labs.montevive.ai/openai-privacy-demo/">Live demo</a> ·
  <a href="#-quickstart">Quickstart</a> ·
  <a href="#-how-it-works">How it works</a> ·
  <a href="#-browser-support">Browser support</a> ·
  <a href="#-deployment">Deploy</a> ·
  <a href="#-privacy">Privacy</a> ·
  <a href="https://montevive.ai">Montevive.ai</a>
</p>

<p align="center">
  <a href="https://labs.montevive.ai/openai-privacy-demo/">
    <img src="openai-privacy-filter-demo.gif" alt="OpenAI Privacy Filter — animated demo of the in-browser PII detector" width="820" />
  </a>
</p>

---

## 🔗 Live demo

> **Try it now: [labs.montevive.ai/openai-privacy-demo](https://labs.montevive.ai/openai-privacy-demo/)**

Hosted on the [Montevive Labs](https://labs.montevive.ai/) subdomain. First load fetches
~770 MB of model weights from the Hugging Face CDN (cached in your browser afterwards);
every subsequent visit starts instantly. Open your browser's DevTools Network tab to
verify for yourself that nothing is sent back to a server.

---

## Overview

A small browser app that runs [`openai/privacy-filter`](https://huggingface.co/openai/privacy-filter)
— OpenAI's bidirectional token classifier for personal data detection — **entirely on the
user's device**. Model weights are downloaded once from the Hugging Face CDN, cached in
IndexedDB, and inference runs on the local GPU via WebGPU (with a WASM CPU fallback for
browsers without WebGPU). There is no backend. There are no API calls. Your text never
leaves the tab it's typed into.

Built by [Montevive.ai](https://montevive.ai) as a concrete example of the privacy-first
techniques we advocate for. *Secure AI for secure decisions.*

## ✨ Features

- **100% local inference** — model weights live in IndexedDB, tensors live on the user's GPU. No server, no API, no telemetry.
- **WebGPU first, WASM fallback** — uses `navigator.gpu` when available, falls back to ONNX Runtime Web on CPU otherwise.
- **Adaptive precision** — detects `shader-f16` support and picks the `q4f16` (772 MB) variant when it's safe, or `q4` (875 MB) otherwise. Manual override in an *Advanced* toggle.
- **Pre-flight system check** — shows WebGPU / `shader-f16` / GPU buffer / device memory / storage quota probes before any bytes are fetched. No auto-download.
- **Web-Worker inference** — keeps the UI thread responsive during model load and scoring.
- **Masked output + entity table** — 8 PII categories (`private_person`, `private_email`, `private_phone`, `private_url`, `private_address`, `private_date`, `account_number`, `secret`) with character-level spans and confidence scores.
- **Light + dark theme** — honors `prefers-color-scheme`, with a manual toggle persisted in `localStorage`.
- **Deploy-anywhere static build** — a single `BASE_PATH=/repo/ npm run build` produces a drop-in GitHub Pages site.

## 🚀 Quickstart

```bash
git clone https://github.com/montevive/openai-privacy-filter-web.git
cd openai-privacy-filter-web
npm install
npm run dev       # open http://localhost:5173
```

Requires **Node 18+**, a modern browser (Chrome 120+, Edge 120+, Safari 26+, or Firefox 145+ on macOS ARM), and ~1 GB of free IndexedDB storage on first visit.

## 🧠 How it works

```
┌──────────────┐   ┌────────────────┐   ┌────────────────────┐
│  App.tsx     │──►│  worker.ts     │──►│  transformers.js   │
│  (UI)        │   │  (Web Worker)  │   │  pipeline          │
└──────┬───────┘   └────────────────┘   └─────────┬──────────┘
       │                                          │
       │ postMessage { type: 'run', text }        │ fetch once
       ▼                                          ▼
 diagnostics.ts                          ┌────────────────────┐
 (WebGPU / CPU                           │ Hugging Face CDN   │
  capability probe)                      │ openai/privacy-fltr│
                                         └─────────┬──────────┘
                                                   │ cached in
                                                   ▼
                                         ┌────────────────────┐
                                         │ Browser IndexedDB  │
                                         └────────────────────┘
```

1. **Pre-flight.** On mount, [`src/diagnostics.ts`](src/diagnostics.ts) probes the browser: `navigator.gpu.requestAdapter()`, `adapter.features.has('shader-f16')`, `adapter.limits.maxBufferSize`, `navigator.deviceMemory`, `navigator.storage.estimate()`. It returns a recommended `{device, dtype}` pair and never fires a request for the model.
2. **User action.** The *Load model* button is the only trigger for the ~800 MB download. Progress streams per-file from the HF CDN.
3. **Inference.** [`src/worker.ts`](src/worker.ts) keeps a singleton [`TokenClassificationPipeline`](https://huggingface.co/docs/transformers.js/pipelines#token-classification-pipeline) alive. Each input sentence is scored with `aggregation_strategy: "simple"`; character offsets are reconstructed locally (the BPE tokenizer doesn't expose them, so we walk the input with `indexOf`).
4. **Render.** [`src/App.tsx`](src/App.tsx) shows a colour-coded masked view plus a table of `(label, text, score, range)` per detected entity.

## 🌐 Browser support

| Browser                                               | WebGPU | `shader-f16` | Active variant    | Notes                                  |
| ----------------------------------------------------- | :----: | :----------: | ----------------- | -------------------------------------- |
| Chrome / Edge 120+ (Windows, Linux, macOS, macOS ARM) |   ✅   |      ✅      | `q4f16` (772 MB)  | Best experience                        |
| Safari 26+ (macOS / iOS)                              |   ✅   |      ✅      | `q4f16`           | Stable since Sept 2025 on macOS Tahoe  |
| Firefox 145+ (macOS ARM)                              |   ✅   |    partial   | `q4` or `q4f16`   | WebGPU on Mac ARM; variable elsewhere  |
| Safari ≤ 18                                           |   ❌   |      —       | `q4f16` via WASM  | Falls back to CPU (~1 s/sentence)      |
| Chrome on Android (120+)                              |  ⚠️   |    depends   | device-specific   | Works on higher-end SoCs               |
| Older desktop Linux without `shader-f16`              |   ✅   |      ❌      | `q4` (875 MB)     | Auto-selected; pure int4               |

If `shader-f16` is missing, the app automatically picks `q4`. If WebGPU is unavailable, it falls back to the WASM CPU backend. Both choices are shown in the system-check card before anything is downloaded.

## 🎛️ Dtype variants

All five ONNX variants published by OpenAI on the Hub are supported. Only the first two are exposed by default; the rest are reachable through the *Advanced* toggle.

| Dtype    | File                     | On-disk  | Best for                               |
| -------- | ------------------------ | -------: | -------------------------------------- |
| `q4f16`  | `model_q4f16.onnx`       |  772 MB  | WebGPU with `shader-f16` (default)     |
| `q4`     | `model_q4.onnx`          |  875 MB  | WebGPU without `shader-f16`            |
| `fp16`   | `model_fp16.onnx`        |  2.6 GB  | Powerful devices prioritizing quality  |
| `q8`     | `model_quantized.onnx`   |  1.5 GB  | CPU fallback on older hardware         |

Size → speed measurements on CPU are in our internal research notes.

## 🛠️ Development

```bash
npm run dev       # start Vite dev server on :5173
npm run build     # typecheck + production build → dist/
npm run preview   # serve the built dist/ locally
npm run lint      # eslint
```

### Project layout

```
.
├── index.html                 # theme boot + OG/Twitter meta
├── public/
│   └── img/
│       └── logo-montevive.png
├── src/
│   ├── App.tsx                # UI: Header, DiagnosticsPanel, ResultsPanel, Footer
│   ├── App.css                # Light + dark palettes, Montevive colors
│   ├── diagnostics.ts         # WebGPU / browser capability probes + recommendation
│   ├── main.tsx
│   ├── types.ts               # WorkerMessage + Entity + Diagnostics types
│   └── worker.ts              # Singleton transformers.js pipeline
├── vite.config.ts             # base: process.env.BASE_PATH ?? '/'
├── deploy/
│   ├── Dockerfile             # multi-stage: Vite build → nginx
│   ├── nginx.conf
│   ├── landing/               # labs.montevive.ai root landing page
│   ├── k8s/                   # Namespace, Deployment, Service, HTTPRoute, Certificate
│   └── README.md              # DNS / deploy / rollback docs
└── .github/workflows/
    └── publish.yml            # build + push to ghcr.io on push to main
```

### Adding a capability probe

1. Extend the `Diagnostics` interface in [`src/types.ts`](src/types.ts).
2. Compute the new field in `runDiagnostics()` inside [`src/diagnostics.ts`](src/diagnostics.ts).
3. Add a row to `DiagnosticsPanel` in [`src/App.tsx`](src/App.tsx) with a pass/warn/fail icon.

## 📦 Deployment

### GitHub Pages

This repo builds cleanly to a static bundle. From the root of the repository:

```bash
BASE_PATH=/openai-privacy-filter-web/ npm run build
```

Then publish `dist/` using the `actions/deploy-pages` workflow or by pushing to a `gh-pages` branch.

A minimal workflow (save as `.github/workflows/pages.yml`):

```yaml
name: Deploy to GitHub Pages
on:
  push: { branches: [main] }
  workflow_dispatch:
permissions: { pages: write, id-token: write, contents: read }
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm ci && BASE_PATH=/${{ github.event.repository.name }}/ npm run build
      - uses: actions/upload-pages-artifact@v3
        with: { path: dist }
  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment: { name: github-pages, url: ${{ steps.deployment.outputs.page_url }} }
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

### Any static host (Netlify, Cloudflare Pages, S3, …)

`npm run build` with no env vars produces a root-hosted site. All assets are fingerprinted, so long-cache headers are safe on everything except `index.html`.

### Caveats

- The app requests ~800 MB of model files from `huggingface.co` on first load. If you self-host, you'll need to mirror those files and point transformers.js at your mirror via `env.remoteHost`.
- WebGPU requires an HTTPS context outside of `localhost`. GitHub Pages / Netlify / Cloudflare Pages all qualify out of the box.

## 🔒 Privacy

This is the whole point of the demo. To make it as honest as possible:

- **No server-side inference.** The repo has no backend. Inference runs entirely in the visitor's browser.
- **No analytics or telemetry.** No Google Analytics, no Plausible, no Sentry, no third-party scripts. The only network requests made after page load are to the Hugging Face CDN for model weights (once, then cached).
- **No tracking cookies.** The only things persisted are the theme preference (`localStorage`) and the model weights (IndexedDB).
- **Your text is never transmitted.** The textarea content never leaves the browser — it's passed by `postMessage` to a same-origin Web Worker and nothing else.

If you fork this and add analytics, **please update this section** so the statement remains literally true.

## 🧪 Model details

- **Architecture.** Pre-norm transformer encoder with grouped-query attention, 128-expert MoE, 50M active / 1.5B total parameters.
- **Output.** 33 BIOES token classes over 8 privacy categories, decoded with either HF's built-in `aggregation_strategy: "simple"` (what this demo uses) or a constrained Viterbi decoder (shipped with the model but not wired up in the browser yet).
- **License.** Apache 2.0 — commercial use permitted.
- **Model card.** [Full card (PDF)](https://cdn.openai.com/pdf/c66281ed-b638-456a-8ce1-97e9f5264a90/OpenAI-Privacy-Filter-Model-Card.pdf).
- **Disclaimer.** The model's authors explicitly flag it as a *"redaction and data-minimization aid, not an anonymization, compliance, or safety guarantee."* High-stakes deployments should layer it with policy, audit and human review.

## 🙏 Credits & thanks

This demo wouldn't exist without the work of several teams who chose to give their research
away. Heartfelt thanks to:

- **[OpenAI](https://openai.com)** — thank you for training the [privacy-filter](https://huggingface.co/openai/privacy-filter) model and, crucially, for releasing it under **Apache 2.0**. An on-device PII detector with a permissive license is exactly what the ecosystem needed; the fact that we can run it in a browser tab, commercially, without phoning home, is a direct consequence of that choice. Extra thanks for shipping pre-quantized ONNX variants (including `q4f16`) right in the repo — the demo works out of the box because of that.
- **[Hugging Face](https://huggingface.co)** — thank you for [transformers.js](https://github.com/huggingface/transformers.js) and the whole WebGPU + ONNX pipeline stack. The v4 release turned "run any HF model in the browser" from a party trick into a boring one-liner, and we appreciate it. Thanks also for hosting the weights on the Hub and keeping the CDN fast.
- **[ONNX Runtime](https://onnxruntime.ai/)** — thank you for the Web backend. The WebGPU execution provider (and the WASM fallback that picks up the slack on Safari ≤ 18) is what actually makes this fast on consumer hardware.
- **The WebGPU working group** — thank you for shipping a real GPU API to the browser. Running a 1.5B-parameter model on-device at ~50 ms/sentence is genuinely new, and it's only possible because you landed the standard.
- **The `tokenizers` and `onnxruntime-web` maintainers** — thank you for the countless hours of unglamorous work that make everything above Just Work™ for end users.
- **Everyone who reported issues, wrote blog posts, and answered our questions** while we were getting WebGPU + `shader-f16` + transformers.js v4 to cooperate — you made this a weekend instead of a month.

And of course, **[Montevive.ai](https://montevive.ai)** built and published the demo itself —
if it's useful to you, we'd love to hear about it.

## 📄 License

Copyright © Montevive.ai. Licensed under the **Apache License, Version 2.0**. See [`LICENSE`](LICENSE) for the full text.

The underlying model is distributed separately by OpenAI under Apache 2.0.

## 🌐 About Montevive.ai

> **Secure AI for secure decisions.** We help companies make strategic use of AI safely,
> with legal compliance and without putting their information at risk. **100% AI, 99% security.**

- [montevive.ai](https://montevive.ai)
- [LinkedIn](https://www.linkedin.com/company/montevive-ai)
- [GitHub](https://github.com/montevive)
- [info@montevive.ai](mailto:info@montevive.ai)

---

<p align="center">
  Built with ♥ by <a href="https://montevive.ai">Montevive.ai</a>
</p>
