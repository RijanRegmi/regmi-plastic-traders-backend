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

/* ─────────── Utilities ─────────── */

/**
 * Balanced-bracket JSON extractor.
 * Finds the variable assignment in raw HTML and extracts the full JSON value
 * by counting braces — handles any size JSON without regex truncation.
 */
function extractJsonBlock(html: string, varName: string): Record<string, unknown> | null {
  // Look for: varName = { OR varName={
  const markers = [`${varName} = `, `${varName}=`, `"${varName}":`];
  let jsonStart = -1;

  for (const marker of markers) {
    const idx = html.indexOf(marker);
    if (idx !== -1) {
      jsonStart = html.indexOf('{', idx + marker.length - 1);
      if (jsonStart !== -1) break;
    }
  }
  if (jsonStart === -1) return null;

  // Walk forward counting braces, respecting strings
  let depth = 0;
  let inStr = false;
  let escape = false;

  for (let i = jsonStart; i < html.length; i++) {
    const c = html[i];
    if (escape) { escape = false; continue; }
    if (c === '\\' && inStr) { escape = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(jsonStart, i + 1)) as Record<string, unknown>;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/**
 * Parse a Daraz price value into NPR integer.
 *
 * Daraz's internal JSON sometimes stores prices as:
 *   - integer:  5500   (already NPR)
 *   - decimal:  0.55   (÷10000 scaling → × 10000 = 5500)
 *   - string:   "5,500" or "Rs. 5,500"
 */
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
  // Scale-up: values < 10 are stored in 1/10000 rupee units
  if (n > 0 && n < 10) n = Math.round(n * 10000);
  return n > 0 ? n : null;
}

/** Convert HTML markup to clean plain text */
function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Recursively find first numeric value at any key matching a regex */
function deepFindNum(obj: unknown, keyRx: RegExp, d = 0): number | null {
  if (d > 10 || !obj || typeof obj !== 'object') return null;
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (keyRx.test(k) && typeof v === 'number' && !isNaN(v) && v > 0) return v;
    const found = deepFindNum(v, keyRx, d + 1);
    if (found !== null) return found;
  }
  return null;
}

/** Recursively find first string value at any key matching a regex */
function deepFindStr(obj: unknown, keyRx: RegExp, d = 0): string | null {
  if (d > 10 || !obj || typeof obj !== 'object') return null;
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (keyRx.test(k) && typeof v === 'string' && v.trim().length > 5) return v.trim();
    const found = deepFindStr(v, keyRx, d + 1);
    if (found) return found;
  }
  return null;
}

