import arc from '@architect/functions';
import parser from 'xml2json-light';
import fetch from 'node-fetch';

function delay(time) {
  return new Promise(resolve => setTimeout(resolve, time));
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

export async function handler (req) {

  let startTime = new Date().getTime();
  console.log(startTime);

  const sitemapResponse = await fetch("https://innovation.ca.gov/sitemap.xml");
  if (!sitemapResponse.ok) {
    return {
      statusCode: 502,
      headers: {
        'cache-control': 'no-cache, no-store, must-revalidate, max-age=0, s-maxage=0',
        'content-type': 'text/plain; charset=utf8'
      },
      body: `sitemap fetch failed with status ${sitemapResponse.status}`
    };
  }

  const textData = await sitemapResponse.text();
  var sitemapJSON = parser.xml2json(textData);
  let sitemapPages = Array.isArray(sitemapJSON?.urlset?.url) ? sitemapJSON.urlset.url : [];
  console.log(`loaded ${sitemapPages.length} pages from sitemap`);

  let data = await arc.tables();

  for (const page of sitemapPages) {
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
          console.warn(`pagespeed request failed for ${pageURL}: status=${fetchResponse.status} message=${getApiErrorMessage(fetchData)}`);
          await delay(5000);
          continue;
        }

        let lighthouseResult = fetchData?.lighthouseResult;
        let performanceScore = lighthouseResult?.categories?.performance?.score;
        let accessibilityScore = lighthouseResult?.categories?.accessibility?.score;
        if (typeof performanceScore !== 'number') {
          console.warn(`pagespeed response missing score for ${pageURL}`);
          await delay(5000);
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
        }

        // Delay to avoid API throttling in manual runs.
        await delay(5000);
      }
    } catch (error) {
      console.error(`error processing page ${page?.loc || 'unknown'}: ${error.message}`);
    }
  }

  let endTime = new Date().getTime();
  console.log(endTime);
  console.log(endTime - startTime);

  return {
    statusCode: 200,
    headers: {
      'cache-control': 'no-cache, no-store, must-revalidate, max-age=0, s-maxage=0',
      'content-type': 'text/html; charset=utf8'
    },
    body: `run complete`
  }
}
