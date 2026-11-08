# 0027. Search from the current page

- Status: adopted
- Date: 2026-11-08

## Decision

Start at the page the viewer shows when a search begins. Scan forward to
the end, then from the beginning up to the starting page. Publish the
first match immediately. The search reads each page once, including
pages outside the viewport.

Keep the two runs of matches in page order and join them at publication.
Read the selected match from the last published state, which also reflects
any call to `next()` or `previous()`. Locate that match in the new list.
When earlier matches arrive its index can increase while the highlight
and scroll position stay on the chosen occurrence.

## Evidence

On the 1,000-page generated `synthetic-text-1000.pdf`, searching for
`Page` from page 900 used to search 900 pages before selecting its first
match. The new build selected the same occurrence after searching one
page. Every run finished with the same 1,000 matches in document order.

The table gives median time from calling `search("Page")` to the first
selected match and to completion. Each build ran three times per starting
page in fresh headless browser contexts on Windows 11 (Ryzen 5 3600XT,
AC power, 1280 × 900, devicePixelRatio 2, pdfjs-dist 6.4.299). The baseline
(`16b3330`) and the changed build ran back to back, reversing order each
round. Search started once the starting page's text layer was ready, with
a cold search index. Only one browser was measured at a time. The Unix
process watcher was disabled on Windows.

| Browser | Start page | First match before | First match after | All pages before | All pages after |
|---|---:|---:|---:|---:|---:|
| Chromium 156.0.8078.4 | 1 | 15 ms | 12 ms | 4.78 s | 6.08 s |
| Chromium 156.0.8078.4 | 900 | 4,921 ms | 15 ms | 5.54 s | 4.12 s |
| WebKit 27.2 | 1 | 54 ms | 30 ms | 20.11 s | 23.18 s |
| WebKit 27.2 | 900 | 18,955 ms | 40 ms | 20.79 s | 18.75 s |
| Firefox 157.0 | 1 | 18 ms | 18 ms | 8.72 s | 5.81 s |
| Firefox 157.0 | 900 | 5,403 ms | 26 ms | 5.99 s | 7.88 s |

Time to finish all pages varied between runs. Its median increased from
page 1 in Chromium and WebKit and from page 900 in Firefox. The repeatable
gain was reaching the starting page's match on the first page searched.

## Reopen if

Joining the runs or locating the selected occurrence becomes a measurable
cost on documents with many matches per page.