/** Extract all product data from a parsed __moduleData__ blob */
function extractFromModuleData(blob: Record<string, unknown>): Partial<DarazProduct> {
  const result: Partial<DarazProduct> = {};
  const log: string[] = [];

  const jData = blob?.data as Record<string, unknown> | undefined;
  const jRoot = jData?.root as Record<string, unknown> | undefined;
  const f = jRoot?.fields as Record<string, unknown> | undefined;

  if (!f) {
    log.push('fields not found in blob');
    console.log('[Scraper/Parser]', log.join(' | '));
    return result;
  }

  // ── Name ──────────────────────────────────────────────────────────────────
  const prod = f.product as Record<string, unknown> | undefined;
  const name = (prod?.title ?? prod?.name ?? prod?.displayName) as string | undefined;
  if (typeof name === 'string' && name.length > 2) {
    result.name = name;
    log.push(`name="${name}"`);
  }

  // ── Price ─────────────────────────────────────────────────────────────────
  const skuInfos = (f.skuInfos ?? {}) as Record<string, Record<string, unknown>>;
  const firstSkuId = Object.keys(skuInfos)[0];
  if (firstSkuId) {
    const sku = skuInfos[firstSkuId] ?? {};
    const priceObj = (sku.price ?? sku) as Record<string, unknown>;

    // Try deeply nested salePrice.value, originalPrice.value first
    const salePriceBlock = priceObj?.salePrice as Record<string, unknown> | undefined;
    const origPriceBlock = priceObj?.originalPrice as Record<string, unknown> | undefined;

    const rawSale = salePriceBlock?.value
      ?? priceObj?.price
      ?? priceObj?.salePrice
      ?? priceObj?.value;

    const rawOrig = origPriceBlock?.value
      ?? priceObj?.originalPrice
      ?? priceObj?.retailPrice;

    const pSale = parseNPR(rawSale);
    const pOrig = parseNPR(rawOrig);

    if (pSale !== null) { result.price = pSale; log.push(`price=${pSale} (raw=${rawSale})`); }
    if (pOrig !== null) { result.originalPrice = pOrig; log.push(`origPrice=${pOrig}`); }
  }

  // Deep-search fallback for price if structured path failed
  if (!result.price) {
    const p = deepFindNum(f, /^salePrice$|^sale_price$/i);
    if (p !== null) { result.price = parseNPR(p); log.push(`price via deepFind=${p}`); }
  }

  // ── Rating & Review Count ─────────────────────────────────────────────────
  // Daraz typically stores under f.review.ratings.* or f.review.*
  const reviewSection = (f.review ?? f.reviews ?? f.rating) as Record<string, unknown> | undefined;
  if (reviewSection) {
    const ratingsBlock = (reviewSection.ratings ?? reviewSection) as Record<string, unknown>;

    const avg = ratingsBlock.average
      ?? ratingsBlock.averageScore
      ?? ratingsBlock.ratingScore
      ?? ratingsBlock.score
      ?? reviewSection.average
      ?? reviewSection.score;

    const cnt = ratingsBlock.reviewCount
      ?? ratingsBlock.totalReview
      ?? ratingsBlock.count
      ?? ratingsBlock.ratingCount
      ?? reviewSection.reviewCount
      ?? reviewSection.totalReview
      ?? reviewSection.count;

    if (typeof avg === 'number' && avg > 0 && avg <= 5) {
      result.rating = avg;
      log.push(`rating=${avg}`);
    }
    if (typeof cnt === 'number' && cnt >= 0) {
      result.reviewCount = cnt;
      log.push(`reviewCount=${cnt}`);
    }
  }

  // Deep-search fallback for rating
  if (!result.rating) {
    const r = deepFindNum(f, /^average$|^averageScore$|^ratingScore$/i);
    if (r !== null && r > 0 && r <= 5) {
      result.rating = r;
      log.push(`rating via deepFind=${r}`);
    }
  }
  if (!result.reviewCount) {
    const c = deepFindNum(f, /^reviewCount$|^totalReview$|^ratingCount$/i);
    if (c !== null) {
      result.reviewCount = c;
      log.push(`reviewCount via deepFind=${c}`);
    }
  }

  // ── Description ───────────────────────────────────────────────────────────
  // Daraz description is almost always HTML in product.description or product.desc
  const rawDesc = (prod?.description ?? prod?.desc ?? prod?.longDescription) as string | undefined;
  if (typeof rawDesc === 'string' && rawDesc.length > 10) {
    result.description = stripHtml(rawDesc).slice(0, 2000);
    log.push('desc from product.description');
  }

  // Highlights array as fallback
  if (!result.description) {
    const highlights = prod?.highlights;
    if (Array.isArray(highlights) && highlights.length > 0) {
      result.description = (highlights as unknown[])
        .map((h) => typeof h === 'string' ? h : (h as Record<string, unknown>)?.text as string ?? '')
        .filter(Boolean)
        .join('\n');
      log.push('desc from highlights');
    }
  }

  // Deep string search as last resort
  if (!result.description) {
    const d = deepFindStr(f, /^desc$|^description$|^longDescription$/i);
    if (d && d.length > 10) {
      result.description = stripHtml(d).slice(0, 2000);
      log.push('desc via deepFindStr');
    }
  }

  // ── Images ────────────────────────────────────────────────────────────────
  // Try skuImages from the first SKU
  const imgs: string[] = [];
  if (firstSkuId) {
    const sku = skuInfos[firstSkuId] ?? {};
    const skuImgs = (sku.skuImages ?? sku.images) as unknown[] | undefined;
    if (Array.isArray(skuImgs)) {
      for (const img of skuImgs) {
        const src = typeof img === 'string' ? img
          : ((img as Record<string, unknown>)?.url ?? (img as Record<string, unknown>)?.src) as string | undefined;
        if (typeof src === 'string' && src.startsWith('http')) {
          const hq = src.replace(/_\d+x\d+\.(jpg|jpeg|png|webp)/i, '_800x800.$1').split('?')[0];
          if (!imgs.includes(hq)) imgs.push(hq);
        }
      }
    }
  }

  // Also try product.images
  if (imgs.length === 0) {
    const pImgs = prod?.images as unknown[] | undefined;
    if (Array.isArray(pImgs)) {
      for (const img of pImgs) {
        const src = typeof img === 'string' ? img
          : ((img as Record<string, unknown>)?.url ?? (img as Record<string, unknown>)?.src) as string | undefined;
        if (typeof src === 'string' && src.startsWith('http')) imgs.push(src);
      }
    }
  }

  if (imgs.length > 0) {
    result.images = imgs.slice(0, 8);
    log.push(`images=${imgs.length}`);
  }

  console.log('[Scraper/Parser] Extracted:', log.join(' | '));
  return result;
}

/* ─────────── Primary: Axios strategy ─────────── */

