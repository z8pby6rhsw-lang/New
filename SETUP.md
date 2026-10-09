# Setting up your sales dashboard

This guide connects the dashboard to your Shopify store and your eBay account. You don't need to write
any code. Everything happens by clicking around on GitHub, Shopify and eBay, and copying a few values
between them.

Set aside about **45 minutes**. You only do this once. After that the dashboard updates itself every hour.

> Screens on Shopify, eBay and GitHub change from time to time. If a button has a slightly different
> name from the one below, look for the closest match.

---

## How it works

```
Shopify ─┐
         ├─► GitHub fetches your sales every hour ─► locks them with your password ─► your dashboard page
eBay ────┘
```

- Your **API keys** (the passwords that let GitHub read your stores) are kept in GitHub's locked
  "Secrets" vault. Nobody can read them back out, including you.
- Your **sales data** is scrambled (encrypted) with a dashboard password that only you know. The page
  can be opened by anyone with the link, but without the password all they see is a lock screen.
- The dashboard only **reads** from your stores. It can't change orders, listings or prices.

---

## Step 0: Before you start

**GitHub plan.** Your repository is private. GitHub only hosts web pages from private repositories on a
paid plan, **GitHub Pro** (about $4/month: github.com → your profile picture → *Settings* → *Billing and
plans*). Pro also includes 3,000 minutes a month of the automatic runs; the hourly sync uses about
1,500.

If you'd rather not pay, the other choice is to make the repository public (*Settings* → *General* →
scroll to *Danger Zone* → *Change visibility*). Your keys stay in Secrets and your sales stay locked
with your password, so that's still safe. Anyone could read the dashboard's code, which is harmless.
The one catch: GitHub pauses hourly jobs in public repositories that see no changes for 60 days. It
emails you first, and one click turns it back on.

