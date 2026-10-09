# Shopify & eBay Sales Dashboard

One screen that combines sales from your Shopify store and your eBay account, refreshed automatically
every hour.

**👉 To get it running, follow [SETUP.md](SETUP.md).** No coding needed.

Once it's set up, the dashboard is at **https://z8pby6rhsw-lang.github.io/New/** and is locked with your
own password.

## What's in this folder

| File | What it does |
|---|---|
| `dashboard/index.html` | The dashboard page |
| `scripts/sync.mjs` | Fetches orders from Shopify and eBay, then locks (encrypts) them with your password |
| `scripts/connect-ebay.mjs` | One-time helper that links your eBay account |
| `scripts/crypto.mjs` | The locking and unlocking code |
| `.github/workflows/sync.yml` | Runs the sync every hour and publishes the page |
| `.github/workflows/connect-ebay.yml` | The "Connect eBay" button in the Actions tab |

If you open `dashboard/index.html` before any data has synced, it shows made-up sample data so you can
see the layout.
