# Deployment Checklist

Use this before deploying to Vercel.

## Function Count

Vercel Hobby allows at most 12 Serverless Functions per deployment.

Run this locally:

```powershell
Get-ChildItem api -Recurse -File -Filter *.js | Measure-Object
```

The count must stay at `12` or lower. Current target: `11`.

Do not place shared helpers in `api/`. Vercel counts every `.js` file under `api/` as a function.

## Required Checks

```powershell
node --check server.js
node --check event-store.js
node --check event-normalizer.js
node --check location-resolver.js
node --check api\events.js
node --check api\cron.js
node --check api\admin-events.js
node --check api\health.js
npm run test:location
npm run test:admin
```

## Required Environment Variables

Minimum useful deployment:

- `KV_REST_API_URL`
- `KV_REST_API_TOKEN`
- `REPORT_ADMIN_TOKEN`
- `MAPBOX_PUBLIC_TOKEN`

For scheduled/admin operations:

- `CRON_SECRET`
- `TDX_CLIENT_ID`
- `TDX_CLIENT_SECRET`
- `OPENAI_API_KEY` or Azure OpenAI variables

For notifications and support:

- `DISCORD_WEBHOOK_URL`
- `ECPAY_MERCHANT_ID`
- `ECPAY_HASH_KEY`
- `ECPAY_HASH_IV`

## Post Deploy Smoke Test

- `/` loads and still shows beta wording.
- `/api/events` returns `200`.
- `/api/health` without token returns `401`.
- `/api/health?token=...` returns `200` and does not expose secret values.
- `/admin-events.html`, `/admin-reports.html`, `/admin-health.html` load.
