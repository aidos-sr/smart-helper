# UI fonts

Noto Sans and Noto Sans Mono are served locally under the SIL Open Font License 1.1. The adjacent OFL files contain the original copyright and license notices.

Sources from Google's official font collection:

- https://github.com/google/fonts/tree/main/ofl/notosans
- https://github.com/google/fonts/tree/main/ofl/notosansmono

The WOFF2 files retain Latin, Cyrillic (including Ә Ғ Қ Ң Ө Ұ Ү Һ І and lowercase), common punctuation, currency signs and arrows. They were subset from NotoSans[wdth,wght].ttf and NotoSansMono[wdth,wght].ttf using fontTools, with width fixed at 100 and weight ranges 300–800 / 400–600 respectively. Both output cmaps were checked for all Kazakh Cyrillic letters. Empty gvar entries for non-varying glyphs were materialized before subsetting for fontTools compatibility.

These UI and code fonts do not replace KaTeX's bundled mathematical fonts.
