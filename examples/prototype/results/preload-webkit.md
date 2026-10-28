# The PDF preload in WebKit browsers (decision 0014)

`scripts/preload-reuse.ts` with `RATE=1000000` (the PDF's responses share
1 MB/s), `ENGINE=pdfjs` (pdfjs-dist 6.4.299), bill-hr815.pdf (360,076
bytes), on macOS 27.0.1, Apple silicon, on AC power. `before` is the demo
built from `main` after 0.7.0, `after` the same with the preload skipped in
WebKit; the two follow each other, browser by browser, in three runs.
Safari 27.0.1 (through `bench/scripts/safari.ts`), Playwright's WebKit 27.2
and Chromium 156.0.8078.4. Safari's windows share one HTTP cache, so only
the first job of each launch, `no-cache cold`, starts with an empty one.

Raw output:

```
## run=1 safari before
no-cache      cold: 2 request(s), first page in 1140 ms — GET 200 360076 B; GET 200 360076 B
no-cache      warm: 2 request(s), first page in 452 ms — GET 200 360076 B; GET 304 0 B
max-age=3600  cold: 2 request(s), first page in 851 ms — GET 304 0 B; GET 200 360076 B
max-age=3600  warm: 1 request(s), first page in 252 ms — GET 200 360076 B
## run=1 safari after
no-cache      cold: 1 request(s), first page in 2636 ms — GET 200 360076 B
no-cache      warm: 1 request(s), first page in 292 ms — GET 304 0 B
max-age=3600  cold: 1 request(s), first page in 422 ms — GET 304 0 B
max-age=3600  warm: 1 request(s), first page in 335 ms — GET 304 0 B
## run=1 webkit before
no-cache      cold: 2 request(s), first page in 1264 ms — GET 200 360076 B; GET 200 360076 B
no-cache      warm: 2 request(s), first page in 945 ms — GET 200 360076 B; GET 200 360076 B
max-age=3600  cold: 2 request(s), first page in 1208 ms — GET 200 360076 B; GET 200 360076 B
max-age=3600  warm: 2 request(s), first page in 1473 ms — GET 200 360076 B; GET 200 360076 B
## run=1 webkit after
no-cache      cold: 1 request(s), first page in 987 ms — GET 200 360076 B
no-cache      warm: 1 request(s), first page in 636 ms — GET 200 360076 B
max-age=3600  cold: 1 request(s), first page in 866 ms — GET 200 360076 B
max-age=3600  warm: 1 request(s), first page in 580 ms — GET 200 360076 B
## run=1 chromium before
no-cache      cold: 1 request(s), first page in 620 ms — GET 200 360076 B
no-cache      warm: 1 request(s), first page in 189 ms — GET 304 0 B
max-age=3600  cold: 1 request(s), first page in 564 ms — GET 200 360076 B
max-age=3600  warm: 0 request(s), first page in 139 ms — 
## run=1 chromium after
no-cache      cold: 1 request(s), first page in 552 ms — GET 200 360076 B
no-cache      warm: 1 request(s), first page in 194 ms — GET 304 0 B
max-age=3600  cold: 1 request(s), first page in 579 ms — GET 200 360076 B
max-age=3600  warm: 0 request(s), first page in 162 ms — 
## run=2 safari before
no-cache      cold: 2 request(s), first page in 1270 ms — GET 200 360076 B; GET 200 360076 B
no-cache      warm: 2 request(s), first page in 271 ms — GET 200 360076 B; GET 304 0 B
max-age=3600  cold: 2 request(s), first page in 698 ms — GET 304 0 B; GET 200 360076 B
max-age=3600  warm: 1 request(s), first page in 221 ms — GET 200 360076 B
## run=2 safari after
no-cache      cold: 1 request(s), first page in 779 ms — GET 200 360076 B
no-cache      warm: 1 request(s), first page in 331 ms — GET 304 0 B
max-age=3600  cold: 1 request(s), first page in 403 ms — GET 304 0 B
max-age=3600  warm: 1 request(s), first page in 305 ms — GET 304 0 B
## run=2 webkit before
no-cache      cold: 2 request(s), first page in 1220 ms — GET 200 360076 B; GET 200 360076 B
no-cache      warm: 2 request(s), first page in 892 ms — GET 200 360076 B; GET 200 360076 B
max-age=3600  cold: 2 request(s), first page in 1115 ms — GET 200 360076 B; GET 200 360076 B
max-age=3600  warm: 2 request(s), first page in 1013 ms — GET 200 360076 B; GET 200 360076 B
## run=2 webkit after
no-cache      cold: 1 request(s), first page in 927 ms — GET 200 360076 B
no-cache      warm: 1 request(s), first page in 578 ms — GET 200 360076 B
max-age=3600  cold: 1 request(s), first page in 816 ms — GET 200 360076 B
max-age=3600  warm: 1 request(s), first page in 611 ms — GET 200 360076 B
## run=2 chromium before
no-cache      cold: 1 request(s), first page in 603 ms — GET 200 360076 B
no-cache      warm: 1 request(s), first page in 183 ms — GET 304 0 B
max-age=3600  cold: 1 request(s), first page in 570 ms — GET 200 360076 B
max-age=3600  warm: 0 request(s), first page in 165 ms — 
## run=2 chromium after
no-cache      cold: 1 request(s), first page in 633 ms — GET 200 360076 B
no-cache      warm: 1 request(s), first page in 200 ms — GET 304 0 B
max-age=3600  cold: 1 request(s), first page in 656 ms — GET 200 360076 B
max-age=3600  warm: 0 request(s), first page in 139 ms — 
## run=3 safari before
no-cache      cold: 2 request(s), first page in 1111 ms — GET 200 360076 B; GET 200 360076 B
no-cache      warm: 2 request(s), first page in 284 ms — GET 200 360076 B; GET 304 0 B
max-age=3600  cold: 2 request(s), first page in 730 ms — GET 304 0 B; GET 200 360076 B
max-age=3600  warm: 1 request(s), first page in 190 ms — GET 200 360076 B
## run=3 safari after
no-cache      cold: 1 request(s), first page in 667 ms — GET 200 360076 B
no-cache      warm: 1 request(s), first page in 214 ms — GET 304 0 B
max-age=3600  cold: 1 request(s), first page in 340 ms — GET 304 0 B
max-age=3600  warm: 1 request(s), first page in 309 ms — GET 304 0 B
## run=3 webkit before
no-cache      cold: 2 request(s), first page in 1221 ms — GET 200 360076 B; GET 200 360076 B
no-cache      warm: 2 request(s), first page in 904 ms — GET 200 360076 B; GET 200 360076 B
max-age=3600  cold: 2 request(s), first page in 1201 ms — GET 200 360076 B; GET 200 360076 B
max-age=3600  warm: 2 request(s), first page in 894 ms — GET 200 360076 B; GET 200 360076 B
## run=3 webkit after
no-cache      cold: 1 request(s), first page in 950 ms — GET 200 360076 B
no-cache      warm: 1 request(s), first page in 616 ms — GET 200 360076 B
max-age=3600  cold: 1 request(s), first page in 884 ms — GET 200 360076 B
max-age=3600  warm: 1 request(s), first page in 591 ms — GET 200 360076 B
## run=3 chromium before
no-cache      cold: 1 request(s), first page in 604 ms — GET 200 360076 B
no-cache      warm: 1 request(s), first page in 165 ms — GET 304 0 B
max-age=3600  cold: 1 request(s), first page in 566 ms — GET 200 360076 B
max-age=3600  warm: 0 request(s), first page in 168 ms — 
## run=3 chromium after
no-cache      cold: 1 request(s), first page in 622 ms — GET 200 360076 B
no-cache      warm: 1 request(s), first page in 211 ms — GET 304 0 B
max-age=3600  cold: 1 request(s), first page in 649 ms — GET 200 360076 B
max-age=3600  warm: 0 request(s), first page in 142 ms — 
```
