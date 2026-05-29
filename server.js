// SellerPilot AI backend-proxy for real Ozon + Wildberries Seller API calls.
// Run: node server.js  (Node.js 18+)
// Open: http://localhost:8787

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 8787);
const ROOT = __dirname;
// On serverless (Vercel) the project filesystem is read-only; only /tmp is writable.
// /tmp is ephemeral (reset on cold start) which is acceptable for the demo.
const IS_SERVERLESS = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
const DATA_DIR = IS_SERVERLESS ? path.join('/tmp', 'sellerpilot-data') : path.join(ROOT, 'data');
const SHOPS_FILE = path.join(DATA_DIR, 'shops.json');
const PRODUCTS_FILE = path.join(DATA_DIR, 'products.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');
const RECOVERY_FILE = path.join(DATA_DIR, 'recovery_requests.json');
const ORDERS_FILE = path.join(DATA_DIR, 'orders.json');
const COSTS_FILE = path.join(DATA_DIR, 'costs.json');
const TELEGRAM_FILE = path.join(DATA_DIR, 'telegram_settings.json');
const AI_USAGE_FILE = path.join(DATA_DIR, 'ai_usage.json');
const BILLING_FILE = path.join(DATA_DIR, 'billing.json');
const AI_PROVIDER = (process.env.AI_PROVIDER || (process.env.GEMINI_API_KEY ? 'gemini' : 'rules')).toLowerCase();
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const AI_MAX_CALLS_PER_DAY = Number(process.env.AI_MAX_CALLS_PER_DAY || 30);
const ADMIN_PHONE = process.env.ADMIN_PHONE || '89382222453';
const ADMIN_WHATSAPP = process.env.ADMIN_WHATSAPP || ADMIN_PHONE.replace(/^8/, '7').replace(/\D/g, '');
const ADMIN_PANEL_PASSWORD = process.env.ADMIN_PANEL_PASSWORD || 'admin123';
const adminSessions = new Set();
const START_PLAN_PRICE_RUB = Number(process.env.START_PLAN_PRICE_RUB || 1000);
const TRIAL_DAYS = Number(process.env.TRIAL_DAYS || 7);
const YOOKASSA_SHOP_ID = process.env.YOOKASSA_SHOP_ID || '';
const YOOKASSA_SECRET_KEY = process.env.YOOKASSA_SECRET_KEY || '';
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`;

const WB = {
  contentCards: 'https://content-api.wildberries.ru/content/v2/get/cards/list',
  stocks: 'https://statistics-api.wildberries.ru/api/v1/supplier/stocks',
  prices: 'https://discounts-prices-api.wildberries.ru/api/v2/list/goods/filter',
  stockUpdate: (warehouseId) => `https://marketplace-api.wildberries.ru/api/v3/stocks/${encodeURIComponent(warehouseId)}`,
  orders: 'https://statistics-api.wildberries.ru/api/v1/supplier/orders',
  sales: 'https://statistics-api.wildberries.ru/api/v1/supplier/sales',
};
const OZON = {
  productList: 'https://api-seller.ozon.ru/v3/product/list',
  productInfoList: 'https://api-seller.ozon.ru/v3/product/info/list',
  stocks: 'https://api-seller.ozon.ru/v4/product/info/stocks',
  stockUpdate: 'https://api-seller.ozon.ru/v1/product/import/stocks',
  fbsPostings: 'https://api-seller.ozon.ru/v3/posting/fbs/list',
  fboPostings: 'https://api-seller.ozon.ru/v2/posting/fbo/list',
};

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(SHOPS_FILE)) fs.writeFileSync(SHOPS_FILE, '[]');
  if (!fs.existsSync(PRODUCTS_FILE)) fs.writeFileSync(PRODUCTS_FILE, '[]');
  if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, '[]');
  if (!fs.existsSync(SESSIONS_FILE)) fs.writeFileSync(SESSIONS_FILE, '{}');
  if (!fs.existsSync(RECOVERY_FILE)) fs.writeFileSync(RECOVERY_FILE, '[]');
  if (!fs.existsSync(ORDERS_FILE)) fs.writeFileSync(ORDERS_FILE, '[]');
  if (!fs.existsSync(COSTS_FILE)) fs.writeFileSync(COSTS_FILE, '[]');
  if (!fs.existsSync(TELEGRAM_FILE)) fs.writeFileSync(TELEGRAM_FILE, '[]');
  if (!fs.existsSync(AI_USAGE_FILE)) fs.writeFileSync(AI_USAGE_FILE, '{}');
  if (!fs.existsSync(BILLING_FILE)) fs.writeFileSync(BILLING_FILE, '[]');
}
function readJson(file, fallback) {
  ensureDataDir();
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJson(file, data) {
  ensureDataDir();
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}
function loadShops() { return readJson(SHOPS_FILE, []); }
function saveShops(shops) { writeJson(SHOPS_FILE, shops); }
function loadProducts() { return readJson(PRODUCTS_FILE, []); }
function saveProducts(products) { writeJson(PRODUCTS_FILE, products); }
function loadUsers() { return readJson(USERS_FILE, []); }
function saveUsers(users) { writeJson(USERS_FILE, users); }
function loadSessions() { return readJson(SESSIONS_FILE, {}); }
function saveSessions(sessions) { writeJson(SESSIONS_FILE, sessions); }
function loadRecoveryRequests() { return readJson(RECOVERY_FILE, []); }
function saveRecoveryRequests(items) { writeJson(RECOVERY_FILE, items); }
function loadOrders() { return readJson(ORDERS_FILE, []); }
function saveOrders(items) { writeJson(ORDERS_FILE, items); }
function loadCosts() { return readJson(COSTS_FILE, []); }
function saveCosts(items) { writeJson(COSTS_FILE, items); }
function loadTelegramSettings() { return readJson(TELEGRAM_FILE, []); }
function saveTelegramSettings(items) { writeJson(TELEGRAM_FILE, items); }
function loadAiUsage() { return readJson(AI_USAGE_FILE, {}); }
function saveAiUsage(items) { writeJson(AI_USAGE_FILE, items); }
function loadBilling() { return readJson(BILLING_FILE, []); }
function saveBilling(items) { writeJson(BILLING_FILE, items); }
function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.pbkdf2Sync(String(password), salt, 120000, 32, 'sha256').toString('hex');
  return `${salt}:${hash}`;
}
function verifyPassword(password, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  const test = crypto.pbkdf2Sync(String(password), salt, 120000, 32, 'sha256').toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(test, 'hex'));
}
function publicUser(u) { return u ? { id: u.id, name: u.name || '', email: u.email, createdAt: u.createdAt } : null; }
function getBearerToken(req) {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7) : '';
}
function getUserByRequest(req) {
  const token = getBearerToken(req);
  if (!token) return null;
  const sessions = loadSessions();
  const session = sessions[token];
  if (!session || (session.expiresAt && Date.parse(session.expiresAt) < Date.now())) return null;
  return loadUsers().find(u => u.id === session.userId) || null;
}
function requireUser(req) {
  const user = getUserByRequest(req);
  if (!user) { const e = new Error('Требуется вход в аккаунт'); e.status = 401; throw e; }
  return user;
}
function createSession(user) {
  const token = crypto.randomBytes(32).toString('hex');
  const sessions = loadSessions();
  sessions[token] = { userId: user.id, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 1000*60*60*24*30).toISOString() };
  saveSessions(sessions);
  return token;
}
function mask(str) {
  if (!str) return '';
  const s = String(str);
  return s.length <= 10 ? '***' : `${s.slice(0, 4)}…${s.slice(-4)}`;
}
function publicShop(shop, products) {
  const p = products.filter(x => x.shopId === shop.id);
  const stock = p.reduce((sum, x) => sum + Number(x.stock || 0), 0);
  return {
    id: shop.id,
    marketplace: shop.marketplace,
    name: shop.name,
    legal: shop.legal || '—',
    status: shop.status || 'warn',
    products: p.length,
    active: p.filter(x => x.status === 'active').length,
    stock,
    revenue: shop.revenue || 0,
    lastSync: shop.lastSync || null,
    lastError: shop.lastError || null,
    credentialsMasked: shop.marketplace === 'wb'
      ? { wbToken: mask(shop.credentials?.wbToken), wbWarehouseId: shop.credentials?.wbWarehouseId || '' }
      : { ozonClientId: shop.credentials?.ozonClientId || '', ozonApiKey: mask(shop.credentials?.ozonApiKey) }
  };
}
function publicState(userId = null) {
  const allShops = loadShops();
  const userShops = userId ? allShops.filter(s => s.userId === userId) : allShops;
  const shopIds = new Set(userShops.map(s => s.id));
  const products = loadProducts().filter(p => !userId || shopIds.has(p.shopId));
  const shops = userShops.map(s => publicShop(s, products));
  return { shops, products };
}
function json(res, status, data) {
  const body = JSON.stringify(data, null, 2);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  });
  res.end(body);
}
function text(res, status, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Access-Control-Allow-Origin': '*' });
  res.end(body);
}
async function parseBody(req) {
  // On Vercel the body may already be parsed/consumed into req.body.
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === 'object') return req.body;
    if (typeof req.body === 'string') {
      if (!req.body) return {};
      try { return JSON.parse(req.body); } catch { throw new Error('Некорректный JSON в теле запроса'); }
    }
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { throw new Error('Некорректный JSON в теле запроса'); }
}
async function fetchJson(url, options = {}, label = 'API') {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(process.env.API_TIMEOUT_MS || 30000));
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    const raw = await res.text();
    let data = null;
    try { data = raw ? JSON.parse(raw) : {}; } catch { data = { raw }; }
    if (!res.ok) {
      const details = data?.message || data?.error || data?.errors?.[0]?.message || raw.slice(0, 300);
      throw new Error(`${label}: HTTP ${res.status} ${details || ''}`.trim());
    }
    return data;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error(`${label}: timeout`);
    throw e;
  } finally {
    clearTimeout(timeout);
  }
}
function wbHeaders(token) {
  return { 'Authorization': token, 'Content-Type': 'application/json' };
}
function ozonHeaders(credentials) {
  return {
    'Client-Id': String(credentials.ozonClientId || ''),
    'Api-Key': String(credentials.ozonApiKey || ''),
    'Content-Type': 'application/json',
  };
}
function numberFromAny(v) {
  if (v === null || v === undefined || v === '') return 0;
  return Number(String(v).replace(',', '.')) || 0;
}

