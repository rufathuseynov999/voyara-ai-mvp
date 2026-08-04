# VOYARA AI — Phase 4H Activation Runbook: Instagram Messaging (Dual-Brand)

No live Meta or Instagram credentials exist anywhere in this project. Everything below is a requirements list and procedure — **no real activation has occurred, no live message has ever been sent, and the controlled pilot has not started.**

---

## 1. Current status — what is and is not true today

- The Instagram adapter, webhook route, signature/challenge verification, dual-brand routing, and fixture-based certification are built and verified (see the Phase 4H Adapter Report).
- **A Meta Developer App for VOYARA/R-Travel still needs to be created.** None exists yet.
- **Meta Business verification is not complete.** This is a separate, document-based process from creating the Developer App, and typically takes longer — start it early.
- **Neither R-Travel's nor VOYARA's professional Instagram account has been linked to its Facebook Page yet.** Instagram Messaging via the Graph API requires each Instagram Business/Creator account to be connected to a Facebook Page before it can receive API-delivered messages at all.
- **No credentials of any kind have been supplied.** Every value in the environment contract below (Section 4) is currently unset.
- **The activation safety switch (`VOYARA_INSTAGRAM_ACTIVATION_ENABLED`) remains `false`.** Even once credentials exist, this project's own channel registry refuses to construct a working adapter until this flag is explicitly set to `true` — a second, independent gate beyond credentials being merely present.
- **R-Travel and VOYARA's account mappings are fully separate** in both the database (migration 27's `unique (brand)` / `unique (instagram_account_id)` / `unique (page_id)` constraints) and in application code (`readInstagramCredentials` takes `brand` as its own parameter and never accepts a caller-supplied override) — they must never share an account, a Page, or an access token, and the system actively rejects configuration that tries.

## 2. What Rufat / the provider must supply

All of the following require action from Rufat or VOYARA's Meta-facing provider — none of it can be generated or simulated:

1. **Meta Business verification** for the business entity behind R-Travel and/or VOYARA (may already be underway if Phase 4C's WhatsApp Business verification covered the same Meta Business account — confirm before starting a duplicate process).
2. **A Meta Developer App**, with the Instagram product added. Note the **App ID** and **App Secret**.
3. **Two professional Instagram accounts** — one for R-Travel, one for VOYARA — each already existing as an Instagram Business or Creator account.
4. **Two Facebook Pages**, each linked to its corresponding Instagram account (R-Travel's Page linked to R-Travel's Instagram account; VOYARA's Page linked to VOYARA's Instagram account). This linkage is done inside Meta's own tools (Business Suite / Page settings), not by this project.
5. **A long-lived access token per brand**, generated after the Page is linked and the app has the right permissions.
6. **App Review** — required before the app can message real, non-test Instagram users in production. Budget real time; Meta reviews actual use-case evidence, similar to WhatsApp's App Review in Phase 4C.
7. **A webhook verification token** — a random string Rufat/the provider chooses (not Meta-issued), entered into Meta's webhook configuration screen. Meta echoes it back during the one-time challenge handshake this project's `GET /api/v1/instagram/webhook` already implements.
8. **Required permissions**: `instagram_basic`, `instagram_manage_messages`, `pages_messaging` at minimum — confirm the exact current list in Meta's own documentation at setup time, since Meta's permission names and requirements can change.

## 3. Callback URL

`https://<your-deployed-domain>/api/v1/instagram/webhook` — must be HTTPS and publicly reachable once deployed. One callback URL and one webhook subscription serve both brands (the Meta App is shared; brand is resolved per-message by matching the Page id in the payload against each brand's own configured Page id).

## 4. Environment contract — what to fill in, and when

All variables are server-only. See `.env.example` for the authoritative list with inline documentation of required/optional status per variable.

| Variable | Supplied by | Needed for |
|---|---|---|
| `VOYARA_META_APP_ID` | Provider, from Meta Developer Console | Both brands (shared) |
| `VOYARA_META_APP_SECRET` | Provider, from Meta Developer Console | Both brands (shared) — signs/verifies every inbound webhook |
| `VOYARA_INSTAGRAM_WEBHOOK_VERIFY_TOKEN` | Chosen by Rufat/provider, entered into Meta's webhook config | Both brands (shared) |
| `VOYARA_INSTAGRAM_CALLBACK_URL` | The deployed app's own public URL | Both brands (shared) |
| `VOYARA_INSTAGRAM_GRAPH_API_VERSION` | Optional, defaults to `v21.0` | Both brands |
| `VOYARA_INSTAGRAM_RTRAVEL_ACCOUNT_ID` / `_PAGE_ID` / `_ACCESS_TOKEN` | Provider, once R-Travel's IG account is Page-linked | R-Travel only |
| `VOYARA_INSTAGRAM_VOYARA_ACCOUNT_ID` / `_PAGE_ID` / `_ACCESS_TOKEN` | Provider, once VOYARA's IG account is Page-linked | VOYARA only |
| `VOYARA_INSTAGRAM_ACTIVATION_ENABLED` | Founder decision — stays `false` until deliberately activated | Both brands (shared master switch) |

The app refuses to start a brand's adapter unless **both** the shared app-level variables and that brand's three account variables are present and non-placeholder — partial configuration is rejected, never silently treated as "not configured." R-Travel and VOYARA may be activated independently of each other; neither depends on the other being configured.

## 5. Verification before flipping the activation switch

Once credentials are entered (in a non-production environment first):

1. Run `npm run check:instagram` — confirms which of `BOTH_NOT_CONFIGURED` / `ONLY_RTRAVEL_CONFIGURED` / `ONLY_VOYARA_CONFIGURED` / `BOTH_CONFIGURED` applies, and exits non-zero on any malformed, partial, or duplicate configuration.
2. Run `npm run certify:instagram` — with real credentials present, this switches from fixture-only certification to a real (but read-only) `health()` probe per brand; it does not send any message.
3. Confirm the webhook subscription in Meta's dashboard shows a successful challenge response from the deployed callback URL.
4. Only after all of the above are green should `VOYARA_INSTAGRAM_ACTIVATION_ENABLED` be set to `true`, and only in the environment intended for that stage (never committed to source).

## 6. What still does not exist after activation

Flipping the activation switch makes the adapter *able* to send — it does not, by itself, start any outreach. Per the Human Approval Gate that governs every channel in this project, every outbound message still requires a human-approved reply from the staff inbox; nothing in Phase 4H adds automatic sending. The controlled pilot referenced in this runbook's title is a distinct, later decision — not covered by this document, and not started.
