# ParaPDF distribution copy

Prepared November 16, 2026 for ParaPDF 0.9.0. These are publication-ready
drafts, not evidence that any social post was sent. Record actual URLs in
[the publication log](publications.md) only after verification.

## X: English introduction

Use one original post, linking directly to the usable demo and source.
Post through an authorized API integration; X prohibits scripting its
website for automated posting. Do not publish both language variants as
duplicate campaign posts.

```text
I'm building ParaPDF: an open-source React viewer for huge PDFs.

Page virtualization, zoom, search and cached canvases; your own UI.

Try 1,000 pages (no signup):
https://parapdf.yhay81.com/demo/?file=synthetic-text-1000.pdf

Code: https://github.com/yhay81/parapdf
```

## X: Japanese article announcement, alternative

```text
巨大なPDF向けのReactビューア「ParaPDF」の紹介記事を公開しました。

react-pdf＋react-windowで必要になる実装と、ParaPDFが引き受ける部分、3ブラウザでの比較結果をまとめています。

https://zenn.dev/yhay81/articles/202611-parapdf
```

## LinkedIn: English technical introduction

```text
I'm building ParaPDF, an open-source React PDF viewer for huge documents.

Displaying one page is straightforward. A continuous reader also needs to coordinate page sizes, zoom anchors, internal navigation, drawing priorities and canvas reuse. ParaPDF brings those pieces together on top of pdf.js, while the application builds its own toolbar and UI.

For version 0.9.0, I compared it with react-pdf + react-window in Chromium, Playwright WebKit and Firefox: two documents, two scroll speeds, five runs per condition.

One result from the 1,000-page document at fast scrolling in Chromium:
• React commits: 25 vs 43
• Estimated canvas memory at the sample: 111 vs 249 MiB
• Main-thread blocked time: 51 vs 17 ms — worse for ParaPDF in this condition

Canvas memory is not total browser memory, and the sample does not wait for full-resolution refinement. The report includes the methodology, every run and the losses as well as the wins.

Try the 1,000-page demo without an account:
https://parapdf.yhay81.com/demo/?file=synthetic-text-1000.pdf

Source, installation and benchmark report:
https://github.com/yhay81/parapdf

Apache-2.0. Requires React/React DOM 19.3+. The API can change before 1.0.

#React #OpenSource #PDF
```

## Medium: English article

Use [launch.en.md](launch.en.md). Keep the AI-assistance disclosure in the
first two paragraphs, publish without a paywall, and use the existing
maintainer account if available. Reuse the actual
[demo screenshot](../../.github/assets/demo.png) with the caption:
"ParaPDF's example UI showing page 500 of a generated 1,000-page document.
This screenshot illustrates the UI, not a speed measurement."

Suggested topics: React, Open Source, JavaScript, Web Development, PDF.

## Channel decisions

- **X / LinkedIn:** the first short introductions. One relevant post per
  account; no mass mentions, unsolicited DMs, paid campaigns, or automated
  follow-up replies. Account access and duplicate-post checks are still needed.
- **Medium:** the English technical article, with disclosure and no paywall.
  No account is created or subscription purchased by this plan.
- **DEV:** not used for this promotional campaign. Its AI-assisted article
  policy prohibits promotion of a program and content primarily intended
  to build a social presence. Disclosure alone does not remove that restriction.
- **Hacker News:** the maintainer must personally write and submit it.
  HN prohibits generated/AI-edited text and automated posting. No HN copy is supplied.
- **r/opensource:** not used for generated copy; its rules prohibit
  AI-generated content and excessive self-promotion.
- **r/reactjs:** potential future discussion, with source code and the
  appropriate showcase flair. The AI rule is listed but its full current
  text was not accessible during this check, so publication is deferred
  until the complete rule and account participation history can be checked.

## Rules checked November 16, 2026

- [X automation rules](https://help.x.com/en/rules-and-policies/x-automation)
- [LinkedIn community policies](https://www.linkedin.com/legal/professional-community-policies)
- [Medium AI content policy](https://help.medium.com/hc/en-us/articles/22576852947223-Artificial-Intelligence-AI-content-policy)
- [DEV AI-assisted article guidelines](https://dev.to/guidelines-for-ai-assisted-articles-on-dev)
- [HN guidelines](https://news.ycombinator.com/newsguidelines.html)
- [r/opensource rules](https://www.reddit.com/r/opensource/)
- [r/reactjs rules and sidebar](https://www.reddit.com/r/reactjs/)
