// Source officielle : API « AliExpress Affiliate » (programme AliExpress Portals, gratuit).
// Méthode aliexpress.affiliate.hotproduct.query = produits les plus vendus, filtrés par mot-clé / catégorie.
// Requête signée (HMAC-SHA256 avec la clé secrète de l'application). Aucune lecture de page web : uniquement l'API prévue pour ça.
const crypto = require('crypto');

const GATEWAY = process.env.ALIEXPRESS_GATEWAY || 'https://api-sg.aliexpress.com/sync'; // (adresse remplaçable pour les tests)

function sign(params, secret) {
  const base = Object.keys(params).sort().map((k) => k + params[k]).join('');
  return crypto.createHmac('sha256', secret).update(base, 'utf8').digest('hex').toUpperCase();
}

async function call(method, business, { appKey, appSecret }) {
  const params = { app_key: appKey, method, sign_method: 'sha256', timestamp: String(Date.now()), format: 'json', v: '2.0', ...business };
  for (const k of Object.keys(params)) if (params[k] === undefined || params[k] === '') delete params[k];
  params.sign = sign(params, appSecret);
  const res = await fetch(GATEWAY, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' }, body: new URLSearchParams(params), signal: AbortSignal.timeout(20000) });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data) throw new Error(`AliExpress a répondu ${res.status}`);
  if (data.error_response) throw new Error(`AliExpress : ${data.error_response.msg || data.error_response.code}`);
  return data;
}

const num = (v) => { const n = Number(String(v ?? '').replace(/[^0-9.]/g, '')); return Number.isFinite(n) ? n : null; };

/** Produits les plus vendus pour un mot-clé. Renvoie une liste normalisée. */
async function hotProducts(keyword, creds, { pageSize = 20, maxPriceEur } = {}) {
  const data = await call('aliexpress.affiliate.hotproduct.query', {
    keywords: keyword, page_no: '1', page_size: String(pageSize), sort: 'LAST_VOLUME_DESC',
    target_currency: 'EUR', target_language: 'FR', ship_to_country: creds.shipTo || 'FR', tracking_id: creds.trackingId || undefined,
    max_sale_price: maxPriceEur ? String(Math.round(maxPriceEur * 100)) : undefined,
  }, creds);
  const r = data.aliexpress_affiliate_hotproduct_query_response?.resp_result;
  if (r && r.resp_code && Number(r.resp_code) !== 200) throw new Error(`AliExpress : ${r.resp_msg || r.resp_code}`);
  const list = r?.result?.products?.product || [];
  return list.map((p) => ({
    source: 'aliexpress', sourceId: String(p.product_id), title: String(p.product_title || '').slice(0, 200),
    image: p.product_main_image_url || null, images: (p.product_small_image_urls?.string || []).slice(0, 5),
    url: p.promotion_link || p.product_detail_url || `https://www.aliexpress.com/item/${p.product_id}.html`,
    priceEur: num(p.target_sale_price), oldPriceEur: num(p.target_original_price), volume: num(p.lastest_volume) || 0,
    rating: num(p.evaluate_rate), category: p.second_level_category_name || p.first_level_category_name || '', keyword,
  }));
}

/** Vérifie les clés (petite requête). */
async function test(creds) {
  const list = await hotProducts('earphones', creds, { pageSize: 1 });
  return { ok: true, sample: list[0]?.title || null };
}

module.exports = { hotProducts, test, sign };
