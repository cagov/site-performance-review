@app
site-performance-review

@http
get /

@scheduled
evaluate cron(0 23 * * ? *)

@tables
evaluations
  sitedomain *String
  pageURL **String
  
@aws
# profile default
region us-west-1
architecture arm64
timeout 900