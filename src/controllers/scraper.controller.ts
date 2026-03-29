import { Request, Response, NextFunction } from 'express';
import axios from 'axios';
import puppeteer, { Browser } from 'puppeteer-core';
import chromium from '@sparticuz/chromium';

interface DarazProduct {
  name: string;
  price: number | null;
  originalPrice: number | null;
  description: string;
  images: string[];
  rating: number;
  reviewCount: number;
  category: string;
  success: boolean;
  error?: string;
}

/* ═══════════════════════════════════════════════════════════════
   UTILITIES
═══════════════════════════════════════════════════════════════ */

/** Parse Any price value → integer NPR */
function parseNPR(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  let n: number;
  if (typeof v === 'number') {
    if (isNaN(v) || v <= 0) return null;
    n = v;
  } else {
    const s = String(v).replace(/[^\d.]/g, '');
    n = parseFloat(s);
    if (isNaN(n) || n <= 0) return null;
  }
  // Daraz sometimes stores 5500 as 0.55 (÷10000 scale)
  if (n > 0 && n < 100) n = Math.round(n * 10000);
  return n > 0 ? n : null;
}

/** Strip all HTML tags → plain text */
function stripHtml(raw: string): string {
  return raw
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|li|h\d|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#39;/gi, "'")
    .replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Balanced-bracket JSON extractor.
 * Handles both:  varName = {...}
 *            and varName = JSON.parse('...')
 */
function extractJsonBlock(html: string, varName: string): Record<string, unknown> | null {
  // Find assignment
  let pos = html.indexOf(`${varName} = `);
  if (pos === -1) pos = html.indexOf(`${varName}=`);
  if (pos === -1) return null;

  const after = html.slice(pos).replace(/^[^=]+=\s*/, ''); // everything after "="

  // Case A: JSON.parse('...')
  if (after.trimStart().startsWith('JSON.parse(')) {
    const quoteChar = after.includes("JSON.parse('") ? "'" : '"';
    const qStart = after.indexOf(quoteChar, after.indexOf('JSON.parse(') + 11);
    if (qStart === -1) return null;
    let i = qStart + 1;
    let escaped = false;
    while (i < after.length) {
      if (escaped) { escaped = false; i++; continue; }
      if (after[i] === '\\') { escaped = true; i++; continue; }
      if (after[i] === quoteChar) break;
      i++;
    }
    try { return JSON.parse(after.slice(qStart + 1, i)); } catch { return null; }
  }

  // Case B: inline JSON object {...}
  const jsonStart = after.indexOf('{');
  if (jsonStart === -1) return null;

  let depth = 0;
  let inStr = false;
  let esc = false;

  for (let i = jsonStart; i < after.length; i++) {
    const c = after[i];
    if (esc) { esc = false; continue; }
    if (c === '\\' && inStr) { esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(after.slice(jsonStart, i + 1)); } catch { return null; }
      }
    }
  }
  return null;
}

/** Deep find a NUMBER value by key regex (depth limited) */
function deepNum(obj: unknown, rx: RegExp, d = 0): number | null {
  if (d > 12 || !obj || typeof obj !== 'object') return null;
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (rx.test(k) && typeof v === 'number' && !isNaN(v) && v > 0) return v;
    const r = deepNum(v, rx, d + 1);
    if (r !== null) return r;
  }
  return null;
}

/** Deep find a STRING value by key regex (depth limited) */
function deepStr(obj: unknown, rx: RegExp, d = 0): string | null {
  if (d > 12 || !obj || typeof obj !== 'object') return null;
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (rx.test(k) && typeof v === 'string' && v.trim().length > 10) return v.trim();
    const r = deepStr(v, rx, d + 1);
    if (r) return r;
  }
  return null;
}

/* ═══════════════════════════════════════════════════════════════
   STRATEGY 1 — JSON-LD  (cleanest, machine-readable)
═══════════════════════════════════════════════════════════════ */