async function syncWB(shop) {
  const token = shop.credentials?.wbToken;
  if (!token) throw new Error('WB token не задан');
  const now = new Date().toISOString();
  const warnings = [];

  const cardsBody = {
    settings: {
      sort: { ascending: false },
      cursor: { limit: Number(process.env.WB_LIMIT || 100) },
      filter: { withPhoto: -1 }
    }
  };
  const cardsResp = await fetchJson(WB.contentCards, {
    method: 'POST',
    headers: wbHeaders(token),
    body: JSON.stringify(cardsBody),
  }, 'WB content/v2/get/cards/list');
  const cards = cardsResp.cards || cardsResp.data?.cards || [];

  const stockByNm = new Map();
  const stockByArticle = new Map();
  try {
    const stockResp = await fetchJson(`${WB.stocks}?dateFrom=2019-01-01`, {
      method: 'GET',
      headers: wbHeaders(token),
    }, 'WB statistics stocks');
    const rows = Array.isArray(stockResp) ? stockResp : (stockResp.data || []);
    for (const r of rows) {
      const qty = Number(r.quantity ?? r.quantityFull ?? r.stock ?? 0) || 0;
      if (r.nmId || r.nmID) stockByNm.set(Number(r.nmId || r.nmID), (stockByNm.get(Number(r.nmId || r.nmID)) || 0) + qty);
      if (r.supplierArticle) stockByArticle.set(String(r.supplierArticle), (stockByArticle.get(String(r.supplierArticle)) || 0) + qty);
    }
  } catch (e) {
    warnings.push('Остатки WB не получены: ' + e.message);
  }

  const priceByNm = new Map();
  try {
    const priceResp = await fetchJson(`${WB.prices}?limit=${encodeURIComponent(process.env.WB_LIMIT || 100)}`, {
      method: 'GET',
      headers: wbHeaders(token),
    }, 'WB prices');
    const rows = priceResp.data?.listGoods || priceResp.listGoods || priceResp.data || [];
    for (const r of rows) {
      const nm = Number(r.nmID || r.nmId);
      const size = Array.isArray(r.sizes) ? r.sizes[0] : null;
      const price = numberFromAny(size?.discountedPrice || size?.price || r.discountedPrice || r.price);
      if (nm && price) priceByNm.set(nm, price);
    }
  } catch (e) {
    warnings.push('Цены WB не получены: ' + e.message);
  }

  const products = cards.map((c, i) => {
    const nm = Number(c.nmID || c.nmId || c.id || 0);
    const article = String(c.vendorCode || c.supplierArticle || nm || `WB-${i + 1}`);
    const firstSize = Array.isArray(c.sizes) ? c.sizes[0] : null;
    const sku = firstSize?.skus?.[0] || firstSize?.sku || '';
    const stock = stockByNm.get(nm) ?? stockByArticle.get(article) ?? 0;
    const price = priceByNm.get(nm) || 0;
    const name = c.title || c.name || c.subjectName || article;
    const inactive = c.isProhibited || c.isDeleted || c.imtID === 0 || !name;
    return {
      id: `wb:${shop.id}:${nm || article}`,
      shopId: shop.id,
      shopName: shop.name,
      marketplace: 'wb',
      externalId: nm || article,
      nmID: nm || null,
      chrtID: firstSize?.chrtID || null,
      sku,
      article,
      name,
      brand: c.brand || '',
      price,
      stock,
      status: inactive ? 'inactive' : (stock > 0 ? 'active' : 'no-stock'),
      updated: now.slice(0, 10),
      emoji: '📦',
      rawMinimal: { subjectName: c.subjectName, imtID: c.imtID }
    };
  });
  return { products, warnings };
}

async function syncOzon(shop) {
  const credentials = shop.credentials || {};
  if (!credentials.ozonClientId || !credentials.ozonApiKey) throw new Error('Ozon Client-Id или Api-Key не заданы');
  const now = new Date().toISOString();
  const headers = ozonHeaders(credentials);
  const warnings = [];

  const listResp = await fetchJson(OZON.productList, {
    method: 'POST',
    headers,
    body: JSON.stringify({ filter: { visibility: 'ALL' }, limit: Number(process.env.OZON_LIMIT || 100), last_id: '' }),
  }, 'Ozon /v3/product/list');
  const items = listResp.result?.items || [];
  const ids = items.map(x => Number(x.product_id)).filter(Boolean);

  const infoById = new Map();
  if (ids.length) {
    try {
      const infoResp = await fetchJson(OZON.productInfoList, {
        method: 'POST',
        headers,
        body: JSON.stringify({ product_id: ids }),
      }, 'Ozon /v3/product/info/list');
      const infoItems = infoResp.result?.items || infoResp.items || [];
      for (const item of infoItems) infoById.set(Number(item.id || item.product_id), item);
    } catch (e) {
      warnings.push('Детали товаров Ozon не получены: ' + e.message);
    }
  }

  const stockById = new Map();
  const stockByOffer = new Map();
  try {
    const stockResp = await fetchJson(OZON.stocks, {
      method: 'POST',
      headers,
      body: JSON.stringify({ filter: { visibility: 'ALL' }, limit: Number(process.env.OZON_LIMIT || 100) }),
    }, 'Ozon /v4/product/info/stocks');
    const rows = stockResp.result?.items || stockResp.items || [];
    for (const r of rows) {
      const productId = Number(r.product_id);
      const offerId = String(r.offer_id || '');
      let qty = 0;
      if (Array.isArray(r.stocks)) {
        qty = r.stocks.reduce((sum, st) => sum + Math.max(0, Number(st.present ?? st.stock ?? 0) - Number(st.reserved ?? 0)), 0);
      } else {
        qty = Number(r.stock || r.present || 0) || 0;
      }
      if (productId) stockById.set(productId, qty);
      if (offerId) stockByOffer.set(offerId, qty);
    }
  } catch (e) {
    warnings.push('Остатки Ozon не получены: ' + e.message);
  }

  const products = items.map((item, i) => {
    const productId = Number(item.product_id);
    const offerId = String(item.offer_id || `OZON-${i + 1}`);
    const info = infoById.get(productId) || {};
    const price = numberFromAny(info.price || info.marketing_price || info.old_price || info.sources?.[0]?.price);
    const stock = stockById.get(productId) ?? stockByOffer.get(offerId) ?? 0;
    const name = info.name || item.name || offerId;
    return {
      id: `ozon:${shop.id}:${productId || offerId}`,
      shopId: shop.id,
      shopName: shop.name,
      marketplace: 'ozon',
      externalId: productId || offerId,
      product_id: productId || null,
      offer_id: offerId,
      article: offerId,
      name,
      brand: info.brand || '',
      price,
      stock,
      status: item.archived ? 'inactive' : (stock > 0 ? 'active' : 'no-stock'),
      updated: now.slice(0, 10),
      emoji: '📦',
      rawMinimal: { has_fbo_stocks: item.has_fbo_stocks, has_fbs_stocks: item.has_fbs_stocks, archived: item.archived }
    };
  });
  return { products, warnings };
}
async function syncMarketplaceShop(shop) {
  if (shop.marketplace === 'wb') return syncWB(shop);
  if (shop.marketplace === 'ozon') return syncOzon(shop);
  throw new Error('Неизвестный marketplace: ' + shop.marketplace);
}

async function updateStocks(shop, items) {
  if (!Array.isArray(items) || !items.length) throw new Error('Нет товаров для обновления остатков');
  if (shop.marketplace === 'ozon') {
    const headers = ozonHeaders(shop.credentials || {});
    const stocks = items.map(x => ({
      product_id: Number(x.product_id || x.externalId || 0) || undefined,
      offer_id: String(x.offer_id || x.article || ''),
      stock: Number(x.stock || 0),
    })).filter(x => x.product_id || x.offer_id);
    if (!stocks.length) throw new Error('Для Ozon нужен product_id или offer_id');
    return fetchJson(OZON.stockUpdate, { method: 'POST', headers, body: JSON.stringify({ stocks }) }, 'Ozon /v1/product/import/stocks');
  }
  if (shop.marketplace === 'wb') {
    const token = shop.credentials?.wbToken;
    const warehouseId = shop.credentials?.wbWarehouseId;
    if (!warehouseId) throw new Error('Для WB обновления остатков укажите wbWarehouseId при подключении магазина');
    const stocks = items.map(x => ({ sku: String(x.sku || x.barcode || x.article || ''), amount: Number(x.stock || 0) })).filter(x => x.sku);
    if (!stocks.length) throw new Error('Для WB нужен sku/barcode товара');
    return fetchJson(WB.stockUpdate(warehouseId), { method: 'PUT', headers: wbHeaders(token), body: JSON.stringify({ stocks }) }, 'WB /api/v3/stocks/{warehouseId}');
  }
  throw new Error('Неизвестный marketplace');
}

function ruleBasedRecommendations(shopId = 'all', userId = null) {
  let shops = loadShops();
  if (userId) shops = shops.filter(s => s.userId === userId);
  const shopIds = new Set(shops.map(s => s.id));
  let products = loadProducts().filter(p => !userId || shopIds.has(p.shopId));
  if (shopId && shopId !== 'all') products = products.filter(p => p.shopId === shopId);
  const rec = [];
  const noStock = products.filter(p => Number(p.stock || 0) === 0 && p.status !== 'inactive');
  const lowStock = products.filter(p => Number(p.stock || 0) > 0 && Number(p.stock || 0) <= 5);
  const inactive = products.filter(p => p.status === 'inactive');
  if (noStock.length) {
    rec.push({
      priority: 'high',
      title: 'Срочно пополнить товары без остатка',
      text: `${noStock.length} товаров сейчас не продаются из-за нулевого остатка. Начните с: ${noStock.slice(0, 5).map(p => p.article).join(', ')}.`,
      action: 'Обновить остатки / создать поставку',
      impact: 'возврат продаж',
    });
  }
  if (lowStock.length) {
    rec.push({
      priority: 'medium',
      title: 'Защитный запас для товаров с малым остатком',
      text: `${lowStock.length} товаров имеют остаток от 1 до 5. Рекомендуемый минимум: 14–21 день продаж или не меньше 20 шт.`,
      action: 'Пополнить склад',
      impact: 'меньше out-of-stock',
    });
  }
  if (inactive.length) {
    rec.push({
      priority: 'high',
      title: 'Вернуть неактивные карточки в продажу',
      text: `${inactive.length} карточек неактивны. Проверьте модерацию, фото, обязательные характеристики, цену и наличие.`,
      action: 'Исправить карточки',
      impact: 'рост ассортимента',
    });
  }
  const byName = new Map();
  for (const p of products) {
    const key = String(p.name || '').toLowerCase().replace(/\d+/g, '').trim();
    if (!key) continue;
    if (!byName.has(key)) byName.set(key, new Set());
    byName.get(key).add(p.marketplace);
  }
  const cross = [...byName.values()].filter(set => set.size === 1).length;
  if (cross) {
    rec.push({
      priority: 'low',
      title: 'Разместить успешные SKU на втором маркетплейсе',
      text: `${cross} товарных групп найдены только на одном маркетплейсе. Проверьте перенос карточек Ozon ↔ WB.`,
      action: 'Кросс-листинг',
      impact: '+ охват',
    });
  }
  const errShops = shops.filter(s => s.status === 'err');
  if (errShops.length) {
    rec.push({
      priority: 'high',
      title: 'Починить интеграции с ошибкой',
      text: `У ${errShops.length} кабинетов ошибка синхронизации. Последняя ошибка: ${errShops[0].lastError || 'проверьте токены и права API'}.`,
      action: 'Обновить API-ключи',
      impact: 'актуальные данные',
    });
  }
  if (!rec.length) {
    rec.push({ priority: 'low', title: 'Критичных проблем нет', text: 'Остатки и статусы товаров выглядят нормально. Следующий шаг — анализ маржинальности, цен конкурентов и рекламных ставок.', action: 'Запустить расширенную аналитику', impact: 'оптимизация прибыли' });
  }
  return rec;
}
async function llmRecommendationsIfConfigured(baseRecommendations, userId = null) {
  if (AI_PROVIDER === 'gemini') return baseRecommendations;
  const apiKey = process.env.AI_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) return baseRecommendations;
  const baseUrl = (process.env.AI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
  const model = process.env.AI_MODEL || 'gpt-4o-mini';
  const userShopIds = userId ? new Set(loadShops().filter(s => s.userId === userId).map(s => s.id)) : null;
  const products = loadProducts().filter(p => !userShopIds || userShopIds.has(p.shopId)).slice(0, 200);
  const prompt = `Ты AI-консультант продавца Ozon/Wildberries. Верни СТРОГО JSON массив рекомендаций без markdown. Поля: priority(high|medium|low), title, text, action, impact. Данные: ${JSON.stringify({ baseRecommendations, products })}`;
  try {
    const resp = await fetchJson(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], temperature: 0.2 }),
    }, 'AI recommendations');
    const content = resp.choices?.[0]?.message?.content || '';
    const parsed = JSON.parse(content.replace(/^```json\s*/i, '').replace(/```$/i, '').trim());
    return Array.isArray(parsed) && parsed.length ? parsed : baseRecommendations;
  } catch (e) {
    return baseRecommendations.concat([{ priority: 'low', title: 'LLM недоступна', text: `Rule-based рекомендации показаны вместо LLM: ${e.message}`, action: 'Проверить AI_API_KEY', impact: 'качество AI' }]);
  }
}


