import PerfLeaderboard from "performance-leaderboard";
import parser from 'xml2json';
import arc from '@architect/functions';

export async function handler (event) {

  const response = await fetch("https://innovation.ca.gov/sitemap.xml");
  const textData = await response.text();
  
  // xml to json
  var sitemapJSON = JSON.parse(parser.toJson(textData));

  let startTime = new Date().getTime();
  console.log(startTime);

  const perfBoardOptions = {
    axePuppeteerTimeout: 30000, // 30 seconds
    writeLogs: false, // Store audit data
    logDirectory: '.log', // Default audit data files stored at `.log`
    readFromLogDirectory: false, // Skip tests with existing logs
    // onlyCategories: ["performance","accessibility"],
    chromeFlags: ['--headless'],
    freshChrome: "site", // or "run"
    launchOptions: {}, // Puppeteer launch options
  }

  let data = await arc.tables();

  // gimme a single url at a time in synchronous loop
  for (const page of sitemapJSON.urlset.url) {
    console.log('checking '+page.loc)

		// lookup each url in dynamo db
    let pageURL = page.loc;
    let urlObj = new URL(pageURL);
    let sitedomain = urlObj.origin;

    let urlInfo = await data.evaluations.get({pageURL, sitedomain});
    console.log('retrieved info about '+page.loc);
    if(!urlInfo || urlInfo.lastmod !== page.lastmod) {
      let urlsToReview = [];
      urlsToReview.push(pageURL);
      perfBoardOptions.bypassAxe = urlsToReview;
      let perfData = await PerfLeaderboard(urlsToReview, 1, perfBoardOptions);
      console.log(perfData);

      if(perfData[0].url === page.loc) {
        page.performance = perfData[0].lighthouse.performance;
        // insert into dynamo
        page.pageURL = page.loc;
        delete page.loc;
        page.lastreviewed = new Date().getTime();
        page.sitedomain = sitedomain;
        console.log(page);

        console.log('inserting this reviewed page')
        // save the reviewed page
        let insertPage = await data.evaluations.put(page);
        console.log(insertPage);

      }
    }

  }

  let endTime = new Date().getTime();
  console.log(endTime)
  console.log(endTime - startTime);

  return
}