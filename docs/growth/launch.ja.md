# ParaPDF 紹介文の下書き

2026年11月16日作成。外部サービスには未投稿です。
公開前に投稿者が内容を確認し、利用するアカウントを指定してください。
Hacker Newsは生成文・AIによる編集・自動投稿を認めていないため、
以下はXとZenn向けです。

## X向けの短い紹介

React向けPDFビューア「ParaPDF」を作っています。

1,000ページのデモを登録なしで試せます。検索・フォーム・注釈に対応。
性能比較は改善点と弱点を両方公開しています。

デモ：https://parapdf.yhay81.com/demo/?file=synthetic-text-1000.pdf
GitHub：https://github.com/yhay81/parapdf

## Zenn向けの記事

タイトル：Reactで長いPDFを扱うためのビューア、ParaPDFを作っています

### まずは1,000ページを試す

ReactアプリにPDFを組み込むためのライブラリ、ParaPDFを開発しています。
pdf.jsを使い、ページの仮想化、テキスト選択、検索、フォーム、注釈などを扱えます。

[1,000ページのデモ](https://parapdf.yhay81.com/demo/?file=synthetic-text-1000.pdf)
を公開しています。登録は不要です。ページ番号に「500」と入力して移動したり、
検索したりしてみてください。自分のPDFを開くこともできます。
選んだファイルはブラウザ内で読み込み、アップロードしません。

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

### 描画とReactの役割を分ける

長いPDFでは、すべてのページを同時に表示対象にすると、
画面の外にあるページにも描画の費用がかかります。
ParaPDFは画面付近のページだけをマウントし、
戻ってきたページのキャンバスは予算の範囲内で再利用します。

スクロールやズームの各フレームでReactの状態を更新せず、
表示するページの範囲や現在のページが変わったときにReactを更新します。
ピクセルを描く処理と、アプリの状態を扱う処理の役割を分けています。

### 比較では弱点も公開する

2026年10月28日の計測では、110ページの文書を毎秒900 CSSピクセルで
4秒間スクロールし、react-pdfとreact-windowを組み合わせた構成と比較しました。
どちらもページを仮想化しています。Apple M2 Pro、Chromium 156、
画面1280×900・devicePixelRatio 2で5回計測した中央値です。

| 項目 | ParaPDF | react-pdf + react-window |
| --- | ---: | ---: |
| 最初の表示 | 142 ms | 187 ms |
| スクロール中のReactコミット数 | 4 | 10 |
| 描画完了後のキャンバスメモリ | 183 MiB | 217 MiB |
| メインスレッドのブロック時間 | 17 ms | 5 ms |

この条件では最初の表示とキャンバスメモリが改善した一方、
ブロック時間は長くなりました。すべての条件で速い、とは言えません。

この表は過去の計測で、現在のmainを再計測した結果ではありません。
pdf.jsのバージョンもParaPDF側が6.4.299、比較対象側が6.3.289と異なります。
キャンバスメモリはブラウザ全体の使用メモリではありません。
[計測条件と生データ](https://github.com/yhay81/parapdf/blob/main/examples/prototype/results/compare-react-pdf-110-chromium.md)
と[ブラウザごとの結果](https://parapdf.yhay81.com/about/performance/)
を公開しています。

### 試してもらいたいこと

現在のnpm公開版は0.8.0です。1.0まではマイナーバージョンでもAPIが変わります。
GitHubのmainには未公開の変更があるため、導入するときは公開版に対応した
[ドキュメント](https://parapdf.yhay81.com/getting-started/)を使ってください。

長いマニュアル、論文、フォームのあるPDFなど、実際の用途で使ったときに
困った点を[GitHub Issues](https://github.com/yhay81/parapdf/issues)で
教えてもらえると、改善に役立ちます。資料を添付する場合は公開できるものを選んでください。

後で使ってみたいと思ったら、
[GitHubでスター](https://github.com/yhay81/parapdf)を付けておいてもらえるとうれしいです。

## 公開前の確認

- npmの最新版と記事中のバージョンを確認する。
- デモ、導入例、計測結果へのリンクを開く。
- 公開先とアカウントを指定し、本文を確認する。
- 投稿URLと日時を手元に記録し、後日の計測と照合する。