function daysAgoISO(days) {
  const d = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return d.toISOString();
}
function dateOnly(iso) { return String(iso || new Date().toISOString()).slice(0, 10); }
function toNumber(v) { return Number(String(v ?? 0).replace(',', '.')) || 0; }
function normalizeArticle(v) { return String(v || '').trim().toLowerCase(); }
function getUserShopIds(userId) { return new Set(loadShops().filter(s => s.userId === userId).map(s => s.id)); }
function userProducts(userId) {
  const ids = getUserShopIds(userId);
  return loadProducts().filter(p => ids.has(p.shopId));
}
function userOrders(userId) {
  const ids = getUserShopIds(userId);
  return loadOrders().filter(o => ids.has(o.shopId));
}
function userCostsMap(userId) {
  const m = new Map();
  for (const c of loadCosts().filter(x => x.userId === userId)) m.set(normalizeArticle(c.article), Number(c.cost || 0));
  return m;
}

async function fetchWBOrders(shop, days = Number(process.env.SYNC_DAYS || 30)) {
  const token = shop.credentials?.wbToken;
  if (!token) throw new Error('WB token не задан');
  const dateFrom = dateOnly(daysAgoISO(days));
  const result = [];
  const warnings = [];
  try {
    const rows = await fetchJson(`${WB.orders}?dateFrom=${encodeURIComponent(dateFrom)}&flag=0`, { method: 'GET', headers: wbHeaders(token) }, 'WB supplier orders');
    for (const r of (Array.isArray(rows) ? rows : rows.data || [])) {
      const article = String(r.supplierArticle || r.vendorCode || r.nmId || r.nmID || '');
      const price = toNumber(r.finishedPrice || r.priceWithDisc || r.totalPrice || r.price || 0);
      result.push({
        id: `wb-order:${shop.id}:${r.srid || r.gNumber || r.odid || crypto.randomUUID()}`,
        shopId: shop.id, shopName: shop.name, marketplace: 'wb', source: 'orders',
        postingNumber: String(r.gNumber || r.srid || ''), article, productName: r.subject || r.category || article,
        qty: 1, price, revenue: price, status: r.isCancel ? 'cancelled' : 'created', date: r.date || r.lastChangeDate || new Date().toISOString(),
        rawMinimal: { nmId: r.nmId || r.nmID, warehouseName: r.warehouseName, regionName: r.regionName, isCancel: r.isCancel }
      });
    }
  } catch (e) { warnings.push('WB orders не получены: ' + e.message); }
  try {
    const rows = await fetchJson(`${WB.sales}?dateFrom=${encodeURIComponent(dateFrom)}&flag=0`, { method: 'GET', headers: wbHeaders(token) }, 'WB supplier sales');
    for (const r of (Array.isArray(rows) ? rows : rows.data || [])) {
      const article = String(r.supplierArticle || r.vendorCode || r.nmId || r.nmID || '');
      const price = toNumber(r.finishedPrice || r.priceWithDisc || r.forPay || r.totalPrice || 0);
      result.push({
        id: `wb-sale:${shop.id}:${r.saleID || r.srid || crypto.randomUUID()}`,
        shopId: shop.id, shopName: shop.name, marketplace: 'wb', source: 'sales',
        postingNumber: String(r.saleID || r.srid || ''), article, productName: r.subject || r.category || article,
        qty: 1, price, revenue: price, status: 'delivered', date: r.date || r.lastChangeDate || new Date().toISOString(),
        rawMinimal: { nmId: r.nmId || r.nmID, warehouseName: r.warehouseName, regionName: r.regionName }
      });
    }
  } catch (e) { warnings.push('WB sales не получены: ' + e.message); }
  return { orders: result, warnings };
}

async function fetchOzonOrders(shop, days = Number(process.env.SYNC_DAYS || 30)) {
  const credentials = shop.credentials || {};
  const headers = ozonHeaders(credentials);
  const since = daysAgoISO(days);
  const to = new Date().toISOString();
  const result = [];
  const warnings = [];
  async function fetchPostings(kind) {
    const url = kind === 'fbs' ? OZON.fbsPostings : OZON.fboPostings;
    const body = kind === 'fbs'
      ? { dir: 'ASC', filter: { since, to }, limit: 1000, offset: 0, with: { analytics_data: true, financial_data: true } }
      : { dir: 'ASC', filter: { since, to }, limit: 1000, offset: 0, translit: false, with: { analytics_data: true, financial_data: true } };
    const data = await fetchJson(url, { method: 'POST', headers, body: JSON.stringify(body) }, `Ozon ${kind.toUpperCase()} postings`);
    return data.result?.postings || data.result || data.postings || [];
  }
  for (const kind of ['fbs', 'fbo']) {
    try {
      const postings = await fetchPostings(kind);
      for (const posting of postings) {
        const products = posting.products || [];
        for (const pr of products) {
          const qty = Number(pr.quantity || 1) || 1;
          const price = toNumber(pr.price || pr.offer_price || pr.financial_data?.price || 0);
          const article = String(pr.offer_id || pr.sku || pr.product_id || '');
          result.push({
            id: `ozon-${kind}:${shop.id}:${posting.posting_number || posting.order_id}:${article}`,
            shopId: shop.id, shopName: shop.name, marketplace: 'ozon', source: kind,
            postingNumber: String(posting.posting_number || posting.order_id || ''), article, productName: pr.name || article,
            qty, price, revenue: price * qty, status: posting.status || 'unknown', date: posting.in_process_at || posting.created_at || posting.shipment_date || new Date().toISOString(),
            rawMinimal: { order_id: posting.order_id, delivery_method: posting.delivery_method?.name, warehouse: posting.delivery_method?.warehouse }
          });
        }
      }
    } catch (e) { warnings.push(`Ozon ${kind.toUpperCase()} postings не получены: ${e.message}`); }
  }
  return { orders: result, warnings };
}

async function fetchMarketplaceOrders(shop) {
  if (shop.marketplace === 'wb') return fetchWBOrders(shop);
  if (shop.marketplace === 'ozon') return fetchOzonOrders(shop);
  return { orders: [], warnings: ['Неизвестный marketplace для заказов'] };
}
function mergeShopOrders(shopId, newOrders) {
  const other = loadOrders().filter(o => o.shopId !== shopId);
  const uniq = new Map();
  for (const o of newOrders) uniq.set(o.id, o);
  saveOrders(other.concat([...uniq.values()]));
}

function buildOperationalInsights(userId) {
  const products = userProducts(userId);
  const orders = userOrders(userId);
  const costs = userCostsMap(userId);
  const now = Date.now();
  const orders7d = orders.filter(o => Date.parse(o.date || 0) >= now - 7 * 86400000);
  const orders14d = orders.filter(o => Date.parse(o.date || 0) >= now - 14 * 86400000);
  const orders30d = orders.filter(o => Date.parse(o.date || 0) >= now - 30 * 86400000);
  function buildSalesMap(rows) {
    const map = new Map();
    for (const o of rows) {
      const key = normalizeArticle(o.article);
      if (!key) continue;
      const cur = map.get(key) || { qty: 0, revenue: 0, orders: 0 };
      cur.qty += Number(o.qty || 0);
      cur.revenue += Number(o.revenue || 0);
      cur.orders += 1;
      map.set(key, cur);
    }
    return map;
  }
  const sales7 = buildSalesMap(orders7d);
  const sales14 = buildSalesMap(orders14d);
  const sales30 = buildSalesMap(orders30d);
  const revenue7d = orders7d.reduce((a,o)=>a+Number(o.revenue||0),0);
  const revenue14d = orders14d.reduce((a,o)=>a+Number(o.revenue||0),0);
  const revenue30d = orders30d.reduce((a,o)=>a+Number(o.revenue||0),0);
  const tasks = [];
  const supplyPlan = [];
  const profitLeaks = [];
  let estimatedLoss = 0, estimatedLoss14 = 0, estimatedLoss30 = 0, lostOrders7 = 0;
  let noStock = 0, lowStock = 0, inactive = 0, negativeMargin = 0, noCost = 0;
  for (const p of products) {
    const key = normalizeArticle(p.article);
    const sold7 = sales7.get(key) || { qty: 0, revenue: 0, orders: 0 };
    const sold14 = sales14.get(key) || { qty: 0, revenue: 0, orders: 0 };
    const sold30 = sales30.get(key) || { qty: 0, revenue: 0, orders: 0 };
    const avgDaily7 = sold7.qty / 7;
    const avgDaily14 = sold14.qty / 14;
    const avgDaily30 = sold30.qty / 30;
    const avgDaily = avgDaily7 || avgDaily14 || avgDaily30;
    const avgPrice = (sold7.revenue && sold7.qty ? sold7.revenue / sold7.qty : sold30.revenue && sold30.qty ? sold30.revenue / sold30.qty : 0);
    const price = Number(p.price || avgPrice || 0);
    const stock = Number(p.stock || 0);
    const cost = costs.get(key);
    if (!cost) noCost++;
    const daysLeft = avgDaily > 0 ? stock / avgDaily : null;
    const loss7 = Math.round((avgDaily || 0.15) * (price || 1000) * 7);
    const loss14 = Math.round((avgDaily || 0.15) * (price || 1000) * 14);
    const loss30 = Math.round((avgDaily || 0.15) * (price || 1000) * 30);
    const lostQty7 = Math.round((avgDaily || 0.15) * 7);
    if (p.status === 'inactive') {
      inactive++;
      tasks.push({ priority: 'high', type: 'content', marketplace: p.marketplace, article: p.article, productId: p.id, title: 'Вернуть карточку в продажу', text: `${p.name}: карточка неактивна. По темпу последних 7 дней риск потерь: ₽${loss7.toLocaleString('ru-RU')} за неделю.`, action: 'Исправить карточку', moneyImpact: loss7, loss7, loss14, loss30, lostOrders7: lostQty7, avgDaily7: Number(avgDaily7.toFixed(2)), confidence: avgDaily ? 0.78 : 0.55 });
    }
    if (stock <= 0) {
      noStock++;
      estimatedLoss += loss7;
      estimatedLoss14 += loss14;
      estimatedLoss30 += loss30;
      lostOrders7 += lostQty7;
      tasks.push({ priority: 'high', type: 'stock', marketplace: p.marketplace, article: p.article, productId: p.id, title: 'Срочно пополнить остаток', text: `${p.name}: остаток 0. Расчёт по последним 7 дням: риск ≈ ${lostQty7} заказов / ₽${loss7.toLocaleString('ru-RU')} за неделю.`, action: 'Создать поставку / обновить остаток', moneyImpact: loss7, loss7, loss14, loss30, lostOrders7: lostQty7, avgDaily7: Number(avgDaily7.toFixed(2)), avgDaily30: Number(avgDaily30.toFixed(2)), confidence: avgDaily7 > 0 ? 0.9 : avgDaily30 > 0 ? 0.78 : 0.55 });
    } else if (stock <= 5 || (daysLeft !== null && daysLeft < 10)) {
      lowStock++;
      const target = Math.max(10, Math.ceil((avgDaily || 1) * 21));
      const qty = Math.max(0, target - stock);
      supplyPlan.push({ marketplace: p.marketplace, article: p.article, name: p.name, stock, avgDaily7: Number(avgDaily7.toFixed(2)), avgDaily30: Number(avgDaily30.toFixed(2)), daysLeft: daysLeft === null ? null : Number(daysLeft.toFixed(1)), recommendedQty: qty, risk7: loss7 });
      tasks.push({ priority: 'medium', type: 'supply', marketplace: p.marketplace, article: p.article, productId: p.id, title: 'Подготовить пополнение', text: `${p.name}: остаток ${stock}, ${daysLeft ? `хватит примерно на ${daysLeft.toFixed(1)} дн.` : 'продаж мало для прогноза'}. Риск недели: ₽${loss7.toLocaleString('ru-RU')}.`, action: `Пополнить до ${target} шт.`, moneyImpact: loss7, loss7, loss14, loss30, lostOrders7: lostQty7, avgDaily7: Number(avgDaily7.toFixed(2)), confidence: avgDaily ? 0.76 : 0.55 });
    }
    if (cost && price) {
      const gross = price - cost;
      const marginPct = gross / price;
      if (marginPct < 0.12) {
        if (marginPct < 0) negativeMargin++;
        const leak7 = Math.round(Math.abs(Math.min(marginPct, 0.12)) * price * Math.max(sold7.qty, 1));
        const leak30 = Math.round(Math.abs(Math.min(marginPct, 0.12)) * price * Math.max(sold30.qty, 1));
        profitLeaks.push({ marketplace: p.marketplace, article: p.article, name: p.name, price, cost, marginPct: Number((marginPct * 100).toFixed(1)), estimatedLeak7d: leak7, estimatedLeak30d: leak30 });
        tasks.push({ priority: marginPct < 0 ? 'high' : 'medium', type: 'profit', marketplace: p.marketplace, article: p.article, productId: p.id, title: marginPct < 0 ? 'Товар может быть убыточным' : 'Низкая маржа', text: `${p.name}: цена ₽${price}, себестоимость ₽${cost}, грубая маржа ${Math.round(marginPct*100)}%. Утечка за 7 дней: ₽${leak7.toLocaleString('ru-RU')}.`, action: 'Проверить цену, скидки и комиссии', moneyImpact: leak7, loss7: leak7, loss30: leak30, confidence: 0.7 });
      }
    }
  }
  const onlyByName = new Map();
  for (const p of products) {
    const k = String(p.name || '').toLowerCase().replace(/\d+/g, '').trim();
    if (!k) continue;
    const cur = onlyByName.get(k) || { marketplaces: new Set(), items: [] };
    cur.marketplaces.add(p.marketplace); cur.items.push(p); onlyByName.set(k, cur);
  }
  for (const [, group] of onlyByName) {
    if (group.marketplaces.size === 1 && group.items.length) {
      const p = group.items[0];
      tasks.push({ priority: 'low', type: 'cross-listing', marketplace: p.marketplace, article: p.article, productId: p.id, title: 'Разместить SKU на втором маркетплейсе', text: `${p.name}: товар найден только на ${p.marketplace === 'wb' ? 'Wildberries' : 'Ozon'}.`, action: 'Подготовить карточку для второго МП', moneyImpact: Math.round((Number(p.price || 1000)) * 3), loss7: Math.round((Number(p.price || 1000)) * 3), confidence: 0.5 });
    }
  }
  tasks.sort((a,b) => (b.moneyImpact||0)-(a.moneyImpact||0));
  const health = Math.max(1, Math.min(100, Math.round(100 - noStock*8 - lowStock*4 - inactive*7 - negativeMargin*8 - Math.min(noCost, 10)*1.5)));
  return {
    healthScore: health,
    estimatedLoss,
    estimatedLoss7d: estimatedLoss,
    estimatedLoss14d: estimatedLoss14,
    estimatedLoss30d: estimatedLoss30,
    lostOrders7d: lostOrders7,
    revenue: { sevenDays: revenue7d, fourteenDays: revenue14d, thirtyDays: revenue30d },
    counters: { products: products.length, orders7d: orders7d.length, orders14d: orders14d.length, orders30d: orders30d.length, noStock, lowStock, inactive, negativeMargin, noCost },
    tasks: tasks.slice(0, 50),
    supplyPlan: supplyPlan.slice(0, 50),
    profitLeaks: profitLeaks.slice(0, 50),
    generatedAt: new Date().toISOString()
  };
}

