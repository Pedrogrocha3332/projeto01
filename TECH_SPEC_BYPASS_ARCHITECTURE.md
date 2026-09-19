# ARCHITECTURAL & FORENSIC SPECIFICATION: META REELS BYPASS & INFRASTRUCTURE ANALYSIS

**Target Entity:** Meta Graph API v21.0 (Content Publishing Engine & SMI Pipeline)  
**Host Architecture:** TanStack Start (Nitro/Vite SSR) on Vercel Serverless (AWS Lambda `us-east-1`)  
**State & Database Layer:** Supabase Postgres (Dedicated Instances `t3a.nano`/`t3a.micro`)  
**Traffic Volume:** 10–15 Tenant Dashboards × 10–15 Accounts = ~150 IG Accounts @ 5 Reels/hr burst cadence (~18,000 requests/24h)

---

## 1. COMPREHENSIVE ARCHITECTURAL AUDIT & FORENSIC SYSTEM OVERVIEW

The application functions as a multi-tenant orchestration system for mass publication of Instagram Reels via the official Instagram Graph API (`graph.instagram.com/v21.0`).

### 1.1. Core Pipeline Workflow
1. **Coordination & Scheduling:**
   * External cron (`cron-job.org`) dispatches HTTP `POST` triggers at 1-minute resolution to `/api/public/cron/publish-scheduled`.
   * The cron route executes Postgres RPC `tick_publication_rounds()` under exclusive transaction advisory locking (`pg_advisory_xact_lock(14092026)`).
   * A dynamic publication plan materializes records into `public.scheduled_posts` and `public.post_media`.
2. **Ingestion & Containerization:**
   * Node.js server engine (`src/lib/publish.server.ts`) issues `claim_publication_send` acquiring a 15-minute lease token.
   * Signed ephemeral URLs (TTL: 7200s) are generated against Supabase Storage bucket `media` via S3 API.
   * `POST https://graph.instagram.com/v21.0/{ig-user-id}/media` is invoked with payload:
     `{ media_type: "REELS", video_url: signedUrl, caption, share_to_feed: "true" }`.
3. **Asynchronous Polling & Commit:**
   * Worker polls `GET /{ig-container-id}?fields=status_code,status` until `status_code === 'FINISHED'`.
   * Publication trigger: `POST /{ig-user-id}/media_publish` with `{ creation_id: containerId }`.
   * Advisory lock release: RPC `release_publication_send()`.

---

## 2. FORENSIC ROOT-CAUSE ANALYSIS (THE "0-VIEW SHADOWBAN" BOTTLENECK)

The observed failure mode is **distribution suppression** (Reel publishes successfully with HTTP 200/204, account health status remains green, but algorithmic propagation across Explore and the Reels Feed is throttled to 0–5 impressions).

Analysis reveals a systemic multi-vector correlation triggered by Meta’s **Spam & Media Integrity (SMI)** and **Coordinated Inauthentic Behavior (CIB)** detection engines:

### Vector A: Network Egress & ASN Clustering (Vercel Serverless Gateway)
* **Pre-mitigation State:** All 10–15 dashboards executed on Vercel Serverless running out of AWS `us-east-1` (iad1).
* **Signal Leakage:** 18,000 requests/day originating from a shared AWS datacenter ASN targeting Meta endpoints. Meta edge proxies (Proxygen) inspect Layer 4/7 metadata (TCP handshake, TLS JA3/JA4 fingerprint, HTTP/2 SETTINGS frames). Meta's internal heuristics flag commercial cloud ASN bursts as automated content farm activity, dropping the trust multiplier of issued `ig_media_id`s.

