// Pulls orders from Shopify and eBay, merges them into one data file,
// encrypts it with DASHBOARD_PASSWORD and writes it next to the dashboard page.
//
// Runs inside GitHub Actions (see .github/workflows/sync.yml). Logs only counts,
// never order details, so the run logs are safe to look at.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { encryptJson, decryptString } from './crypto.mjs';

const env = (name, fallback = '') => (process.env[name] ?? '').trim() || fallback;

const PASSWORD = env('DASHBOARD_PASSWORD');
const DAYS_BACK = Number(env('DAYS_BACK', '730')) || 730;
const OUT = env('OUT_FILE', 'site/data.enc.json');
const PLAIN_OUT = env('PLAIN_OUT_FILE'); // local testing only
const SINCE = new Date(Date.now() - DAYS_BACK * 86400000);

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const round2 = (n) => Math.round(n * 100) / 100;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchJson(url, options = {}, label = url) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, options);
    if (res.status === 429 || res.status >= 500) {
      if (attempt >= 5) throw new Error(`${label}: HTTP ${res.status} after ${attempt} attempts`);
      await sleep(1500 * attempt);
      continue;
    }
    const text = await res.text();
    if (!res.ok) throw new Error(`${label}: HTTP ${res.status} ${text.slice(0, 300)}`);
    return text ? JSON.parse(text) : {};
  }
}

// ---------------------------------------------------------------- Shopify

function shopDomain() {
  let s = env('SHOPIFY_STORE').replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (s && !s.includes('.')) s += '.myshopify.com';
  return s;
}

async function shopifyToken(domain) {
  const direct = env('SHOPIFY_ACCESS_TOKEN');
  if (direct) return direct;
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: env('SHOPIFY_CLIENT_ID'),
    client_secret: env('SHOPIFY_CLIENT_SECRET'),
  });
  const json = await fetchJson(`https://${domain}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body,
  }, 'Shopify login');
  if (!json.access_token) throw new Error('Shopify login: no access token returned. Check the Client ID and Client secret.');
  return json.access_token;
}

function shopifyClient(domain, token) {
  const version = env('SHOPIFY_API_VERSION', '2026-07');
  return async function gql(query, variables = {}) {
    for (let attempt = 1; ; attempt++) {
      const json = await fetchJson(`https://${domain}/admin/api/${version}/graphql.json`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
        body: JSON.stringify({ query, variables }),
      }, 'Shopify');
      const errors = json.errors || [];
      if (errors.some((e) => e.extensions?.code === 'THROTTLED') && attempt < 8) {
        await sleep(2000 * attempt);
        continue;
      }
      if (errors.length && !json.data) throw new Error('Shopify: ' + errors.map((e) => e.message).join('; '));
      // Partial data with access errors (e.g. no permission for addresses) is returned to the caller.
      return json;
    }
  };
}

const money = (set) => num(set?.shopMoney?.amount);

function orderQuery(withAddress) {
  return `query Orders($cursor: String, $q: String) {
    orders(first: 25, after: $cursor, query: $q, sortKey: CREATED_AT) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id name createdAt cancelledAt test sourceName
        displayFinancialStatus displayFulfillmentStatus
        totalPriceSet { shopMoney { amount currencyCode } }
        totalTaxSet { shopMoney { amount } }
        totalShippingPriceSet { shopMoney { amount } }
        totalDiscountsSet { shopMoney { amount } }
        totalRefundedSet { shopMoney { amount } }
        ${withAddress ? 'shippingAddress { countryCodeV2 }' : ''}
        lineItems(first: 30) {
          nodes { title sku quantity variant { id } discountedTotalSet { shopMoney { amount } } }
        }
      }
    }
  }`;
}

const PRODUCTS_QUERY = `query Products($cursor: String) {
  products(first: 25, after: $cursor, query: "status:active") {
    pageInfo { hasNextPage endCursor }
    nodes {
      title totalInventory tracksInventory
      variants(first: 20) {
        nodes { id sku title inventoryQuantity inventoryItem { unitCost { amount } } }
      }
    }
  }
}`;

function shopifyStatus(o) {
  if (o.cancelledAt) return 'cancelled';
  const f = o.displayFinancialStatus;
  if (f === 'REFUNDED') return 'refunded';
  if (f === 'PARTIALLY_REFUNDED') return 'part_refunded';
  if (f === 'PENDING' || f === 'AUTHORIZED') return 'pending';
  return 'paid';
}

