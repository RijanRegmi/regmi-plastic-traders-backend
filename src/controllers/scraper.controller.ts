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

    // Clean URL — no query params
    const cleanUrl = url.split('?')[0].replace(/\/$/, '');
    const finalUrl = cleanUrl.endsWith('.html') ? cleanUrl : `${cleanUrl}.html`;
    console.log(`[Scraper] Navigating to: ${finalUrl}`);

    await page.goto(finalUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });

    // Give inline scripts time to execute and populate data
    await new Promise(r => setTimeout(r, isVercel ? 5000 : 2000));

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
        debugLog: [] as string[],
      };

      /* ─── Helpers ─── */

      /**
       * Parse a raw price value.
       * Daraz's __moduleData__ stores prices in 1/100 paise units (÷10000 of rupees).
       * So Rs 5,500 is stored as 0.55 → we multiply back by 10,000.
       * If a string like "Rs. 5,500" is given, we strip non-digit chars.
       */
      const parseNPR = (v: unknown): number | null => {
        if (v === null || v === undefined) return null;
        let n: number;
        if (typeof v === 'number') {
          if (isNaN(v) || v <= 0) return null;
          n = v;
        } else {
          // Strip currency symbols, spaces, commas
          const s = String(v).replace(/[^\d.]/g, '');
          n = parseFloat(s);
          if (isNaN(n) || n <= 0) return null;
        }
        // Daraz internal scaling: if value looks like a fraction < 10, scale back
        // e.g. 0.55 → 5500, 0.66 → 6600
        if (n > 0 && n < 10) {
          n = Math.round(n * 10000);
        }
        return n > 0 ? n : null;
      };

      /** Remove all HTML tags and decode basic entities, return clean plain text */
      const stripHtml = (html: string): string => {
        return html
          .replace(/<br\s*\/?>/gi, '\n')       // <br> → newline
          .replace(/<\/p>/gi, '\n')              // </p> → newline
          .replace(/<[^>]+>/g, '')               // strip remaining tags
          .replace(/&nbsp;/gi, ' ')
          .replace(/&amp;/gi, '&')
          .replace(/&lt;/gi, '<')
          .replace(/&gt;/gi, '>')
          .replace(/&quot;/gi, '"')
          .replace(/&#39;/gi, "'")
          .replace(/\n{3,}/g, '\n\n')            // collapse excess newlines
          .trim();
      };

      /** Recursively find ANY numeric value whose key matches a regex */
      const deepFindNum = (obj: unknown, keyRx: RegExp, d = 0): number | null => {
        if (d > 10 || !obj || typeof obj !== 'object') return null;
        for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
          if (keyRx.test(k)) {
            if (typeof v === 'number' && !isNaN(v) && v > 0) return v;
          }
          const found = deepFindNum(v, keyRx, d + 1);
          if (found !== null) return found;
        }
        return null;
      };

      /** Recursively find ANY string value whose key matches a regex */
      const deepFindStr = (obj: unknown, keyRx: RegExp, d = 0): string | null => {
        if (d > 10 || !obj || typeof obj !== 'object') return null;
        for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
          if (keyRx.test(k) && typeof v === 'string' && v.trim().length > 5) return v.trim();
          const found = deepFindStr(v, keyRx, d + 1);
          if (found) return found;
        }
        return null;
      };

      const getText = (sel: string): string =>
        (document.querySelector(sel) as HTMLElement)?.innerText?.trim() || '';

      const getMeta = (n: string): string =>
        document.querySelector(`meta[name="${n}"], meta[property="${n}"]`)?.getAttribute('content') || '';

      /* ─── STEP 1: Parse all inline <script> JSON blobs ─── */
      const allScripts = Array.from(document.querySelectorAll('script'));
      const jsonBlobs: Record<string, unknown>[] = [];

      for (const s of allScripts) {
        const text = s.textContent || '';

        // Pattern A: window.__moduleData__ = {...}
        const modMatch = text.match(/__moduleData__\s*=\s*(\{[\s\S]*?\})\s*;?\s*(?:window\.|$)/);
        if (modMatch) {
          try { jsonBlobs.push(JSON.parse(modMatch[1])); } catch { /* bad JSON */ }
        }

        // Pattern B: window.__INIT_DATA__ = {...} or similar globals
        const initMatch = text.match(/window\.__(?:INIT_DATA|pageData|productData|APP_DATA)__\s*=\s*(\{[\s\S]*?\})\s*;/);
        if (initMatch) {
          try { jsonBlobs.push(JSON.parse(initMatch[1])); } catch { /* bad JSON */ }
        }

        // Pattern C: any blob that contains skuInfos + salePrice
        if (text.includes('skuInfos') && text.includes('salePrice')) {
          // Find the outermost { ... } that contains both
          const bigMatch = text.match(/=\s*(\{[\s\S]{100,}\})\s*;/);
          if (bigMatch) {
            try { jsonBlobs.push(JSON.parse(bigMatch[1])); } catch { /* bad JSON */ }
          }
        }
      }

      result.debugLog.push(`Found ${jsonBlobs.length} JSON blob(s)`);

      /* ─── STEP 2: Extract structured data from JSON blobs ─── */
      for (const blob of jsonBlobs) {
        const jRec = blob as Record<string, unknown>;
        const jData = jRec?.data as Record<string, unknown> | undefined;
        const jRoot = jData?.root as Record<string, unknown> | undefined;
        const f = jRoot?.fields as Record<string, unknown> | undefined;

        // ── Name ──
        if (!result.name && f) {
          const prod = f.product as Record<string, unknown> | undefined;
          const n = (prod?.title ?? prod?.name) as string | undefined;
          if (typeof n === 'string' && n.length > 2) {
            result.name = n;
            result.debugLog.push(`name from fields.product.title: ${n}`);
          }
        }

        // ── Price ── (Daraz stores as fraction: 0.55 = Rs 5,500)
        if (!result.price && f) {
          const skuInfos = (f.skuInfos ?? {}) as Record<string, Record<string, unknown>>;
          const firstSkuId = Object.keys(skuInfos)[0];
          if (firstSkuId) {
            const sku = skuInfos[firstSkuId] ?? {};
            const priceObj = (sku.price ?? sku) as Record<string, unknown>;

            // Try salePrice.value first, then fallbacks
            const salePriceBlock = priceObj.salePrice as Record<string, unknown> | undefined;
            const origPriceBlock = priceObj.originalPrice as Record<string, unknown> | undefined;

            const rawSale = (salePriceBlock?.value ?? priceObj.price ?? priceObj.salePrice) as unknown;
            const rawOrig = (origPriceBlock?.value ?? priceObj.originalPrice) as unknown;

            const pSale = parseNPR(rawSale);
            const pOrig = parseNPR(rawOrig);

            if (pSale !== null) {
              result.price = pSale;
              result.debugLog.push(`price from skuInfos: raw=${rawSale} → ${pSale}`);
            }
            if (pOrig !== null) {
              result.originalPrice = pOrig;
              result.debugLog.push(`originalPrice from skuInfos: raw=${rawOrig} → ${pOrig}`);
            }
          }
        }

        // ── Rating & Review Count ──
        // Daraz stores this under fields.review or fields.reviews or similar
        if ((!result.rating || !result.reviewCount) && f) {
          // Try fields.review directly
          const reviewBlock = (f.review ?? f.reviews ?? f.ratings) as Record<string, unknown> | undefined;
          if (reviewBlock) {
            const avgRaw = reviewBlock.average ?? reviewBlock.averageScore ??
              reviewBlock.ratingScore ?? reviewBlock.score;
            const countRaw = reviewBlock.reviewCount ?? reviewBlock.totalReview ??
              reviewBlock.ratingCount ?? reviewBlock.count;

            if (!result.rating && typeof avgRaw === 'number' && avgRaw > 0) {
              result.rating = avgRaw;
              result.debugLog.push(`rating from fields.review: ${avgRaw}`);
            }
            if (!result.reviewCount && typeof countRaw === 'number' && countRaw >= 0) {
              result.reviewCount = countRaw;
              result.debugLog.push(`reviewCount from fields.review: ${countRaw}`);
            }
          }

          // Deep-search fallback with very specific keys for rating
          if (!result.rating) {
            const r = deepFindNum(f, /^average$|^averageScore$|^ratingScore$/i);
            if (r !== null && r >= 1 && r <= 5) {
              result.rating = r;
              result.debugLog.push(`rating via deepFindNum: ${r}`);
            }
          }
          if (!result.reviewCount) {
            const c = deepFindNum(f, /^reviewCount$|^totalReview$|^ratingCount$|^count$/i);
            if (c !== null) {
              result.reviewCount = c;
              result.debugLog.push(`reviewCount via deepFindNum: ${c}`);
            }
          }
        }

        // ── Description ──
        if (!result.description && f) {
          // Try fields.product.description / fields.product.desc / highlights
          const prod = f.product as Record<string, unknown> | undefined;
          const rawDesc = (prod?.description ?? prod?.desc) as string | undefined;
          if (typeof rawDesc === 'string' && rawDesc.length > 10) {
            result.description = stripHtml(rawDesc).slice(0, 2000);
            result.debugLog.push(`desc from fields.product.desc`);
          }

          // Try highlights array as fallback
          if (!result.description) {
            const highlights = prod?.highlights;
            if (Array.isArray(highlights) && highlights.length > 0) {
              result.description = highlights
                .map((h: unknown) => typeof h === 'string' ? h : (h as Record<string, unknown>)?.text as string || '')
                .filter(Boolean)
                .join('\n');
              result.debugLog.push(`desc from highlights`);
            }
          }

          // Deep search
          if (!result.description) {
            const d = deepFindStr(f, /^desc$|^description$|^longDescription$/i);
            if (d) {
              result.description = stripHtml(d).slice(0, 2000);
              result.debugLog.push(`desc via deepFindStr`);
            }
          }
        }
      }

      /* ─── STEP 3: DOM Fallbacks ─── */

      // Name
      if (!result.name) {
        result.name =
          getText('.pdp-product-title') ||
          getText('h1.pdp-mod-product-badge-title') ||
          getMeta('og:title') ||
          document.title.split('|')[0].trim();
      }

      // Price from DOM (rendered text like "Rs. 5,500")
      if (!result.price) {
        const priceSelectors = [
          '.pdp-price_type_normal',
          '.pdp-price',
          '.pdp-mod-product-badge-price span',
          '[class*="pdp-price"]:not([class*="deleted"])',
          '.pdc-price',
        ];
        for (const sel of priceSelectors) {
          const el = document.querySelector(sel) as HTMLElement | null;
          if (el) {
            const p = parseNPR(el.innerText);
            if (p !== null && p > 10) { result.price = p; result.debugLog.push(`price from DOM sel=${sel}: ${p}`); break; }
          }
        }
      }

      // Original price from DOM
      if (!result.originalPrice) {
        const origEl = document.querySelector(
          '.pdp-price_type_deleted, [class*="price-del"], .pdp-price_type_original'
        ) as HTMLElement | null;
        if (origEl) {
          const p = parseNPR(origEl.innerText);
          if (p !== null) result.originalPrice = p;
        }
      }

      // Rating from DOM — Daraz renders ".score-average" on PDP when JS runs
      if (!result.rating) {
        const ratingSelectors = [
          '.score-average',
          '[class*="score-average"]',
          '.pdp-review-summary-score',
          '.star-score',
          '[class*="rating-score"]',
        ];
        for (const sel of ratingSelectors) {
          const val = parseFloat(getText(sel));
          if (!isNaN(val) && val > 0 && val <= 5) {
            result.rating = val;
            result.debugLog.push(`rating from DOM sel=${sel}: ${val}`);
            break;
          }
        }
      }

      // Review count from DOM
      if (!result.reviewCount) {
        const countSelectors = [
          '.count-content',             // "20"
          '.pdp-review-summary-count',
          '[class*="review-count"]',
          '[class*="count-content"]',
        ];
        for (const sel of countSelectors) {
          const text = getText(sel).replace(/[^\d]/g, '');
          const val = parseInt(text, 10);
          if (!isNaN(val) && val >= 0) {
            result.reviewCount = val;
            result.debugLog.push(`reviewCount from DOM sel=${sel}: ${val}`);
            break;
          }
        }
      }

      // Description from DOM
      if (!result.description) {
        const descSelectors = [
          '.pdp-product-desc',
          '.html-content',
          '#product_detail',
          '[class*="product-desc"]',
          '[class*="pdp-desc"]',
        ];
        for (const sel of descSelectors) {
          const el = document.querySelector(sel);
          if (el) {
            const inner = el.innerHTML || '';
            const clean = stripHtml(inner).slice(0, 2000);
            if (clean.length > 20) { result.description = clean; break; }
          }
        }
      }

      /* ─── STEP 4: Images ─── */
      const imgUrls: string[] = [];
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
          if (src && !src.includes('placeholder') && !src.includes('data:') && src.startsWith('http')) {
            const hq = src.replace(/_\d+x\d+\.(jpg|jpeg|png|webp)/i, '_800x800.$1').split('?')[0];
            if (!imgUrls.includes(hq)) imgUrls.push(hq);
          }
        });
        if (imgUrls.length > 0) break;
      }
      if (imgUrls.length === 0) {
        const og = getMeta('og:image');
        if (og) imgUrls.push(og);
      }
      result.images = imgUrls.slice(0, 8);

      return result;
    });

    console.log(
      `[Scraper] Done. name="${data.name}" price=${data.price} origPrice=${data.originalPrice}` +
      ` rating=${data.rating} reviews=${data.reviewCount} imgs=${data.images.length}`
    );
    console.log(`[Scraper] Debug log: ${data.debugLog.join(' | ')}`);

    if (!data.name && data.price === null) {
      return { ...empty, error: 'Failed to extract data. Daraz may be blocking the request.' };
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
      try { await browser.close(); } catch { /* ignore close error */ }
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