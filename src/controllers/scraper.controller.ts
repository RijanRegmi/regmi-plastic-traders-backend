import { Request, Response, NextFunction } from 'express';
import axios from 'axios';
import puppeteer, { Browser, HTTPResponse } from 'puppeteer-core';
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

/* ─────────── Helpers ─────────── */

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
  // Daraz sometimes scales price by 1/10000
  if (n > 0 && n < 100) n = Math.round(n * 10000);
  return n > 0 ? n : null;
}

function stripHtml(raw: string): string {
  return raw
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|li|h\d|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"').replace(/&#39;/gi, "'")
    .replace(/\n{3,}/g, '\n\n').trim();
}


/* ─────────── Step 1: axios for static data (name, desc, images) ─────────── */

async function fetchStaticData(url: string): Promise<Partial<DarazProduct>> {
  const cleanUrl = url.split('?')[0].replace(/\/$/, '');
  const finalUrl = cleanUrl.endsWith('.html') ? cleanUrl : `${cleanUrl}.html`;

  const { data: html } = await axios.get<string>(finalUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    timeout: 20000,
  });

  console.log(`[axios] html=${html.length} hasModuleData=${html.includes('__moduleData__')}`);

  const out: Partial<DarazProduct> = {};

  // ── Name from moduleData or og:title
  const modIdx = html.indexOf('__moduleData__ = {');
  if (modIdx !== -1) {
    // Extract just the product title — fast targeted regex, no full JSON parse
    const titleM = html.slice(modIdx, modIdx + 5000).match(/"title"\s*:\s*"([^"]{3,})"/);
    if (titleM) out.name = titleM[1];

    // Extract description (highlights + desc) from the moduleData snippet
    // product.desc is HTML — grab it with a targeted approach
    const descM = html.slice(modIdx, modIdx + 30000).match(/"desc"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    if (descM) {
      const rawDesc = descM[1].replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
      out.description = stripHtml(rawDesc).slice(0, 2500);
    }

    // highlights is an array — grab the raw substring between highlights and the next field
    const hlM = html.slice(modIdx, modIdx + 30000).match(/"highlights"\s*:\s*(\[[\s\S]*?\])/);
    if (hlM) {
      try {
        const highlights = JSON.parse(hlM[1]) as unknown[];
        const bullets = highlights.map((h) =>
          typeof h === 'string' ? h : (h as Record<string, unknown>).text as string ?? ''
        ).filter(Boolean);
        if (bullets.length > 0) {
          const hlText = bullets.join('\n');
          out.description = out.description
            ? `${hlText}\n\n${out.description}`
            : hlText;
        }
      } catch { /* skip */ }
    }
  }

  // Fallback name
  if (!out.name) {
    const ogM = html.match(/property="og:title"\s+content="([^"]+)"/);
    out.name = ogM?.[1] ?? '';
  }
  // Clean name: strip " | Daraz.com.np" and similar site suffixes
  if (out.name) {
    out.name = out.name.replace(/\s*[|\-–]\s*Daraz[^|]*$/i, '').trim();
  }

  // ── og:description as description fallback
  if (!out.description) {
    const ogD = html.match(/property="og:description"\s+content="([^"]+)"/);
    if (ogD) out.description = ogD[1];
  }

  // Price: Daraz loads price via JS — NOT in initial HTML.
  // We get pdt_price (original) from tracking block as fallback only.
  const trackingPriceM = html.match(/"pdt_price"\s*:\s*"([^"]+)"/);
  if (trackingPriceM) {
    // pdt_price is the ORIGINAL price (before discount)
    out.originalPrice = parseNPR(trackingPriceM[1]);
    console.log(`[axios] pdt_price (original)="${trackingPriceM[1]}" → ${out.originalPrice}`);
  }

  // ── Images from skuGalleries in moduleData
  if (modIdx !== -1) {
    const galleryM = html.slice(modIdx, modIdx + 50000).match(/"skuGalleries"\s*:\s*(\{[\s\S]*?\})\s*,\s*"skuInfos"/);
    if (galleryM) {
      try {
        const galleries = JSON.parse(galleryM[1]) as Record<string, unknown[]>;
        const allImgs: string[] = [];
        for (const imgs of Object.values(galleries)) {
          if (Array.isArray(imgs)) {
            for (const img of imgs) {
              const src = typeof img === 'string' ? img
                : (img as Record<string, unknown>).url as string
                  ?? (img as Record<string, unknown>).src as string;
              if (typeof src === 'string' && src.startsWith('http') && !allImgs.includes(src)) {
                allImgs.push(src.replace(/_\d+x\d+\.(jpg|jpeg|png|webp)/i, '_800x800.$1').split('?')[0]);
              }
            }
          }
        }
        if (allImgs.length > 0) out.images = allImgs.slice(0, 8);
      } catch { /* skip */ }
    }
  }

  console.log(`[axios] name="${out.name}" origPrice=${out.originalPrice} imgs=${out.images?.length ?? 0} descLen=${out.description?.length ?? 0}`);
  return out;
}