function shopifyFulfillment(o) {
  const f = o.displayFulfillmentStatus;
  if (f === 'FULFILLED' || f === 'RESTOCKED') return 'fulfilled';
  if (f === 'PARTIALLY_FULFILLED' || f === 'IN_PROGRESS') return 'partial';
  if (f === 'UNFULFILLED' || f === 'ON_HOLD' || f === 'OPEN' || f === 'PENDING_FULFILLMENT' || f === 'SCHEDULED') return 'unfulfilled';
  return 'fulfilled';
}

async function syncShopify() {
  const domain = shopDomain();
  if (!domain) return { skipped: 'Shopify is not set up yet.' };
  const gql = shopifyClient(domain, await shopifyToken(domain));

  const shop = (await gql('{ shop { name currencyCode ianaTimezone } }')).data.shop;

  // Products first: gives cost-per-item (for profit) and stock levels.
  const costBySku = {};
  const costByVariant = {};
  const lowStock = [];
  let productCount = 0;
  let cursor = null;
  for (let page = 0; page < 80; page++) {
    const json = await gql(PRODUCTS_QUERY, { cursor });
    const conn = json.data?.products;
    if (!conn) break;
    for (const p of conn.nodes) {
      productCount++;
      for (const v of p.variants?.nodes || []) {
        const cost = v.inventoryItem?.unitCost?.amount;
        if (cost != null) {
          costByVariant[v.id] = num(cost);
          if (v.sku) costBySku[v.sku.trim().toLowerCase()] = num(cost);
        }
      }
      if (p.tracksInventory && p.totalInventory != null && p.totalInventory <= 5) {
        lowStock.push({ title: p.title, qty: p.totalInventory });
      }
    }
    if (!conn.pageInfo.hasNextPage) break;
    cursor = conn.pageInfo.endCursor;
  }

  // Orders. Addresses need extra Shopify permission; drop them if not granted.
  const q = `created_at:>=${SINCE.toISOString().slice(0, 10)}`;
  let withAddress = true;
  const orders = [];
  cursor = null;
  for (let page = 0; page < 2000; page++) {
    const json = await gql(orderQuery(withAddress), { cursor, q });
    if (withAddress && json.errors?.length) {
      withAddress = false;
      page--;
      continue;
    }
    const conn = json.data?.orders;
    if (!conn) throw new Error('Shopify: could not read orders. Make sure the app has the read_orders permission.');
    for (const o of conn.nodes) {
      if (o.test) continue;
      // Orders imported from eBay by a Shopify app would be counted twice.
      if (/ebay/i.test(o.sourceName || '')) continue;
      const tax = money(o.totalTaxSet);
      const items = (o.lineItems?.nodes || []).map((li) => {
        const unit = costByVariant[li.variant?.id] ?? (li.sku ? costBySku[li.sku.trim().toLowerCase()] : undefined);
        return {
          title: li.title,
          sku: li.sku || '',
          qty: li.quantity,
          amt: round2(money(li.discountedTotalSet)),
          cost: unit == null ? null : round2(unit * li.quantity),
        };
      });
      orders.push({
        ch: 's',
        id: o.name,
        t: o.createdAt,
        sales: round2(money(o.totalPriceSet) - tax),
        tax: round2(tax),
        ship: round2(money(o.totalShippingPriceSet)),
        disc: round2(money(o.totalDiscountsSet)),
        refund: round2(money(o.totalRefundedSet)),
        fee: 0,
        status: shopifyStatus(o),
        ful: shopifyFulfillment(o),
        country: o.shippingAddress?.countryCodeV2 || null,
        src: o.sourceName || 'web',
        items,
      });
    }
    if (!conn.pageInfo.hasNextPage) break;
    cursor = conn.pageInfo.endCursor;
  }

  lowStock.sort((a, b) => a.qty - b.qty);
  return {
    info: { name: shop.name, currency: shop.currencyCode, timezone: shop.ianaTimezone, products: productCount, addresses: withAddress },
    orders,
    lowStock: lowStock.slice(0, 25),
    costBySku,
  };
}

// ---------------------------------------------------------------- eBay

const EBAY_SCOPES = [
  'https://api.ebay.com/oauth/api_scope',
  'https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly',
  'https://api.ebay.com/oauth/api_scope/sell.finances',
  'https://api.ebay.com/oauth/api_scope/sell.inventory.readonly',
];

async function ebayToken() {
  const refresh = await decryptString(env('EBAY_REFRESH_TOKEN'), PASSWORD);
  const basic = Buffer.from(`${env('EBAY_CLIENT_ID')}:${env('EBAY_CLIENT_SECRET')}`).toString('base64');
  const json = await fetchJson('https://api.ebay.com/identity/v1/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${basic}` },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refresh, scope: EBAY_SCOPES.join(' ') }),
  }, 'eBay login');
  if (!json.access_token) throw new Error('eBay login failed. Run the "Connect eBay" step again.');
  return json.access_token;
}

