//! Prints the classifier's counts for the pages of the given PDFs.
//!
//! Usage: cargo run --release --example classify -- [--all | --table] file.pdf...
//! Without `--all`, the walk stops early the way the hybrid engine runs it.
//! `--table` prints one Markdown row per file with the hybrid engine's
//! decision (the rule in packages/parapdf/src/engine/hybrid.ts) and timings.

use hayro_classify::{Limits, PageStats, classify_page};
use hayro_syntax::Pdf;
use std::time::Instant;

/// The hybrid engine's default rule for sending a page to hayro.
fn image_only(stats: &PageStats) -> bool {
    !stats.stopped
        && stats.visible_text == 0
        && stats.images > 0
        && stats.image_coverage >= 0.5
        && stats.path_segments <= 64
        && stats.shadings == 0
        && stats.annotations == 0
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let all = args.iter().any(|arg| arg == "--all");
    let table = args.iter().any(|arg| arg == "--table");
    let limits = Limits {
        stop_at_visible_text: !all,
        max_path_segments: if all { u32::MAX } else { 64 },
        max_operators: if all { u32::MAX } else { 1_000_000 },
        max_content_bytes: if all { usize::MAX } else { 256 * 1024 },
    };
    if table {
        println!(
            "| File | Pages | Parse (ms) | Pages to hayro | Classify p50 / max (µs) | Why pages stay on pdf.js |"
        );
        println!("|---|---:|---:|---:|---:|---|");
    }
    for path in args.iter().filter(|arg| !arg.starts_with("--")) {
        let data = std::fs::read(path).expect("readable file");
        let start = Instant::now();
        let pdf = Pdf::new(data).expect("parsable PDF");
        let pages = pdf.pages();
        let parse = start.elapsed();
        if !table {
            println!("{path}: {} pages, opened in {parse:?}", pages.len());
        }
        let mut times = Vec::new();
        let mut hayro = 0;
        let mut reasons = std::collections::BTreeSet::new();
        for (index, page) in pages.iter().enumerate() {
            let start = Instant::now();
            let stats = classify_page(page, &limits);
            let elapsed = start.elapsed();
            times.push(elapsed.as_secs_f64() * 1e6);
            if image_only(&stats) {
                hayro += 1;
            } else if stats.visible_text > 0 {
                reasons.insert("visible text");
            } else if stats.stopped && stats.operators == 0 {
                reasons.insert("content over 256 KiB");
            } else if stats.path_segments > 64 {
                reasons.insert("vector paths");
            } else if stats.annotations > 0 {
                reasons.insert("annotation appearances");
            } else if stats.images == 0 {
                reasons.insert("no image");
            } else {
                reasons.insert("image covers under half");
            }
            if !table && index < 12 {
                println!("  page {}: {stats:?} in {elapsed:?}", index + 1);
            }
        }
        if table {
            times.sort_by(f64::total_cmp);
            let name = path.rsplit('/').next().unwrap_or(path);
            println!(
                "| `{name}` | {} | {:.2} | {hayro} | {:.0} / {:.0} | {} |",
                pages.len(),
                parse.as_secs_f64() * 1e3,
                times[times.len() / 2],
                times.last().copied().unwrap_or(0.0),
                if reasons.is_empty() {
                    "—".to_string()
                } else {
                    reasons.into_iter().collect::<Vec<_>>().join(", ")
                },
            );
        }
    }
}