function parseJsonLd(html: string): Partial<DarazProduct> {
  const out: Partial<DarazProduct> = {};
  const rx = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;

  while ((m = rx.exec(html)) !== null) {
    try {
      const doc = JSON.parse(m[1]) as Record<string, unknown>;
      if (doc['@type'] !== 'Product') continue;

      if (!out.name && typeof doc.name === 'string') out.name = doc.name;

      const offers = doc.offers as Record<string, unknown> | undefined;
      if (offers) {
        if (!out.price) out.price = parseNPR(offers.price ?? offers.lowPrice);
        if (!out.originalPrice) out.originalPrice = parseNPR(offers.originalPrice ?? offers.highPrice);
      }

      const agg = doc.aggregateRating as Record<string, unknown> | undefined;
      if (agg) {
        if (!out.rating) out.rating = parseFloat(String(agg.ratingValue)) || 0;
        if (!out.reviewCount) out.reviewCount = parseInt(String(agg.reviewCount ?? agg.ratingCount ?? '0')) || 0;
      }

      const imgs = doc.image as unknown;
      if (Array.isArray(imgs) && imgs.length > 0 && !out.images?.length) {
        out.images = (imgs as string[]).filter(u => typeof u === 'string').slice(0, 8);
      } else if (typeof imgs === 'string' && !out.images?.length) {
        out.images = [imgs];
      }
    } catch { /* skip */ }
  }

  console.log(`[JSON-LD] price=${out.price} rating=${out.rating} reviews=${out.reviewCount}`);
  return out;
}

/* ═══════════════════════════════════════════════════════════════
   STRATEGY 2 — Targeted regex directly on raw HTML
   (Works even when full JSON parse fails)
═══════════════════════════════════════════════════════════════ */

function parseByRegex(html: string): Partial<DarazProduct> {
  const out: Partial<DarazProduct> = {};

  // ── Price: match "salePrice":{"value":5500  OR  "salePrice":"5500"
  const saleRx = /"salePrice"\s*:\s*(?:\{[^}]*"value"\s*:\s*([\d.]+)|"?([\d.]+)"?)/;
  const saleM = html.match(saleRx);
  if (saleM) out.price = parseNPR(saleM[1] ?? saleM[2]);

  // ── Original price
  const origRx = /"originalPrice"\s*:\s*(?:\{[^}]*"value"\s*:\s*([\d.]+)|"?([\d.]+)"?)/;
  const origM = html.match(origRx);
  if (origM) out.originalPrice = parseNPR(origM[1] ?? origM[2]);

  // ── Rating: "ratingScore":"4.7" or "averageScore":4.7 or "average":4.7
  const ratingRx = /"(?:ratingScore|averageScore|average|rating)"\s*:\s*"?([\d.]+)"?/;
  const ratingM = html.match(ratingRx);
  if (ratingM) {
    const r = parseFloat(ratingM[1]);
    if (r > 0 && r <= 5) out.rating = r;
  }

  // ── Review count
  const countRx = /"(?:reviewCount|totalReview|ratingCount|review_count)"\s*:\s*(\d+)/;
  const countM = html.match(countRx);
  if (countM) out.reviewCount = parseInt(countM[1]);

  // ── Product name from <title> or og:title
  if (!out.name) {
    const titleM = html.match(/<title>([^<]+)<\/title>/i);
    if (titleM) out.name = titleM[1].split('|')[0].split('-')[0].trim();
  }

  console.log(`[Regex] price=${out.price} rating=${out.rating} reviews=${out.reviewCount}`);
  return out;
}

/* ═══════════════════════════════════════════════════════════════
   STRATEGY 3 — __moduleData__ JSON parse (comprehensive)
═══════════════════════════════════════════════════════════════ */