### Vector B: Perceptual Video Hashing & Frame Integrity (PDQ/TMK Collision)
* **Pre-mitigation State:** Identical raw `.mp4` master files were signed and published across multiple accounts and tenants.
* **Signal Leakage:** When Meta worker nodes (`FacebookExternalHit`) execute ingestion from Supabase Storage:
  * **PDQ (Spatial Hash):** 256-bit perceptual hash computed per keyframe based on discrete cosine transforms (DCT) of luminance matrices.
  * **TMK (Temporal Match Kernel):** Evaluates vector sequence similarities between scene transitions and I-Frame temporal pacing.
  * **ACRCloud / Audio Spectrogram:** Acoustic fingerprint matching against global audio index.
* **Failure Trigger:** Identical raw videos across multiple accounts trip Meta's updated "Unoriginal Content / Content Farming" recommendation filter, removing the posts from non-follower distribution.

### Vector C: Token Rejection Loops & Meta App ID Poisoning
* **Pre-mitigation State:** When an account suffered an operational checkpoint or authentication suspension, the cron continued retry cycles.
* **Signal Leakage:** Repeated `OAuthException` responses (Codes 190, 368; subcodes 490, 458, 460) accumulated against the Meta `client_id` (App ID). High error rates trigger tenant-level API call budget degradation (BUC rate limit penalties) and shadow-quarantine of the entire application identifier.

### Vector D: Database Memory Pressure & Swap Depletion (Supabase Nano/Micro)
* **Observed Metrics:** `DevOps07` (1GB RAM) running at 929.17 MB resident memory, 1.27 GB committed, with active disk SWAP allocation.
* **Impact:** High latency in Postgres transaction advisory locks (`pg_advisory_xact_lock`), causing cron workers to timeout before container confirmation and producing duplicate or desynchronized queue states.

---

## 3. IMPLEMENTED MITIGATION ARCHITECTURE & HARDENING

We have engineered and integrated four core defensive subsystems into `Avaliable-domain-main`:

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                APPLICATION ARCHITECTURE                               │
└────────────────────────────────────────────────────────────────────────────────────────┘

    [ CRON ORCHESTRATOR ] (1-min resolution)
              │
              ▼
    [ VERCEL RUNTIME: Nitro / TanStack Start ]
              │
              ├──► [ PROXY DISPATCHER: Undici ProxyAgent ]
              │             │
              │             ▼
              │    [ RESIDENTIAL PROXY SILO 1:1 ] (Claro/Vivo Residential ASN)
              │             │
              │             ▼  (Payload: ~3 KB JSON command)
              │    [ META GRAPH API v21.0 ]
              │             │
              │             │  GET media payload (Egress)
              │             ▼
              └──► [ SIGNED MEDIA ENDPOINT ]
                            ▲
                            │
               [ LOCAL / VPS FFmpeg CAMOUFLAGE PIPELINE ]
               (Destroys PDQ/TMK, I-Frames, Injects ACR Trend & EOF Entropy)