function getExpenseMap(userId) {
  const map = new Map();
  for (const c of loadCosts().filter(x => x.userId === userId)) {
    map.set(normalizeArticle(c.article), {
      cost: Number(c.cost || 0),
      packaging: Number(c.packaging || 0),
      logistics: Number(c.logistics || 0),
      taxPct: Number(c.taxPct || 0),
      adSpend: Number(c.adSpend || 0),
    });
  }
  return map;
}
function groupSalesByArticle(orders, days = 30) {
  const now = Date.now();
  const rows = orders.filter(o => Date.parse(o.date || 0) >= now - days * 86400000);
  const map = new Map();
  for (const o of rows) {
    const key = normalizeArticle(o.article);
    if (!key) continue;
    const cur = map.get(key) || { qty: 0, revenue: 0, orders: 0, daily: {} };
    const qty = Number(o.qty || 0);
    const revenue = Number(o.revenue || 0);
    const day = dateOnly(o.date);
    cur.qty += qty; cur.revenue += revenue; cur.orders += 1;
    cur.daily[day] = (cur.daily[day] || 0) + qty;
    map.set(key, cur);
  }
  return map;
}
function estimateCommission(marketplace) {
  return marketplace === 'ozon' ? 0.20 : 0.18;
}
function calcUnitEconomics(p, exp, sold) {
  const price = Number(p.price || (sold?.revenue && sold?.qty ? sold.revenue / sold.qty : 0) || 0);
  const cost = Number(exp?.cost || 0);
  const packaging = Number(exp?.packaging || 0);
  const logistics = Number(exp?.logistics || 0);
  const taxPct = Number(exp?.taxPct || 0) / 100;
  const adPerUnit = Number(exp?.adSpend || 0);
  const commissionPct = estimateCommission(p.marketplace);
  const commission = price * commissionPct;
  const tax = price * taxPct;
  const netProfit = price - cost - packaging - logistics - adPerUnit - commission - tax;
  const marginPct = price ? netProfit / price : 0;
  const safePrice = Math.ceil((cost + packaging + logistics + adPerUnit) / Math.max(0.35, (1 - commissionPct - taxPct - 0.15)));
  return { price, cost, packaging, logistics, adPerUnit, commission: Math.round(commission), commissionPct, tax: Math.round(tax), taxPct, netProfit: Math.round(netProfit), marginPct: Number((marginPct * 100).toFixed(1)), safePrice };
}
function xyzClass(daily, days = 30) {
  const arr = [];
  for (let i = days - 1; i >= 0; i--) arr.push(Number(daily[dateOnly(daysAgoISO(i))] || 0));
  const avg = arr.reduce((a,b)=>a+b,0) / days;
  if (avg === 0) return 'Z';
  const variance = arr.reduce((a,b)=>a+Math.pow(b-avg,2),0) / days;
  const cv = Math.sqrt(variance) / avg;
  return cv < 0.5 ? 'X' : cv < 1 ? 'Y' : 'Z';
}
function buildFeatureCenter(userId) {
  const insights = buildOperationalInsights(userId);
  const products = userProducts(userId);
  const orders = userOrders(userId);
  const shops = loadShops().filter(s => s.userId === userId).map(s => publicShop(s, loadProducts()));
  const expenses = getExpenseMap(userId);
  const sales7 = groupSalesByArticle(orders, 7);
  const sales30 = groupSalesByArticle(orders, 30);
  const rows = products.map(p => {
    const key = normalizeArticle(p.article);
    const sold7 = sales7.get(key) || { qty: 0, revenue: 0, orders: 0, daily: {} };
    const sold30 = sales30.get(key) || { qty: 0, revenue: 0, orders: 0, daily: {} };
    const exp = expenses.get(key) || {};
    const unit = calcUnitEconomics(p, exp, sold30);
    const stock = Number(p.stock || 0);
    const avgDaily7 = sold7.qty / 7;
    const avgDaily30 = sold30.qty / 30;
    const avgDaily = avgDaily7 || avgDaily30;
    const daysLeft = avgDaily ? stock / avgDaily : null;
    const stockValue = Math.round(stock * (unit.cost || unit.price * 0.55 || 0));
    const deadStock = stock > 0 && (sold30.qty === 0 || (daysLeft !== null && daysLeft > 75));
    const frozenMoney = deadStock ? stockValue : 0;
    const gradeScore = (sold30.revenue ? 35 : 0) + (unit.marginPct > 25 ? 25 : unit.marginPct > 12 ? 12 : unit.marginPct < 0 ? -20 : 0) + (stock > 0 ? 15 : -20) + (p.status === 'active' ? 15 : -25) + (daysLeft !== null && daysLeft < 45 ? 10 : 0);
    const grade = gradeScore >= 70 ? 'A' : gradeScore >= 45 ? 'B' : gradeScore >= 20 ? 'C' : 'D';
    return { p, key, sold7, sold30, unit, stock, avgDaily7, avgDaily30, daysLeft, stockValue, deadStock, frozenMoney, grade };
  });
  const sortedRevenue = [...rows].sort((a,b)=>b.sold30.revenue-a.sold30.revenue);
  const totalRevenue = sortedRevenue.reduce((a,x)=>a+x.sold30.revenue,0) || 1;
  let cumulative = 0;
  const abcMap = new Map();
  for (const r of sortedRevenue) {
    cumulative += r.sold30.revenue;
    const share = cumulative / totalRevenue;
    abcMap.set(r.key, share <= 0.8 ? 'A' : share <= 0.95 ? 'B' : 'C');
  }
  const productScores = rows.map(r => ({ marketplace: r.p.marketplace, article: r.p.article, name: r.p.name, grade: r.grade, abc: abcMap.get(r.key) || 'C', xyz: xyzClass(r.sold30.daily), revenue30d: Math.round(r.sold30.revenue), qty30d: r.sold30.qty, stock: r.stock, daysLeft: r.daysLeft === null ? null : Number(r.daysLeft.toFixed(1)), marginPct: r.unit.marginPct, netProfit: r.unit.netProfit }));
  const deadStock = rows.filter(r=>r.deadStock).map(r=>({ marketplace:r.p.marketplace, article:r.p.article, name:r.p.name, stock:r.stock, frozenMoney:r.frozenMoney, daysLeft:r.daysLeft===null?null:Number(r.daysLeft.toFixed(1)), action:r.sold30.qty===0?'Распродать или остановить закупку':'Снизить закупку / запустить акцию' }));
  const riskCalendar = rows.filter(r=>r.stock>0 && r.daysLeft!==null && r.daysLeft < 45).map(r=>{
    const stockout = new Date(Date.now()+r.daysLeft*86400000);
    const reorder = new Date(stockout.getTime()-14*86400000);
    return { article:r.p.article, name:r.p.name, marketplace:r.p.marketplace, event:'Риск окончания товара', stockoutDate:dateOnly(stockout.toISOString()), reorderDate:dateOnly(reorder.toISOString()), daysLeft:Number(r.daysLeft.toFixed(1)), priority:r.daysLeft<10?'high':'medium' };
  }).sort((a,b)=>a.daysLeft-b.daysLeft);
  const purchaseForecast = rows.map(r=>{
    const leadTime = 14, reserveDays = 21;
    const target = Math.ceil((r.avgDaily7 || r.avgDaily30 || 0.5) * (leadTime + reserveDays));
    return { article:r.p.article, name:r.p.name, marketplace:r.p.marketplace, stock:r.stock, avgDaily7:Number(r.avgDaily7.toFixed(2)), recommendedQty:Math.max(0,target-r.stock), leadTimeDays:leadTime, reserveDays, comment:r.daysLeft!==null && r.daysLeft<leadTime?'Уже опаздывает поставка':'Плановая поставка' };
  }).filter(x=>x.recommendedQty>0).sort((a,b)=>b.recommendedQty-a.recommendedQty);
  const unitEconomics = rows.map(r=>({ marketplace:r.p.marketplace, article:r.p.article, name:r.p.name, ...r.unit, revenue30d:Math.round(r.sold30.revenue), qty30d:r.sold30.qty }));
  const unprofitable = unitEconomics.filter(x=>x.netProfit<0).map(x=>({ ...x, alert:`Товар продаётся, но прибыль с единицы отрицательная: ₽${x.netProfit}` }));
  const safePrices = unitEconomics.map(x=>({ marketplace:x.marketplace, article:x.article, name:x.name, currentPrice:x.price, safePrice:x.safePrice, diff:Math.round(x.safePrice-x.price), status:x.price && x.price<x.safePrice?'below_safe':'ok' }));
  const repricer = safePrices.filter(x=>x.currentPrice && x.status==='below_safe').map(x=>({ ...x, recommendation:`Поднять цену минимум до ₽${x.safePrice} или снизить расходы` }));
  const noSales = rows.filter(r=>r.sold30.qty===0).map(r=>({ marketplace:r.p.marketplace, article:r.p.article, name:r.p.name, stock:r.stock, reason:r.stock<=0?'нет остатка':'нет продаж 30 дней', action:'Проверить SEO, цену, фото и категорию' }));
  const seoAudit = rows.map(r=>{
    const name = String(r.p.name||'');
    const score = Math.max(20, Math.min(100, 55 + (name.length>=40&&name.length<=120?20:-10) + (r.p.brand?10:0) + (r.p.price?5:0) + (r.stock>0?10:-15)));
    return { marketplace:r.p.marketplace, article:r.p.article, name:r.p.name, score, issues:[...(name.length<40?['короткое название']:[]),...(name.length>120?['слишком длинное название']:[]),...(!r.p.brand?['не указан бренд']:[]),...(r.stock<=0?['нет остатка']:[])], suggestions:['Добавить ключевые запросы в название','Проверить обязательные характеристики','Усилить первое фото и инфографику'] };
  });
  const cardGenerator = rows.slice(0,50).map(r=>({ marketplace:r.p.marketplace, article:r.p.article, title:`${r.p.name} — купить на ${r.p.marketplace==='wb'?'Wildberries':'Ozon'}`, description:`${r.p.name}. Подходит для ежедневного использования. Проверьте характеристики, размеры и комплектацию перед публикацией.`, bullets:['Понятное название с ключом','Заполнить характеристики','Добавить преимущества','Проверить фото 1:1'] }));
  const crossListing = [];
  const nameGroups = new Map();
  for (const r of rows) {
    const n = String(r.p.name||'').toLowerCase().replace(/\d+/g,'').trim();
    if(!n) continue;
    const g = nameGroups.get(n)||{marketplaces:new Set(),items:[]}; g.marketplaces.add(r.p.marketplace); g.items.push(r); nameGroups.set(n,g);
  }
  for (const [,g] of nameGroups) if(g.marketplaces.size===1) { const r=g.items[0]; crossListing.push({ article:r.p.article, name:r.p.name, from:r.p.marketplace, to:r.p.marketplace==='wb'?'ozon':'wb', action:'Создать черновик карточки на втором маркетплейсе' }); }
  const promotionAdvisor = rows.map(r=>({ article:r.p.article, name:r.p.name, marketplace:r.p.marketplace, canDiscount:r.unit.marginPct>25 && r.stock>10, warning:r.unit.marginPct<12?'Не входить в акцию: маржа низкая':'Можно тестировать акцию', maxDiscountPct:Math.max(0, Math.min(30, Math.floor(r.unit.marginPct-12))) }));
  const beginnerMode = ['Подключить Ozon и WB API-ключи','Синхронизировать товары и заказы','Загрузить себестоимость','Разобрать AI-задачи с высоким приоритетом','Пополнить товары с риском out-of-stock','Проверить убыточные SKU','Настроить ежедневный отчёт'];
  const morningReport = `Доброе утро! Health Score: ${insights.healthScore}/100. За 7 дней заказов: ${insights.counters.orders7d || 0}. Потери из-за остатков за 7 дней: ₽${Number(insights.estimatedLoss7d||0).toLocaleString('ru-RU')}. Срочных AI-задач: ${insights.tasks.filter(t=>t.priority==='high').length}.`;
  const apiTrustIndex = shops.map(s=>({ shopId:s.id, name:s.name, marketplace:s.marketplace, status:s.status, lastError:s.lastError, checks:{ products: !String(s.lastError||'').includes('cards') && s.status!=='err', stocks: !String(s.lastError||'').includes('Остатки'), prices: !String(s.lastError||'').includes('Цены'), orders: !String(s.lastError||'').includes('orders') && !String(s.lastError||'').includes('sales') && !String(s.lastError||'').includes('postings') } }));
  const antiCrisis = insights.tasks.filter(t=>t.priority==='high').slice(0,5).map((t,i)=>({ day:i+1, task:t.title, article:t.article, action:t.action, moneyImpact:t.moneyImpact }));
  const modules = {
    todayTasks: insights.tasks,
    sevenDayLoss: { estimatedLoss7d: insights.estimatedLoss7d, lostOrders7d: insights.lostOrders7d, revenue7d: insights.revenue.sevenDays },
    deadStock,
    productScores,
    abcXyz: productScores.map(x=>({ article:x.article, name:x.name, abc:x.abc, xyz:x.xyz, revenue30d:x.revenue30d })),
    riskCalendar,
    purchaseForecast,
    unitEconomics,
    expenses: loadCosts().filter(c=>c.userId===userId),
    unprofitableAlerts: unprofitable,
    adDrrManual: unitEconomics.map(x=>({ article:x.article, name:x.name, adSpendPerUnit:x.adPerUnit, drrApprox:x.revenue30d ? Number(((x.adPerUnit*x.qty30d)/x.revenue30d*100).toFixed(1)) : 0, note:'Расчёт по вручную загруженным рекламным расходам или будущему Ads API' })),
    promotionAdvisor,
    safePrices,
    repricer,
    noSalesProducts: noSales,
    seoAudit,
    cardGenerator,
    crossListing,
    reviewsAnalysis: { status:'needs_official_seller_feedback_api', note:'Публичный/конкурентный парсинг не используется. Подключается только официальный API отзывов продавца при наличии прав.' },
    autoReplies: { status:'ready_template', styles:['официальный','дружелюбный','премиум'], example:'Здравствуйте! Спасибо за отзыв. Мы проверим ситуацию и поможем решить вопрос.' },
    telegramMorningReport: morningReport,
    adminNotifications: { recoveryPhone: ADMIN_PHONE, events:['ошибка токена','новая заявка восстановления','критичный out-of-stock'] },
    actionLog: { status:'basic', note:'Следующий шаг — сохранять все действия пользователя и AI в отдельный журнал.' },
    teamRoles: ['owner','admin','manager','warehouse','content','analyst'],
    teamTasks: insights.tasks.map(t=>({ ...t, assigneeRole:t.type==='stock'||t.type==='supply'?'warehouse':t.type==='content'||t.type==='cross-listing'?'content':t.type==='profit'?'owner':'manager' })),
    beginnerMode,
    aiChatContext: { suggestedQuestions:['Почему упали продажи?','Что сегодня срочно?','Какие товары убыточны?','Что пополнить первым?'] },
    voiceAssistant: { status:'ui_ready', note:'Текстовый AI-контекст готов; голос можно подключить через Web Speech API/TTS.' },
    competitorComparison: { status:'disabled_by_design', note:'Не добавлено: требует внешней публичной/конкурентной аналитики как MPStats. Работаем только с ключами селлера.' },
    weeklyPdfReport: { status:'markdown_ready', endpoint:'/api/report/weekly' },
    antiCrisis,
    apiTrustIndex
  };
  return { insights, modules, generatedAt:new Date().toISOString() };
}
function buildWeeklyReport(userId) {
  const fc = buildFeatureCenter(userId);
  const i = fc.insights;
  const lines = [];
  lines.push(`# SellerPilot AI — недельный отчёт`);
  lines.push(`Дата: ${new Date().toLocaleString('ru-RU')}`);
  lines.push(`Health Score: ${i.healthScore}/100`);
  lines.push(`Заказы за 7 дней: ${i.counters.orders7d || 0}`);
  lines.push(`Выручка за 7 дней: ₽${Number(i.revenue.sevenDays||0).toLocaleString('ru-RU')}`);
  lines.push(`Потери за 7 дней: ₽${Number(i.estimatedLoss7d||0).toLocaleString('ru-RU')}`);
  lines.push(`\n## Срочные задачи`);
  for (const t of i.tasks.slice(0,10)) lines.push(`- **${t.title}** (${t.article || ''}) — ${t.text} Действие: ${t.action}`);
  lines.push(`\n## Неликвид`);
  for (const d of fc.modules.deadStock.slice(0,10)) lines.push(`- ${d.article}: заморожено ₽${Number(d.frozenMoney||0).toLocaleString('ru-RU')} — ${d.action}`);
  return lines.join('\n');
}