function parseModuleData(html: string): Partial<DarazProduct> {
  const out: Partial<DarazProduct> = {};

  const blob = extractJsonBlock(html, '__moduleData__');
  if (!blob) {
    console.log('[moduleData] NOT FOUND in HTML');
    return out;
  }
  console.log('[moduleData] Found, extracting...');

  const jData = blob?.data as Record<string, unknown> | undefined;
  const jRoot = jData?.root as Record<string, unknown> | undefined;
  const f = jRoot?.fields as Record<string, unknown> | undefined;

  if (!f) {
    console.log('[moduleData] fields missing from blob');
    return out;
  }

  // ── Name
  const prod = f.product as Record<string, unknown> | undefined;
  const title = (prod?.title ?? prod?.name ?? prod?.displayName) as string | undefined;
  if (typeof title === 'string' && title.length > 2) out.name = title;

  // ── Price via skuInfos
  const skuInfos = (f.skuInfos ?? {}) as Record<string, Record<string, unknown>>;
  const skuIds = Object.keys(skuInfos);
  if (skuIds.length > 0) {
    const sku = skuInfos[skuIds[0]] ?? {};
    const priceObj = (sku.price ?? sku) as Record<string, unknown>;

    const sp = priceObj.salePrice as Record<string, unknown> | undefined;
    const op = priceObj.originalPrice as Record<string, unknown> | undefined;

    const rawSale = sp?.value ?? priceObj.price ?? priceObj.salePrice;
    const rawOrig = op?.value ?? priceObj.originalPrice;

    if (!out.price) out.price = parseNPR(rawSale);
    if (!out.originalPrice) out.originalPrice = parseNPR(rawOrig);
  }

  // ── Price deep search (in case skuInfos path failed)
  if (!out.price) {
    const pNum = deepNum(f, /^salePrice$/i);
    if (pNum !== null) out.price = parseNPR(pNum);
  }

  // ── Rating from review section
  const review = (f.review ?? f.reviews ?? f.ratings) as Record<string, unknown> | undefined;
  if (review) {
    const ratBlock = (review.ratings ?? review) as Record<string, unknown>;
    const avg = ratBlock.average ?? ratBlock.averageScore ?? ratBlock.ratingScore ?? ratBlock.score;
    const cnt = ratBlock.reviewCount ?? ratBlock.totalReview ?? ratBlock.count ?? ratBlock.ratingCount;
    if (!out.rating && typeof avg === 'number' && avg > 0 && avg <= 5) out.rating = avg;
    if (!out.reviewCount && typeof cnt === 'number') out.reviewCount = cnt;
  }

  // Deep search fallback for rating
  if (!out.rating) {
    const r = deepNum(f, /^(?:average|averageScore|ratingScore|score)$/i);
    if (r !== null && r > 0 && r <= 5) out.rating = r;
  }
  if (!out.reviewCount) {
    const c = deepNum(f, /^(?:reviewCount|totalReview|ratingCount|count)$/i);
    if (c !== null) out.reviewCount = c;
  }

  // ── Description: highlights + desc, combined
  const descParts: string[] = [];

  const highlights = prod?.highlights;
  if (Array.isArray(highlights) && highlights.length > 0) {
    const bullets = (highlights as unknown[])
      .map((h) => (typeof h === 'string' ? h : (h as Record<string, unknown>)?.text as string) ?? '')
      .filter(Boolean);
    if (bullets.length > 0) descParts.push(bullets.join('\n'));
  }

  const rawDesc = (prod?.description ?? prod?.desc ?? prod?.longDescription) as string | undefined;
  if (typeof rawDesc === 'string' && rawDesc.length > 10) {
    const clean = stripHtml(rawDesc);
    // Avoid duplication if paragraph already in highlights
    if (!descParts.some(p => p.includes(clean.slice(0, 40)))) {
      descParts.push(clean);
    }
  }

  if (descParts.length === 0) {
    // last resort deep search
    const d = deepStr(f, /^(?:desc|description|longDescription)$/i);
    if (d) descParts.push(stripHtml(d));
  }

  if (descParts.length > 0) out.description = descParts.join('\n\n').slice(0, 2500);

  // ── Images from skuInfos
  const imgs: string[] = [];
  for (const id of skuIds.slice(0, 3)) {
    const sku = skuInfos[id] ?? {};
    const skuImgs = (sku.skuImages ?? sku.images) as unknown[] | undefined;
    if (Array.isArray(skuImgs)) {
      for (const img of skuImgs) {
        const src = typeof img === 'string' ? img
          : ((img as Record<string, unknown>)?.url ?? (img as Record<string, unknown>)?.src) as string | undefined;
        if (typeof src === 'string' && src.startsWith('http') && !imgs.includes(src)) {
          imgs.push(src.replace(/_\d+x\d+\.(jpg|jpeg|png|webp)/i, '_800x800.$1').split('?')[0]);
        }
      }
    }
  }
  if (imgs.length > 0 && !out.images?.length) out.images = imgs.slice(0, 8);

  console.log(`[moduleData] price=${out.price} rating=${out.rating} reviews=${out.reviewCount} desc=${out.description?.length ?? 0}ch`);
  return out;
}

/* ═══════════════════════════════════════════════════════════════
   STRATEGY 4 — Description from raw HTML (regex on DOM content)
═══════════════════════════════════════════════════════════════ */

function parseDescriptionFromHtml(html: string): string {
  // Daraz renders description content server-side in html-content divs
  const patterns = [
    /class="[^"]*html-content[^"]*"[^>]*>([\s\S]{50,5000}?)<\/div>/i,
    /id="product_detail"[^>]*>([\s\S]{50,5000}?)<\/div>/i,
    /class="[^"]*pdp-product-desc[^"]*"[^>]*>([\s\S]{50,5000}?)<\/div>/i,
  ];

  for (const rx of patterns) {
    const m = html.match(rx);
    if (m) {
      const clean = stripHtml(m[1]);
      if (clean.length > 30) return clean.slice(0, 2500);
    }
  }
  return '';
}

/* ═══════════════════════════════════════════════════════════════
   PRIMARY FETCHER — axios (no browser fingerprint)
═══════════════════════════════════════════════════════════════ */

