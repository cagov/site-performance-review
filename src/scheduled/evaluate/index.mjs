import parser from 'xml2json-light';
import fetch from 'node-fetch';
import arc from '@architect/functions';

const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;

function delay(time) {
  return new Promise(resolve => setTimeout(resolve, time));
}

function readPositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function readBatchSize() {
  return readPositiveInt(process.env.BATCH_SIZE, 25);
}

function readMaxRunMs() {
  const seconds = readPositiveInt(process.env.MAX_RUN_SECONDS, 840);
  return seconds * 1000;
}

function getStartIndex(totalPages, batchSize, nowMs) {
  if (totalPages === 0) return 0;
  const scheduleSlot = Math.floor(nowMs / FOUR_HOURS_MS);
  return (scheduleSlot * batchSize) % totalPages;
}

function getBatchPages(pages, batchSize, startIndex) {
  if (pages.length === 0) return [];
  const take = Math.min(batchSize, pages.length);
  const batch = [];
  for (let i = 0; i < take; i++) {
    batch.push(pages[(startIndex + i) % pages.length]);
  }
  return batch;
}

function buildPageSpeedUrl(pageURL) {
  const params = new URLSearchParams();
  params.set('strategy', 'mobile');
  params.append('category', 'accessibility');
  params.append('category', 'performance');
  params.set('url', pageURL);

  if (process.env.PAGESPEED_API_KEY) {
    params.set('key', process.env.PAGESPEED_API_KEY);
  }

  return `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${params.toString()}`;
}

async function readJsonSafe(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

function getApiErrorMessage(fetchData) {
  return fetchData?.error?.message || fetchData?.error_description || 'unknown error';
}

export async function handler () {
  let startTime = new Date().getTime();
  let maxRunMs = readMaxRunMs();
  let batchSize = readBatchSize();

  const sitemapResponse = await fetch("https://innovation.ca.gov/sitemap.xml");
  if (!sitemapResponse.ok) {
    throw new Error(`Sitemap fetch failed with status ${sitemapResponse.status}`);
  }

  const textData = await sitemapResponse.text();
  var sitemapJSON = parser.xml2json(textData);
  let allPages = Array.isArray(sitemapJSON?.urlset?.url) ? sitemapJSON.urlset.url : [];
  let batchStartIndex = getStartIndex(allPages.length, batchSize, startTime);
  let sitemapPages = getBatchPages(allPages, batchSize, batchStartIndex);
  console.log(`loaded ${allPages.length} pages from sitemap`);
  console.log(`batching ${sitemapPages.length} page(s) from index ${batchStartIndex} with batch size ${batchSize}`);

  let data = await arc.tables();
  let results = {
    updated: 0,
    unchanged: 0,
    apiErrors: 0,
    pageErrors: 0
  };

  for (const page of sitemapPages) {
    if ((Date.now() - startTime) >= maxRunMs) {
      console.warn(`stopping early due to max runtime budget of ${maxRunMs}ms`);
      break;
    }

    try {
      console.log('checking ' + page.loc);

      let pageURL = page.loc;
      let urlObj = new URL(pageURL);
      let sitedomain = urlObj.host;

      let urlInfo = await data.evaluations.get({pageURL, sitedomain});
      console.log('looked up this in db: ' + page.loc);
      if (!urlInfo || urlInfo.lastmod !== page.lastmod) {
        let fetchUrl = buildPageSpeedUrl(pageURL);
        let fetchResponse = await fetch(fetchUrl);
        let fetchData = await readJsonSafe(fetchResponse);

        if (!fetchResponse.ok) {
          results.apiErrors++;
          console.warn(`pagespeed request failed for ${pageURL}: status=${fetchResponse.status} message=${getApiErrorMessage(fetchData)}`);
          await delay(1000);
          continue;
        }

        let lighthouseResult = fetchData?.lighthouseResult;
        let performanceScore = lighthouseResult?.categories?.performance?.score;
        let accessibilityScore = lighthouseResult?.categories?.accessibility?.score;

        if (typeof performanceScore !== 'number') {
          results.apiErrors++;
          console.warn(`pagespeed response missing score for ${pageURL}`);
          await delay(1000);
          continue;
        }

        console.log(`performance score for ${pageURL}: ${performanceScore}`);
        if (lighthouseResult.requestedUrl === page.loc && performanceScore > 0.1) {
          page.performance = performanceScore;
          if (typeof accessibilityScore === 'number') {
            page.accessibility = accessibilityScore;
          }

          page.pageURL = page.loc;
          delete page.loc;
          page.lastreviewed = new Date().getTime();
          page.sitedomain = sitedomain;
          console.log(page);

          console.log('inserting this reviewed page');
          let insertPage = await data.evaluations.put(page);
          console.log(insertPage);
          results.updated++;
        }

        // Delay slightly to reduce likelihood of API throttling.
        await delay(1000);
      } else {
        results.unchanged++;
      }
    } catch (error) {
      results.pageErrors++;
      console.error(`error processing page ${page?.loc || 'unknown'}: ${error.message}`);
    }
  }

  let endTime = new Date().getTime();
  console.log(endTime);
  console.log(endTime - startTime);
  console.log(results);

  return;
}
