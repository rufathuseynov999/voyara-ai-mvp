# VOYARA AI — Phase 4D Activation Runbook: Multilingual AI Voice Receptionist

No live telephony, SIP, or voice-provider credentials exist anywhere in this project. Everything below is a requirements list and procedure — **no real activation has occurred, and no provider has been selected.**

---

## 1. Provider selection (founder decision, not made)

VOYARA has not chosen a managed voice platform. Candidates to evaluate (not an endorsement of any): Twilio Voice, Vonage Voice API, Plivo, or a regional Azerbaijani/CIS telephony provider with SIP trunking. Selection criteria that matter for this project specifically:

- Genuine AZ/RU/EN speech-to-text and text-to-speech quality — Azerbaijani STT/TTS support is the narrowest filter; verify with real audio samples before committing, not vendor marketing claims.
- Real-time webhook delivery for call state changes (started/ringing/answered/transferred/completed/failed) with a documented, verifiable signature scheme.
- Support for either a direct local Azerbaijani number or SIP-forwarding from an existing R-Travel landline.
- Reasonable per-minute pricing at VOYARA's expected call volume.

## 2. Exact requirements once a provider is chosen

1. **Test number** — nearly every provider offers a free/low-cost test number for initial certification; use this before any production number.
2. **Production telephone number(s)** — one for R-Travel, one for VOYARA (or a shared number split by IVR menu, a founder decision) — either a genuine Azerbaijani local number or a SIP-forwarding arrangement from R-Travel's existing line.
3. **API key / account credentials** for the provider (`VOYARA_VOICE_API_KEY`, `VOYARA_VOICE_PROVIDER_ACCOUNT_ID` — names already reserved in `env-core.ts`, ready for a real implementation).
4. **Webhook secret** — the provider's own signing secret for verifying inbound webhook authenticity. **Important**: this project's `VoiceAdapter.verifyAndParseWebhookRaw` implements VOYARA's own fixture/reference HMAC scheme (`sha256=` prefix over the raw body) — it is NOT validated against any real provider's actual signature mechanism. Every real provider has its own scheme (e.g., a different header name, a different canonical string, or public-key signature instead of HMAC) that must be implemented specifically once a provider is chosen, behind the same `VoiceAdapter` interface boundary this project already defines.
5. **SIP trunk credentials** — only if using SIP-forwarding from an existing number rather than a provider-native number.
6. **Inbound and transfer destination numbers** — the real phone numbers authorized staff should be transferred to (per brand, and possibly per department/business-hours-availability).
7. **Callback URL**: `https://<your-deployed-domain>/api/v1/voice/webhook` — must be HTTPS and publicly reachable once deployed.
8. **STT/TTS voice configuration** — voice IDs for AZ/RU/EN (natural-sounding, provider-specific), and confirmation of real-time transcription latency acceptable for a live phone conversation.
9. **Recording, consent, and retention policy** — see §3 below; this is a legal requirement, not just a technical one.
10. **Concurrency, duration, and spending limits** — this project's `Call.durationCeilingSeconds` and `LlmRouter`'s spending-ceiling parameter are already enforced in code; the actual numeric limits (max concurrent calls, max call duration, max daily/monthly spend) are founder business decisions to configure once real cost data exists.
11. **Escalation destinations and business-hours routing** — which staff member/number receives a transfer, and whether that differs outside business hours (e.g., routes to voicemail or a callback offer instead).
12. **WhatsApp follow-up configuration** — this reuses Phase 4C's existing WhatsApp infrastructure unchanged; no new configuration beyond what the Phase 4C runbook already lists is needed for a call to trigger a WhatsApp follow-up.
13. **Monitoring and incident procedures** — alerting for webhook failures, elevated error rates, or unusually high per-call cost; a documented on-call/escalation path for a live-call outage (a phone line that stops answering is a more urgent incident than a website form that stops working).

## 3. Consent, recording, and legal review — mandatory before any live call

**Final recording and privacy wording requires founder-approved legal review for every operating jurisdiction VOYARA takes calls in.** This project does not assume recording is legally permitted anywhere. Concretely:

- The `calls` table's five consent columns (`consent_ai_disclosure`, `consent_recording`, `consent_transcription`, `consent_crm_storage`, `consent_follow_up`) default to `NOT_ASKED` and must be explicitly set by the real call flow before any recording/transcription begins.
- `recordingEnabled` only becomes `true` when consent is explicitly `GRANTED` — proven by both the hermetic and real-sandbox test suites.
- Declining recording/transcription consent still preserves a minimal operational call record (brand, numbers, status, duration, timestamps) — proven directly against real PostgreSQL.
- Azerbaijan, and any other jurisdiction VOYARA later operates calls from or into, may have specific two-party-consent or notification requirements for call recording that a lawyer — not this codebase — must confirm before recording is ever turned on in a live deployment.

## 4. What Phase 4D actually built (real, tested, simulation-only)

- A provider-neutral `VoiceAdapter` interface covering both SIP/telephony (webhook verification, call control) and voice-provider (speak) concerns, with `SimulationVoiceAdapter` as the only implementation.
- Raw-body-first webhook signature verification (before any parsing), matching the discipline already proven for WhatsApp/payment-link webhooks.
- The real webhook-receiving endpoint (`/api/v1/voice/webhook`) with reserve-first idempotent duplicate rejection and multi-number/brand resolution.
- `voice-call-service.ts`, reusing (not duplicating) the exact same policy-gated low-risk auto-send discipline, LLM router, and WhatsApp follow-up path already proven in Phase 4C.
- Full call lifecycle, consent tracking, transfer, callback scheduling, and an append-only audit trail.
- Unified-inbox extension (voice channel, filters, full call detail panel) and read-only Founder Command Center voice metrics.

## 5. What is NOT built yet (the real gap before any live activation)

- No real voice/telephony provider is connected — `createVoiceAdapter('SANDBOX', ...)` honestly reports `CREDENTIALS_MISSING` even when credentials ARE present, because no real Sandbox adapter implementation exists yet.
- No real STT/TTS call has ever been made.
- No provider-specific webhook signature verification exists — only VOYARA's own reference HMAC scheme.
- No spending-ceiling *persistence/summing* across calls exists yet (same gap already documented for LLM routing in the Phase 4C runbook — the check works per-call given a "spent so far" input, but nothing yet computes that input from real accumulated data).
- No estimated voice-provider cost is shown anywhere in the Founder Command Center — it is displayed as explicitly unavailable, not zero-by-omission or guessed, because no real cost model exists without a connected provider.

## 6. Activation sequence

1. Founder selects a managed voice platform (§1).
2. Obtain a test number; certify the real adapter against it (`npm run certify:voice` will need a real `SANDBOX` adapter implementation built first — see §5).
3. Complete legal review of consent/recording wording for every jurisdiction (§3) — do this in parallel with §2, not after.
4. Build the real provider-specific `VoiceAdapter` implementation (webhook signature scheme, speak/transfer/end call control) behind the existing interface.
5. Configure real duration/spending ceilings once real per-call cost data exists.
6. Configure escalation destinations and business-hours routing.
7. Only then consider enabling `SANDBOX` mode for voice in a shared environment.

**No step in this sequence has been started beyond the code written in this phase.**
