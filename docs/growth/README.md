# Helping readers discover ParaPDF

Started November 16, 2026. This is a maintainer's experiment plan, not API
documentation. The [site](https://parapdf.yhay81.com/) documents the released
package. Current public baseline: **1 star, 0 forks, npm 0.8.0**.

## Audience and promise

Start with React developers embedding long documents in an application:
manuals, research readers, and document review tools. They need page
virtualization and interaction with their own UI, and can try a library
before adopting it.

Use one message: **A React PDF viewer for long documents, with your own UI.**
Lead with the [1,000-page demo](https://parapdf.yhay81.com/demo/?file=synthetic-text-1000.pdf),
then a two-component installation example, then measurements and limits.
Keep search, forms, annotations, and Japanese text as reasons to explore.

The first hypothesis is that qualified discovery is the bottleneck. Capture
traffic before changing it; do not infer a conversion rate by dividing
lifetime stars by the last 14 days of visitors.

## First 30 days

Aim for **50 total stars by December 16**, with 100 as a stretch target,
and five substantive reports from people trying real documents. These are
planning targets, not predictions. The first milestone is ten interested
readers, not a large one-day spike.

| When | Action | Evidence to keep |
| --- | --- | --- |
| Day 0 | Improve the repository description, relevant topics, README, demo links, and preview assets. Capture a baseline. | Commit, live repository metadata, local snapshot |
| Days 1–3 | Publish the Japanese technical article and one short post from the maintainer's accounts, after approving their exact text. Link to the working demo and repository. | Each post URL, date, and snapshot before/after |
| Days 4–7 | Answer real setup questions; fix the most common obstacle. Use the replies to choose the next example. | Reproducible issues and documentation fixes |
| Week 2 | Share one technical finding with the community that would use it. Show both wins and losses from the recorded comparison. | Article or discussion URL, qualified feedback |
| Week 3 | Publish an example addressing the most common real request, if it fits the project's scope. | Working example and feedback from its requester |
| Week 4 | Compare the experiment's snapshots and effort. Continue the channel that brought useful trials; revise or stop the others. | Net stars, non-overlapping visitor windows, trial reports, time spent |

No posts, messages, or recurring jobs are sent by this plan. External
publication needs a chosen account and approval of the finished text.
The Japanese drafts are in [launch.ja.md](launch.ja.md).

## Distribution, in order

1. **GitHub discovery.** Keep the About description specific, retain the
   homepage, and use relevant topics. The README should answer what it is,
   show it working, and make trying it obvious. A single star invitation
   belongs after those answers.
2. **Zenn and the maintainer's existing social audience.** Start with the
   technical article and a short demo link. Explain the implementation
   problem, provide runnable code, and include one useful measurement.
   Publish once, then respond to questions instead of repeating the link.
3. **A relevant React community.** Read that community's current rules and
   select its project-showcase venue before proposing a post. Do not put
   promotional issues in unrelated repositories or send unsolicited DMs.
4. **Show HN, only with the maintainer personally participating.** Link to
   the usable demo, and let the maintainer write the title, explanation,
   and replies themselves. HN currently prohibits generated/AI-edited text
   and automated posting. Research notes are the demo URL, decisions
   [0010](../decisions/0010-renderer-owns-page-dom.md) and
   [0017](../decisions/0017-measured-against-react-pdf.md), the API's 0.x
   status, and its measured trade-offs. This repository intentionally
   provides no ready-to-post HN text.

Defer launch directories and broad outreach until the first readers can
install and use the package successfully. Never buy, exchange, or automate
stars, or coordinate votes on another service.

## Claims and release checks

- The first-paint comparison is historical: October 28, 2026, five runs,
  Apple M2 Pro, Chromium 156, 110 pages, 900 CSS px/s for four seconds,
  1280×900 at devicePixelRatio 2. Link to the
  [raw report](../../examples/prototype/results/compare-react-pdf-110-chromium.md).
- Compare against **windowed react-pdf**, not just an all-pages-mounted
  example. Report the 17 vs 5 ms main-thread loss beside the first-paint
  and canvas-memory wins. The two stacks use different pdf.js versions.
- Do not call canvas memory total memory, or Playwright WebKit Safari.
  Do not call the library universally faster or imply worker drawing is
  the default. Do not present an old measurement as a fresh test of `main`.
- Before a post, compare npm's latest version with the examples being
  promoted. The public site follows releases; `main` has unreleased APIs.
  Do not release the runtime just to publish marketing material.
- The demo's toolbar is an example application. ParaPDF applications build
  their own controls; the install example needs React/React DOM 19.3+ and
  a definite viewport height.

## Measure manually

```sh
node .github/scripts/growth-snapshot.mjs
```

Requires Node 24+ and an authenticated `gh` with repository traffic access.
Run before each approved publication, the next day, and at each weekly
review. It only reads GitHub and npm; it creates no schedule. It saves a
timestamped JSON file under ignored `.growth/`, with owner-only file
permissions. Keep these private, since repository traffic requires
maintainer access. An unavailable source is recorded as unavailable and
returns a failing exit code, never as a zero.

The snapshot includes stars, forks, description, topics, daily views and
clones, referrers, popular paths, npm's last-week downloads, and the latest
npm version. Keep a local log beside it with each publication's URL and
timestamp. Use the dates returned by each service: the APIs can lag.

The initial snapshot was captured at `2026-11-16T02:57:44.295Z`, before
changing repository metadata. Its private traffic data is intentionally
not committed.

- **Outcome:** net stars between snapshots, plus reports of actual trials.
- **Discovery:** unique visitors and reported referrers. GitHub's traffic
  window is 14 days; do not add overlapping totals or daily uniques.
- **Adoption signal:** npm downloads, with the caveat that CI and repeat
  installs count. Clones are not a count of human users either.
- **Attribution:** the snapshots show changes over time, not which visitor
  starred. Referrers are incomplete. Query parameters alone do not create
  analytics; do not claim channel-level conversion without instrumentation.

Use simple decision rules, as heuristics rather than significance tests:

| Observation after a two-week window | Next experiment |
| --- | --- |
| Fewer than 100 unique visitors | Improve the topic/audience match and one distribution channel before polishing the README again. |
| At least 100 visitors, fewer than five net new stars, few trials | Revisit the promise and setup friction using real feedback. |
| Useful trials and recurring setup questions | Turn the repeated question into a tested guide; prioritize successful use. |
| Stars rise but no reported use | Check whether the audience matches the library; do not mistake attention for adoption. |

## Assets

- [Demo screenshot](../../.github/assets/demo.png): captured from the public
  1,000-page demo at page 500, fit-page, thumbnails open, 1280×640, November
  16, 2026. The PDF is generated by this repository. It is a product
  screenshot, not a speed measurement.
- [Social preview](../../.github/assets/social-preview.png): 1280×640, with
  editable [HTML source](../../.github/assets/social-preview.html). Render
  the source at that viewport and devicePixelRatio 1 to reproduce it.
  Set as GitHub's social preview on November 16, 2026, under Settings →
  General → Social preview. When replacing it, update that setting too;
  committing a new image alone does not change GitHub's preview.

## Sources checked November 16, 2026

- [GitHub topics](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/classifying-your-repository-with-topics)
- [GitHub social previews](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/customizing-your-repositorys-social-media-preview)
- [GitHub traffic API and its 14-day window](https://docs.github.com/en/rest/metrics/traffic)
- [Show HN](https://news.ycombinator.com/showhn.html) and
  [HN's posting guidelines](https://news.ycombinator.com/newsguidelines.html)
