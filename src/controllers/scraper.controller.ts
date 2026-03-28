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

  console.log(`[Scraper] Initializing... (Mode: ${process.env.VERCEL === '1' ? 'Vercel' : 'Local'})`);
  try {
    const isVercel = process.env.VERCEL === '1' || process.env.NODE_ENV === 'production';
    
    browser = await puppeteer.launch({
      args: isVercel ? chromium.args : [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-infobars',
        '--window-size=1366,768',
      ],
      defaultViewport: chromium.defaultViewport,
      executablePath: isVercel 
        ? await chromium.executablePath() 
        : (process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'),
      headless: isVercel ? (chromium.headless as unknown as boolean) : true,
    });

    const page = await browser.newPage();

    // Specific desktop User-Agent to ensure desktop layout
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    );
    await page.setViewport({ width: 1366, height: 768 });

    // Bypass simple bot checks
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
      (window as unknown as { chrome: object }).chrome = { runtime: {} };
    });

    const baseUrl = url.split('?')[0].replace(/\/$/, '');
    const cleanUrl = baseUrl.endsWith('.html') ? baseUrl : `${baseUrl}.html`;

    console.log(`[Scraper] Navigating to: ${cleanUrl}`);
    await page.goto(cleanUrl, { 
      waitUntil: isVercel ? 'domcontentloaded' : 'networkidle2', 
      timeout: 25000 
    });

    // Strategy: Wait for hydration
    try {
      console.log(`[Scraper] Waiting for hydration indicators...`);
      await Promise.race([
        page.waitForSelector('.pdp-price', { timeout: 12000 }),
        page.waitForSelector('.score-average', { timeout: 12000 }),
        new Promise(r => setTimeout(r, 8000))
      ]);
      await new Promise(r => setTimeout(r, 1000));
    } catch {
      console.log(`[Scraper] Wait indicators timed out, proceeding.`);
    }

    const data = await page.evaluate(() => {
      const result = {
        name: '', 
        price: null as number | null, 
        originalPrice: null as number | null, 
        description: '',
        images: [] as string[], 
        rating: 0, 
        reviewCount: 0, 
        category: '', 
        source: 'none'
      };

      // 1. JSON-LD
      try {
        const ldScripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
        for (const s of ldScripts) {
          const json = JSON.parse(s.textContent || '{}');
          const p = Array.isArray(json) ? json.find(x => x["@type"] === "Product") : (json["@type"] === "Product" ? json : null);
          if (p) {
            result.name = p.name || result.name;
            if (p.offers) {
              const offer = Array.isArray(p.offers) ? p.offers[0] : p.offers;
              result.price = parseFloat(offer.price) || result.price;
            }
            if (p.aggregateRating) {
              result.rating = parseFloat(p.aggregateRating.ratingValue) || result.rating;
              result.reviewCount = parseInt(p.aggregateRating.reviewCount) || result.reviewCount;
            }
            result.source = 'json-ld';
          }
        }
      } catch {}

      // 2. Initial State
      try {
        const scripts = Array.from(document.querySelectorAll('script'));
        for (const s of scripts) {
          const content = s.textContent || '';
          if (content.includes('__INITIAL_STATE__')) {
            const match = content.match(/__INITIAL_STATE__\s*=\s*({.*?});(?:<\/script>|var|window)/s);
            if (match) {
              const state = JSON.parse(match[1]);
              const p = state.product || state || {};
              result.name = p.name || p.title || result.name;
              result.price = parseFloat(p.price || p.salePrice || p.skuPrice?.price) || result.price;
              if (p.ratingValue || p.rating || p.reviewSummary?.score) {
                result.rating = parseFloat(p.ratingValue || p.rating || p.reviewSummary?.score) || result.rating;
              }
              if (p.reviewCount || p.reviewSummary?.totalReview) {
                result.reviewCount = parseInt(p.reviewCount || p.reviewSummary?.totalReview) || result.reviewCount;
              }
              result.source = 'initial-state';
            }
          }
        }
      } catch {}

      // 3. DOM Fallbacks
      const getText = (s: string) => (document.querySelector(s) as HTMLElement)?.textContent?.trim() || '';
      
      if (!result.name) result.name = getText('.pdp-mod-product-badge-title') || getText('h1');
      
      if (!result.price) {
        const pEl = document.querySelector('.pdp-price') || document.querySelector('[class*="pdp-product-price"]');
        if (pEl) result.price = parseFloat(pEl.textContent?.replace(/[^0-9.]/g, '') || '0') || null;
      }

      const delEl = document.querySelector('.pdp-price_type_deleted') || document.querySelector('del');
      if (delEl) result.originalPrice = parseFloat(delEl.textContent?.replace(/[^0-9.]/g, '') || '0') || null;

      if (!result.rating) {
        const rEl = document.querySelector('.score-average') || document.querySelector('[class*="rating-average"]');
        if (rEl) result.rating = parseFloat(rEl.textContent || '0') || 0;
      }

      if (!result.reviewCount) {
        const cEl = document.querySelector('.pdp-review-summary__link') || document.querySelector('.count');
        if (cEl) result.reviewCount = parseInt(cEl.textContent?.replace(/[^0-9]/g, '') || '0') || 0;
      }

      // Images
      const imgs: string[] = [];
      document.querySelectorAll('.item-gallery__thumbnail img, .pdp-mod-common-gallery img').forEach((el) => {
        const src = (el as HTMLImageElement).src || (el as HTMLImageElement).dataset.src;
        if (src && src.includes('http') && !src.includes('placeholder')) {
          const hq = src.replace(/_\d+x\d+/, '_800x800').split('?')[0];
          if (!imgs.includes(hq)) imgs.push(hq);
        }
      });
      result.images = imgs.length ? imgs : result.images;

      // Description
      const dEl = document.querySelector('.html-content') || document.querySelector('#product_detail');
      if (dEl) result.description = dEl.textContent?.replace(/\s+/g, ' ').trim().slice(0, 500) || '';

      // Category
      const crumbs = Array.from(document.querySelectorAll('.breadcrumb_item')).map(el => el.textContent?.trim() || '');
      result.category = crumbs.filter(c => c && c.toLowerCase() !== 'home').pop() || '';

      return result;
    });

    console.log(`[Scraper] Done. Source: ${data.source}`);

    if (!data.name && !data.price) {
      return { ...empty, error: 'Could not extract data. Layout may have changed.' };
    }

    return {
      name: data.name,
      price: data.price,
      originalPrice: data.originalPrice,
      description: data.description,
      images: data.images.slice(0, 10),
      rating: data.rating,
      reviewCount: data.reviewCount,
      category: data.category,
      success: true,
    };

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[Scraper] Error: ${msg}`);
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
      res.json({ success: true, data });
    } catch (err) { 
      next(err); 
    }
  }
}

export const scraperController = new ScraperController();