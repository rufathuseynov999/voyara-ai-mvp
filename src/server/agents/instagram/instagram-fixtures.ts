import type { InstagramWebhookPayload } from './instagram-contract';

/** Phase 4H — documented Instagram fixtures, modeled on public API docs,
 *  not captured live (see instagram-contract.ts's header for the honesty
 *  note). `test-ig-account-000001` / `test-page-000001` are used
 *  consistently across all three fixtures below to model one connected
 *  test account receiving a DM, then a second DM in a new thread. */

export const INSTAGRAM_FIXTURE_INBOUND_TEXT: InstagramWebhookPayload = {
  object: 'instagram',
  entry: [
    {
      id: 'test-page-000001',
      time: 1735689600,
      messaging: [
        {
          sender: { id: 'test-igsid-000001' },
          recipient: { id: 'test-page-000001' },
          timestamp: 1735689600,
          message: { mid: 'ig-mid-TEST0001', text: 'Salam, Dubay ucun teklif almaq isteyirem' }
        }
      ]
    }
  ]
};

export const INSTAGRAM_FIXTURE_INBOUND_SECOND_SENDER: InstagramWebhookPayload = {
  object: 'instagram',
  entry: [
    {
      id: 'test-page-000001',
      time: 1735689660,
      messaging: [
        {
          sender: { id: 'test-igsid-000002' },
          recipient: { id: 'test-page-000001' },
          timestamp: 1735689660,
          message: { mid: 'ig-mid-TEST0002', text: 'Do you have Maldives packages?' }
        }
      ]
    }
  ]
};

/** Delivery receipt with no `message` field — must be recognized and
 *  skipped by inbound processing, not treated as an empty DM. */
export const INSTAGRAM_FIXTURE_DELIVERY_RECEIPT: InstagramWebhookPayload = {
  object: 'instagram',
  entry: [
    {
      id: 'test-page-000001',
      time: 1735689700,
      messaging: [
        { sender: { id: 'test-page-000001' }, recipient: { id: 'test-igsid-000001' }, timestamp: 1735689700 }
      ]
    }
  ]
};

/** Same sender id as INSTAGRAM_FIXTURE_INBOUND_TEXT, a second message —
 *  used to prove a returning sender is recognized via lookup, not
 *  re-created as a new contact. */
export const INSTAGRAM_FIXTURE_INBOUND_RETURNING_SENDER: InstagramWebhookPayload = {
  object: 'instagram',
  entry: [
    {
      id: 'test-page-000001',
      time: 1735689800,
      messaging: [
        {
          sender: { id: 'test-igsid-000001' },
          recipient: { id: 'test-page-000001' },
          timestamp: 1735689800,
          message: { mid: 'ig-mid-TEST0003', text: 'Are there any updates?' }
        }
      ]
    }
  ]
};

/** An entry addressed to a Page id this fixture set does not own — used to
 *  prove unknown account/page ids are rejected/filtered by the adapter. */
export const INSTAGRAM_FIXTURE_UNKNOWN_PAGE: InstagramWebhookPayload = {
  object: 'instagram',
  entry: [
    {
      id: 'unowned-page-999999',
      time: 1735689900,
      messaging: [
        { sender: { id: 'test-igsid-000003' }, recipient: { id: 'unowned-page-999999' }, timestamp: 1735689900, message: { mid: 'ig-mid-TEST0004', text: 'hello' } }
      ]
    }
  ]
};