function maskToken(token) {
  if (!token) return '';
  const s = String(token);
  return s.length < 14 ? '***' : `${s.slice(0, 8)}…${s.slice(-6)}`;
}
function publicTelegramSetting(setting) {
  if (!setting) return { enabled: false, botTokenMasked: '', chatId: '', reportTime: '09:00', timezone: 'Europe/Moscow' };
  return {
    enabled: Boolean(setting.enabled),
    botTokenMasked: maskToken(setting.botToken),
    hasBotToken: Boolean(setting.botToken),
    chatId: setting.chatId || '',
    reportTime: setting.reportTime || '09:00',
    timezone: setting.timezone || 'Europe/Moscow',
    lastSentAt: setting.lastSentAt || null,
    lastSentDate: setting.lastSentDate || null,
    lastError: setting.lastError || null,
  };
}
function htmlEscape(s) {
  return String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}
async function sendTelegramMessage(botToken, chatId, text) {
  if (!botToken || !chatId) throw new Error('Не указан Telegram bot token или chat_id');
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  const data = await fetchJson(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: String(chatId), text, parse_mode: 'HTML', disable_web_page_preview: true }),
  }, 'Telegram sendMessage');
  if (data.ok === false) throw new Error(data.description || 'Telegram вернул ошибку');
  return data;
}
function getLocalParts(timezone) {
  const tz = timezone || 'Europe/Moscow';
  const now = new Date();
  const time = new Intl.DateTimeFormat('ru-RU', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(now);
  const date = new Intl.DateTimeFormat('sv-SE', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  return { date, time };
}
function timeToMinutes(t) {
  const [h, m] = String(t || '09:00').split(':').map(Number);
  return (Number.isFinite(h) ? h : 9) * 60 + (Number.isFinite(m) ? m : 0);
}
function buildTelegramDailyReport(user, setting) {
  const fc = buildFeatureCenter(user.id);
  const i = fc.insights;
  const top = i.tasks.slice(0, 5);
  const lines = [];
  lines.push(`🤖 <b>SellerPilot AI — отчёт на сегодня</b>`);
  lines.push(`Аккаунт: <b>${htmlEscape(user.email)}</b>`);
  lines.push(``);
  lines.push(`🏥 Health Score: <b>${i.healthScore}/100</b>`);
  lines.push(`💰 Потери за 7 дней: <b>₽${Number(i.estimatedLoss7d || 0).toLocaleString('ru-RU')}</b>`);
  lines.push(`📉 Возможные потерянные заказы: <b>${i.lostOrders7d || 0}</b>`);
  lines.push(`🧾 Заказы за 7 дней: <b>${i.counters.orders7d || 0}</b>`);
  lines.push(`📦 Без остатка: <b>${i.counters.noStock}</b> · мало остатка: <b>${i.counters.lowStock}</b>`);
  lines.push(`📌 Срочных задач: <b>${top.filter(t => t.priority === 'high').length}</b> из ${i.tasks.length}`);
  lines.push(``);
  if (top.length) {
    lines.push(`<b>Что сделать сегодня:</b>`);
    top.forEach((t, idx) => lines.push(`${idx + 1}. ${htmlEscape(t.title)} ${t.article ? '(' + htmlEscape(t.article) + ')' : ''}\n   ${htmlEscape(t.action || '')} · эффект: ₽${Number(t.moneyImpact || 0).toLocaleString('ru-RU')}`));
  } else {
    lines.push(`✅ Критичных задач нет. Проверьте кабинет и синхронизацию.`);
  }
  lines.push(``);
  lines.push(`Время отчёта: ${htmlEscape(setting.reportTime || '09:00')} ${htmlEscape(setting.timezone || 'Europe/Moscow')}`);
  return lines.join('\n');
}
let telegramSchedulerBusy = false;
async function checkTelegramSchedules() {
  if (telegramSchedulerBusy) return;
  telegramSchedulerBusy = true;
  try {
    const settings = loadTelegramSettings();
    const users = loadUsers();
    let changed = false;
    for (const setting of settings) {
      if (!setting.enabled || !setting.botToken || !setting.chatId) continue;
      const { date, time } = getLocalParts(setting.timezone || 'Europe/Moscow');
      const nowMin = timeToMinutes(time);
      const targetMin = timeToMinutes(setting.reportTime || '09:00');
      if (setting.lastSentDate === date) continue;
      if (nowMin < targetMin || nowMin > targetMin + 10) continue;
      const user = users.find(u => u.id === setting.userId);
      if (!user) continue;
      try {
        await sendTelegramMessage(setting.botToken, setting.chatId, buildTelegramDailyReport(user, setting));
        setting.lastSentAt = new Date().toISOString();
        setting.lastSentDate = date;
        setting.lastError = null;
      } catch (e) {
        setting.lastError = e.message;
      }
      changed = true;
    }
    if (changed) saveTelegramSettings(settings);
  } finally {
    telegramSchedulerBusy = false;
  }
}


function todayKey() { return new Date().toISOString().slice(0, 10); }
function aiUsageKey(userId, feature) { return `${todayKey()}:${userId}:${feature}`; }
function checkAiLimit(userId, feature) {
  const usage = loadAiUsage();
  const key = aiUsageKey(userId, feature);
  const used = Number(usage[key] || 0);
  if (used >= AI_MAX_CALLS_PER_DAY) {
    const e = new Error(`Дневной лимит Gemini для ${feature} исчерпан: ${used}/${AI_MAX_CALLS_PER_DAY}`);
    e.status = 429;
    throw e;
  }
  usage[key] = used + 1;
  saveAiUsage(usage);
  return { used: usage[key], limit: AI_MAX_CALLS_PER_DAY };
}
function compactFeatureContext(fc) {
  const i = fc.insights || {};
  return {
    healthScore: i.healthScore,
    estimatedLoss7d: i.estimatedLoss7d,
    lostOrders7d: i.lostOrders7d,
    revenue7d: i.revenue?.sevenDays,
    counters: i.counters,
    topTasks: (i.tasks || []).slice(0, 10).map(t => ({ priority: t.priority, type: t.type, article: t.article, title: t.title, action: t.action, moneyImpact: t.moneyImpact })),
    deadStock: (fc.modules?.deadStock || []).slice(0, 5),
    unprofitable: (fc.modules?.unprofitableAlerts || []).slice(0, 5),
    noSales: (fc.modules?.noSalesProducts || []).slice(0, 5),
  };
}
async function geminiGenerate(userId, feature, prompt, options = {}) {
  if (AI_PROVIDER !== 'gemini' || !GEMINI_API_KEY) return null;
  if (!['chat', 'report', 'card', 'review', 'analysis'].includes(feature)) return null;
  const usage = checkAiLimit(userId, feature);
  const model = options.model || GEMINI_MODEL;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;
  const data = await fetchJson(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: options.temperature ?? 0.25, maxOutputTokens: options.maxOutputTokens || 1200 }
    }),
  }, `Gemini ${feature}`);
  const text = data.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';
  return { text: text.trim(), usage };
}
function stripMarkdownJson(text) {
  return String(text || '').replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();
}
async function geminiChatAnswer(user, question) {
  const fc = buildFeatureCenter(user.id);
  const prompt = `Ты AI-директор продавца Ozon/Wildberries. Отвечай кратко, по-русски, только по данным продавца. Не выдумывай конкурентную аналитику. Если данных мало — скажи, что нужно синхронизировать кабинеты.\n\nДанные:\n${JSON.stringify(compactFeatureContext(fc), null, 2)}\n\nВопрос пользователя: ${question}`;
  const gen = await geminiGenerate(user.id, 'chat', prompt, { maxOutputTokens: 900, temperature: 0.2 });
  return gen ? { answer: gen.text, context: fc.insights, provider: 'gemini', usage: gen.usage } : null;
}
async function geminiPrettyReport(user) {
  const fc = buildFeatureCenter(user.id);
  const prompt = `Сделай красивый еженедельный markdown-отчёт для владельца магазина Ozon/Wildberries. Используй только эти данные, не добавляй публичную аналитику и конкурентов. Структура: Итог, Деньги, Срочные задачи, Неликвид, Убыточные SKU, План на неделю.\n\nДанные:\n${JSON.stringify(compactFeatureContext(fc), null, 2)}`;
  const gen = await geminiGenerate(user.id, 'report', prompt, { maxOutputTokens: 1800, temperature: 0.25 });
  return gen?.text || null;
}
async function geminiGenerateCard(user, payload) {
  const fc = buildFeatureCenter(user.id);
  const article = String(payload.article || '').trim();
  const products = userProducts(user.id);
  const product = products.find(p => normalizeArticle(p.article) === normalizeArticle(article)) || null;
  const base = product || { article, name: payload.name || 'Товар', marketplace: payload.marketplace || 'wb' };
  const prompt = `Сгенерируй карточку товара для маркетплейса ${base.marketplace}. Верни строго JSON без markdown: {"title":"...","description":"...","bullets":["..."],"seo":["..."],"characteristicsTips":["..."]}. Не обещай свойства, которых нет в данных.\n\nТовар: ${JSON.stringify(base)}\nКонтекст магазина: ${JSON.stringify(compactFeatureContext(fc))}`;
  const gen = await geminiGenerate(user.id, 'card', prompt, { maxOutputTokens: 1200, temperature: 0.35 });
  if (!gen) return null;
  try { return { result: JSON.parse(stripMarkdownJson(gen.text)), provider: 'gemini', usage: gen.usage }; }
  catch { return { result: { raw: gen.text }, provider: 'gemini', usage: gen.usage }; }
}
async function geminiReviewReply(user, payload) {
  const style = String(payload.style || 'дружелюбный');
  const review = String(payload.review || '').trim();
  if (!review) { const e = new Error('Введите текст отзыва'); e.status = 400; throw e; }
  const prompt = `Напиши ответ продавца на отзыв для Ozon/Wildberries. Стиль: ${style}. Коротко, вежливо, без обещаний компенсаций, если их нет. Верни только текст ответа.\n\nОтзыв: ${review}`;
  const gen = await geminiGenerate(user.id, 'review', prompt, { maxOutputTokens: 500, temperature: 0.35 });
  return gen ? { reply: gen.text, provider: 'gemini', usage: gen.usage } : null;
}


