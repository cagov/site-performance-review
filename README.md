# site-performance-review
Endpoint which analyzes all pages of sites for their web performance profile

Currently only setup to run against ODI site

Process is:
- Pull sitemap from innovation.ca.gov/sitemap.xml
- Review all pages in there against dynamodb database that recorded last url set
- If a new page or a page that has a new lastmod date is discovered run a new performance analysis
- Record updated performance analysis in dynamodb
- The performance analysis is a really slow process, takes several seconds per url.
- There were 73 urls in the ODI site when this repo was created. Those can all be analyzed in less than the mas 15 minute timeout on a lambda but most of them don't change that often so running the expensive performance analysis on the bulk of them will rarely be necessary.

This code is setup to run on a schedule once a day.
