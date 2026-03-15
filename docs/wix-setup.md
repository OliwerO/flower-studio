# Wix Webhook Integration Setup

## 1. Webhook URL

Your backend exposes a webhook endpoint at:

```
https://<RAILWAY_BACKEND_URL>/api/webhook/wix
```

Production: `https://flower-studio-backend-production.up.railway.app/api/webhook/wix`

## 2. Configure Wix Events

In your Wix dashboard:

1. Go to **Settings > Webhooks** (or use Wix Velo / Wix Automations)
2. Create a new webhook subscription
3. Subscribe to these events:
   - `order.created` — triggers when a customer places an order
   - `order.paid` — triggers when payment is confirmed
4. Set the **Target URL** to the webhook URL above
5. Note the **Secret Key** that Wix generates — you'll need it for step 3

## 3. Environment Variables

Set this on your Railway backend:

| Variable | Description |
|----------|-------------|
| `WIX_WEBHOOK_SECRET` | The secret key from Wix webhook settings. Used to verify HMAC-SHA256 signatures on incoming requests. |

If `WIX_WEBHOOK_SECRET` is not set, signature verification is skipped (dev mode only — never do this in production).

## 4. How It Works

1. Wix sends a POST request with the order payload + `x-wix-signature` header
2. Backend verifies the HMAC-SHA256 signature against `WIX_WEBHOOK_SECRET`
3. Order is deduplicated by `Wix Order ID` (prevents double-processing)
4. A new App Order + Order Lines + Delivery record are created in Airtable
5. The webhook is logged to the Webhook Log table for auditing

## 5. Testing

1. **Without Wix:** Use curl or Postman to POST to the webhook URL:
   ```bash
   curl -X POST https://localhost:3001/api/webhook/wix \
     -H "Content-Type: application/json" \
     -d '{"orderId": "test-123", "lineItems": [...]}'
   ```
   (With no `WIX_WEBHOOK_SECRET` set, signature check is skipped in dev)

2. **With Wix:** Place a test order on your Wix store and check:
   - Backend logs for `[WEBHOOK]` entries
   - Airtable Webhook Log table for the raw payload
   - App Orders table for the newly created order

3. **Verify signature locally:** Set `WIX_WEBHOOK_SECRET` in your `.env.dev` and include the `x-wix-signature` header in your test request.

## Troubleshooting

- **401 "Missing webhook signature"** — Wix is not sending the `x-wix-signature` header. Check your Wix webhook configuration.
- **401 "Invalid webhook signature"** — `WIX_WEBHOOK_SECRET` does not match the secret configured in Wix.
- **Duplicate orders** — The system deduplicates by `Wix Order ID`. Check the Webhook Log for processing status.