async function geminiBusinessAnalysis(user, fc) {
  const prompt = `Ты AI-директор продавца Ozon/Wildberries. Проанализируй уже рассчитанные backend данные и верни СТРОГО JSON без markdown. Не меняй фактические числа, не выдумывай конкурентов и внешнюю аналитику. Сделай человеческие выводы по модулям: потери за 7 дней, Health Score, неликвид, ABC/XYZ, план закупки, unit-экономика, убыточные SKU, безопасная цена, AI-задачи.\n\nСхема JSON:\n{\n  "executiveSummary":"короткий итог",\n  "healthComment":"комментарий",\n  "moneyLossComment":"комментарий",\n  "topPriorities":[{"priority":"high|medium|low","title":"...","why":"...","action":"...","moneyImpact":0}],\n  "moduleInsights":{\n    "loss7d":"...",\n    "healthScore":"...",\n    "deadStock":"...",\n    "abcXyz":"...",\n    "purchasePlan":"...",\n    "unitEconomics":"...",\n    "unprofitableSku":"...",\n    "safePrice":"...",\n    "aiTasks":"..."\n  }\n}\n\nДанные:\n${JSON.stringify({ insights: fc.insights, modules: { deadStock: fc.modules.deadStock?.slice(0,10), abcXyz: fc.modules.abcXyz?.slice(0,20), purchaseForecast: fc.modules.purchaseForecast?.slice(0,10), unitEconomics: fc.modules.unitEconomics?.slice(0,20), unprofitableAlerts: fc.modules.unprofitableAlerts?.slice(0,10), safePrices: fc.modules.safePrices?.slice(0,20), todayTasks: fc.modules.todayTasks?.slice(0,15) } }, null, 2)}`;
  const gen = await geminiGenerate(user.id, 'analysis', prompt, { maxOutputTokens: 2200, temperature: 0.15 });
  if (!gen) return null;
  try { return { result: JSON.parse(stripMarkdownJson(gen.text)), provider: 'gemini', model: GEMINI_MODEL, usage: gen.usage }; }
  catch { return { result: { executiveSummary: gen.text, moduleInsights: {} }, provider: 'gemini', model: GEMINI_MODEL, usage: gen.usage }; }
}


function addDaysISO(days) { return new Date(Date.now() + days * 86400000).toISOString(); }
function getUserSubscription(user) {
  const sub = user.subscription || { plan: 'trial', status: 'trial', trialEndsAt: user.trialEndsAt || addDaysISO(TRIAL_DAYS), currentPeriodEnd: null };
  const trialActive = sub.trialEndsAt && Date.parse(sub.trialEndsAt) > Date.now();
  const paidActive = sub.status === 'active' && sub.currentPeriodEnd && Date.parse(sub.currentPeriodEnd) > Date.now();
  return {
    plan: sub.plan || 'start',
    status: paidActive ? 'active' : trialActive ? 'trial' : sub.status === 'pending' ? 'pending' : 'expired',
    priceRub: START_PLAN_PRICE_RUB,
    trialEndsAt: sub.trialEndsAt || null,
    currentPeriodEnd: sub.currentPeriodEnd || null,
    active: Boolean(paidActive || trialActive),
    paymentProvider: YOOKASSA_SHOP_ID && YOOKASSA_SECRET_KEY ? 'yookassa' : 'manual',
  };
}
function ensureUserTrial(user) {
  if (!user.subscription) {
    user.subscription = { plan: 'start', status: 'trial', trialEndsAt: addDaysISO(TRIAL_DAYS), currentPeriodEnd: null };
    const users = loadUsers();
    const idx = users.findIndex(u => u.id === user.id);
    if (idx >= 0) { users[idx] = user; saveUsers(users); }
  }
  return user;
}
async function createYookassaPayment(user, amountRub) {
  const idempotenceKey = crypto.randomUUID();
  const auth = Buffer.from(`${YOOKASSA_SHOP_ID}:${YOOKASSA_SECRET_KEY}`).toString('base64');
  const body = {
    amount: { value: Number(amountRub).toFixed(2), currency: 'RUB' },
    capture: true,
    confirmation: { type: 'redirect', return_url: `${PUBLIC_BASE_URL}/app.html?billing=return` },
    description: `SellerPilot AI Start — ${amountRub} ₽/мес, ${user.email}`,
    metadata: { userId: user.id, plan: 'start' },
    receipt: undefined,
  };
  const data = await fetchJson('https://api.yookassa.ru/v3/payments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Basic ${auth}`, 'Idempotence-Key': idempotenceKey },
    body: JSON.stringify(body),
  }, 'YooKassa create payment');
  return data;
}
function createManualInvoice(user, amountRub) {
  const invoice = {
    id: crypto.randomUUID(), userId: user.id, provider: 'manual', status: 'pending', amountRub,
    email: user.email,
    comment: `SellerPilot AI Start ${user.email} ${amountRub} RUB`,
    adminPhone: ADMIN_PHONE, createdAt: new Date().toISOString(),
  };
  const billing = loadBilling(); billing.push(invoice); saveBilling(billing);
  invoice.whatsappUrl = whatsappPayUrl(invoice);
  return invoice;
}
function activateUserSubscription(userId, days = 30) {
  const users = loadUsers();
  const u = users.find(x => x.id === userId);
  if (!u) return null;
  u.subscription = { plan: 'start', status: 'active', trialEndsAt: u.subscription?.trialEndsAt || null, currentPeriodEnd: addDaysISO(days) };
  saveUsers(users);
  return u;
}


function whatsappPayUrl(invoice) {
  const text = encodeURIComponent(`Здравствуйте! Хочу оплатить SellerPilot AI Start 1000 ₽/мес. Логин: ${invoice.email || ''}. Комментарий: ${invoice.comment}`);
  return `https://wa.me/${ADMIN_WHATSAPP}?text=${text}`;
}
function requireAdmin(req) {
  const token = getBearerToken(req);
  if (!token || !adminSessions.has(token)) { const e = new Error('Требуется вход администратора'); e.status = 401; throw e; }
  return true;
}
function adminPublicUser(u) {
  return { id: u.id, name: u.name || '', email: u.email, createdAt: u.createdAt, subscription: getUserSubscription(u) };
}
function adminOverview() {
  const users = loadUsers().map(adminPublicUser);
  const billing = loadBilling().map(b => ({ ...b, whatsappUrl: b.provider === 'manual' ? whatsappPayUrl(b) : b.whatsappUrl }));
  const recovery = loadRecoveryRequests();
  return { users, billing, recovery, adminPhone: ADMIN_PHONE, adminWhatsapp: ADMIN_WHATSAPP, generatedAt: new Date().toISOString() };
}

