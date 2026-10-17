//! Minimal hayro bindings for the engine benchmark.
//!
//! The document and its render cache live for the whole benchmark job, so the
//! cache can reuse parsed fonts across pages the way pdf.js and PDFium do.

use hayro::hayro_interpret::InterpreterSettings;
use hayro::hayro_syntax::Pdf;
use hayro::vello_cpu::color::palette::css::WHITE;
use hayro::vello_cpu::peniko::ImageAlphaType;
use hayro::{PixmapSettings, RenderCache, RenderSettings, render};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct HayroDocument {
    // Leaked so the cache can borrow it for 'static. Each benchmark job runs in
    // a fresh page, so the allocation is reclaimed with the page.
    pdf: &'static Pdf,
    cache: RenderCache<'static>,
    settings: InterpreterSettings,
}

#[wasm_bindgen]
pub struct RenderedPage {
    width: u32,
    height: u32,
    pixels: Vec<u8>,
}

#[wasm_bindgen]
impl RenderedPage {
    #[wasm_bindgen(getter)]
    pub fn width(&self) -> u32 {
        self.width
    }

    #[wasm_bindgen(getter)]
    pub fn height(&self) -> u32 {
        self.height
    }

    /// Move the RGBA8 pixels out; the browser copies them into JS memory once.
    pub fn take_pixels(&mut self) -> Vec<u8> {
        std::mem::take(&mut self.pixels)
    }
}

#[wasm_bindgen]
impl HayroDocument {
    #[wasm_bindgen(constructor)]
    pub fn new(data: Vec<u8>) -> Result<HayroDocument, JsError> {
        let pdf = Pdf::new(data).map_err(|err| JsError::new(&format!("{err:?}")))?;
        let pdf: &'static Pdf = Box::leak(Box::new(pdf));
        Ok(HayroDocument {
            pdf,
            cache: RenderCache::new(),
            settings: InterpreterSettings::default(),
        })
    }

    #[wasm_bindgen(js_name = pageCount)]
    pub fn page_count(&self) -> u32 {
        self.pdf.pages().len() as u32
    }

    /// Return the rotation-resolved page size in points as `[width, height]`.
    #[wasm_bindgen(js_name = pageSize)]
    pub fn page_size(&self, index: u32) -> Result<Vec<f32>, JsError> {
        let pages = self.pdf.pages();
        let page = pages
            .get(index as usize)
            .ok_or_else(|| JsError::new("page index out of range"))?;
        let (width, height) = page.render_dimensions();
        Ok(vec![width, height])
    }

    /// Render one page on an opaque white background.
    ///
    /// With an opaque background the premultiplied buffer equals straight
    /// alpha, so no conversion pass is needed.
    pub fn render(&self, index: u32, scale: f32) -> Result<RenderedPage, JsError> {
        let pages = self.pdf.pages();
        let page = pages
            .get(index as usize)
            .ok_or_else(|| JsError::new("page index out of range"))?;
        let pixmap = render(
            page,
            &self.cache,
            &self.settings,
            &RenderSettings::default(),
            &PixmapSettings {
                x_scale: scale,
                y_scale: scale,
                bg_color: WHITE,
            },
        );
        let (width, height) = (u32::from(pixmap.width()), u32::from(pixmap.height()));
        Ok(RenderedPage {
            width,
            height,
            pixels: pixmap.take_rgba8(ImageAlphaType::AlphaPremultiplied),
        })
    }
}
