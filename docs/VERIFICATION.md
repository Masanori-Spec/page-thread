# Verification record

2026-10-04 UTC · PageThread 0.1.0 · Hosted evidence pinned to commit `11411ee7836a7001735b9db9bfb9117baa2a47d6`, [run 37195622780](https://github.com/Masanori-Spec/page-thread/actions/runs/37195622780). All six jobs passed. Later documentation/package commits require their own external exact-head audit.

## Passed

The local aggregate has **64 passing Node tests**, including nine actual-handler UI regressions and 14 independent reviewer tests. The tests cover exact intended source locations; repeated candidates; inline emphasis/entities; Unicode code-point offsets; comment/PI text nodes; whitespace/case/NBSP/normalization distinctions; strict spine order; source/mapping binding; deterministic replay; existing-pagination rejection; unsupported profiles; Buffer/offset/ArrayBuffer ownership; XML/ZIP limits; namespace and UTF-8 rejection; inert report escaping; worker bundle consistency; and isolated worker execution.

The UI double checks workflow/export/restore, exact labels, sample choices after pasted TSV, language retention, failed replacement retention, cancelled/reset file reads, stale workers, four download contents and imported-text escaping. It does not simulate browser rendering, accessibility trees or native worker scheduling.

The separate Python oracle verifies eight literal intended boundaries from the hand-authored fixture. It recovers all original XML/text/comments/PIs after removing only the receipt-declared additions and reverting the declared modified timestamp. Five XML parts change; four other members remain byte-identical. Thirty-three semantic/structural mutations are rejected after output and part hashes are refreshed. Eleven additional invalid-input vocabulary cases reject, and a valid root dcterms alias completes a positive round trip. A harmless XML serialization change passes, so the oracle is testing structure and content rather than one serializer's spelling. See [ORACLE.md](ORACLE.md).

Official EPUBCheck **5.4.0** validates both actual fixture files with zero fatal/error/warning/usage messages. The [raw source report](epubcheck-evidence/source.json), [raw output report](epubcheck-evidence/output.json) and [hash-binding record](epubcheck-evidence/results.json) are included. The official release archive and JAR hashes are recorded. Java 21 was used locally.

- Source EPUB SHA-256: `8600894b09e9da1c0bf671ba42b37b4f6e565e15fa435b9ab0dbd1e3fc507d27`
- Output EPUB SHA-256: `fc3599f09ce46cf4116bed104914c50b6516a29fb6f5d962937d36f4e27c4e26`

EPUBCheck 5.4.0 labels its validator publication version **3.4**, the current Candidate Recommendation. The implementation profile is EPUB 3.3 structure with current accessibility-techniques pagination-source guidance. No final EPUB 3.4 standard claim is implied by the validator's version label.

The independent review additionally verifies 24 entity/Unicode/inline/comment cases with a separate Python DOM restoration witness, three semantic corruptions, explicit hidden document roots, malformed nav placement, data-descriptor input validation, duplicate-key JSON, multiline saved records, a 500-boundary case, early oversized-input rejection under a 128 MiB heap, real worker-thread preview/export parity and prefixed XML preservation. See [the independent review](INDEPENDENT_REVIEW.md). Every changed output XML part is parsed once before export returns; the per-part ID index is reused for marker verification.

The reviewer also reversed and rotated only central-directory order in an otherwise unchanged ZIP. Export preserves the original physical order (mimetype first) and central order separately. Both the reversed-directory input and its repaired output independently pass official EPUBCheck 5.4.0 with zero messages; [focused source/output files and reports](epubcheck-evidence/order-permutation/results.json) are retained.

## Hosted browser and visual verification

All **14 Chromium scenarios passed**: entry/keyboard skip, JA/EN desktop/mobile views, repeated-candidate choices, actual four-file downloads, exact independent oracle, repeated export, invalidation, saved mapping restore, stale/malformed/reversed mappings, missing phrases, malformed/already-paginated replacement, cancellation/oversized/reset with held real worker callbacks, offline-after-load export, escaped hostile metadata, narrow widths, standalone report printing and cleared reload state. The run recorded no uncaught errors. Chromium launched with its sandbox enabled on ubuntu-22.04; no local browser restriction was bypassed.

The other five hosted jobs passed: Node 22/24 × UTC/Asia/Tokyo, each with 64 tests and zero failures/skips plus the Python suites; and official EPUBCheck 5.4.0 on ubuntu-22.04. The validator release download is SHA-256 pinned. The [hosted raw source/output reports](hosted-evidence/epubcheck/results.json) have empty message lists and zero fatal/error/warning/usage counts, bound to the source and actual output hashes above.

Actual browser EPUB, mapping JSON, receipt JSON and HTML report match module replay. Repeated, restored and offline EPUB exports match byte-for-byte. The independent Python oracle separately verifies the downloaded artifacts against all eight literal intended locations. These are original synthetic fixtures; no customer material was used.

Visual inspection covered Japanese desktop and 390px mobile, English confirmed preview, 320px and 768px responsive screenshots, and every page of the four-page PDF. The 1440/768/390/320px browser checks report no horizontal overflow. The focused skip link remains keyboard-visible and is clipped/transparent after focus moves. All four final PDF pages match the individually inspected preceding clean run at 100 DPI. This verifies these browser-generated pages, not an EPUB reading system or physical printer.

The [evidence manifest](hosted-evidence/evidence.json) records the exact run, commit, artifact IDs/archive hashes, selected member hashes and tested runtime source hashes. `npm run test:evidence` rechecks those bindings and replays actual exports through both the module and Python oracle. It does not rerun hosted CI, prove a future head passed, or automatically repeat human visual inspection. The [dated addendum](HOSTED_REVIEW_ADDENDUM.md) preserves the original independent review and records subsequent browser repairs.

## Remaining gates and limits

1. External exact-head CI and source/archive reconciliation for later documentation/package commits
2. Other browser engines, reading systems, real mobile hardware, assistive technology, physical printers and a permission-cleared multi-editor corpus
3. Editorial checks against the actual print edition and usefulness interviews

No reading-system pixel result, editorial page-boundary correctness, full input validation, malware-safety guarantee, overall accessibility conformance or universal compatibility is claimed. The application does not run EPUBCheck on user imports; its bounded eligibility checks are narrower than that validator.