async function fetchAndParse(url: string): Promise<{ data: Partial<DarazProduct>; html: string }> {
  const cleanUrl = url.split('?')[0].replace(/\/$/, '');
  const finalUrl = cleanUrl.endsWith('.html') ? cleanUrl : `${cleanUrl}.html`;
  console.log(`[Axios] GET ${finalUrl}`);

  const { data: html } = await axios.get<string>(finalUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'Cache-Control': 'no-cache',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Upgrade-Insecure-Requests': '1',
    },
    timeout: 20000,
    maxRedirects: 5,
  });

  console.log(`[Axios] HTML length=${html.length}`);

  // Log a snippet to debug what's in the HTML
  const moduleIdx = html.indexOf('__moduleData__');
  console.log(`[Axios] __moduleData__ found=${moduleIdx !== -1} (pos=${moduleIdx})`);

  // Run all strategies, merge results (first non-null wins per field)
  const ldData = parseJsonLd(html);
  const regexData = parseByRegex(html);
  const modData = parseModuleData(html);

  const out: Partial<DarazProduct> = {};

  const merge = (field: keyof DarazProduct, ...sources: Partial<DarazProduct>[]): void => {
    for (const src of sources) {
      const v = src[field];
      if (v !== undefined && v !== null && v !== '' && v !== 0) {
        (out as Record<string, unknown>)[field] = v;
        return;
      }
    }
  };

  // Priority: JSON-LD (most reliable) → moduleData (structure) → regex (fallback)
  merge('name', ldData, modData, regexData);
  merge('price', ldData, modData, regexData);
  merge('originalPrice', ldData, modData, regexData);
  merge('rating', ldData, modData, regexData);
  merge('reviewCount', ldData, modData, regexData);
  merge('images', ldData, modData);

  // Description: moduleData is best (structured), regex on HTML as fallback
  out.description = modData.description || parseDescriptionFromHtml(html);

  return { data: out, html };
}

/* ═══════════════════════════════════════════════════════════════
   FALLBACK — Puppeteer (images only)
═══════════════════════════════════════════════════════════════ */

async function getImagesWithPuppeteer(url: string): Promise<string[]> {
  const isVercel = !!process.env.VERCEL || process.env.NODE_ENV === 'production';
  let browser: Browser | null = null;

  try {
    browser = await puppeteer.launch({
      args: [
        ...(isVercel ? chromium.args : []),
        '--no-sandbox', '--disable-setuid-sandbox',
        '--disable-dev-shm-usage', '--disable-gpu',
        '--single-process', '--no-zygote',
      ],
      defaultViewport: { width: 1280, height: 800 },
      executablePath: isVercel
        ? await chromium.executablePath()
        : (process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'),
      headless: true,
    });

    const page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      if (['stylesheet', 'font', 'media'].includes(req.resourceType())) req.abort();
      else req.continue();
    });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

    const cleanUrl = url.split('?')[0].replace(/\/$/, '');
    const finalUrl = cleanUrl.endsWith('.html') ? cleanUrl : `${cleanUrl}.html`;

    await page.goto(finalUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });
    await new Promise(r => setTimeout(r, isVercel ? 4000 : 1500));

    return await page.evaluate(() => {
      const found: string[] = [];
      const sels = ['.item-gallery__thumbnail img', '.pdp-mod-common-image img', '[class*="gallery"] img', '[class*="thumbnail"] img'];
      for (const sel of sels) {
        document.querySelectorAll(sel).forEach((el) => {
          const img = el as HTMLImageElement;
          const src = img.src || img.dataset?.src || img.getAttribute('data-lazyload') || '';
          if (src && !src.includes('placeholder') && !src.includes('data:') && src.startsWith('http')) {
            const hq = src.replace(/_\d+x\d+\.(jpg|jpeg|png|webp)/i, '_800x800.$1').split('?')[0];
            if (!found.includes(hq)) found.push(hq);
          }
        });
        if (found.length) break;
      }
      return found.slice(0, 8);
    });
  } catch (e) {
    console.log('[Puppeteer/Images] Failed:', (e as Error).message);
    return [];
  } finally {
    if (browser) try { await browser.close(); } catch { /* ignore */ }
  }
}

/* ═══════════════════════════════════════════════════════════════
   MAIN SCRAPER
═══════════════════════════════════════════════════════════════ */