**How to add a "secret"** (you'll do this about 8 times):

1. Open your repository on github.com: **https://github.com/z8pby6rhsw-lang/New**
2. Click **Settings** (top row of tabs) → **Secrets and variables** (left side) → **Actions**.
3. Click **New repository secret**.
4. Type the **Name** exactly as shown in this guide (capitals and underscores matter), paste the
   **Secret**, and click **Add secret**.

---

## Step 1: Choose your dashboard password

Pick a strong password (a short sentence works well, e.g. `blue teapots sell on tuesdays`). This is
what you'll type to open the dashboard.

Add it as a secret:

| Name | Secret |
|---|---|
| `DASHBOARD_PASSWORD` | your chosen password |

Write it down somewhere safe too. GitHub won't show it to you again.

---

## Step 2: Turn on the web page

1. In your repository: **Settings** → **Pages** (left side).
2. Under **Build and deployment** → **Source**, choose **GitHub Actions**.

That's it. Your dashboard will live at **https://z8pby6rhsw-lang.github.io/New/**.

---

## Step 3: Connect Shopify

You'll create a small private "app" that only your store uses. It just gives GitHub permission to read
your orders.

1. In your Shopify admin go to **Settings** → **Apps** → **Develop apps**.
   Click **Build apps in Dev Dashboard**. (If Shopify asks you to allow custom app development, allow it.)
2. Click **Create app**, name it `Sales Dashboard`, and create it.
3. Open the app's **Versions** section, create a new version and under **Access scopes** tick:
   - `read_orders`
   - `read_all_orders`: lets the dashboard see more than the last 60 days (tick it if it's offered)
   - `read_products`
   - `read_inventory`: stock levels and item costs (used for profit)

   Click **Release**.
4. Go to the app's **Home** (or **Overview**) page and click **Install** to add it to your store.
5. Open the app's **Settings** page. Copy the **Client ID** and **Client secret**.

Add three secrets:

| Name | Secret |
|---|---|
| `SHOPIFY_STORE` | your store's Shopify address, e.g. `my-shop.myshopify.com` (find it in Shopify under *Settings* → *Domains*) |
| `SHOPIFY_CLIENT_ID` | the Client ID |
| `SHOPIFY_CLIENT_SECRET` | the Client secret |

> **Already have an old custom app** with an *Admin API access token* starting `shpat_`? You can skip
> the steps above and add that token as `SHOPIFY_ACCESS_TOKEN` instead (plus `SHOPIFY_STORE`).

**Optional, to see where buyers are:** the "Where buyers are" map needs shipping countries, which
Shopify treats as protected customer data. In the Dev Dashboard, open your app's
**API access** → **Protected customer data**, request access, and tick the **Address** field. Without
it everything else still works; that panel will show eBay buyers only.

---

## Step 4: Connect eBay

eBay takes a few more clicks. You'll make a free eBay developer account, then sign in once to
give permission.

### 4a. Get eBay developer keys

1. Go to **https://developer.ebay.com** and click **Register**. Use your normal details. eBay can
   take up to a business day to approve a new developer account.
2. Once you're in, go to **Your Account** (your name, top right) → **Application Keys**.
3. Give your app a name (e.g. `SalesDashboard`) and click **Create a keyset** in the **Production**
   column (not Sandbox).
4. eBay may ask about **marketplace account deletion notifications**. Choose the option to **apply for
   an exemption** and pick the reason that fits. This tool only reads your own seller account.
5. In the **Production** box, copy:
   - **App ID (Client ID)**
   - **Cert ID (Client Secret)**

Add two secrets:

| Name | Secret |
|---|---|
| `EBAY_CLIENT_ID` | the App ID (Client ID) |
| `EBAY_CLIENT_SECRET` | the Cert ID (Client Secret) |

### 4b. Set up the eBay sign-in

1. Still on **Application Keys**, click **User Tokens** next to your Production keyset.
2. Under **Get a Token from eBay via Your Application**, click **Add eBay Redirect URL**.
3. Fill in the form. For the **privacy policy URL** you can use your shop's privacy policy page. Leave
   the **accept** and **decline** URLs as eBay's defaults. Make sure **OAuth** is selected. Click
   **Save**.
4. eBay now shows a long name called the **RuName** (it looks like
   `Your_Name-YourApp-PRD-1a2b3c4d5-6e7f8a9b`). Copy it.

Add one secret:

| Name | Secret |
|---|---|
| `EBAY_RUNAME` | the RuName |

### 4c. Sign in to eBay (two quick runs)

1. In your repository, click the **Actions** tab. (If GitHub asks, click **I understand my workflows,
   go ahead and enable them**.)
2. On the left, click **Connect eBay** → **Run workflow** (right side) → leave the box **empty** →
   green **Run workflow** button.
3. After about 20 seconds a new run appears. Click it. The page shows **Step 1 of 2** with a link.
4. Open that link, sign in with your **eBay seller account**, and click **Agree**.
5. eBay shows a "you're signed in" page. **Copy the whole address** from your browser's address bar.
6. **Within 5 minutes:** back on GitHub, **Connect eBay** → **Run workflow** → paste the address into
   the box → **Run workflow**.
7. Open the new run. It shows **Step 2 of 2** with a long line starting `enc:`. Copy all of it.

Add one secret:

| Name | Secret |
|---|---|
| `EBAY_REFRESH_TOKEN` | the long `enc:...` line |

> eBay's permission lasts about 18 months. When it runs out the dashboard shows a red message, and you
> repeat **4c** (about 2 minutes).

---

## Step 5: First sync

1. **Actions** tab → **Sync sales** (left) → **Run workflow** → **Run workflow**.
2. Wait about 2 minutes for a green tick ✓.
3. Open **https://z8pby6rhsw-lang.github.io/New/**, type your dashboard password and click
   **Unlock dashboard**. Leave **Remember on this device** ticked so you don't have to type it again.

From now on it refreshes **every hour by itself**. An open dashboard picks up new data within about
10 minutes, with no reload needed. Bookmark it, or on your phone use *Add to Home Screen*.

---

## Getting the most out of it

- **Profit.** Add a **Cost per item** to your products in Shopify (open a product → *Pricing*). eBay
  sales are matched to Shopify products by **SKU**, so use the same SKUs on both to get eBay profit too.
- **More history.** The dashboard loads the last 2 years where the stores allow it. To change that, add
  a *variable* (not a secret) under **Settings** → **Secrets and variables** → **Actions** →
  **Variables** tab, named `DAYS_BACK`, e.g. `365`.
- **Already sync eBay orders into Shopify** with an app like Marketplace Connect? The dashboard skips
  Shopify orders that came from eBay so they aren't counted twice.

## What's on the screen

| Area | What it shows |
|---|---|
| Top row | Sales (with the Shopify/eBay split), orders, average order, items sold, estimated profit, eBay fees, refunds, shipping charged, orders waiting to ship. Each one compares against the previous period. |
| Sales over time | Daily (or weekly, for long periods) sales, stacked by store. Hover for the numbers; *Show as table* lists them. |
| Shopify vs eBay | Side-by-side comparison of every key number |
| Top products | Best sellers across both stores, with each store's share |
| Orders to ship | Unshipped orders, oldest first. Red means waiting more than 2 days. |
| Latest orders | The newest orders and their payment status |
| When orders come in | Busiest days and hours |
| Where buyers are | Sales by country |
| Stock & payouts | eBay money ready to pay out, live listings, most-watched items, Shopify low stock |

Use the buttons at the top to switch the period (today, 7 / 30 / 90 days, this month, this year,
12 months) and to show both stores or just one.

**What the numbers mean.** *Sales* is what customers paid including shipping, minus tax and refunds.
Cancelled orders aren't counted. *Profit (est.)* is sales minus eBay fees minus item costs. Shopify
payment-processing fees aren't included because Shopify doesn't share them.

## If something goes wrong

| What you see | What to do |
|---|---|
| A yellow **Sample data** banner | The dashboard hasn't synced real data yet. Run **Sync sales** (Step 5) and check it got a green tick. |
| A red ✗ on a **Sync sales** run | Click the run, then the **sync** box. The message says which store failed and why. Usually a secret is missing or mistyped. Fix it (secrets can be replaced, but not viewed) and run again. |
| "Shopify didn't sync" | Check `SHOPIFY_STORE` ends in `.myshopify.com`, the app is **installed** on the store, and the Client ID and secret are right. |
| "eBay didn't sync" | Redo **4c** to make a fresh `EBAY_REFRESH_TOKEN`. |
| "That password didn't work" | Use exactly the `DASHBOARD_PASSWORD` secret. If you changed it, the next hourly sync re-locks the data with the new one. |
| Shopify only shows 60 days | Add the `read_all_orders` permission to your Shopify app (Step 3) and release a new version. |
| The page shows a 404 | Check Step 2 (Pages source = GitHub Actions) and that **Sync sales** has run successfully at least once. |
