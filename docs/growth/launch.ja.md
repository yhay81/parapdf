# ParaPDF 紹介文の下書き

2026年11月16日作成。外部サービスには未投稿です。
公開前に投稿者が内容を確認し、利用するアカウントを指定してください。
Hacker Newsは生成文・AIによる編集・自動投稿を認めていないため、
以下はXとZenn向けです。

## X向けの短い紹介

巨大なPDF向けのReactビューア「ParaPDF」を作っています。

1,000ページの比較では、react-pdf＋react-windowよりキャンバスメモリ約55%減
（Chromium・高速スクロール時）。計測条件と弱点も公開しています。

デモ：https://parapdf.yhay81.com/demo/?file=synthetic-text-1000.pdf
GitHub：https://github.com/yhay81/parapdf

## Zenn向けの記事

タイトル：巨大なPDFをReactで快適に扱うためのビューア、ParaPDFを作っています

### まずは1,000ページを試す

Reactアプリで巨大なPDFを扱うためのライブラリ、ParaPDFを開発しています。
pdf.jsを使い、ページの仮想化、テキスト選択、検索、フォーム、注釈などを扱えます。

ページ数の多さに加え、画像やベクター描画の複雑さ、拡大時のピクセル数も
描画のコストに影響します。ここでは1,000ページの文書を例に紹介します。