/* ─────────── Step 2: Puppeteer — wait for JS-rendered price and rating ─────────── */

async function fetchDynamicData(url: string): Promise<{
  price: number | null;
  originalPrice: number | null;
  rating: number;
  reviewCount: number;
  images: string[];
}> {
  const fallback = { price: null, originalPrice: null, rating: 0, reviewCount: 0, images: [] };
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

    const capturedData = {
      price: null as number | null,
      originalPrice: null as number | null,
      rating: 0,
      reviewCount: 0,
    };

    // Block images/fonts/css to speed up — keep scripts and XHR (needed for price API calls)
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const rt = req.resourceType();
      if (['stylesheet', 'font', 'media'].includes(rt)) {
        req.abort();
      } else if (rt === 'image') {
        // Allow only tiny images (thumbnails) to avoid blocking gallery detection
        const u = req.url();
        if (u.includes('placeholder') || u.includes('logo') || (!u.includes('daraz') && !u.includes('lazada'))) {
          req.abort();
        } else {
          req.continue();
        }
      } else {
        req.continue();
      }
    });

    // Intercept API responses that contain price/rating data
    page.on('response', async (response: HTTPResponse) => {
      const u = response.url();
      if (
        u.includes('mtop') || u.includes('getPrice') ||
        u.includes('itemDetail') || u.includes('pdp') ||
        u.includes('product/detail') || u.includes('lazada')
      ) {
        try {
          const ct = response.headers()['content-type'] ?? '';
          if (!ct.includes('json')) return;
          const json = await response.json() as Record<string, unknown>;
          const raw = JSON.stringify(json);

          if (raw.includes('salePrice') || raw.includes('sale_price') || raw.includes('"price"')) {
            const pM = raw.match(/"(?:salePrice|sale_price|discountedPrice|currentPrice)"\s*:\s*([\d.]+)/);
            if (pM) {
              const p = parseNPR(pM[1]);
              if (p !== null) { capturedData.price = p; console.log(`[intercept] price=${p}`); }
            }
            const oM = raw.match(/"(?:originalPrice|original_price|retailPrice)"\s*:\s*([\d.]+)/);
            if (oM) {
              const op = parseNPR(oM[1]);
              if (op !== null) { capturedData.originalPrice = op; }
            }
          }

          if (raw.includes('rating') || raw.includes('Rating') || raw.includes('score')) {
            const rM = raw.match(/"(?:ratingScore|averageScore|average|ratingValue)"\s*:\s*([\d.]+)/);
            if (rM) {
              const r = parseFloat(rM[1]);
              if (r > 0 && r <= 5) { capturedData.rating = r; console.log(`[intercept] rating=${r}`); }
            }
            const cM = raw.match(/"(?:reviewCount|review_count|ratingCount|totalReview)"\s*:\s*(\d+)/);
            if (cM) { capturedData.reviewCount = parseInt(cM[1]); }
          }
        } catch { /* skip non-JSON */ }
      }
    });

    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

    const cleanUrl = url.split('?')[0].replace(/\/$/, '');
    const finalUrl = cleanUrl.endsWith('.html') ? cleanUrl : `${cleanUrl}.html`;

    // domcontentloaded (not networkidle0!) — Daraz has infinite tracking pings
    // that would make networkidle0 never resolve on Vercel
    await page.goto(finalUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });

    // Wait for THE sale price element — confirmed selector from actual Daraz HTML inspection
    // This element is added by React AFTER the JS price API call completes (~5-10s)
    try {
      await page.waitForSelector('.pdp-price_type_normal', { timeout: 22000 });
      console.log('[puppeteer] .pdp-price_type_normal found');
    } catch {
      console.log('[puppeteer] price selector timed out — extracting whatever is available');
    }

    // Brief wait for rating to render (loads just after price)
    await new Promise(r => setTimeout(r, 1000));

    const domData = await page.evaluate(() => {
      const getNum = (s: string) => parseFloat(s.replace(/[^\d.]/g, '')) || 0;
      const getText = (sel: string) => (document.querySelector(sel) as HTMLElement)?.innerText?.trim() ?? '';

      // Sale price
      let price: number | null = null;
      for (const sel of ['.pdp-price_type_normal', '.pdp-mod-product-badge-price .pdp-price']) {
        const els = document.querySelectorAll(sel);
        for (let i = 0; i < els.length; i++) {
          const n = getNum((els[i] as HTMLElement).innerText ?? '');
          if (n > 100) { price = n; break; }
        }
        if (price !== null) break;
      }

      // Original/crossed price
      let originalPrice: number | null = null;
      const origTxt = getText('.pdp-price_type_deleted');
      if (origTxt) { const n = getNum(origTxt); if (n > 100) originalPrice = n; }

      // Rating: .score-average renders "4.7" after JS load
      let rating = 0;
      const scoreEl = document.querySelector('.score-average') as HTMLElement | null;
      if (scoreEl?.innerText) {
        const r = parseFloat(scoreEl.innerText.trim());
        if (r > 0 && r <= 5) rating = r;
      }

      // Review count: .pdp-review-summary__link renders "Ratings 20" after JS
      // (starts as "No Ratings" in initial HTML — ignore that)
      let reviewCount = 0;
      const linkEl = document.querySelector('.pdp-review-summary__link') as HTMLElement | null;
      if (linkEl?.innerText) {
        const txt = linkEl.innerText.trim();
        if (txt && !txt.toLowerCase().startsWith('no')) {
          const m = txt.match(/(\d+)/);
          if (m) reviewCount = parseInt(m[1]);
        }
      }

      // Gallery images
      const imgs: string[] = [];
      for (const sel of ['.item-gallery__thumbnail img', '.pdp-mod-common-image img', '[class*="gallery"] img']) {
        document.querySelectorAll(sel).forEach((el) => {
          const img = el as HTMLImageElement;
          const src = img.src || img.dataset?.src || img.getAttribute('data-lazyload') || '';
          if (src && src.startsWith('http') && !src.includes('data:') && !src.includes('placeholder')) {
            const hq = src.replace(/_\d+x\d+\.(jpg|jpeg|png|webp)/i, '_800x800.$1').split('?')[0];
            if (!imgs.includes(hq)) imgs.push(hq);
          }
        });
        if (imgs.length > 0) break;
      }

      return { price, originalPrice, rating, reviewCount, images: imgs.slice(0, 8) };
    });

    console.log(`[puppeteer DOM] price=${domData.price} origPrice=${domData.originalPrice} rating=${domData.rating} reviews=${domData.reviewCount} imgs=${domData.images.length}`);

    return {
      price: capturedData.price ?? domData.price,
      originalPrice: capturedData.originalPrice ?? domData.originalPrice,
      rating: capturedData.rating || domData.rating,
      reviewCount: capturedData.reviewCount || domData.reviewCount,
      images: domData.images,
    };

  } catch (e) {
    console.error('[puppeteer] Error:', (e as Error).message);
    return fallback;
  } finally {
    if (browser) try { await browser.close(); } catch { /* ignore */ }
  }
}

