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

  const isVercel = process.env.VERCEL === '1' || process.env.NODE_ENV === 'production';
  console.log(`[Scraper] Initializing... (Mode: ${isVercel ? 'Vercel' : 'Local'})`);

  try {
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
      headless: true,
    });

    const page = await browser.newPage();

    // Block images, fonts, and stylesheets on Vercel to save time/memory budget
    if (isVercel) {
      await page.setRequestInterception(true);
      page.on('request', (req) => {
        const type = req.resourceType();
        if (['image', 'stylesheet', 'font', 'media'].includes(type)) {
          req.abort();
        } else {
          req.continue();
        }
      });
    }

    // Desktop User-Agent
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
      waitUntil: 'domcontentloaded',
      timeout: 25000,
    });

    // Wait until the price element has numeric content >= 3 digits (e.g. 100+)
    // This avoids grabbing tiny decimal prices from hidden elements
    console.log(`[Scraper] Waiting for JS hydration of price/rating...`);
    try {
      await Promise.race([
        page.waitForFunction(
          () => {
            const selectors = [
              '.pdp-price_type_normal',
              '.pdp-price_color_orange',
              '.pdp-price',
            ];
            for (const sel of selectors) {
              const el = document.querySelector(sel);
              if (el && el.textContent) {
                const digits = el.textContent.replace(/[^0-9]/g, '');
                // Must have at least 2 digits to be a real price (not 0.55 type junk)
                if (digits.length >= 2) return true;
              }
            }
            return false;
          },
          { timeout: 18000, polling: 300 }
        ),
        new Promise<void>((resolve) => setTimeout(resolve, 15000)),
      ]);
      console.log(`[Scraper] Price hydration detected.`);
    } catch {
      console.log(`[Scraper] Price hydration wait timed out, proceeding anyway.`);
    }

    // Extra buffer for ratings/reviews to hydrate after price
    await new Promise<void>((resolve) => setTimeout(resolve, 2000));

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
        source: 'none',
      };

      // Helper to clean and parse price text like "Rs. 5,500" → 5500
      const parsePrice = (text: string): number => {
        // Remove currency symbols, spaces, commas — keep digits and dot
        const cleaned = text.replace(/[^0-9.]/g, '');
        return parseFloat(cleaned) || 0;
      };

      // 1. JSON-LD (most reliable when present)
      try {
        const ldScripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
        for (const s of ldScripts) {
          const json = JSON.parse(s.textContent || '{}');
          const p = Array.isArray(json)
            ? json.find((x) => x['@type'] === 'Product')
            : json['@type'] === 'Product' ? json : null;
          if (p) {
            result.name = p.name || result.name;
            if (p.offers) {
              const offer = Array.isArray(p.offers) ? p.offers[0] : p.offers;
              const jsonPrice = parseFloat(offer.price) || 0;
              // JSON-LD sometimes gives a tiny decimal — only trust if >= 1
              if (jsonPrice >= 1) result.price = jsonPrice;
            }
            if (p.aggregateRating) {
              result.rating = parseFloat(p.aggregateRating.ratingValue) || result.rating;
              result.reviewCount = parseInt(p.aggregateRating.reviewCount) || result.reviewCount;
            }
            result.source = 'json-ld';
          }
        }
      } catch { /* ignore */ }

      // 2. __INITIAL_STATE__ embedded in script tags
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
              const statePrice = parseFloat(p.price || p.salePrice || p.skuPrice?.price) || 0;
              if (statePrice >= 1) result.price = statePrice;
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
      } catch { /* ignore */ }

      // 3. DOM Fallbacks

      // Name
      const getText = (sel: string) =>
        (document.querySelector(sel) as HTMLElement)?.textContent?.trim() || '';

      if (!result.name) {
        result.name = getText('.pdp-mod-product-badge-title') || getText('h1');
      }

      // --- PRICE DOM FALLBACK ---
      // Priority order: normal sale price first, then generic pdp-price
      // Skip any element with a tiny value (< 1) — those are USD or junk decimals
      if (!result.price) {
        const priceSelectors = [
          '.pdp-price_type_normal',        // main sale price on Daraz NP
          '.pdp-price_color_orange',       // highlighted orange price
          '.pdp-price_size_xl',            // large price display
        ];
        for (const sel of priceSelectors) {
          const el = document.querySelector(sel);
          if (el && el.textContent) {
            const parsed = parsePrice(el.textContent);
            if (parsed >= 1) {
              result.price = parsed;
              break;
            }
          }
        }
      }

      // --- ORIGINAL / CROSSED-OUT PRICE ---
      if (!result.originalPrice) {
        const origSelectors = [
          '.pdp-price_type_deleted',
          '.pdp-price_type_deleted span',
          'del',
        ];
        for (const sel of origSelectors) {
          const el = document.querySelector(sel);
          if (el && el.textContent) {
            const parsed = parsePrice(el.textContent);
            if (parsed >= 1) {
              result.originalPrice = parsed;
              break;
            }
          }
        }
      }

      // --- RATING DOM FALLBACK ---
      if (!result.rating) {
        const ratingSelectors = [
          '.score-average',
          '[class*="score-average"]',
          '[class*="rating-average"]',
          // Daraz NP sometimes puts it here
          '.pdp-review-summary .score-average',
        ];
        for (const sel of ratingSelectors) {
          const el = document.querySelector(sel);
          if (el && el.textContent) {
            const parsed = parseFloat(el.textContent.trim());
            if (parsed > 0 && parsed <= 5) {
              result.rating = parsed;
              break;
            }
          }
        }
      }

      // --- REVIEW COUNT DOM FALLBACK ---
      if (!result.reviewCount) {
        const countSelectors = [
          '.pdp-review-summary__link',
          '[class*="pdp-review-summary"] [class*="count"]',
          '.count',
        ];
        for (const sel of countSelectors) {
          const el = document.querySelector(sel);
          if (el && el.textContent) {
            const parsed = parseInt(el.textContent.replace(/[^0-9]/g, ''));
            if (parsed > 0) {
              result.reviewCount = parsed;
              break;
            }
          }
        }
      }

      // --- DESCRIPTION ---
      // Try multiple known description containers on Daraz
      const descSelectors = [
        '.html-content',
        '#product_detail',
        '.pdp-product-desc',
        '[class*="product-detail"]',
        '.pdp-mod-spec',
      ];
      for (const sel of descSelectors) {
        const el = document.querySelector(sel);
        if (el && el.textContent) {
          const text = el.textContent.replace(/\s+/g, ' ').trim();
          if (text.length > 10) {
            result.description = text.slice(0, 500);
            break;
          }
        }
      }

      // --- IMAGES ---
      const imgs: string[] = [];
      document
        .querySelectorAll('.item-gallery__thumbnail img, .pdp-mod-common-gallery img')
        .forEach((el) => {
          const src = (el as HTMLImageElement).src || (el as HTMLImageElement).dataset.src;
          if (src && src.includes('http') && !src.includes('placeholder')) {
            const hq = src.replace(/_\d+x\d+/, '_800x800').split('?')[0];
            if (!imgs.includes(hq)) imgs.push(hq);
          }
        });
      result.images = imgs.length ? imgs : result.images;

      // --- CATEGORY from breadcrumbs ---
      const crumbs = Array.from(
        document.querySelectorAll('.breadcrumb_item')
      ).map((el) => el.textContent?.trim() || '');
      result.category = crumbs.filter((c) => c && c.toLowerCase() !== 'home').pop() || '';

      return result;
    });

    console.log(`[Scraper] Done. Source: ${data.source}, price: ${data.price}, rating: ${data.rating}, reviews: ${data.reviewCount}`);

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