async function handleApi(req, res, url) {
  if (req.method === 'OPTIONS') return json(res, 204, {});
  try {
    if (req.method === 'POST' && url.pathname === '/api/admin/login') {
      const body = await parseBody(req);
      if (String(body.password || '') !== ADMIN_PANEL_PASSWORD) return json(res, 401, { error: 'Неверный пароль администратора' });
      const token = crypto.randomBytes(32).toString('hex');
      adminSessions.add(token);
      console.log('[admin] login ok');
      return json(res, 200, { token, adminPhone: ADMIN_PHONE, adminWhatsapp: ADMIN_WHATSAPP });
    }
    if (req.method === 'GET' && url.pathname === '/api/admin/overview') {
      requireAdmin(req);
      const data = adminOverview();
      console.log('[admin] overview', { users: data.users.length, invoices: data.billing.length });
      return json(res, 200, data);
    }
    if (req.method === 'POST' && url.pathname === '/api/admin/activate') {
      requireAdmin(req);
      const body = await parseBody(req);
      const userId = String(body.userId || '');
      const days = Number(body.days || 30);
      const updated = activateUserSubscription(userId, days);
      if (!updated) return json(res, 404, { error: 'Пользователь не найден' });
      if (body.invoiceId) {
        const billing = loadBilling();
        const inv = billing.find(x => x.id === body.invoiceId);
        if (inv) { inv.status = 'paid'; inv.paidAt = new Date().toISOString(); inv.activatedUserId = userId; }
        saveBilling(billing);
      }
      console.log('[admin] activated', { userId, days, invoiceId: body.invoiceId || null });
      return json(res, 200, { ok: true, user: adminPublicUser(updated), overview: adminOverview() });
    }
    if (req.method === 'POST' && url.pathname === '/api/admin/deactivate') {
      requireAdmin(req);
      const body = await parseBody(req);
      const users = loadUsers();
      const u = users.find(x => x.id === String(body.userId || ''));
      if (!u) return json(res, 404, { error: 'Пользователь не найден' });
      u.subscription = { ...(u.subscription || {}), plan: 'start', status: 'expired', currentPeriodEnd: new Date(Date.now()-86400000).toISOString() };
      saveUsers(users);
      console.log('[admin] deactivated', { userId: u.id });
      return json(res, 200, { ok: true, user: adminPublicUser(u), overview: adminOverview() });
    }
    if (req.method === 'GET' && url.pathname === '/api/health') {
      return json(res, 200, { ok: true, service: 'SellerPilot AI backend: Ozon + WB proxy', date: new Date().toISOString() });
    }
    if (req.method === 'POST' && url.pathname === '/api/auth/register') {
      const body = await parseBody(req);
      const email = String(body.email || '').trim().toLowerCase();
      const password = String(body.password || '');
      const name = String(body.name || '').trim();
      if (!/^\S+@\S+\.\S+$/.test(email)) return json(res, 400, { error: 'Введите корректный email' });
      if (password.length < 6) return json(res, 400, { error: 'Пароль должен быть минимум 6 символов' });
      const users = loadUsers();
      if (users.some(u => u.email === email)) return json(res, 409, { error: 'Пользователь с таким email уже есть' });
      const user = { id: crypto.randomUUID(), name: name || email.split('@')[0], email, passwordHash: hashPassword(password), createdAt: new Date().toISOString(), subscription: { plan: 'start', status: 'trial', trialEndsAt: addDaysISO(TRIAL_DAYS), currentPeriodEnd: null } };
      users.push(user); saveUsers(users);
      const token = createSession(user);
      return json(res, 201, { token, user: publicUser(user) });
    }
    if (req.method === 'POST' && url.pathname === '/api/auth/recovery-request') {
      const body = await parseBody(req);
      const email = String(body.email || '').trim().toLowerCase();
      const name = String(body.name || '').trim();
      const phone = String(body.phone || '').trim();
      const comment = String(body.comment || '').trim();
      if (!email && !phone) return json(res, 400, { error: 'Укажите email или телефон аккаунта' });
      const users = loadUsers();
      const user = email ? users.find(u => u.email === email) : null;
      const requests = loadRecoveryRequests();
      const request = {
        id: crypto.randomUUID(),
        status: 'new',
        userId: user?.id || null,
        email,
        name,
        phone,
        comment,
        createdAt: new Date().toISOString(),
        adminPhone: ADMIN_PHONE,
        note: 'Пароль восстанавливается вручную администратором после подтверждения личности.'
      };
      requests.push(request);
      saveRecoveryRequests(requests);
      return json(res, 200, { ok: true, adminPhone: ADMIN_PHONE, message: 'Заявка на восстановление отправлена администратору. Подтвердите личность по телефону.' });
    }
    if (req.method === 'POST' && url.pathname === '/api/auth/login') {
      const body = await parseBody(req);
      const email = String(body.email || '').trim().toLowerCase();
      const password = String(body.password || '');
      const user = loadUsers().find(u => u.email === email);
      if (!user || !verifyPassword(password, user.passwordHash)) return json(res, 401, { error: 'Неверный email или пароль' });
      const token = createSession(user);
      return json(res, 200, { token, user: publicUser(user) });
    }
    if (req.method === 'GET' && url.pathname === '/api/auth/me') {
      const user = getUserByRequest(req);
      if (!user) return json(res, 401, { error: 'Требуется вход в аккаунт' });
      return json(res, 200, { user: publicUser(user) });
    }
    if (req.method === 'POST' && url.pathname === '/api/auth/logout') {
      const token = getBearerToken(req);
      if (token) { const sessions = loadSessions(); delete sessions[token]; saveSessions(sessions); }
      return json(res, 200, { ok: true });
    }
    if (req.method === 'GET' && url.pathname === '/api/shops') {
      const user = requireUser(req);
      return json(res, 200, publicState(user.id));
    }
    if (req.method === 'GET' && url.pathname === '/api/products') {
      const user = requireUser(req);
      return json(res, 200, { products: publicState(user.id).products });
    }
    if (req.method === 'POST' && url.pathname === '/api/shops') {
      const user = requireUser(req);
      const body = await parseBody(req);
      if (!['wb', 'ozon'].includes(body.marketplace)) throw new Error('marketplace должен быть wb или ozon');
      if (!body.name) throw new Error('Название магазина обязательно');
      const shop = {
        id: crypto.randomUUID(),
        userId: user.id,
        marketplace: body.marketplace,
        name: String(body.name),
        legal: String(body.legal || '—'),
        status: 'warn',
        createdAt: new Date().toISOString(),
        lastSync: null,
        lastError: null,
        credentials: body.marketplace === 'wb'
          ? { wbToken: String(body.wbToken || ''), wbWarehouseId: String(body.wbWarehouseId || '') }
          : { ozonClientId: String(body.ozonClientId || ''), ozonApiKey: String(body.ozonApiKey || '') },
      };
      if (shop.marketplace === 'wb' && !shop.credentials.wbToken) throw new Error('WB token обязателен');
      if (shop.marketplace === 'ozon' && (!shop.credentials.ozonClientId || !shop.credentials.ozonApiKey)) throw new Error('Ozon Client-Id и Api-Key обязательны');
      const shops = loadShops();
      shops.push(shop);
      saveShops(shops);
      return json(res, 201, { shop: publicShop(shop, loadProducts()) });
    }
    const shopSyncMatch = url.pathname.match(/^\/api\/shops\/([^/]+)\/sync$/);
    if (req.method === 'POST' && shopSyncMatch) {
      const user = requireUser(req);
      const id = decodeURIComponent(shopSyncMatch[1]);
      const shops = loadShops();
      const shop = shops.find(s => s.id === id && s.userId === user.id);
      if (!shop) return json(res, 404, { error: 'Магазин не найден' });
      try {
        const result = await syncMarketplaceShop(shop);
        let orderResult = { orders: [], warnings: [] };
        try { orderResult = await fetchMarketplaceOrders(shop); mergeShopOrders(id, orderResult.orders); }
        catch (e) { orderResult.warnings = ['Заказы не получены: ' + e.message]; }
        const otherProducts = loadProducts().filter(p => p.shopId !== id);
        saveProducts(otherProducts.concat(result.products));
        const allWarnings = (result.warnings || []).concat(orderResult.warnings || []);
        shop.status = allWarnings.length ? 'warn' : 'ok';
        shop.lastSync = new Date().toISOString();
        shop.lastError = allWarnings.join(' | ') || null;
        saveShops(shops);
        return json(res, 200, { ...publicState(user.id), insights: buildOperationalInsights(user.id), synced: { shopId: id, products: result.products.length, orders: orderResult.orders.length, warnings: allWarnings } });
      } catch (e) {
        shop.status = 'err';
        shop.lastError = e.message;
        saveShops(shops);
        return json(res, 502, { error: e.message, ...publicState(user.id) });
      }
    }
    const shopStocksMatch = url.pathname.match(/^\/api\/shops\/([^/]+)\/stocks$/);
    if (req.method === 'POST' && shopStocksMatch) {
      const user = requireUser(req);
      const id = decodeURIComponent(shopStocksMatch[1]);
      const shops = loadShops();
      const shop = shops.find(s => s.id === id && s.userId === user.id);
      if (!shop) return json(res, 404, { error: 'Магазин не найден' });
      const body = await parseBody(req);
      const result = await updateStocks(shop, body.items || []);
      const products = loadProducts();
      for (const item of body.items || []) {
        const p = products.find(x => String(x.id) === String(item.id));
        if (p) { p.stock = Number(item.stock || 0); p.status = p.stock > 0 ? 'active' : 'no-stock'; p.updated = new Date().toISOString().slice(0, 10); }
      }
      saveProducts(products);
      return json(res, 200, { ok: true, result, ...publicState(user.id) });
    }
    const shopDeleteMatch = url.pathname.match(/^\/api\/shops\/([^/]+)$/);
    if (req.method === 'DELETE' && shopDeleteMatch) {
      const user = requireUser(req);
      const id = decodeURIComponent(shopDeleteMatch[1]);
      const shops = loadShops();
      const shop = shops.find(s => s.id === id && s.userId === user.id);
      if (!shop) return json(res, 404, { error: 'Магазин не найден' });
      saveShops(shops.filter(s => s.id !== id));
      saveProducts(loadProducts().filter(p => p.shopId !== id));
      return json(res, 200, { ok: true, ...publicState(user.id) });
    }
    if (req.method === 'GET' && url.pathname === '/api/billing/status') {
      const user = ensureUserTrial(requireUser(req));
      return json(res, 200, { subscription: getUserSubscription(user), plan: { code: 'start', name: 'Start', priceRub: START_PLAN_PRICE_RUB, skuLimit: 300, shops: 2, trialDays: TRIAL_DAYS } });
    }
    if (req.method === 'POST' && url.pathname === '/api/billing/subscribe') {
      const user = ensureUserTrial(requireUser(req));
      if (YOOKASSA_SHOP_ID && YOOKASSA_SECRET_KEY) {
        const payment = await createYookassaPayment(user, START_PLAN_PRICE_RUB);
        const billing = loadBilling();
        billing.push({ id: payment.id, userId: user.id, provider: 'yookassa', status: payment.status, amountRub: START_PLAN_PRICE_RUB, confirmationUrl: payment.confirmation?.confirmation_url || '', createdAt: new Date().toISOString() });
        saveBilling(billing);
        return json(res, 200, { provider: 'yookassa', paymentId: payment.id, status: payment.status, confirmationUrl: payment.confirmation?.confirmation_url || '', subscription: getUserSubscription(user) });
      }
      const invoice = createManualInvoice(user, START_PLAN_PRICE_RUB);
      return json(res, 200, { provider: 'manual', invoice, whatsappUrl: invoice.whatsappUrl, message: `Оплата вручную через WhatsApp: ${START_PLAN_PRICE_RUB} ₽/мес. Напишите администратору ${ADMIN_PHONE} и укажите комментарий: ${invoice.comment}`, subscription: getUserSubscription(user) });
    }
    if (req.method === 'POST' && url.pathname === '/api/billing/manual-activate') {
      const user = requireUser(req);
      const body = await parseBody(req).catch(() => ({}));
      const code = String(body.adminCode || '');
      if (!process.env.ADMIN_BILLING_CODE || code !== process.env.ADMIN_BILLING_CODE) return json(res, 403, { error: 'Неверный код администратора' });
      const updated = activateUserSubscription(user.id, 30);
      return json(res, 200, { ok: true, subscription: getUserSubscription(updated) });
    }
    if (req.method === 'GET' && url.pathname === '/api/telegram/settings') {
      const user = requireUser(req);
      const setting = loadTelegramSettings().find(x => x.userId === user.id);
      return json(res, 200, { settings: publicTelegramSetting(setting) });
    }
    if (req.method === 'POST' && url.pathname === '/api/telegram/settings') {
      const user = requireUser(req);
      const body = await parseBody(req);
      const all = loadTelegramSettings();
      let setting = all.find(x => x.userId === user.id);
      if (!setting) {
        setting = { userId: user.id, createdAt: new Date().toISOString() };
        all.push(setting);
      }
      if (Object.prototype.hasOwnProperty.call(body, 'botToken') && String(body.botToken || '').trim()) setting.botToken = String(body.botToken).trim();
      setting.chatId = String(body.chatId || setting.chatId || '').trim();
      setting.reportTime = /^\d{2}:\d{2}$/.test(String(body.reportTime || '')) ? String(body.reportTime) : (setting.reportTime || '09:00');
      setting.timezone = String(body.timezone || setting.timezone || 'Europe/Moscow').trim();
      setting.enabled = Boolean(body.enabled);
      setting.updatedAt = new Date().toISOString();
      saveTelegramSettings(all);
      return json(res, 200, { ok: true, settings: publicTelegramSetting(setting) });
    }
    if (req.method === 'POST' && url.pathname === '/api/telegram/test') {
      const user = requireUser(req);
      const body = await parseBody(req).catch(() => ({}));
      const setting = loadTelegramSettings().find(x => x.userId === user.id);
      const finalSetting = {
        ...(setting || {}),
        botToken: String(body.botToken || setting?.botToken || '').trim(),
        chatId: String(body.chatId || setting?.chatId || '').trim(),
        reportTime: String(body.reportTime || setting?.reportTime || '09:00'),
        timezone: String(body.timezone || setting?.timezone || 'Europe/Moscow'),
      };
      await sendTelegramMessage(finalSetting.botToken, finalSetting.chatId, buildTelegramDailyReport(user, finalSetting));
      return json(res, 200, { ok: true, message: 'Тестовый отчёт отправлен в Telegram' });
    }
    if (req.method === 'GET' && url.pathname === '/api/ai/status') {
      const user = requireUser(req);
      const usage = loadAiUsage();
      const usageToday = Object.fromEntries(Object.entries(usage).filter(([k]) => k.startsWith(todayKey()+':' + user.id + ':')).map(([k,v]) => [k.split(':').pop(), v]));
      return json(res, 200, { provider: AI_PROVIDER, geminiEnabled: Boolean(GEMINI_API_KEY), model: AI_PROVIDER === 'gemini' ? GEMINI_MODEL : null, allowedFeatures: ['analysis','chat','report','card','review'], maxCallsPerDay: AI_MAX_CALLS_PER_DAY, usageToday });
    }
    if (req.method === 'POST' && url.pathname === '/api/ai/card') {
      const user = requireUser(req);
      const body = await parseBody(req);
      const generated = await geminiGenerateCard(user, body).catch(e => ({ error: e.message }));
      if (generated && !generated.error) return json(res, 200, generated);
      const fc = buildFeatureCenter(user.id);
      const fallback = fc.modules.cardGenerator.find(x => normalizeArticle(x.article) === normalizeArticle(body.article)) || fc.modules.cardGenerator[0] || { title: body.name || 'Товар', description: 'Описание товара', bullets: [] };
      return json(res, 200, { result: fallback, provider: 'rules', geminiError: generated?.error || null });
    }
    if (req.method === 'POST' && url.pathname === '/api/ai/review-reply') {
      const user = requireUser(req);
      const body = await parseBody(req);
      const generated = await geminiReviewReply(user, body).catch(e => ({ error: e.message, status: e.status }));
      if (generated && !generated.error) return json(res, 200, generated);
      const review = String(body.review || '').trim();
      if (!review) return json(res, 400, { error: 'Введите текст отзыва' });
      return json(res, 200, { reply: 'Здравствуйте! Спасибо за отзыв. Нам очень жаль, что у вас возникли сложности. Мы проверим информацию и постараемся улучшить качество товара и сервиса.', provider: 'rules', geminiError: generated?.error || null });
    }
    if (req.method === 'GET' && url.pathname === '/api/intelligence') {
      const user = requireUser(req);
      const fc = buildFeatureCenter(user.id);
      const geminiAnalysis = await geminiBusinessAnalysis(user, fc).catch(e => ({ provider: 'rules', error: e.message }));
      return json(res, 200, { ...fc, geminiAnalysis });
    }
    if (req.method === 'GET' && url.pathname === '/api/report/weekly') {
      const user = requireUser(req);
      const pretty = await geminiPrettyReport(user).catch(() => null);
      return text(res, 200, pretty || buildWeeklyReport(user.id), 'text/markdown; charset=utf-8');
    }
    if (req.method === 'POST' && url.pathname === '/api/chat') {
      const user = requireUser(req);
      const body = await parseBody(req);
      const question = String(body.question || '').trim();
      const gemini = await geminiChatAnswer(user, question).catch(e => ({ error: e.message }));
      if (gemini && !gemini.error) return json(res, 200, gemini);
      const q = question.toLowerCase();
      const fc = buildFeatureCenter(user.id);
      let answer = fc.modules.telegramMorningReport;
      if (q.includes('упал') || q.includes('почему')) answer = `Основные причины просадки: нулевые остатки — ${fc.insights.counters.noStock}, малые остатки — ${fc.insights.counters.lowStock}, неактивные карточки — ${fc.insights.counters.inactive}, убыточные товары — ${fc.modules.unprofitableAlerts.length}. Потери 7д: ₽${Number(fc.insights.estimatedLoss7d||0).toLocaleString('ru-RU')}.`;
      if (q.includes('сроч') || q.includes('сегодня')) answer = fc.insights.tasks.slice(0,5).map((t,i)=>`${i+1}. ${t.title} ${t.article||''}: ${t.action}. Эффект: ₽${Number(t.moneyImpact||0).toLocaleString('ru-RU')}`).join('\n') || 'Срочных задач нет.';
      if (q.includes('убыт') || q.includes('марж')) answer = fc.modules.unprofitableAlerts.slice(0,5).map(x=>`${x.article}: прибыль/ед. ₽${x.netProfit}, маржа ${x.marginPct}%`).join('\n') || 'Убыточных товаров по загруженной себестоимости не найдено.';
      return json(res, 200, { answer, context: fc.insights, provider: 'rules', geminiError: gemini?.error || null });
    }
    if (req.method === 'GET' && url.pathname === '/api/dashboard') {
      const user = requireUser(req);
      const insights = buildOperationalInsights(user.id);
      if (url.searchParams.get('gemini') === '1') {
        const fc = buildFeatureCenter(user.id);
        const geminiAnalysis = await geminiBusinessAnalysis(user, fc).catch(e => ({ provider: 'rules', error: e.message }));
        return json(res, 200, { ...insights, geminiAnalysis });
      }
      return json(res, 200, insights);
    }
    if (req.method === 'GET' && url.pathname === '/api/orders') {
      const user = requireUser(req);
      return json(res, 200, { orders: userOrders(user.id) });
    }
    if (req.method === 'GET' && url.pathname === '/api/costs') {
      const user = requireUser(req);
      return json(res, 200, { costs: loadCosts().filter(c => c.userId === user.id) });
    }
    if (req.method === 'POST' && url.pathname === '/api/costs') {
      const user = requireUser(req);
      const body = await parseBody(req);
      const items = Array.isArray(body.items) ? body.items : [];
      const all = loadCosts().filter(c => c.userId !== user.id);
      const map = new Map(loadCosts().filter(c => c.userId === user.id).map(c => [normalizeArticle(c.article), c]));
      for (const item of items) {
        const article = String(item.article || '').trim();
        if (!article) continue;
        map.set(normalizeArticle(article), { userId: user.id, article, cost: Number(item.cost || 0), packaging: Number(item.packaging || 0), logistics: Number(item.logistics || 0), taxPct: Number(item.taxPct || 0), adSpend: Number(item.adSpend || 0), updatedAt: new Date().toISOString() });
      }
      saveCosts(all.concat([...map.values()]));
      return json(res, 200, { ok: true, insights: buildOperationalInsights(user.id) });
    }
    if (req.method === 'GET' && url.pathname === '/api/ai/recommendations') {
      const user = requireUser(req);
      const insights = buildOperationalInsights(user.id);
      const base = insights.tasks.length ? insights.tasks.map(t => ({ priority: t.priority, title: t.title, text: `${t.text} Оценка эффекта: ₽${Number(t.moneyImpact || 0).toLocaleString('ru-RU')}.`, action: t.action, impact: t.type })) : ruleBasedRecommendations(url.searchParams.get('shopId') || 'all', user.id);
      const recommendations = await llmRecommendationsIfConfigured(base, user.id);
      return json(res, 200, { recommendations, insights, ai: (process.env.AI_API_KEY || process.env.OPENAI_API_KEY) ? 'llm-or-fallback' : 'rule-based' });
    }
    return json(res, 404, { error: 'API route not found' });
  } catch (e) {
    return json(res, e.status || 500, { error: e.message || String(e) });
  }
}

