# VOYARA AI — Phase 4C Activation Runbook: WhatsApp, Website Chat & LLM Routing

No live Meta, WhatsApp, or LLM credentials exist anywhere in this project. Everything below is a requirements list and procedure — **no real activation has occurred.**

---

## 1. Meta / WhatsApp Business activation requirements

1. **Meta Business verification** (if not already completed for Instagram in Phase 4B — this is the same underlying Meta Business account). A document-based process; start early if not already done.
2. **A WhatsApp Business Account (WABA)** under that Meta Business account. Note the **WhatsApp Business Account ID** once created.
3. **A phone number** connected to the WABA — for initial certification, Meta provides a **free test number** with a **test phone number ID**, usable without a real SIM card, sufficient to prove the whole flow end to end before committing to a real number. Note the **phone number ID** (`VOYARA_WHATSAPP_PHONE_NUMBER_ID`).
4. **A Meta App** (Developer console) with the WhatsApp product added — note the **App ID** and **App Secret** (`VOYARA_WHATSAPP_APP_SECRET`, used to verify inbound webhook signatures — see the WhatsApp adapter).
5. **A permanent access token** for the WABA (`VOYARA_WHATSAPP_ACCESS_TOKEN`) — Meta's short-lived tokens expire in 24h; a System User permanent token is what a production deployment needs.
6. **A webhook verification token** — a random string you choose yourself (`VOYARA_WHATSAPP_WEBHOOK_VERIFY_TOKEN`), entered in Meta's webhook configuration screen; Meta echoes it back during the one-time challenge handshake this project's `GET /api/v1/whatsapp/webhook` already implements.
7. **Callback URL**: `https://<your-deployed-domain>/api/v1/whatsapp/webhook` — must be HTTPS and publicly reachable once deployed.
8. **Required permissions**: `whatsapp_business_messaging`, `whatsapp_business_management` at minimum — confirm the exact current list in Meta's own documentation at setup time, since Meta's permission names can change.
9. **App Review**: required before your app can message real (non-test) numbers in production. Budget real time — Meta reviews actual use-case evidence.
10. **Message templates**: any message sent outside Meta's 24-hour customer-service window (see below) must use a pre-approved template — submit template content for Meta's approval before relying on it; this project's adapter already models the 24h window (`withinServiceWindow()`) but has no template-content management UI yet (noted as a gap below).
11. **Multi-account**: for R-Travel and VOYARA to each have their own WhatsApp number, repeat steps 2–3 for a second WABA/number and add a second row to the `whatsapp_accounts` table (already multi-account-ready by design — see the Phase 4C final report).

## 2. Website chat environment requirements

No external account is needed to activate the website chat itself — it runs entirely on VOYARA's own infrastructure (Supabase + this Next.js app). Nothing new to configure beyond what Phase 1–4B already required (`NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SECRET_KEY`, etc.).

## 3. LLM provider requirements (for real agent responses)

Currently `SimulationLlmRouter` is the only router that exists — no LLM is called anywhere in this build. To activate real agent responses:

1. **Choose a provider** (Anthropic, OpenAI, or another) — a founder decision, not yet made.
2. **API key** for that provider — would become something like `VOYARA_LLM_API_KEY` (exact name to be finalized when a real router is built, following the same env-var-and-registry pattern as every other credential in this project).
3. **A spending ceiling** — this project's `LlmRouter.run()` already accepts and enforces a spending-ceiling parameter; a real deployment needs a founder-set number (e.g., a daily or monthly minor-units cap) and a place to persist "spent so far," which doesn't exist yet (noted as a gap below — `agent_llm_runs` records every run's cost, but nothing yet sums it against a ceiling automatically).
4. **Per-tier model names** — which specific model powers the CHEAP tier vs. the STRONG tier is a provider-specific choice made once a provider is selected.

## 4. What Phase 4C actually built (real, tested, simulation-only)

- WhatsApp Cloud API adapter: Meta's real webhook challenge and `X-Hub-Signature-256` schemes (implemented with full confidence — stable, documented mechanisms), inbound normalization, the 24h service window check, multi-account-ready construction.
- The real webhook-receiving endpoint (`/api/v1/whatsapp/webhook`) — GET challenge, POST signed-and-idempotent inbound processing.
- Website chat: cryptographically opaque sessions, strict anonymous isolation, rate limiting, consent gating, a real AZ/RU/EN widget.
- Message risk classification and policy-gated low-risk auto-send — the one path that can send without per-message human approval, and only under a founder-approved, hash-verified, versioned policy.
- Provider-neutral LLM routing scaffolding — tiered selection, spending-ceiling enforcement, a closed tool-permission set incapable of expressing an authoritative action.
- Unified inbox extended with unread/SLA indicators for all four channels.

## 5. What is NOT built yet (the real gap before any live activation)

- No real WhatsApp send has ever been attempted (only against `https://fixture.invalid` in fixture certification).
- No real LLM call exists anywhere — `SimulationLlmRouter` fabricates nothing beyond a routing decision and a cost estimate.
- No spending-ceiling *persistence/summing* exists yet — the ceiling check works per-call given a "spent so far" input, but nothing yet computes that input from real accumulated `agent_llm_runs` rows.
- No template-message content management UI exists — the adapter knows *when* a template is required (service window closed) but has no template library to choose from.
- Instagram (from Phase 4B) still has no real adapter either — unchanged from the Phase 4B runbook.

## 6. Activation sequence

1. Complete Meta Business verification and WhatsApp App Review (§1) — longest lead time, start first.
2. Obtain the WhatsApp test number and certify against it first (`npm run certify:whatsapp` will automatically switch to real calls the moment credentials are set) before committing to a real production number.
3. Choose an LLM provider (§3); build the real `LlmRouter` implementation following the exact fail-closed, credential-gated pattern already proven for every other integration in this project.
4. Build the spending-ceiling persistence/summing logic once a provider and real cost model exist.
5. Build template-message management once real WhatsApp send is certified.
6. Only then consider enabling `SANDBOX` mode for WhatsApp in a shared environment.

**No step in this sequence has been started beyond the code written in this phase.**