/* ─────────── Main ─────────── */

async function scrape(url: string): Promise<DarazProduct> {
  const empty: DarazProduct = {
    name: '', price: null, originalPrice: null, description: '',
    images: [], rating: 0, reviewCount: 0, category: '', success: false,
  };

  // Run axios (fast, static data) and puppeteer (dynamic: price, rating) in parallel
  const [staticData, dynamicData] = await Promise.allSettled([
    fetchStaticData(url),
    fetchDynamicData(url),
  ]);

  const sd = staticData.status === 'fulfilled' ? staticData.value : {};
  const dd = dynamicData.status === 'fulfilled' ? dynamicData.value : {
    price: null, originalPrice: null, rating: 0, reviewCount: 0, images: []
  };

  if (staticData.status === 'rejected') console.log('[scrape] axios failed:', staticData.reason);
  if (dynamicData.status === 'rejected') console.log('[scrape] puppeteer failed:', dynamicData.reason);

  const result: DarazProduct = {
    name: sd.name ?? '',
    price: dd.price,                               // from puppeteer (JS-rendered)
    originalPrice: dd.originalPrice ?? sd.originalPrice ?? null, // puppeteer first, axios pdt_price fallback
    description: sd.description ?? '',
    images: (dd.images.length > 0 ? dd.images : sd.images) ?? [],
    rating: dd.rating,
    reviewCount: dd.reviewCount,
    category: '',
    success: false,
  };

  console.log(`[FINAL] name="${result.name}" price=${result.price} origPrice=${result.originalPrice} rating=${result.rating} reviews=${result.reviewCount} imgs=${result.images.length} descLen=${result.description.length}`);

  if (!result.name && result.price === null) {
    return { ...empty, error: 'Could not extract product data from Daraz.' };
  }

  result.success = true;
  return result;
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

/* ─────────── Debug endpoint ─────────── */

export async function debugScrape(req: Request, res: Response): Promise<void> {
  const { url } = req.query as { url?: string };
  if (!url) { res.status(400).json({ error: 'url param required' }); return; }
  try {
    const sd = await fetchStaticData(url as string);
    res.json({ staticData: sd, note: 'price/rating require puppeteer (JS-rendered by Daraz)' });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
}