// Static files may live under different roots depending on how the bundle is laid out
// (local: ROOT; Vercel lambda: process.cwd() / included files). Try each candidate.
const STATIC_ROOTS = Array.from(new Set([ROOT, process.cwd()].filter(Boolean)));
const STATIC_FILES = new Set(['index.html', 'app.html', 'admin.html']);
function findStaticFile(relPath) {
  for (const base of STATIC_ROOTS) {
    const fp = path.join(base, relPath);
    if (fp.startsWith(base) && fs.existsSync(fp) && !fs.statSync(fp).isDirectory()) return fp;
  }
  return null;
}
function serveStatic(req, res, url) {
  let rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
  // Only serve known static assets; everything else falls back to the landing page.
  const baseName = rel.split('/').pop();
  let filePath = (STATIC_FILES.has(baseName) || /\.(css|js|json|png|jpe?g|svg|ico|woff2?)$/i.test(baseName)) ? findStaticFile(rel) : null;
  if (!filePath) filePath = findStaticFile('index.html');
  if (!filePath) return text(res, 404, 'Not found');
  const ext = path.extname(filePath).toLowerCase();
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8' };
  text(res, 200, fs.readFileSync(filePath), types[ext] || 'application/octet-stream');
}

async function handleRequest(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    return serveStatic(req, res, url);
  } catch (e) {
    if (!res.headersSent) json(res, 500, { error: e.message || String(e) });
  }
}

// Export the handler so it can be wrapped by a Vercel serverless function (api/index.js).
module.exports = handleRequest;

// Standalone mode: `node server.js` (local / any normal host). Skipped on serverless.
if (require.main === module) {
  ensureDataDir();
  const server = http.createServer(handleRequest);
  server.listen(PORT, () => {
    console.log(`SellerPilot AI running: http://localhost:${PORT}`);
    console.log('Data directory:', DATA_DIR);
    setInterval(checkTelegramSchedules, 60 * 1000);
    setTimeout(checkTelegramSchedules, 3000);
  });
}
