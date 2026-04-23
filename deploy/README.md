# Deploy — `labs.montevive.ai`

This directory packages the web demo into a minimal Nginx container and ships it to
`labs.montevive.ai/openai-privacy-demo`. The root of `labs.montevive.ai/` is a small
Montevive Labs landing page that links to the demo.

```
labs.montevive.ai/                         → deploy/landing/   (landing page)
labs.montevive.ai/openai-privacy-demo/     → web/dist/          (the Vite build)
```

All of it runs from one container image, pushed to the GitHub Container Registry at
`ghcr.io/montevive/openai-privacy-filter:latest` and deployed to the shared k8s-mv
cluster using the same Envoy Gateway + cert-manager pattern every other Montevive app
uses.

## Layout

```
deploy/
├── Dockerfile               # multi-stage: Vite build → nginx:1.27-alpine
├── nginx.conf               # static file serving + /healthz + caching
├── landing/                 # labs.montevive.ai root
│   ├── index.html
│   ├── style.css
│   └── logo-montevive.png
└── k8s/
    ├── namespace.yaml       # ns: labs
    ├── deployment.yaml      # 1 replica, non-root, read-only rootfs
    ├── service.yaml         # ClusterIP 80 → 8080
    ├── certificate.yaml     # labs-tls in envoy-gateway-system
    ├── httproute.yaml       # sectionName: https-labs
    └── httproute-redirect.yaml
```

## One-time bootstrap

### 1. DNS

From [infra/k8s-mv](/home/chema/projects/montevive/infra/k8s-mv/):

```bash
./scripts/dns add labs
# Creates: labs.montevive.ai  CNAME  lb.montevive.ai
```

Verify: `dig +short labs.montevive.ai` should resolve through `lb.montevive.ai` to the
Hetzner LB IPv4. DNS typically propagates in < 1 minute.

### 2. Make sure the image exists in GHCR

Either wait for the [Publish image](../.github/workflows/publish.yml) GitHub Actions
workflow to run (triggers on push to `main`), or build + push manually:

```bash
# From the repo root
docker build -t ghcr.io/montevive/openai-privacy-filter:latest -f deploy/Dockerfile .
echo "$GHCR_PAT" | docker login ghcr.io -u <gh-user> --password-stdin
docker push ghcr.io/montevive/openai-privacy-filter:latest
```

The `GHCR_PAT` needs `write:packages` scope on `github.com/montevive`.

### 3. Mark the package public (first push only)

GHCR packages default to private. After the first successful push:
`github.com/montevive/openai-privacy-filter` → **Packages** → `openai-privacy-filter` →
**Package settings** → **Change visibility** → **Public**.

The cluster deployment has no `imagePullSecrets`, so a private package will cause
`ErrImagePull` until this is flipped.

### 4. Certificate (before the Gateway patch can resolve)

```bash
kubectl apply -f deploy/k8s/namespace.yaml
kubectl apply -f deploy/k8s/certificate.yaml
kubectl -n envoy-gateway-system wait --for=condition=Ready certificate/labs-tls --timeout=5m
```

If the wait times out, check the cert-manager event stream:
`kubectl -n envoy-gateway-system describe certificate labs-tls` — usually LE is mid-challenge.

### 5. Patch the shared Gateway (one-time — team convention)

Other Montevive apps add their HTTPS listener this way rather than editing
`infra/k8s-mv/gateway.tf`. Reference: [infra/odoo/README.md:86-103](../../infra/odoo/README.md).

```bash
kubectl -n envoy-gateway-system patch gateway montevive --type=json -p '[
  {
    "op": "add",
    "path": "/spec/listeners/-",
    "value": {
      "name": "https-labs",
      "protocol": "HTTPS",
      "port": 443,
      "hostname": "labs.montevive.ai",
      "allowedRoutes": {"namespaces": {"from": "All"}},
      "tls": {
        "mode": "Terminate",
        "certificateRefs": [{"kind": "Secret", "name": "labs-tls"}]
      }
    }
  }
]'
```

Verify: `kubectl -n envoy-gateway-system get gateway montevive -o jsonpath='{.spec.listeners[*].name}'`
should include `https-labs`.

> ⚠️ **Drift note.** This patched listener is not tracked in `gateway.tf`. A future
> `terraform apply` in `infra/k8s-mv/` would remove it. This is an existing team
> trade-off, not something specific to this deploy.

### 6. Apply the app

```bash
kubectl apply -f deploy/k8s/
kubectl rollout status deployment/labs -n labs --timeout=120s
```

### 7. Verify

```bash
curl -sI  https://labs.montevive.ai/                         | head -1    # 200
curl -sI  https://labs.montevive.ai/openai-privacy-demo/     | head -1    # 200
curl -s   https://labs.montevive.ai/healthz                               # ok
curl -sI  http://labs.montevive.ai/                          | head -1    # 301 → https
```

Browser check: open `https://labs.montevive.ai/`, click into the demo, click
**Load model**, confirm the pre-flight + download + inference loop all work the same
as on localhost.

## Updating

Every push to `main` that touches `web/`, `deploy/`, or the workflow re-publishes
`ghcr.io/montevive/openai-privacy-filter:latest` via the [Publish image](../.github/workflows/publish.yml)
workflow. To roll the running pod onto the new image:

```bash
kubectl -n labs rollout restart deployment/labs
kubectl -n labs rollout status deployment/labs --timeout=120s
```

(Because `imagePullPolicy: Always`, the fresh pod pulls `:latest`.)

## Rollback

Every push also tags an immutable `:sha-<short>` variant. To revert:

```bash
# Find the previous SHA tag at:
# https://github.com/montevive/openai-privacy-filter/pkgs/container/openai-privacy-filter
kubectl -n labs set image deployment/labs \
  labs=ghcr.io/montevive/openai-privacy-filter:sha-abcdef0
kubectl -n labs rollout status deployment/labs
```

To go back to `:latest` after the fix is merged, `rollout restart` again.

## Teardown

```bash
kubectl delete -f deploy/k8s/
kubectl -n envoy-gateway-system delete certificate labs-tls
# Remove the Gateway listener
kubectl -n envoy-gateway-system patch gateway montevive --type=json -p '[
  {"op":"remove","path":"/spec/listeners/<index-of-https-labs>"}
]'
# DNS (from infra/k8s-mv)
./scripts/dns delete labs --yes
```

Find the listener index with:
`kubectl -n envoy-gateway-system get gateway montevive -o jsonpath='{range .spec.listeners[*]}{.name}{"\n"}{end}' | nl -ba`

## Troubleshooting

- **`ErrImagePull`** — the GHCR package is still private. See step 3.
- **`labs-tls` stuck Not Ready** — Let's Encrypt http01 challenge is routed via the
  Gateway. Make sure DNS points to the LB and the `http` listener is healthy.
- **`502` from Envoy** — the `Deployment` isn't ready. `kubectl -n labs logs deploy/labs`.
- **Landing works but `/openai-privacy-demo/` 404s** — asset URLs aren't using the
  right `BASE_PATH`. Confirm the Dockerfile sets `BASE_PATH=/openai-privacy-demo/`
  before `npm run build` and that `web/vite.config.ts` reads it.

## Local smoke test

```bash
# From the repo root
docker build -t ghcr.io/montevive/openai-privacy-filter:latest -f deploy/Dockerfile .
docker run --rm -p 8080:8080 ghcr.io/montevive/openai-privacy-filter:latest

# Separate terminal:
curl -I http://localhost:8080/                          # 200
curl -I http://localhost:8080/openai-privacy-demo/      # 200
curl    http://localhost:8080/healthz                   # ok
```