function ebayStatus(o) {
  if (o.cancelStatus?.cancelState === 'CANCELED') return 'cancelled';
  const p = o.orderPaymentStatus;
  if (p === 'FULLY_REFUNDED') return 'refunded';
  if (p === 'PARTIALLY_REFUNDED') return 'part_refunded';
  if (p === 'PENDING' || p === 'FAILED') return 'pending';
  return 'paid';
}

function ebayFulfillment(o) {
  const f = o.orderFulfillmentStatus;
  if (f === 'NOT_STARTED') return 'unfulfilled';
  if (f === 'IN_PROGRESS') return 'partial';
  return 'fulfilled';
}

async function ebayOrders(token, since) {
  const out = [];
  const filter = `creationdate:[${since.toISOString()}..]`;
  for (let offset = 0; offset < 100000; offset += 200) {
    const url = `https://api.ebay.com/sell/fulfillment/v1/order?limit=200&offset=${offset}&filter=${encodeURIComponent(filter)}`;
    const json = await fetchJson(url, { headers: { Authorization: `Bearer ${token}` } }, 'eBay orders');
    out.push(...(json.orders || []));
    if (!json.next || !(json.orders || []).length) break;
  }
  return out;
}

async function ebaySellerFunds(token) {
  const json = await fetchJson('https://apiz.ebay.com/sell/finances/v1/seller_funds_summary', {
    headers: { Authorization: `Bearer ${token}` },
  }, 'eBay funds');
  const v = (k) => (json[k] ? num(json[k].value) : null);
  return { available: v('availableFunds'), processing: v('processingFunds'), onHold: v('fundsOnHold'), total: v('totalFunds') };
}

// Active listings come from eBay's older Trading API (XML).
async function ebayListings(token) {
  const tag = (xml, name) => (xml.match(new RegExp(`<${name}>([^<]*)</${name}>`)) || [])[1];
  const items = [];
  let total = 0;
  for (let page = 1; page <= 10; page++) {
    const body = `<?xml version="1.0" encoding="utf-8"?>
<GetMyeBaySellingRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <ActiveList><Include>true</Include><Pagination><EntriesPerPage>200</EntriesPerPage><PageNumber>${page}</PageNumber></Pagination></ActiveList>
  <DetailLevel>ReturnAll</DetailLevel>
</GetMyeBaySellingRequest>`;
    const res = await fetch('https://api.ebay.com/ws/api.dll', {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml',
        'X-EBAY-API-CALL-NAME': 'GetMyeBaySelling',
        'X-EBAY-API-SITEID': env('EBAY_SITE_ID', '0'),
        'X-EBAY-API-COMPATIBILITY-LEVEL': '1225',
        'X-EBAY-API-IAF-TOKEN': token,
      },
      body,
    });
    const xml = await res.text();
    if (!res.ok || /<Ack>Failure<\/Ack>/.test(xml)) throw new Error('eBay listings: ' + (tag(xml, 'ShortMessage') || `HTTP ${res.status}`));
    const active = (xml.match(/<ActiveList>([\s\S]*)<\/ActiveList>/) || [])[1] || '';
    total = num(tag(active.replace(/<ItemArray>[\s\S]*<\/ItemArray>/, ''), 'TotalNumberOfEntries')) || total;
    const blocks = active.match(/<Item>[\s\S]*?<\/Item>/g) || [];
    for (const b of blocks) {
      items.push({
        title: tag(b, 'Title') || '',
        watchers: num(tag(b, 'WatchCount')),
        qty: num(tag(b, 'QuantityAvailable') ?? tag(b, 'Quantity')),
        price: num(tag(b, 'CurrentPrice')),
      });
    }
    const pages = num(tag(active.replace(/<ItemArray>[\s\S]*<\/ItemArray>/, ''), 'TotalNumberOfPages')) || 1;
    if (page >= pages) break;
  }
  const decode = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
  items.forEach((i) => (i.title = decode(i.title)));
  return {
    active: total || items.length,
    mostWatched: [...items].sort((a, b) => b.watchers - a.watchers).filter((i) => i.watchers > 0).slice(0, 10),
    lowQty: items.filter((i) => i.qty <= 1).slice(0, 25),
  };
}

