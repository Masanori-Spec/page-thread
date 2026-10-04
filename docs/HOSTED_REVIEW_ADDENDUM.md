# Hosted verification addendum

2026-10-04 UTC · PageThread 0.1.0

This builder/publication verification addendum records checks after the original [independent functional review](INDEPENDENT_REVIEW.md). It does not change that review or attribute browser work to its reviewer. The original report SHA-256 remains `92f23a7d3044ee2a7a70b5d1761c5bab421ba650cb6c653ae248bdbd83e5eb4c`; the reviewer test file remains `fbd481a247ec051417817b2009fca147b8fe94d52e47858b8bfe92dca263faa7`.

## Inspected implementation

[Commit 11411ee7836a7001735b9db9bfb9117baa2a47d6](https://github.com/Masanori-Spec/page-thread/commit/11411ee7836a7001735b9db9bfb9117baa2a47d6) passed all six jobs in [run 37195622780](https://github.com/Masanori-Spec/page-thread/actions/runs/37195622780): four model/oracle jobs, sandboxed Chromium and official EPUBCheck 5.4.0. Each Node 22/24 × UTC/Asia/Tokyo job reported 64 passing tests, no failures and no skips. All 14 browser scenarios passed with no uncaught errors.

Three browser-stage corrections preceded this run:

1. A keyboard assertion used `.skip` while the actual link class was `.skip-link`. The initial screenshot confirmed the real link was focused; only the test selector changed.
2. The rotated paper illustration and protruding label exceeded the 230px tablet column, producing a 774px document at a 768px viewport. The column became 260px. The strict overflow assertion stayed in place, with element-bound diagnostics added for failures. All tested widths now pass.
3. Translating the unfocused fixed skip link above the viewport still left an overlay in full-page captures. It now uses clipping and opacity with keyboard-focus restoration. The test asserts both focused visibility and the hidden state after interaction. Corrected desktop/mobile screenshots show no overlay.

No EPUB matching, mapping, package editing or receipt semantics changed during those repairs.

## Actual outputs and inspected pixels

The downloaded EPUB, mapping, receipt and HTML match module replay; the mapping bytes match their receipt hash. Repeated, restored and offline EPUB downloads are byte-identical. The separate Python ZIP/XML oracle checks all eight literal intended locations, five changed XML parts, four untouched members and restoration of the original XML. Official EPUBCheck reports for source/output have empty message lists and zero fatal/error/warning/usage counts.

Japanese desktop/mobile, English preview and responsive screenshots were inspected. Every page of the four-page report PDF was inspected; the final four pages have exact pixel equality at 100 DPI with the preceding individually inspected clean pages. The evidence uses the original synthetic fixture. It does not depict an actual commercial book or prove page-boundary editorial correctness.

Selected actual files and archive/source hashes are in [the pinned evidence manifest](hosted-evidence/evidence.json). `scripts/check-hosted-evidence.mjs` verifies the retained hashes, tested source bindings, output replay and independent oracle without claiming a new hosted or visual run.

## Remaining limits

These results apply to the pinned implementation and documented bounded profile. A later documentation/package head needs a separate exact-head CI and source/ZIP audit. Other browser engines, EPUB reading systems, real mobile devices, assistive technology and physical printers remain untested. Editors must check boundaries against their print edition and inspect actual exports in their target readers.

EPUBCheck 5.4.0 reports the current EPUB 3.4 Candidate Recommendation profile. This is not a final EPUB 3.4 standard claim, full validation of every accepted import, an accessibility certification, or proof of universal compatibility or market demand.
