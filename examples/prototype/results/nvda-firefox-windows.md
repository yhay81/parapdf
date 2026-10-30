# Reading and interaction with NVDA in Firefox on Windows

Windows verification for [#32](https://github.com/yhay81/parapdf/issues/32).
These are the words NVDA reported, not an inspection of the accessibility
tree. Items not listed as checked remain unverified.

## Setup

- On 2026-10-30: Windows 11 build 26300.9818, Firefox 157.0.1, and NVDA 2026.3 with
  Japanese announcements.
- The first run used `main` at `5337de31c43b60c373970d18cb355a32b9c3e83c`;
  the additional cases below used `042a9c0f0dc0974bd0f2fb2ad45a155ebbb920a6`,
  based on `main` at `40406d9555506ef515a65a8ab25f0beba2845930`. Both used
  `engine=pdfjs` and the demo's English labels. The corpus was generated with
  `pnpm --filter @parapdf/bench corpus` before building.
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
- For the additional cases, an injected observation script recorded the
  viewer's current page, mounted `data-page` elements, and the active DOM
  element alongside UTC timestamps. It did not move focus or scroll. These
  observations were matched with NVDA's speech queue and keyboard steps.
  The timestamps below make the sequence explicit; the observations and
  speech log themselves contain keystrokes and are not published.

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

## Additional cases on the newer build

All times below are UTC on 2026-10-30. In NVDA browse mode, Ctrl+Home
starts each case at the top of the page; NVDA+Space switches to focus mode.

- **Headings, language, and table:** with `f1040.pdf&forms=1`, press H
  eight times. NVDA announces `Form` and `1040` as level 1 headings,
  `Presidential Election Campaign` as level 3, and `Dependents` as level 2.
  Ctrl+Home then T (01:01:19) announces `テーブル 8行 5列` (table, 8 rows,
  5 columns). Ctrl+Alt+Right twice announces `2列 Dependent 1` and
  `3列 Dependent 2`; Down then Left reaches the `Dependent 1` edit field in
  column 2. The speech queue records `en_US` for this English text, and
  `ja_JP` for the Japanese text in `mhlw-doc.pdf` above.
- **Internal link and focus:** with `synthetic-navigation.pdf`, K then
  Enter (01:06:09) announces `XYZ 300%`, an internal link, followed by
  `Page 2 of 4` and `Navigation page 2`. The observer records focus moving
  from the link on page 1 to the page 2 region, with current page 2. The
  next Down Arrow announces page 3; the exact destination within page 2 was
  not checked.
- **Page changes and unmount:** with `synthetic-navigation.pdf&scroll=page&scale=fit-page`,
  follow the first link and press NVDA+Space. End (01:09:58) announces
  `Page 4 of 4`; the observer records page 4 as current and focused, with
  pages 2–4 mounted. Home (01:09:59) announces page 1 and records page 1 as
  current and focused, with pages 1–3 mounted. The previously focused
  page 4 unmounted without focus falling to the body.
  Repeat with `destinationZoom=0`: after following the first link and
  switching to focus mode, Page Down twice then Page Up (01:12:10–13)
  announces pages 3, 4, then 3; current page and page focus match each
  announcement.
- **External link in an untagged PDF:** with `usrguide.pdf&page=26`, press
  K twice (01:09:17). NVDA reads the URL
  `https://en.wikipedia.org/wiki/IETF_language_tag` and `リンク` (link).
  Enter opens the page titled `IETF language tag - Wikipedia` in Firefox.
  This case checks the link, not the reading order of the untagged text.
- **Reading backwards and thumbnails:** with `synthetic-vector-pages.pdf`,
  read down through page 5, then Up Arrow through pages 4, 3, 2, and 1
  (01:07:46–59). In a separate run, Enter on `Thumbnails`, D twice, and B
  twice reaches `Page 3` in the 24-item `Page thumbnails` navigation list.
  Enter (01:12:42) announces it as the current page; the observer records
  current page 3 with focus remaining on the application's Page 3 button.
  The next Down Arrow reads the Page 4 thumbnail. This is an application
  control; it does not move focus automatically into the PDF text.
- **Annotation control and text editor:** with
  `synthetic-features.pdf&forms=1&annotations=1`, move to the demo's Text
  toggle with B and activate it. NVDA announces the toggle as pressed.
  In a separate run, Tab 13 times from the selected toggle reaches the
  page 1 editor layer. NVDA+Space then Enter opens `Text Editor`, announced
  as a multiline edit field (01:17:41). Type `Accessibility test`, press
  Ctrl+Enter to finish, then Escape and Shift+Tab to reach the demo's Keep
  button. Enter (01:21:00) announces `Kept 1`. This confirms the demo kept
  one annotation locally; it does not verify export to a PDF and reopening.

## Still to verify

- Reading order in untagged documents, exact text position at the destination
  of a link or search result, remaining form interactions, and editing and
  reopening an annotation saved into a PDF.
- Other reader/browser versions and real users' experience. The tests above
  exercise representative paths, not every table cell or focus transition.
- The NVDA log showed warnings about locale symbol data. The text and
  language events above were captured, but naturalness and quality of the
  resulting speech were not assessed by listening.