async function syncEbay(costBySku) {
  if (!env('EBAY_CLIENT_ID') || !env('EBAY_REFRESH_TOKEN')) return { skipped: 'eBay is not set up yet.' };
  const token = await ebayToken();

  let raw;
  try {
    raw = await ebayOrders(token, SINCE);
  } catch (e) {
    // eBay limits how far back orders can be read. Fall back to the last 90 days.
    console.log('eBay: full history not available, reading the last 90 days instead.');
    raw = await ebayOrders(token, new Date(Date.now() - 89 * 86400000));
  }

  let currency = null;
  const orders = raw.map((o) => {
    const ps = o.pricingSummary || {};
    currency ||= ps.total?.currency || null;
    const subtotal = num(ps.priceSubtotal?.value);
    const discount = Math.abs(num(ps.priceDiscount?.value));
    const delivery = num(ps.deliveryCost?.value) - Math.abs(num(ps.deliveryDiscount?.value));
    const lineItems = o.lineItems || [];
    const tax = lineItems.reduce((s, li) => s + (li.ebayCollectAndRemitTaxes || []).reduce((t, x) => t + num(x.amount?.value), 0), 0);
    const refund = (o.paymentSummary?.refunds || [])
      .filter((r) => r.refundStatus !== 'FAILED')
      .reduce((s, r) => s + num(r.amount?.value), 0);
    const items = lineItems.map((li) => {
      const unit = li.sku ? costBySku[li.sku.trim().toLowerCase()] : undefined;
      return {
        title: li.title,
        sku: li.sku || '',
        qty: li.quantity,
        amt: round2(num(li.lineItemCost?.value) - (li.appliedPromotions || []).reduce((s, p) => s + Math.abs(num(p.discountAmount?.value)), 0)),
        cost: unit == null ? null : round2(unit * li.quantity),
      };
    });
    return {
      ch: 'e',
      id: o.orderId,
      t: o.creationDate,
      sales: round2(subtotal - discount + delivery),
      tax: round2(tax),
      ship: round2(delivery),
      disc: round2(discount),
      refund: round2(refund),
      fee: round2(num(o.totalMarketplaceFee?.value)),
      status: ebayStatus(o),
      ful: ebayFulfillment(o),
      country: o.fulfillmentStartInstructions?.[0]?.shippingStep?.shipTo?.contactAddress?.countryCode || null,
      src: 'ebay',
      items,
    };
  });

  const extras = {};
  const notes = [];
  try {
    extras.funds = await ebaySellerFunds(token);
  } catch (e) {
    notes.push('Payout balance unavailable');
    console.log('eBay funds skipped:', e.message.slice(0, 200));
  }
  try {
    extras.listings = await ebayListings(token);
  } catch (e) {
    notes.push('Listings unavailable');
    console.log('eBay listings skipped:', e.message.slice(0, 200));
  }

  return { info: { currency, notes }, orders, ...extras };
}

// ---------------------------------------------------------------- main

async function main() {
  if (!PASSWORD) throw new Error('DASHBOARD_PASSWORD secret is missing. Add it in Settings > Secrets and variables > Actions.');

  const sources = {};
  let shopify = { orders: [], costBySku: {} };
  let ebay = { orders: [] };

  try {
    shopify = { ...shopify, ...(await syncShopify()) };
    sources.shopify = shopify.skipped ? { ok: false, message: shopify.skipped } : { ok: true, ...shopify.info, orders: shopify.orders.length };
  } catch (e) {
    sources.shopify = { ok: false, message: e.message.slice(0, 300) };
  }
  try {
    ebay = { ...ebay, ...(await syncEbay(shopify.costBySku || {})) };
    sources.ebay = ebay.skipped ? { ok: false, message: ebay.skipped } : { ok: true, ...ebay.info, orders: ebay.orders.length };
  } catch (e) {
    sources.ebay = { ok: false, message: e.message.slice(0, 300) };
  }

  for (const [name, s] of Object.entries(sources)) {
    console.log(`${name}: ${s.ok ? `${s.orders} orders` : s.message}`);
  }
  if (!sources.shopify.ok && !sources.ebay.ok && !shopify.skipped && !ebay.skipped) {
    throw new Error('Both stores failed to sync. See the messages above.');
  }

  const data = {
    generatedAt: new Date().toISOString(),
    since: SINCE.toISOString(),
    currency: sources.shopify.currency || sources.ebay.currency || 'USD',
    sources,
    orders: [...shopify.orders, ...ebay.orders].sort((a, b) => (a.t < b.t ? 1 : -1)),
    shopify: { lowStock: shopify.lowStock || [] },
    ebay: { funds: ebay.funds || null, listings: ebay.listings || null },
  };

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(await encryptJson(data, PASSWORD)));
  if (PLAIN_OUT) writeFileSync(PLAIN_OUT, JSON.stringify(data, null, 2));
  console.log(`Wrote ${data.orders.length} orders (encrypted) to ${OUT}`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
