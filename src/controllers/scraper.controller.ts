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
  console.log(`[Scraper] Initializing...`);

  try {
    const isVercel = process.env.VERCEL === '1' || process.env.NODE_ENV === 'production';
    browser = await puppeteer.launch({
      args: isVercel ? chromium.args : ['--no-sandbox', '--disable-setuid-sandbox'],
      defaultViewport: chromium.defaultViewport,
      executablePath: isVercel 
        ? await chromium.executablePath() 
        : (process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'),
      headless: true,
    });

    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1280, height: 800 });

    const baseUrl = url.split('?')[0].replace(/\/$/, '');
    const cleanUrl = baseUrl.endsWith('.html') ? baseUrl : `${baseUrl}.html`;

    console.log(`[Scraper] Navigating to: ${cleanUrl}`);
    await page.goto(cleanUrl, { 
      waitUntil: isVercel ? 'domcontentloaded' : 'networkidle2', 
      timeout: 30000 
    });

    // Smart wait for hydration
    try {
      await Promise.race([
        page.waitForSelector('.pdp-price', { timeout: 8000 }),
        page.waitForSelector('.score-average', { timeout: 8000 }),
        new Promise(r => setTimeout(r, 5000))
      ]);
    } catch { }

    const data = await page.evaluate(() => {
      const result = {
        name: '', price: null as number | null, originalPrice: null as number | null, 
        description: '', images: [] as string[], rating: 0, reviewCount: 0, 
        category: '', source: 'none'
      };

      const get = (obj: unknown, path: string): unknown => 
        path.split('.').reduce((acc: unknown, key: string) => 
          (acc && typeof acc === 'object' && key in acc ? (acc as Record<string, unknown>)[key] : null), obj);
      
      const parse = (v: string | number | null | undefined): number | null => {
        if (v === null || v === undefined) return null;
        if (typeof v === 'number') return v;
        const s = String(v).replace(/Rs\.|\s|,/gi, '');
        const num = parseFloat(s);
        return isNaN(num) ? null : num;
      };

      // --- 1. JSON Extraction ---
      try {
        const scripts = Array.from(document.querySelectorAll('script'));
        const modScript = scripts.find(s => s.textContent?.includes('__moduleData__ '));
        if (modScript) {
          const content = modScript.textContent || '';
          const match = content.match(/__moduleData__\s*=\s*(.*?);\s*window/s);
          if (match) {
            const m = JSON.parse(match[1]);
            const f = m.data?.root?.fields || {};
            
            result.name = (get(f, 'product.title') as string) || result.name;
            
            const skuInfos = (get(f, 'skuInfos') || {}) as Record<string, unknown>;
            const firstSkuKey = Object.keys(skuInfos)[0];
            const firstSku = (firstSkuKey ? skuInfos[firstSkuKey] : {}) as Record<string, unknown>;
            const p = (firstSku.price || {}) as Record<string, unknown>;
            
            result.price = parse((get(p, 'salePrice.value') || get(p, 'price.value') || p['price'] || p['value']) as string | number | null | undefined) as number | null || result.price;
            result.originalPrice = parse((get(p, 'originalPrice.value') || p['originalPrice']) as string | number | null | undefined) as number | null || result.originalPrice;

            const r = (get(f, 'review') || {}) as Record<string, unknown>;
            result.rating = (get(r, 'ratings.average') as number) || (get(r, 'score') as number) || result.rating;
            result.reviewCount = (get(r, 'ratings.reviewCount') as number) || (get(r, 'count') as number) || (get(r, 'totalReview') as number) || result.reviewCount;

            const h = f.product?.highlights || [];
            const highlightText = Array.isArray(h) ? h.map((line: string | { text?: string }) => typeof line === 'string' ? line : (line.text || '')).join('\n') : '';
            result.description = f.product?.desc || highlightText || result.description;
            
            result.source = 'moduleData';
          }
        }
      } catch { }

      // --- 2. Backup Extraction ---
      if (!result.price) {
        const getMeta = (n: string) => document.querySelector(`meta[name="${n}"], meta[property="${n}"]`)?.getAttribute('content');
        const metaPrice = getMeta('product:price:amount') || getMeta('og:price:amount');
        if (metaPrice) result.price = parse(metaPrice);
        if (!result.name) result.name = getMeta('og:title') || '';
      }

      const getText = (s: string) => (document.querySelector(s) as HTMLElement)?.innerText?.trim() || '';
      if (!result.description) {
        const descEl = document.querySelector('.pdp-product-desc') || document.querySelector('.html-content') || document.querySelector('#product_detail');
        result.description = descEl?.textContent?.trim().slice(0, 1000) || '';
      }
      if (!result.price) {
        result.price = parse(getText('.pdp-price') || getText('[class*="pdp-product-price"]'));
      }
      if (!result.rating) {
        result.rating = parseFloat(getText('.score-average')) || 0;
      }

      // Images
      const imgs: string[] = [];
      document.querySelectorAll('.item-gallery__thumbnail img').forEach((img) => {
        const image = img as HTMLImageElement;
        const src = image.src || image.dataset?.src;
        if (src && !src.includes('placeholder')) {
            const hq = src.replace(/_\d+x\d+\.(jpg|png|webp)/, '_800x800.$1').split('?')[0];
            if (!imgs.includes(hq)) imgs.push(hq);
        }
      });
      result.images = imgs;

      return result;
    });

    if (!data.name && !data.price) {
        return { ...empty, error: 'Failed to extract data. Daraz might be blocking the request.' };
    }

    return {
      name: data.name,
      price: data.price,
      originalPrice: data.originalPrice,
      description: data.description,
      images: data.images.slice(0, 8),
      rating: data.rating,
      reviewCount: data.reviewCount,
      category: data.category,
      success: true,
    };

  } catch (err: unknown) {
    const error = err as Error;
    console.error(`[Scraper] Error: ${error.message}`);
    return { ...empty, error: `Scraper error: ${error.message}` };
  } finally {
    if (browser) await browser.close();
  }
}

export class ScraperController {
  async fetchDarazProduct(req: Request, res: Response, next: NextFunction) {
    try {
      const { url } = req.body as { url?: string };
      if (!url) {
        res.status(400).json({ success: false, message: 'URL is required' });
        return;
      }
      const data = await scrapeWithPuppeteer(url);
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  }
}

export const scraperController = new ScraperController();