async function fetchDataWithAxios(url: string): Promise<Partial<DarazProduct>> {
  const cleanUrl = url.split('?')[0].replace(/\/$/, '');
  const finalUrl = cleanUrl.endsWith('.html') ? cleanUrl : `${cleanUrl}.html`;

  console.log(`[Scraper/Axios] Fetching: ${finalUrl}`);

  const { data: html } = await axios.get<string>(finalUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Upgrade-Insecure-Requests': '1',
    },
    timeout: 25000,
    maxRedirects: 5,
  });

  console.log(`[Scraper/Axios] HTML received, length=${html.length}`);

  const result: Partial<DarazProduct> = {};

  // Try to extract __moduleData__
  const moduleData = extractJsonBlock(html, '__moduleData__');
  if (moduleData) {
    console.log('[Scraper/Axios] __moduleData__ found, parsing…');
    Object.assign(result, extractFromModuleData(moduleData));
  } else {
    console.log('[Scraper/Axios] __moduleData__ NOT found in HTML');
  }

  // Fallback: parse meta tags from HTML for name/price/image
  if (!result.name) {
    const ogTitle = html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i)?.[1]
      ?? html.match(/<meta[^>]+name="og:title"[^>]+content="([^"]+)"/i)?.[1];
    if (ogTitle) result.name = ogTitle;
  }

  if (!result.price) {
    const metaPrice = html.match(/<meta[^>]+property="product:price:amount"[^>]+content="([^"]+)"/i)?.[1];
    if (metaPrice) result.price = parseNPR(metaPrice);
  }

  if (!result.images || result.images.length === 0) {
    const ogImage = html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i)?.[1];
    if (ogImage) result.images = [ogImage];
  }

  return result;
}

/* ─────────── Fallback: Puppeteer (for images & DOM scraping) ─────────── */

async function fetchImagesWithPuppeteer(url: string): Promise<string[]> {
  const isVercel = !!process.env.VERCEL || process.env.NODE_ENV === 'production';
  let browser: Browser | null = null;

  try {
    browser = await puppeteer.launch({
      args: [
        ...(isVercel ? chromium.args : []),
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--single-process',
        '--no-zygote',
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
      const rt = req.resourceType();
      if (['stylesheet', 'font', 'media'].includes(rt)) req.abort();
      else req.continue();
    });

    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    );

    const cleanUrl = url.split('?')[0].replace(/\/$/, '');
    const finalUrl = cleanUrl.endsWith('.html') ? cleanUrl : `${cleanUrl}.html`;

    await page.goto(finalUrl, { waitUntil: 'domcontentloaded', timeout: 40000 });
    await new Promise(r => setTimeout(r, isVercel ? 4000 : 1500));

    const imgs = await page.evaluate(() => {
      const found: string[] = [];
      const selectors = [
        '.item-gallery__thumbnail img',
        '.pdp-mod-common-image img',
        '.gallery-preview-panel__content img',
        '[class*="gallery"] img',
        '[class*="thumbnail"] img',
      ];
      for (const sel of selectors) {
        document.querySelectorAll(sel).forEach((el) => {
          const img = el as HTMLImageElement;
          const src = img.src || img.dataset?.src || img.getAttribute('data-lazyload') || '';
          if (src && !src.includes('placeholder') && !src.includes('data:') && src.startsWith('http')) {
            const hq = src.replace(/_\d+x\d+\.(jpg|jpeg|png|webp)/i, '_800x800.$1').split('?')[0];
            if (!found.includes(hq)) found.push(hq);
          }
        });
        if (found.length > 0) break;
      }
      return found;
    });

    return imgs.slice(0, 8);
  } catch (e) {
    console.log('[Scraper/Puppeteer] Image fetch failed:', (e as Error).message);
    return [];
  } finally {
    if (browser) { try { await browser.close(); } catch { /* ignore */ } }
  }
}

/* ─────────── Main Orchestrator ─────────── */

async function scrape(url: string): Promise<DarazProduct> {
  const empty: DarazProduct = {
    name: '', price: null, originalPrice: null, description: '',
    images: [], rating: 0, reviewCount: 0, category: '', success: false,
  };

  let axiosData: Partial<DarazProduct> = {};

  try {
    axiosData = await fetchDataWithAxios(url);
  } catch (e) {
    console.log('[Scraper] Axios strategy failed:', (e as Error).message);
  }

  // Fetch images via Puppeteer if axios didn't find any
  let images = axiosData.images ?? [];
  if (images.length === 0) {
    console.log('[Scraper] No images from axios, trying puppeteer…');
    images = await fetchImagesWithPuppeteer(url);
  }

  const merged: DarazProduct = {
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

  if (!merged.name && merged.price === null) {
    return {
      ...empty,
      error: 'Could not extract product data from Daraz. The page may have changed or is blocking requests.',
    };
  }

  merged.success = true;
  console.log(
    `[Scraper] Final: name="${merged.name}" price=${merged.price} ` +
    `origPrice=${merged.originalPrice} rating=${merged.rating} ` +
    `reviews=${merged.reviewCount} imgs=${merged.images.length}`
  );
  return merged;
}

/* ─────────── Controller ─────────── */

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