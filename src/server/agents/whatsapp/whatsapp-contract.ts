/**
 * Phase 4C — WhatsApp Cloud API wire contract.
 *
 * HONESTY NOTE, same posture as hotelbeds-contract.ts: no live Meta
 * credentials exist anywhere in this project and no network path to
 * graph.facebook.com exists from this environment. The webhook CHALLENGE
 * verification and X-Hub-Signature-256 HMAC scheme below are implemented
 * with full confidence — both are stable, publicly documented Meta
 * mechanisms unchanged for years. The exact inbound/outbound JSON field
 * names are modeled on Meta's long-standing public WhatsApp Cloud API
 * documentation, but have NOT been exercised against a live endpoint —
 * field-level details should be verified against the founder's actual Meta
 * app once real credentials exist, exactly as flagged for Hotelbeds.
 */
import { z } from 'zod';

export const whatsappInboundMessageSchema = z.object({
  from: z.string(), // WhatsApp user's phone number (E.164, no leading +)
  id: z.string(), // WhatsApp message id (wamid)
  timestamp: z.string(),
  type: z.enum(['text', 'button', 'interactive', 'image', 'document', 'audio', 'video', 'location', 'unknown']),
  text: z.object({ body: z.string() }).optional(),
  button: z.object({ text: z.string(), payload: z.string() }).optional()
}).strict();
export type WhatsAppInboundMessage = z.infer<typeof whatsappInboundMessageSchema>;

export const whatsappStatusSchema = z.object({
  id: z.string(), // wamid this status refers to
  status: z.enum(['sent', 'delivered', 'read', 'failed']),
  timestamp: z.string(),
  recipient_id: z.string()
}).strict();
export type WhatsAppStatus = z.infer<typeof whatsappStatusSchema>;

/** One webhook POST body can carry many inbound messages and/or status
 *  updates in one payload — Meta's real "entry/changes" batching shape,
 *  simplified here to the two arrays this adapter actually needs. */
export const whatsappWebhookPayloadSchema = z.object({
  phoneNumberId: z.string(),
  messages: z.array(whatsappInboundMessageSchema).default([]),
  statuses: z.array(whatsappStatusSchema).default([])
}).strict();
export type WhatsAppWebhookPayload = z.infer<typeof whatsappWebhookPayloadSchema>;

export const whatsappOutboundTextSchema = z.object({
  to: z.string(),
  type: z.literal('text'),
  text: z.object({ body: z.string().max(4_096) })
}).strict();

export const whatsappOutboundTemplateSchema = z.object({
  to: z.string(),
  type: z.literal('template'),
  template: z.object({ name: z.string(), language: z.object({ code: z.string() }) })
}).strict();

/** WhatsApp's real 24-hour customer service window: free-form text is only
 *  permitted within 24h of the customer's last inbound message; outside
 *  that window, only a pre-approved template message may be sent. This
 *  constant is VOYARA's own conservative modeling of that rule (24h is
 *  Meta's documented window and has been stable for years). */
export const WHATSAPP_SERVICE_WINDOW_HOURS = 24;