async function scrape(url: string): Promise<DarazProduct> {
  const empty: DarazProduct = {
    name: '', price: null, originalPrice: null, description: '',
    images: [], rating: 0, reviewCount: 0, category: '', success: false,
  };

  let axiosData: Partial<DarazProduct> = {};
  let axiosHtml = '';

  try {
    const { data, html } = await fetchAndParse(url);
    axiosData = data;
    axiosHtml = html;
  } catch (e) {
    console.log('[Scraper] Axios failed:', (e as Error).message);
  }

  // Get images: prefer axios result, fallback puppeteer
  let images = axiosData.images ?? [];
  if (images.length === 0) {
    console.log('[Scraper] No images from axios, trying puppeteer…');
    images = await getImagesWithPuppeteer(url);
  }

  // If og:image available in HTML, use as fallback
  if (images.length === 0 && axiosHtml) {
    const ogImg = axiosHtml.match(/property="og:image"\s+content="([^"]+)"/)?.[1]
      ?? axiosHtml.match(/content="([^"]+)"\s+property="og:image"/)?.[1];
    if (ogImg) images = [ogImg];
  }

  const result: DarazProduct = {
    name: axiosData.name ?? '',
    price: axiosData.price ?? null,
    originalPrice: axiosData.originalPrice ?? null,
    description: axiosData.description ?? '',
    images,
    rating: axiosData.rating ?? 0,
    reviewCount: axiosData.reviewCount ?? 0,
    category: axiosData.category ?? '',
    success: false,
  };

  console.log(`[Scraper] FINAL: name="${result.name}" price=${result.price} origPrice=${result.originalPrice} rating=${result.rating} reviews=${result.reviewCount} imgs=${result.images.length} descLen=${result.description.length}`);

  if (!result.name && result.price === null) {
    return { ...empty, error: 'Could not extract product data. Daraz may be blocking or the page structure changed.' };
  }

  result.success = true;
  return result;
}

/* ═══════════════════════════════════════════════════════════════
   DEBUG ENDPOINT — logs raw extraction to Vercel logs
═══════════════════════════════════════════════════════════════ */

export async function debugScrape(req: Request, res: Response): Promise<void> {
  const { url } = req.query as { url?: string };
  if (!url) { res.status(400).json({ error: 'url query param required' }); return; }

  try {
    const cleanUrl = (url as string).split('?')[0].replace(/\/$/, '');
    const finalUrl = cleanUrl.endsWith('.html') ? cleanUrl : `${cleanUrl}.html`;

    const { data: html } = await axios.get<string>(finalUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      timeout: 20000,
    });

    const hasModuleData = html.includes('__moduleData__');
    const hasSkuInfos = html.includes('skuInfos');
    const hasSalePrice = html.includes('salePrice');
    const hasRatingScore = html.includes('ratingScore') || html.includes('averageScore');
    const hasJsonLd = html.includes('application/ld+json');

    // Try to extract moduleData JSON
    const blob = extractJsonBlock(html, '__moduleData__');

    // Get a snippet of what's around salePrice
    const spIdx = html.indexOf('"salePrice"');
    const spSnippet = spIdx !== -1 ? html.slice(Math.max(0, spIdx - 20), spIdx + 80) : 'NOT FOUND';

    const rIdx = html.indexOf('"ratingScore"');
    const rSnippet = rIdx !== -1 ? html.slice(Math.max(0, rIdx - 10), rIdx + 60) : 'NOT FOUND';

    res.json({
      htmlLength: html.length,
      hasModuleData,
      hasSkuInfos,
      hasSalePrice,
      hasRatingScore,
      hasJsonLd,
      moduleDataParsed: blob !== null,
      moduleDataKeys: blob ? Object.keys(blob) : [],
      salePriceSnippet: spSnippet,
      ratingSnippet: rSnippet,
      ldData: parseJsonLd(html),
      regexData: parseByRegex(html),
      modDataSummary: blob ? { 
        hasFields: !!(blob?.data as Record<string,unknown>)?.root,
        parsed: parseModuleData(html)
      } : null,
    });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
}

/* ═══════════════════════════════════════════════════════════════
   CONTROLLER
═══════════════════════════════════════════════════════════════ */

export class ScraperController {
  async fetchDarazProduct(req: Request, res: Response, next: NextFunction) {
    try {
      const { url } = req.body as { url?: string };
      if (!url || typeof url !== 'string') {
        res.status(400).json({ success: false, message: 'URL is required' });
        return;
      }
      if (!url.includes('daraz.com')) {
        res.status(400).json({ success: false, message: 'Only Daraz URLs are supported' });
        return;
      }
      const data = await scrape(url);
      res.json({ success: data.success, data });
    } catch (err) {
      next(err);
    }
  }
}

export const scraperController = new ScraperController();