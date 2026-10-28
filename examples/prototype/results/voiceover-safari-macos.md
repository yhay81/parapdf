# Reading and interaction with VoiceOver in Safari on macOS

The macOS part of [#32](https://github.com/yhay81/parapdf/issues/32):
what VoiceOver announces as a reader moves through the demo's documents,
follows links, fills forms, and changes pages. NVDA with Firefox on Windows
is not covered here.

## Setup

- Safari 27.0.1 on macOS 27.0.1 (26A434), Apple silicon; VoiceOver of that
  macOS with its Japanese voice (the announcements below keep its words:
  「領域」 region, 「リンク」 link, 「ボタン」 button, 「チェックボックス」
  checkbox, 「終わり」 end of).
- The demo built from `main` at 8f2ffb7 (`pnpm --filter @parapdf/prototype
  build`, served by `vite preview`), with `engine=pdfjs` (pdfjs-dist
  6.4.299), the demo's English labels, and its default options.
- Safari was driven through safaridriver (WebDriver): it loaded the pages,
  moved the keyboard focus, and pressed keys such as Tab, Enter, Space,
  Page Down, and Home. VoiceOver's cursor was moved with VoiceOver's
  AppleScript (VoiceOver Utility, General, "Allow VoiceOver to be controlled
  with AppleScript"), and each announcement was read back from it:

  ```sh
  osascript -e 'tell application "VoiceOver" to tell vo cursor to move right'
  osascript -e 'tell application "VoiceOver" to get content of last phrase'
  ```

  The steps below repeat by hand with VO-Right Arrow and the keys named.
  VoiceOver's hints ("現在、ボタン上にいます…") replace the last phrase about
  a second after an item is announced, so each step was read within half a
  second.
- VoiceOver follows the application in front: other windows that came to
  the front during the run (headless Playwright WebKit windows, other apps)
  took its cursor, and those steps were repeated with Safari in front.

## Results

| Area | Document | Result |
| --- | --- | --- |
| Reading order, tagged | `mhlw-doc.pdf` | pass |
| Structure: lists | `mhlw-doc.pdf` | pass |
| Reading past the mounted pages | `synthetic-vector-pages.pdf` | pass |
| Where reading starts after paging with keys | `usrguide.pdf` | fails: starts at the first mounted page |
| Internal links: names | `synthetic-navigation.pdf`, `usrguide.pdf` | pass |
| Internal links: place in the reading order | `synthetic-navigation.pdf` | limitation: after the page's text |
| Internal links: following one | `synthetic-navigation.pdf` | partial: the view moves, focus and VoiceOver stay |
| External links | `usrguide.pdf` | pass, named by their URL |
| Form fields: roles, states, operation | `synthetic-features.pdf`, generated fields | pass |
| Form fields: labels (`/TU`) | generated fields | partial: the label names the field's region, not the field |
| Comment (text annotation) | `synthetic-features.pdf` | fails: named by its icon's file name |
| Focus when its page unmounts | `usrguide.pdf` | fails: focus falls to `body` |
| Thumbnails (`PdfThumbnails`) | `synthetic-navigation.pdf` | pass |
| Outline (the demo's) | `synthetic-navigation.pdf` | pass |
| Search results (the demo's live region) | `usrguide.pdf` | pass |
| Page indicator (the demo's) | `usrguide.pdf` | not announced on change |
| Copy-restricted document | `synthetic-restricted.pdf`, `permissions=1` | pass |

### Reading order and structure

`mhlw-doc.pdf` (tagged, `/Lang (ja)`; the text layer gets `lang="ja"`).
Focus the viewport, then VO-Right Arrow:

```text
Page 1 of 2 領域
裁判例資料の作成方法
資料２－１
（第１回労働基準法における「労働者」に関する研究会資料３－１を更新）
＜裁判例について＞
リスト1項目
○
裁判例の抽出方法
リストの終わり
昭和 / 60 / 年 / 1 / 月 / 1 / 日から令和 / 6 / 年 / 12 / 月 / 31 / …
法、労働契約法、労災保険法上の労働者性が争点とされた裁判例から、以下の基準によ
り裁判例を抽出した。
リスト2項目
① 2の1
```

The order follows the page, and the tagged lists are announced as lists
with their item counts. A line the PDF draws in several runs (here, the
numbers in a date drawn in another font) is read run by run, as each run is
a span of pdf.js's text layer; pdf.js's viewer reads it the same way. This
document tags no headings; the tagged ones it has are paragraphs, lists,
and a figure.

### Pages that mount and unmount

`synthetic-vector-pages.pdf` (24 pages, pages 1 to 3 mounted at first).
From the viewport, VO-Right Arrow twelve times:

```text
Page 1 / 終わり Page 1 of 24 領域 / Page 2 of 24 領域 / Page 2 /
終わり Page 2 of 24 領域 / Page 3 of 24 領域 / Page 3 / 終わり Page 3 of 24 領域 /
Page 4 of 24 領域 / Page 4 / 終わり Page 4 of 24 領域 / Page 5 of 24 領域
```

VoiceOver scrolls what it reads into view, the viewer mounts the pages
ahead, and reading continues into them: pages 3 to 7 were mounted at the
end. VO-Left Arrow back to page 1 worked the same way, mounting pages 1 and
2 again.

`usrguide.pdf` (27 pages): with focus on the viewport, Page Down four times
showed page 5 (pages 2 to 7 mounted), and VoiceOver said nothing. The next
VO-Right Arrow started at `Page 2 of 27 領域`, the first mounted page, not
at page 5 the reader was looking at.

### Links

Internal links (`synthetic-navigation.pdf`, page 1) are announced by the
text they link, external ones (`usrguide.pdf`, page 26) by their URL:

```text
リンク XYZ 300%
リンク Fit
リンク https://en.wikipedia.org/wiki/IETF_language_tag Page 26 of 27 領域
リンク 1
```

The links follow the page's text in the reading order: VO-Right Arrow
reads `Navigation page 1`, `XYZ 300%`, `XYZ keep zoom`, …, `FitR` as text,
and then `リンク XYZ 300%`, `リンク XYZ keep zoom`, … as links, because
pdf.js's annotation layer comes after its text layer. Safari's Tab does not
stop at links unless its "Press Tab to highlight each item on a webpage"
setting is on; VoiceOver users reach them with VO-Right Arrow, the rotor,
or VO-Command-L.

Enter on `リンク Fit` showed page 2 (the indicator went from 1 to 2), but
VoiceOver announced nothing, and the focus and VoiceOver's cursor stayed on
the link on page 1: the next VO-Right Arrow read `リンク FitH`.

### Forms

With `forms=1`, Tab from the viewport through `synthetic-features.pdf`'s
fields, which have no tooltips:

```text
テキストを編集 カラ Page 2 of 6 領域
チェックされていない チェックボックス
ラジオボタン、1 / 2
下位項目が折りたたまれました ポップアップボタン
```

Space checked the checkbox (`チェックされている チェックボックス`), Right
Arrow chose the second radio button (`選択中 ラジオボタン、2 / 2`), and
typing filled the text field. `f1040.pdf` in the corpus has no tooltips
(`/TU`) either, so its fields are announced the same way, without names.

To hear tooltips, a one-page PDF with the same kinds of fields plus a list
box, each with a `/TU`, was generated with pdf-lib (not committed):

```text
テキストを編集 カラ Your full name 領域
チェックされていない チェックボックス I agree to the terms 領域
ラジオボタン、1 / 2 Favorite color 領域
下位項目が折りたたまれました ポップアップボタン Shirt size 領域
リストボックス 1項目が選択されています。 apple 選択中 （1 / 3） Fruit 領域
```

pdf.js puts the tooltip on the field's `section` as its `title`, so the
section becomes a region with that name, and the control itself has none.
VoiceOver says the name after the control, as the region it entered, and
not again when the reader moves within the region.

### Comments

Tab reaches `synthetic-features.pdf`'s comment on page 1, which pdf.js
builds as a focusable trigger with an icon:

```text
annotation-comment-Cbtg9_PX.svg ダイアログポップアップ グループ Page 1 of 6 領域
```

The icon's `img` has no `alt`: pdf.js marks it with a Fluent id
(`pdfjs-text-annotation-type`) that only its own viewer translates, so
VoiceOver reads the file name the bundler gave the icon. The popup's text
is reachable after it: `Reviewer クリック可能`, `A comment on the sampler`.

### Focus when its page unmounts

`usrguide.pdf`: focus on the external link on page 26, then Home. The view
went to page 1, page 26 unmounted with the link, and `document.activeElement`
became `body`, with no `focusout`. VoiceOver kept speaking from where its
cursor had been placed, and the next Tab starts from the top of the page.
Page Down from the link kept the focus, as page 26 stayed mounted.

### Thumbnails, outline, search, and the page indicator

`PdfThumbnails` (from the Thumbnails button):

```text
Page 1 現在のページ ボタン リスト4項目
Page 2 ボタン
Page 3 ボタン
```

Enter on `Page 3` showed page 3 and moved `aria-current="page"` to it;
VoiceOver does not announce that change on the focused button.

The demo's outline is a list of buttons (`XYZ 300% ボタン リスト2項目`,
`FitR ボタン`); Enter on `FitR` showed page 4.

The demo's search field is announced as `Find in document 検索テキストフィールド`.
Enter after typing `language` moved to the next match and its `aria-live`
output was announced: `2 of 5`. The match is highlighted with the CSS Custom
Highlight API, which VoiceOver does not read, and its cursor stays in the
field.

The demo's page indicator (`1 (1 / 27)`) is plain text next to the Previous
and Next page buttons. Next page changed it to `3 (3 / 27)` after two
presses, and VoiceOver announced nothing.

### Copy-restricted documents

`synthetic-restricted.pdf` with `permissions=1`, which forbids copying:

```text
Page 1 of 2 領域
Restricted page 1
This text may not be copied.
```

## Follow-ups

Package behavior:

1. Where reading starts after the view moves: VoiceOver enters the document
   at its first mounted page, not at the page shown, after Page Down, Home,
   End, a thumbnail, the outline, or a link.
2. Following an internal link moves the view but not the focus or
   VoiceOver's cursor, so the reader stays on the link's page.
3. Focus is lost to `body` when the page holding it unmounts.
4. A comment's trigger is named by its icon's file name (pdf.js's `img`
   without `alt`).
5. A field's tooltip names its region, not the control (pdf.js's
   `container.title`); pdf.js's viewer does the same, so this may belong
   upstream. The synthetic corpus has no field with a `/TU` to check it.

Application-owned, for the guides: announce page changes (an `aria-live`
region for the current page, as the search guide does for results).

Limitations to document: links are read after the page's text; a line drawn
in several runs is read run by run.
