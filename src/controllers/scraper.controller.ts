import { Request, Response, NextFunction } from 'express';
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

/** Parse a price string like "Rs. 1,299" → 1299 (outer scope, used in Node) */
function parsePrice(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number' && !isNaN(v) && v > 0) return v;
  const s = String(v).replace(/[^\d.]/g, '');
  const n = parseFloat(s);
  return isNaN(n) || n <= 0 ? null : n;
}
void parsePrice; // used implicitly via type awareness

async function scrapeWithPuppeteer(url: string): Promise<DarazProduct> {
  const empty: DarazProduct = {
    name: '', price: null, originalPrice: null, description: '',
    images: [], rating: 0, reviewCount: 0, category: '', success: false,
  };

  let browser: Browser | null = null;
  const isVercel = !!process.env.VERCEL || process.env.NODE_ENV === 'production';
  console.log(`[Scraper] Starting. isVercel=${isVercel}`);

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

    // Block heavy assets to speed up load
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const rt = req.resourceType();
      if (['stylesheet', 'font', 'media'].includes(rt)) {
        req.abort();
      } else {
        req.continue();
      }
    });

    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    );
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    });

    // Clean URL
    const cleanUrl = url.split('?')[0].replace(/\/$/, '');
    const finalUrl = cleanUrl.endsWith('.html') ? cleanUrl : `${cleanUrl}.html`;
    console.log(`[Scraper] Navigating to: ${finalUrl}`);

    await page.goto(finalUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 45000,
    });

    // Give scripts time to run and inject data
    await new Promise(r => setTimeout(r, isVercel ? 4000 : 2000));

    // Try waiting for price element as a bonus (don't fail if missing)
    try {
      await page.waitForSelector('.pdp-price, [class*="pdp-product-price"], .pdp-mod-product-badge-price', { timeout: 6000 });
    } catch { /* continue anyway */ }

    const data = await page.evaluate(() => {
      const result = {
        name: '' as string,
        price: null as number | null,
        originalPrice: null as number | null,
        description: '' as string,
        images: [] as string[],
        rating: 0 as number,
        reviewCount: 0 as number,
        category: '' as string,
        debugSource: 'none' as string,
      };

      /* ---------- helpers (re-declared inside evaluate scope) ---------- */
      const parse = (v: unknown): number | null => {
        if (v === null || v === undefined) return null;
        if (typeof v === 'number' && !isNaN(v) && v > 0) return v;
        const s = String(v).replace(/[^\d.]/g, '');
        const n = parseFloat(s);
        return isNaN(n) || n <= 0 ? null : n;
      };

      const deepFind = (obj: unknown, keyRx: RegExp, depth = 0): number | null => {
        if (depth > 8 || !obj || typeof obj !== 'object') return null;
        for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
          if (keyRx.test(k)) { const n = parse(v); if (n !== null) return n; }
          const f = deepFind(v, keyRx, depth + 1);
          if (f !== null) return f;
        }
        return null;
      };

      const getText = (sel: string): string =>
        (document.querySelector(sel) as HTMLElement)?.innerText?.trim() || '';

      const getMeta = (n: string): string =>
        document.querySelector(`meta[name="${n}"], meta[property="${n}"]`)?.getAttribute('content') || '';

      /* ---------- 1. Extract every <script> tag into JSON candidates ---------- */
      const allScripts = Array.from(document.querySelectorAll('script'));
      const jsonCandidates: Record<string, unknown>[] = [];

      for (const s of allScripts) {
        const text = s.textContent || '';
        // Try __moduleData__
        const modMatch = text.match(/__moduleData__\s*=\s*(\{[\s\S]*?\});\s*(?:window|var|let|const|$)/);
        if (modMatch) {
          try { jsonCandidates.push(JSON.parse(modMatch[1])); } catch { /* skip */ }
        }
        // Try window.__INIT_DATA__ or window.pageData
        const initMatch = text.match(/window\.__(?:INIT_DATA|pageData|productData)__\s*=\s*(\{[\s\S]*?\});/);
        if (initMatch) {
          try { jsonCandidates.push(JSON.parse(initMatch[1])); } catch { /* skip */ }
        }
        // Try any large inline JSON containing "salePrice" or "skuInfos"
        if (text.includes('salePrice') || text.includes('skuInfos')) {
          const bigMatch = text.match(/=\s*(\{[\s\S]{200,}\})\s*;/);
          if (bigMatch) {
            try { jsonCandidates.push(JSON.parse(bigMatch[1])); } catch { /* skip */ }
          }
        }
      }

      /* ---------- 2. Extract from JSON candidates ---------- */
      for (const json of jsonCandidates) {
        // ---- Name ----
        if (!result.name) {
          const jRec = json as Record<string, unknown>;
          const jData = (jRec?.data as Record<string, unknown> | undefined);
          const jRoot = (jData?.root as Record<string, unknown> | undefined);
          const fields = (jRoot?.fields as Record<string, unknown> | undefined);
          const n =
            (fields?.product as Record<string, unknown> | undefined)?.title ??
            (fields?.product as Record<string, unknown> | undefined)?.name;
          if (typeof n === 'string' && n.length > 2) result.name = n;
        }

        // ---- Prices via deep key search ----
        if (!result.price) {
          // Try structured paths first
          const jData2 = ((json as Record<string, unknown>)?.data as Record<string, unknown> | undefined);
          const jRoot2 = (jData2?.root as Record<string, unknown> | undefined);
          const f: Record<string, unknown> = (jRoot2?.fields as Record<string, unknown> | undefined) ?? {};

          const skuInfos = (f.skuInfos || {}) as Record<string, Record<string, unknown>>;
          const firstSku = Object.values(skuInfos)[0] || {};
          const priceBlock = (firstSku.price || firstSku) as Record<string, unknown>;

          const candidatePrice = parse(
            (priceBlock?.salePrice as Record<string, unknown>)?.value ??
            (priceBlock?.price as Record<string, unknown>)?.value ??
            priceBlock?.salePrice ??
            priceBlock?.price ??
            priceBlock?.value
          );
          if (candidatePrice !== null) {
            result.price = candidatePrice;
            result.debugSource = 'skuInfos.price';
          }

          // Deep search fallback
          if (!result.price) {
            result.price = deepFind(json, /salePrice|sale_price/i) ??
              deepFind(json, /^price$/i);
            if (result.price) result.debugSource = 'deepFind.salePrice';
          }
        }

        if (!result.originalPrice) {
          result.originalPrice =
            deepFind(json, /originalPrice|original_price|retailPrice|retail_price/i) ?? null;
        }

        // ---- Rating ----
        if (!result.rating) {
          result.rating = (
            deepFind(json, /^average$|^ratingScore$|^averageRating$/i) ??
            deepFind(json, /^score$/i, 0) ??
            0
          ) as number;
        }

        // ---- Review count ----
        if (!result.reviewCount) {
          result.reviewCount = (
            deepFind(json, /reviewCount|review_count|totalReview|ratingCount/i) ?? 0
          ) as number;
        }

        // ---- Description ----
        if (!result.description) {
          // Search for string-type description fields
          const findStr = (obj: unknown, keyRx: RegExp, d = 0): string | null => {
            if (d > 8 || !obj || typeof obj !== 'object') return null;
            for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
              if (keyRx.test(k) && typeof v === 'string' && v.length > 5) return v;
              const f = findStr(v, keyRx, d + 1);
              if (f) return f;
            }
            return null;
          };
          const desc = findStr(json, /^desc$|^description$/i) ?? '';
          if (desc.length > 5) result.description = desc.slice(0, 1500);
        }
      }

      /* ---------- 3. DOM fallbacks ---------- */

      // Name from meta/DOM
      if (!result.name) {
        result.name =
          getMeta('og:title') ||
          getMeta('twitter:title') ||
          getText('h1.pdp-product-title') ||
          getText('.pdp-product-title') ||
          getText('h1') ||
          document.title.split('|')[0].trim();
      }

      // Price from DOM
      if (!result.price) {
        const priceSelectors = [
          '.pdp-price',
          '.pdp-price_type_normal',
          '[class*="pdp-price"]',
          '.pdp-mod-product-badge-price',
          '[data-price]',
          '.price-original',
          '.pdc-price',
        ];
        for (const sel of priceSelectors) {
          const el = document.querySelector(sel) as HTMLElement | null;
          if (el) {
            const p = parse(el.innerText || el.getAttribute('data-price') || '');
            if (p !== null) { result.price = p; break; }
          }
        }
        // Also try meta price
        if (!result.price) {
          result.price = parse(getMeta('product:price:amount') || getMeta('og:price:amount'));
        }
      }

      // Original price from DOM
      if (!result.originalPrice) {
        const origEl = document.querySelector('.pdp-price_type_deleted, [class*="price-del"], .pdp-price_type_original') as HTMLElement | null;
        if (origEl) result.originalPrice = parse(origEl.innerText);
      }

      // Rating from DOM
      if (!result.rating) {
        result.rating = parseFloat(
          getText('.score-average') ||
          getText('[class*="score-average"]') ||
          getText('.pdp-review-summary-score') ||
          getMeta('aggregateRating')
        ) || 0;
      }

      // Description from DOM
      if (!result.description) {
        const descEl =
          document.querySelector('.pdp-product-desc') ??
          document.querySelector('.html-content') ??
          document.querySelector('#product_detail') ??
          document.querySelector('[class*="product-desc"]');
        result.description = descEl?.textContent?.trim().slice(0, 1500) || '';
      }

      /* ---------- 4. Images ---------- */
      const imgUrls: string[] = [];

      // Try gallery thumbnails
      const thumbSelectors = [
        '.item-gallery__thumbnail img',
        '.pdp-mod-common-image img',
        '.gallery-preview-panel__content img',
        '[class*="gallery"] img',
        '[class*="thumbnail"] img',
      ];
      for (const sel of thumbSelectors) {
        document.querySelectorAll(sel).forEach((el) => {
          const img = el as HTMLImageElement;
          const src = img.src || img.dataset?.src || img.getAttribute('data-lazyload') || '';
          if (src && !src.includes('placeholder') && !src.includes('data:')) {
            // Upgrade to high-res
            const hq = src
              .replace(/_\d+x\d+\.(jpg|jpeg|png|webp)/i, '_800x800.$1')
              .split('?')[0];
            if (!imgUrls.includes(hq) && hq.startsWith('http')) imgUrls.push(hq);
          }
        });
        if (imgUrls.length > 0) break;
      }

      // Fallback: og:image
      if (imgUrls.length === 0) {
        const ogImg = getMeta('og:image');
        if (ogImg) imgUrls.push(ogImg);
      }

      result.images = imgUrls.slice(0, 8);

      return result;
    });

    console.log(`[Scraper] Done. name="${data.name}" price=${data.price} rating=${data.rating} imgs=${data.images.length} source=${data.debugSource}`);

    if (!data.name && !data.price) {
      return { ...empty, error: 'Failed to extract any data from Daraz. The page may be blocking headless browsers.' };
    }

    return {
      name: data.name,
      price: data.price,
      originalPrice: data.originalPrice,
      description: data.description,
      images: data.images,
      rating: data.rating,
      reviewCount: data.reviewCount,
      category: data.category,
      success: true,
    };

  } catch (err: unknown) {
    const error = err as Error;
    console.error(`[Scraper] Fatal error: ${error.message}`);
    return { ...empty, error: `Scraper error: ${error.message}` };
  } finally {
    if (browser) {
      try { await browser.close(); } catch { /* ignore */ }
    }
  }
}

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
      const data = await scrapeWithPuppeteer(url);
      res.json({ success: data.success, data });
    } catch (err) {
      next(err);
    }
  }
}

export const scraperController = new ScraperController();