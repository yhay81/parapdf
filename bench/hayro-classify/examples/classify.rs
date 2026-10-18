//! Prints the classifier's counts for the pages of the given PDFs.
//!
//! Usage: cargo run --release --example classify -- [--all] file.pdf...
//! Without `--all`, the walk stops early the way the hybrid engine runs it.

use hayro_classify::{Limits, classify_page};
use hayro_syntax::Pdf;
use std::time::Instant;

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let all = args.iter().any(|arg| arg == "--all");
    let limits = Limits {
        stop_at_visible_text: !all,
        max_path_segments: if all { u32::MAX } else { 64 },
        max_operators: if all { u32::MAX } else { 1_000_000 },
        max_content_bytes: if all { usize::MAX } else { 256 * 1024 },
    };
    for path in args.iter().filter(|arg| !arg.starts_with("--")) {
        let data = std::fs::read(path).expect("readable file");
        let start = Instant::now();
        let pdf = Pdf::new(data).expect("parsable PDF");
        let pages = pdf.pages();
        println!("{path}: {} pages, opened in {:?}", pages.len(), start.elapsed());
        for (index, page) in pages.iter().enumerate().take(12) {
            let start = Instant::now();
            let stats = classify_page(page, &limits);
            println!("  page {}: {:?} in {:?}", index + 1, stats, start.elapsed());
        }
    }
}