[1,000ページのデモ](https://parapdf.yhay81.com/demo/?file=synthetic-text-1000.pdf)
を公開しています。登録は不要です。ページ番号に「500」と入力して移動したり、
検索したりしてみてください。自分のPDFを開くこともできます。
選んだファイルはブラウザ内で読み込み、アップロードしません。

### なぜreact-pdfだけでは足りなかったか

[react-pdf](https://github.com/wojtekmaj/react-pdf)は、
`<Document>`と`<Page>`を使ってPDFの各ページをReactで表示できるライブラリです。
[公式FAQ](https://github.com/wojtekmaj/react-pdf/wiki/Frequently-Asked-Questions#rendering-pdf-is-too-slow-what-can-i-do)
でも、巨大な文書では必要なページだけを描画する仮想化を勧めています。
react-windowなどを組み合わせれば、画面付近のページだけを表示できます。

ParaPDFで必要だったのは、そこから先の制御でした。
素早くスクロールするときは画面内のページを優先し、高倍率では描画する範囲を絞り、
前のページに戻ったときは描画済みのキャンバスを再利用したい。
その全体を、設定したキャンバスメモリの上限に収める必要があります。

例えば、比較に使ったreact-pdf 11.0.0は、ページがアンマウントされると
[キャンバスを解放する実装](https://github.com/wojtekmaj/react-pdf/blob/v11.0.0/packages/react-pdf/src/Page/Canvas.tsx)
です。仮想化でページを外し、戻ってきたときには再描画が必要になります。
再表示用のキャッシュや文書全体の描画優先順位まで加えるには、
`<Page>`の周囲にビューアの仕組みを作ることになります。

ParaPDFは、その描画制御をライブラリ側で引き受けます。
エンジンはreact-pdfと同じpdf.jsを使いながら、
巨大なPDFの閲覧に必要な制御をまとめて提供することが狙いです。

### 使い始める

ReactとReact DOM 19.3以降が必要です。

```bash
npm install parapdf
```

```tsx
import { PdfDocument, PdfViewer } from "parapdf";

export function App() {
  return (
    <PdfDocument source="/manual.pdf">
      <PdfViewer style={{ height: "100vh" }} />
    </PdfDocument>
  );
}
```

`/manual.pdf`にPDFを配置し、ビューアの高さを指定すると表示できます。
pdf.jsのワーカーと関連ファイルはパッケージに同梱しています。
Vite、webpack、Rsbuild、Next.jsではビルド時に配信ファイルへ出力されます。
それ以外は[セットアップの説明](https://parapdf.yhay81.com/setup/bundlers/)
を確認してください。

デモのようなツールバーは、アプリ側で作ります。
ParaPDFは、独自の操作画面とPDF表示を組み合わせるための部品です。
[操作ボタンの作り方](https://parapdf.yhay81.com/guides/controls/)
も用意しています。

### ParaPDFが追加する描画制御

巨大なPDFですべてのページを同時に表示対象にすると、
画面の外にあるページにも描画のコストがかかります。
ParaPDFは画面付近のページだけをマウントしたうえで、次の制御を行います。

- **表示中のページを優先する。** まず低解像度で表示し、スクロールが落ち着いたら
  詳細を描きます。高倍率では画面内に見えている部分を、上限の範囲内で詳細に描きます。
- **戻ったページを再利用する。** 画面外へ出たページのキャンバスを、
  メモリの上限内で保持します。キャッシュが残っているページは、戻ったときに
  同じキャンバスを再利用でき、再描画が不要です。
- **Reactの更新を絞る。** スクロールやズームの各フレームでReactの状態を更新せず、
  表示するページの範囲や現在のページが変わったときにReactを更新します。

ピクセルを描く処理と、アプリの状態を扱う処理の役割を分けています。

### 仮想化したreact-pdfと比べて何が改善したか

2026年10月28日の計測では、1,000ページの文書を毎秒3,600 CSSピクセルで
4秒間スクロールし、react-pdfとreact-windowを組み合わせた構成と比較しました。
比較対象もページを仮想化しています。react-pdf 11.0.0、react-window 2.5.1、
Apple M2 Pro、Chromium 156、画面1280×900・devicePixelRatio 2で5回計測した中央値です。

| 項目 | ParaPDF | react-pdf + react-window |
| --- | ---: | ---: |
| 最初の表示 | 182 ms | 197 ms |
| スクロール中のReactコミット数 | 24 | 43 |
| 描画完了後のキャンバスメモリ | 111 MiB | 249 MiB |
| メインスレッドのブロック時間 | 40 ms | 40 ms |

この条件では、キャンバスメモリが**約55%減り**、
Reactが画面への更新を確定する回数も**約44%減りました**。
最初の表示も早くなり、メインスレッドのブロック時間は同じでした。

一方、同じ1,000ページでも毎秒900 CSSピクセルで読む速度では、
ブロック時間がParaPDFの7 msに対して比較対象は4 msでした。
最初の表示とキャンバスメモリでは改善していますが、
すべての条件で速い、とは言えません。

この表は過去の計測で、現在のmainを再計測した結果ではありません。
pdf.jsのバージョンもParaPDF側が6.4.299、比較対象側が6.3.289と異なります。
キャンバスメモリはブラウザ全体の使用メモリではありません。
[計測条件と生データ](https://github.com/yhay81/parapdf/blob/main/examples/prototype/results/compare-react-pdf-1000-chromium.md)
と[ブラウザごとの結果](https://parapdf.yhay81.com/about/performance/)
を公開しています。

### 試してもらいたいこと

現在のnpm公開版は0.8.0です。1.0まではマイナーバージョンでもAPIが変わります。
GitHubのmainには未公開の変更があるため、導入するときは公開版に対応した
[ドキュメント](https://parapdf.yhay81.com/getting-started/)を使ってください。

巨大なマニュアル、論文集、フォームのあるPDFなど、実際の用途で使ったときに
困った点を[GitHub Issues](https://github.com/yhay81/parapdf/issues)で
教えてもらえると、改善に役立ちます。資料を添付する場合は公開できるものを選んでください。

後で使ってみたいと思ったら、
[GitHubでスター](https://github.com/yhay81/parapdf)を付けておいてもらえるとうれしいです。

## 公開前の確認

- npmの最新版と記事中のバージョンを確認する。
- デモ、導入例、計測結果へのリンクを開く。
- 公開先とアカウントを指定し、本文を確認する。
- 投稿URLと日時を手元に記録し、後日の計測と照合する。
