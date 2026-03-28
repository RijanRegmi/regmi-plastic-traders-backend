import { Request, Response, NextFunction } from 'express';
import puppeteer, { Browser } from 'puppeteer';

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

  try {
    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-infobars',
        '--window-size=1366,768',
      ],
    });

    const page = await browser.newPage();

    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
      Object.defineProperty(navigator, 'plugins',   { get: () => [1, 2, 3] });
      Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
      (window as Window & { chrome?: object }).chrome = { runtime: {} };
    });

    await page.setViewport({ width: 1366, height: 768 });
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });

    const cleanUrl = url.split('?')[0].replace(/\/$/, '') + '.html';

    await page.goto(cleanUrl, { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(r => setTimeout(r, 3000));
    await page.evaluate(() => window.scrollBy(0, 800));
    await new Promise(r => setTimeout(r, 1500));

    const result = await page.evaluate((): {
      name: string;
      price: number | null;
      originalPrice: number | null;
      description: string;
      images: string[];
      rating: number;
      reviewCount: number;
      category: string;
      rawPrices: string[];
      rawRatings: string[];
    } => {
      const getText = (sel: string): string =>
        (document.querySelector(sel) as HTMLElement | null)?.textContent?.trim() || '';

      const getNum = (text: string): number =>
        parseFloat(text.replace(/[^0-9.]/g, '')) || 0;

      // ── Name ──────────────────────────────────────────────────────────────
      const name =
        getText('.pdp-mod-product-badge-title') ||
        getText('h1.pdp-product-title') ||
        getText('[class*="product-title"]') ||
        getText('h1');

      // ── Price & Original Price ─────────────────────────────────────────────
      const rawPrices: string[] = [];
      const allText = document.body.innerText;

      // Get all Rs. numbers from page
      const allRsMatches = allText.match(/Rs\.?\s*([\d,]+)/gi) || [];
      rawPrices.push(...allRsMatches.slice(0, 5));

      const rsNumbers = allRsMatches
        .map(m => parseFloat(m.replace(/Rs\.?\s*/i, '').replace(/,/g, '')))
        .filter(n => n > 10 && n < 10000000);

      // First Rs. number = sale price
      const price: number | null = rsNumbers.length > 0 ? rsNumbers[0] : null;

      // Original price: ONLY set when there is a real discount/strikethrough
      // Check 1: explicit <del> or strikethrough CSS class
      let originalPrice: number | null = null;
      const delEl =
        document.querySelector('[class*="pdp-price_type_deleted"]') ||
        document.querySelector('[class*="price-del"]') ||
        document.querySelector('[class*="price-original"]') ||
        document.querySelector('del') ||
        document.querySelector('s');

      if (delEl) {
        const n = parseFloat((delEl.textContent || '').replace(/Rs\.?\s*/i, '').replace(/,/g, '').replace(/[^0-9.]/g, ''));
        if (n > 0) originalPrice = n;
      }

      // Check 2: if no del element, look for "-N%" discount pattern in page text
      // e.g. "Rs. 478\nRs. 649-26%" means there IS a discount
      if (!originalPrice) {
        const discountMatch = allText.match(/Rs\.?\s*[\d,]+-\d+%/i);
        if (discountMatch && rsNumbers.length >= 2) {
          originalPrice = rsNumbers[1];
        }
      }
      // If neither condition met → product has no discount → originalPrice stays null

      // ── Rating — UNCHANGED ────────────────────────────────────────────────
      const rawRatings: string[] = [];
      const ratingSelectors = [
        '[class*="score-average"]',
        '[class*="rating-average"]',
        '[class*="average-score"]',
        '[class*="pdp-review-summary"]',
        '[class*="review-score"]',
        '[class*="star-score"]',
      ];
      for (const sel of ratingSelectors) {
        const el = document.querySelector(sel);
        if (el) rawRatings.push(`${sel}=${el.textContent?.trim()}`);
      }

      const ratingMatch = document.body.innerText.match(/(\d\.\d)\s*\/\s*5/);
      if (ratingMatch) rawRatings.push(`MATCH=${ratingMatch[1]}`);

      let rating = 0;
      for (const sel of ratingSelectors) {
        const el = document.querySelector(sel);
        if (el) {
          const n = parseFloat(el.textContent?.trim() || '0');
          if (n > 0 && n <= 5) { rating = n; break; }
        }
      }
      if (!rating && ratingMatch) rating = parseFloat(ratingMatch[1]);

      // ── Review count — UNCHANGED ──────────────────────────────────────────
      const reviewSelectors = [
        '[class*="rating-count"]',
        '[class*="review-count"]',
        '[class*="total-rating"]',
        '[class*="pdp-review-count"]',
      ];
      let reviewCount = 0;
      for (const sel of reviewSelectors) {
        const el = document.querySelector(sel);
        if (el) {
          const n = parseInt((el.textContent || '').replace(/[^0-9]/g, ''));
          if (n > 0) { reviewCount = n; break; }
        }
      }
      // Daraz shows "9 Ratings" cleanly — use that format, not "Ratings 9 10 Answered Questions"
      // Also try "Ratings 4" for products where it appears on its own line
      const ratingsMatch1 = document.body.innerText.match(/\b(\d{1,5})\s+Ratings?\b/i);
      const ratingsMatch2 = document.body.innerText.match(/\bRatings?\s+(\d{1,4})\b(?!\s*\d)/i);
      const ratingsRaw = ratingsMatch1
        ? parseInt(ratingsMatch1[1])
        : ratingsMatch2 ? parseInt(ratingsMatch2[1]) : 0;
      if (!reviewCount && ratingsRaw > 0 && ratingsRaw <= 10000) reviewCount = ratingsRaw;

      // ── Images — UNCHANGED ────────────────────────────────────────────────
      const images: string[] = [];
      document.querySelectorAll(
        '.item-gallery__thumbnail img, [class*="gallery-preview-panel"] img, [class*="gallery"] img'
      ).forEach((el) => {
        const img = el as HTMLImageElement;
        const src = img.src || img.dataset.src || '';
        if (src && src.includes('http') && !src.includes('placeholder') && !src.includes('blank')) {
          const hq = src.replace(/_\d+x\d+/, '_800x800').split('?')[0];
          if (!images.includes(hq)) images.push(hq);
        }
      });
      if (images.length === 0) {
        document.querySelectorAll('img').forEach((el) => {
          const img = el as HTMLImageElement;
          const src = img.src || img.dataset.src || '';
          if ((src.includes('img.lazcdn') || src.includes('static.daraz')) && !src.includes('thumb')) {
            const hq = src.replace(/_\d+x\d+/, '_800x800').split('?')[0];
            if (!images.includes(hq)) images.push(hq);
          }
        });
      }

      // ── Description — UNCHANGED ───────────────────────────────────────────
      const descEl =
        document.querySelector('.html-content') ||
        document.querySelector('[class*="product-detail"]') ||
        document.querySelector('[class*="description-content"]');
      const description = (descEl?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 600);

      // ── Category — UNCHANGED ──────────────────────────────────────────────
      const crumbs = Array.from(
        document.querySelectorAll('[class*="breadcrumb"] a, nav a')
      ).map(el => (el as HTMLElement).textContent?.trim() || '');
      const category = crumbs.filter(c => c && c.toLowerCase() !== 'home').pop() || '';

      return { name, price, originalPrice, description, images: images.slice(0, 10), rating, reviewCount, category, rawPrices, rawRatings };
    });

    // ── Also try window.__item__ JSON — UNCHANGED ─────────────────────────────
    const jsonData = await page.evaluate((): {
      name: string; price: number | null; description: string;
      images: string[]; rating: number; reviewCount: number;
    } | null => {
      try {
        const scripts = Array.from(document.querySelectorAll('script'));
        for (const script of scripts) {
          const content = script.textContent || '';
          if (content.includes('__item__')) {
            const m = content.match(/__item__\s*=\s*(\{[\s\S]*?\});/m);
            if (m?.[1]) {
              const j = JSON.parse(m[1]);
              const imgSrc = j.image;
              const imgList: string[] = Array.isArray(imgSrc) ? imgSrc : imgSrc ? [imgSrc] : [];
              const images = imgList
                .map((i: string) => String(i).replace(/_\d+x\d+/, '_800x800').split('?')[0])
                .filter(Boolean)
                .slice(0, 10);
              let price = parseFloat(String(j.price || '0').replace(/[^0-9.]/g, '')) || null;
              if (price && price > 100000) price = price / 100;
              return {
                name:        String(j.name || j.title || ''),
                price,
                description: String(j.description || j.highlights || '')
                  .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 600),
                images,
                rating:      parseFloat(String(j.ratingScore || j.rating || '0')) || 0,
                reviewCount: parseInt(String(j.review || j.reviewCount || '0')) || 0,
              };
            }
          }
        }
      } catch { /* ignore */ }
      return null;
    });

    console.log('[Scraper] Price candidates:', result.rawPrices.slice(0, 5));
    console.log('[Scraper] Rating candidates:', result.rawRatings.slice(0, 5));
    console.log('[Scraper] originalPrice:', result.originalPrice);

    const name        = result.name        || jsonData?.name        || '';
    const price       = result.price; // DOM only — JSON price unreliable
    const description = result.description || jsonData?.description || '';
    const rating      = result.rating      || jsonData?.rating      || 0;
    const reviewCount = result.reviewCount || jsonData?.reviewCount || 0;
    const images      = result.images.length ? result.images : (jsonData?.images || []);

    if (!name) {
      return { ...empty, error: 'Could not extract product data. The page may have changed.' };
    }

    return {
      name, price,
      originalPrice: result.originalPrice, // null if no discount
      description, images, rating, reviewCount,
      category: result.category, success: true,
    };

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ...empty, error: `Scrape failed: ${msg}` };
  } finally {
    if (browser) await browser.close();
  }
}

export class ScraperController {
  async fetchDarazProduct(req: Request, res: Response, next: NextFunction) {
    try {
      const { url } = req.body as { url?: string };
      if (!url || !url.includes('daraz')) {
        res.status(400).json({ success: false, message: 'Valid Daraz URL required' });
        return;
      }
      console.log(`[Scraper] Fetching: ${url}`);
      const data = await scrapeWithPuppeteer(url);
      console.log(`[Scraper] Result: name="${data.name}" price=${data.price} originalPrice=${data.originalPrice} rating=${data.rating} reviews=${data.reviewCount} images=${data.images.length}`);
      res.json({ success: true, data });
    } catch (err) { next(err); }
  }
}

export const scraperController = new ScraperController();