```

### 3.1. Layer 7 Egress Decoupling (`src/lib/publish.server.ts`)
* Integrated `undici.ProxyAgent` within the low-level HTTP client of `publish.server.ts`.
* Environmental variable `PROXY_URL` intercepts all REST calls targeting `graph.instagram.com`:
  * `POST /{ig-user-id}/media`
  * `GET /{ig-container-id}`
  * `POST /{ig-user-id}/media_publish`
* **Zero Overhead Constraint:** Media binaries do NOT traverse the proxy tunnel. The tunnel only handles JSON payload handshakes (~3 KB/call). A 1 GB residential proxy quota sustains >300,000 API operations.

### 3.2. Automated Circuit Breaker Engine (`src/lib/publish.server.ts`)
* Extended `classifyError()` to trap permanent failure signatures:
  * Regular expressions match: `user access is restricted`, `checkpoint`, `challenge_required`, `error_subcode 490|458|459|460|463|467`, `error code 190|368`.
* **Execution Logic:**
  * Immediate state transition: `instagram_accounts.is_active = false`, `is_restricted = true`.
  * Lockout of current round: `publication_round_accounts.stopped_at = now()`.
  * Cancellation of queued tasks: Pending records transition directly to `draft` / `failed_final`.
  * **Result:** Zero subsequent calls are dispatched to Meta with invalid tokens, preserving the aggregate trust tier of the Meta App ID.

### 3.3. Deterministic Media Camouflage (`scripts/camuflar_criativos.py`)
To neutralize PDQ/TMK perceptual hashing before storage staging:
* **I-Frame / Temporal Manipulation:** Dynamic temporal micro-trim of `0.2s` to `0.4s` (`-ss [trim_start]`), stripping the original container keyframe table.
* **Spatial Matrix Perturbation:** Discrete affine transformation via matrix rotation (`rotate=±0.25°`) coupled with a compensatory `1.025x` scaling zoom. Displaces all spatial coordinate matrices, rendering PDQ Hamming distance calculations orthogonal.
* **Acoustic Trend Anchoring (ACRCloud):** Injection of viral background trend audio at `0.01` (1% amplitude), phase-shifted and equalized (`pan=stereo|c0=c0+0.001*c1`).
* **Binary Entropy Injection:** Strips EXIF/metadata (`-map_metadata -1`) and writes a randomized cryptographic byte sequence to EOF, modifying SHA-256 and MD5 hashes.

### 3.4. CDN Masking Layer (`MEDIA_CDN_URL`)
* `signedUrl()` modified to dynamically remap S3/Supabase storage host headers to an edge-cached Cloudflare CDN endpoint (`MEDIA_CDN_URL`), decoupling asset egress origin from known hosting domains and eliminating egress overhead.

### 3.5. Real-Time Telemetry & Zero-View Heuristic Detection
* Integrated real-time insights queries (`/{ig_media_id}/insights?metric=plays,reach,total_interactions`).
* UI surface (`src/routes/_authenticated/queue.tsx` and `analytics.tsx`) features an automated 2-hour zero-view threshold monitor:
  `p.published_at > 2h && p.view_count === 0` -> Triggers shadowban advisory flag for isolation.

---

## 4. CURRENT FILE TREE & COMPONENT MANIFEST

```
Avaliable-domain-main/
├── src/
│   ├── lib/
│   │   ├── publish.server.ts       # ProxyAgent integration, Circuit Breaker, Graph dispatcher
│   │   ├── metrics.server.ts       # Real-time Graph insights collector via Proxy tunnel
│   │   ├── metrics.functions.ts    # TanStack Start server functions (sync single/batch)
│   │   └── rounds.server.ts        # Database advisory locking & coordinator hooks
│   └── routes/_authenticated/
│       ├── queue.tsx               # Queue monitor with real-time views and shadowban flag
│       ├── analytics.tsx           # Aggregate metrics and Meta Graph synchronization
│       └── rounds.tsx              # Cadence enforcement (5 reels/batch, 105s spacing, 60m cooldown)
├── supabase/
│   └── migrations/
│       └── 20260919130000_post_metrics.sql  # Database schema for view_count, like_count, reach_count
├── scripts/
│   └── camuflar_criativos.py       # Standalone FFmpeg mathematical transformation utility
└── GUIA_ISOLAMENTO_PROXIES.md      # Deployment runbook for environment configuration
```

---

## 5. HARDENING ROADMAP & DISCUSSION POINTS FOR SENIOR REVIEW

1. **Storage Decoupling:** Transition from direct Supabase Storage URLs to Cloudflare R2 / Custom Domain S3 with origin request signing.
2. **Cron Distribution:** Elimination of redundant webhook triggers (resolving the observed dual-POST executions on `DevOps07`).
3. **Database Resource Allocation:** Vertical upgrade of high-throughput instances from `t3a.nano` to `t3a.micro`/`small` to clear SWAP pressure.
4. **TLS Fingerprint Harmonization:** Evaluation of residential proxy egress headers to ensure full conformity with real-browser TLS profiles.
