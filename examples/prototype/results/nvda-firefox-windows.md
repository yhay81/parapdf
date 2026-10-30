# Reading and interaction with NVDA in Firefox on Windows

Partial verification for [#32](https://github.com/yhay81/parapdf/issues/32).
These are the words NVDA reported, not an inspection of the accessibility
tree. Items not listed as checked remain unverified.

## Setup

- On 2026-10-30: Windows 11 build 26300.9818, Firefox 157.0.1, and NVDA 2026.3 with
  Japanese announcements.
- The demo built from `main` at `5337de31c43b60c373970d18cb355a32b9c3e83c`,
  with `engine=pdfjs`, using the demo's English labels. The corpus was
  generated with `pnpm --filter @parapdf/bench corpus` before building.
- Firefox and NVDA ran on the logged-in Windows desktop, using a temporary
  Firefox profile and portable NVDA. NVDA's input/output log captured the
  announcements. A remote keyboard sent the same keys a reader can use;
  the browser's accessibility tree was not used as a substitute for NVDA.
- NVDA was started with `--minimal --disable-addons --log-level=12` and a
  dedicated log file. The log contains keystrokes and is not published.
- To repeat, build and serve the prototype, open the indicated PDF with
  `?engine=pdfjs&file=<name>`, and use NVDA in browse mode. Turn on
  `forms=1` for form controls and `permissions=1` for the restricted PDF.
  After each document loads, press Ctrl+Home before the steps below.

## Observations

| Area | Document and operation | NVDA's announcement |
| --- | --- | --- |
| Tagged text and list | `mhlw-doc.pdf`, read with Down Arrow | `Page 1 of 2`, `裁判例資料の作成方法`, `資料２－１`, then `リスト 1項目` and `裁判例の抽出方法`. The log also records Japanese language for the text. |
| Multiple pages | `synthetic-vector-pages.pdf`, read repeatedly with Down Arrow | Continued in order from page 1 through page 22. Mounting and unmounting were not independently observed. |
| Internal link | `synthetic-navigation.pdf`, `K`, Enter | `XYZ 300% リンク`, followed by `Page 2 of 4` and `Navigation page 2`. |
| Comment and form labels | `synthetic-features.pdf`, `forms=1`, read with Down Arrow | `A comment on the sampler`, `Your name エディット`, `チェックボックス チェックなし I agree`, `ラジオボタン チェックなし Favorite color`, and `Size コンボボックス 折りたたみ`. |
| Form operation | `synthetic-features.pdf`, `forms=1&page=2`: `E` twice, Enter, type `test`, Tab, Space, then Tab | The checkbox was announced as `I agree チェックボックス チェックなし`, then `チェック` after Space; Tab reached the radio button and then the Size combo box. |
| Search | `usrguide.pdf`: `E`, Enter, type `language`, Enter, then activate Next match | `Searching 0 of 27 pages`, `1 of 5`, `2 of 5`, then `3 of 5`. These announcements come from the demo's search interface. |
| Copy restriction | `synthetic-restricted.pdf`, `permissions=1`, read with Down Arrow | `Restricted page 1`, `This text may not be copied.`, and text from page 2. |

## Still to verify

- The page shown, focus, and NVDA's reading position after Page Down, Home,
  thumbnails, and a focused page unmounting. A Page Down trial did not
  establish the displayed page or focus, so it is not a pass or a failure.
- Untagged documents, headings and tables, external links, thumbnails,
  annotation controls, and the remaining form interactions and states.
- Page mounting and unmounting, reading backwards, and the text and focus
  position at the destination of a link or search result.
- The NVDA log showed warnings about locale symbol data. The text and
  language events above were captured, but naturalness and quality of the
  resulting speech were not assessed by listening.

The link's next Down Arrow read page 3; this run did not establish whether
the reading cursor starts at the exact destination after following the link.
