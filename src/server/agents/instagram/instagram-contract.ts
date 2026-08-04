/**
 * Phase 4H — Instagram Messaging API wire contract.
 *
 * HONESTY NOTE, same posture as whatsapp-contract.ts and
 * hotelbeds-contract.ts: no live Meta credentials exist anywhere in this
 * project and no network path to graph.facebook.com exists from this
 * environment. Instagram Messaging is the same Meta Graph API platform
 * WhatsApp Cloud API is built on — it shares the identical webhook
 * delivery envelope (`object` + `entry[].messaging[]`), the identical
 * X-Hub-Signature-256 HMAC scheme, and the identical challenge-response
 * webhook setup handshake. Those three mechanisms are implemented with
 * full confidence, unchanged for years and documented publicly. The exact
 * inbound/outbound JSON field names below are modeled on Meta's
 * long-standing public Instagram Messaging API documentation, but have NOT
 * been exercised against a live endpoint — field-level details should be
 * verified against the founder's actual Meta app once real credentials
 * exist for either brand, exactly as flagged for WhatsApp and Hotelbeds.
 */
import { z } from 'zod';

/** Meta's webhook envelope always names the product in `object` —
 *  'instagram' here, 'whatsapp_business_account' for WhatsApp. Any other
 *  value is rejected before any further parsing happens (requirement:
 *  "unsupported object types rejected"). */
export const instagramWebhookObjectSchema = z.literal('instagram');

export const instagramInboundMessageSchema = z.object({
  mid: z.string(), // Meta's message id
  text: z.string().optional()
}).strict();
export type InstagramInboundMessage = z.infer<typeof instagramInboundMessageSchema>;

/** One `messaging` entry: a single inbound DM event from one Instagram
 *  user (`sender.id`, Meta's opaque Instagram-scoped user id — NEVER a
 *  username, and never trusted as a verified real-world identity; see
 *  instagram-inbound.ts) to one connected Page/IG account (`recipient.id`). */
export const instagramMessagingEventSchema = z.object({
  sender: z.object({ id: z.string() }).strict(),
  recipient: z.object({ id: z.string() }).strict(),
  timestamp: z.number(),
  message: instagramInboundMessageSchema.optional()
}).strict();
export type InstagramMessagingEvent = z.infer<typeof instagramMessagingEventSchema>;

export const instagramWebhookEntrySchema = z.object({
  id: z.string(), // the Page/IG account id this entry is for
  time: z.number(),
  messaging: z.array(instagramMessagingEventSchema).default([])
}).strict();

export const instagramWebhookPayloadSchema = z.object({
  object: instagramWebhookObjectSchema,
  entry: z.array(instagramWebhookEntrySchema).default([])
}).strict();
export type InstagramWebhookPayload = z.infer<typeof instagramWebhookPayloadSchema>;

export const instagramOutboundTextSchema = z.object({
  recipient: z.object({ id: z.string() }).strict(),
  message: z.object({ text: z.string().max(1_000) }).strict() // Meta's documented IG DM text limit
}).strict();
export type InstagramOutboundText = z.infer<typeof instagramOutboundTextSchema>;

/** Meta's documented Instagram Messaging service window: outside 24h of
 *  the customer's last inbound message, standard messaging is no longer
 *  permitted (Instagram has no template-message exception the way
 *  WhatsApp does — outside the window, VOYARA simply cannot send). This
 *  constant is VOYARA's own conservative modeling of that rule, mirroring
 *  WHATSAPP_SERVICE_WINDOW_HOURS. */
export const INSTAGRAM_SERVICE_WINDOW_HOURS = 24;
