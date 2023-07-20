# site-performance-review
Endpoint which analyzes all pages of sites for their web performance profile

Currently only setup to run against ODI site

Process is:
- Pull sitemap from innovation.ca.gov/sitemap.xml
- Review all pages in there against dynamodb database that recorded last url set
- If a new page or a page that has a new lastmod date is discovered run a new performance analysis
- Record updated performance analysis in dynamodb
- The performance analysis is a really slow process, takes several seconds per url.
- There are 95 urls in the ODI site at the time of this writing. Those cannot all be analyzed in less than the 15 minute timeout on a lambda (processing time per URL is 9-20 seconds) but most of them don't change that often so running the expensive performance analysis on the bulk of them will rarely be necessary.

This code is setup to run on a schedule every four hours.

It is deployed to an AWS production environment via:

```
npx arc deploy --production
```

Which put it at <a href="https://qdrfvq20o2.execute-api.us-west-1.amazonaws.com">    https://qdrfvq20o2.execute-api.us-west-1.amazonaws.com</a>

It was not deployed to a staging environment. That wouldn't cause problems but would duplicate the same activity as production on the same schedule in a different dynamodb that is not read by anything.

This can run locally if the local "dynamodb instance" is populated.

The 11ty build process retrieves the latest performance information from the get endpoint sending the site domain as a url parameter so we always retrieve the latest performance data.

## Development notes

This service was created to power the performance measurement now displayed in the footer of all pages on the ODI site. 

The 11ty _data file calls the read endpoint on this service to get all the performance readings for the site at once during a build.

I think this addition to the site dovetails nicely with the equity order and ODI's mandate to provide training because we have seen deficiencies throughout the state in these metrics and the ODI team has the expertise to advise on how to make improvements.

Displaying the stats is cool because we are being transparent but you can see that there are links under each number to explain why that metric is important, how we determine it and how you can improve it in your own web service.

<img width="1267" alt="Screenshot 2023-05-19 at 3 52 24 PM" src="https://github.com/cagov/site-performance-review/assets/353360/c8613e15-278b-48a0-8e39-4876eca3ed6d">

I created this as an external service when I discovered that I couldn't perform this audit fast enough using lighthouse to get it done during each production build. It takes several seconds for each page so would add over 10 minutes to the build for ODI's small site.

I tried several things when building this service starting with lighthouse as embedded in 11ty creator Zach Leatherman's <a href="https://www.npmjs.com/package/performance-leaderboard">performance-leaderboard</a> modules.

There were several problems running these tools which use lighthouse locally inside the AWS Lambda environment, some of them created bundles too large, the total runtime took too long. I ended up switching to making this hit google's lighthouse page speed API to get a reading instead. Unfortunately this analysis is not guaranteed to be performed from the US and we can't effectively warm the cache on ODI site's low traffic pages so you see slightly lower performance scores than what we get when we run lighthouse against the site using dev tools on our own machines but it is still a fair analysis.

If we were to expand this service in the future we might want to try:
- Going back to running lighthouse locally either directly or with performance-leaderboard instead of hitting the google pagespeed API
- Running this on a constantly available server instead of lambda so we aren't limited in total code bundle size and can run longer analyses safely