# Independent review: PageThread

Reviewed 2026-10-04. The repaired implementation is ready for hosted CI within its documented EPUB editing profile. The final independent aggregate passed **64 Node tests, zero failures and zero skips**, the Python preservation/mutation suites, syntax and runtime guards, and the static build. No browser, publication or reading-system operation was performed in this review.

## Findings corrected before freeze

1. **Accepted XML whitespace changed on export.** A label containing a tab previewed successfully but failed marker verification after XML attribute normalization. A pagination source containing a carriage return exported successfully with that character changed to LF. XML escaping now uses character references for tab, CR and LF, preserving accepted labels in marker attributes and navigation text, and preserving the source metadata. This follows XML's distinct treatment of literal whitespace and character references during [attribute-value normalization](https://www.w3.org/TR/xml/#AVNormalize).

2. **Hidden document-root ancestors remained searchable.** `hidden`, `inert` and `aria-hidden="true"` on the XHTML root did not exclude its blocks because the eligibility walk stopped at `body`. Ancestor checks now include the document root. Unsupported counts remain explicit. This check concerns encoded hidden state; the program still does not calculate CSS visibility or layout.

3. **Mapping validation could invoke code or silently choose ambiguous values.** Direct records could contain a phrase getter, and sparse arrays produced an unclassified TypeError. Saved JSON silently accepted duplicate keys. Records/mappings now use descriptor-first plain-data checks and dense arrays; JSON rejects duplicate decoded names with byte, depth and token limits. Array length is rejected before index enumeration, and string length before code-point-array allocation. A 16 MiB invalid string rejects normally in a process restricted to a 128 MiB heap.

4. **Navigation insertion could return malformed XML, and verification repeated expensive parsing.** An input whose TOC was outside an empty self-closing navigation body passed inspection; insertion then produced malformed navigation XML while reporting a reopened ZIP. The inspector now requires the TOC inside a non-self-closing body. Every changed XML part, including OPF and navigation, is parsed before return. One ID index per changed part is reused for all marker checks, replacing whole-document reparsing per boundary. A 500-boundary fixture with a 1 MB comment and 5,000 extra elements passes export and preservation checks.

5. **Restored multiline records were damaged by TSV reconstruction.** A valid saved quote containing CRLF restored and previewed correctly, but an immediate Search failed because its editable TSV representation split the field into extra rows. The app retains the exact structured records until the box is edited, and explains that editing switches to one-page-per-line TSV. Unchanged restored records remain searchable without losing their original field strings.

6. **Central-directory order could break the EPUB container on export.** Reversing only a valid input's central-directory records left `mimetype` physically first and passed inspection. The writer then emitted local records in directory order, moving `mimetype` away from byte zero. The writer now preserves original physical order and independently preserves central-directory order, updating offsets. Export verifies the first physical member. The Python oracle was corrected to inspect physical headers instead of assuming directory order was physical order. Independent reversal/rotation regressions check the output's initial local header directly from bytes.

## Independent evidence

The reviewer-owned `tests/reviewer.test.mjs` contains **14 tests**. Its separate Python ZIP/DOM fixture builder and restoration verifier import neither production JavaScript nor the existing oracle. Twenty-four variants combine hand-authored element/text-node/code-point identities with ordinary inline emphasis, comments and processing instructions, XML whitespace, escaped entities, emoji, combining characters, NBSP and ideographic spaces, and exact whitespace-bearing labels. Removing only the declared marker, page list and metadata additions and restoring the timestamp recovers the original document structures, strings and namespace declarations. A further prefixed-XHTML/OPF case verifies additions where default namespaces differ. Text, navigation-label and unrelated-resource corruptions all reject.

The tests also exercise actual UI handlers for duplicate-key rejection and restored multiline records, hidden roots, unsupported navigation placement, getter/sparse/prototype rejection, parser budgets, the maximum 500 decisions, and the final ZIP-order repair. A real Node worker thread exchanges preview/export/error messages, reproduces module output and receipts, and leaves caller input bytes intact. This is worker-message evidence, not browser evidence.

The aggregate separately verifies the original eight literal editorial locations, five changed XML parts and four untouched members. Its existing oracle detects all 33 refreshed-hash output mutations and 11 invalid vocabulary-profile inputs, accepts the valid modified-property alias and harmless XML reserialization, and now checks three central-order positives plus physical-order/local-extra negatives.

Built modules were compared byte-for-byte with source and imported independently. Their EPUB and receipt output match source. The generated worker bundle also matches current modules.

## Official validator evidence

The retained [EPUBCheck 5.4.0 reports](epubcheck-evidence/results.json) were rechecked against the exact current standard fixture bytes. Both have empty message lists and zero fatal/error/warning/usage counts:

- Source: `8600894b09e9da1c0bf671ba42b37b4f6e565e15fa435b9ab0dbd1e3fc507d27`
- Output: `fc3599f09ce46cf4116bed104914c50b6516a29fb6f5d962937d36f4e27c4e26`

The builder also ran the already installed official validator on an independently constructed central-directory-permuted source and repaired output; the [focused evidence](epubcheck-evidence/order-permutation/results.json) is retained separately. This reviewer read both raw reports and independently hashed both files; each report has the same zero counts and no messages:

- Permuted source: `31199a386e7d83d7332692960435000c794746f1e6e4ab42bb93234c295f177e`
- Repaired output: `24e8eaf0868aedc92cebb5730477d0b54f793157030b6ad40727d4ce4abc6670`

These runs validate those fixtures. They do not validate every user import or all independent test variants. EPUBCheck 5.4.0 reports its current EPUB 3.4 Candidate Recommendation profile; no final EPUB 3.4 conformance claim is implied.

## Scope and remaining release gates

The [EPUB 3.3 container rules](https://www.w3.org/TR/epub-33/#sec-zip-container-mime) require `mimetype` first; its [page-list rules](https://www.w3.org/TR/epub-33/#sec-nav-pagelist) describe navigation to static boundaries. Current [W3C pagination-source guidance](https://www.w3.org/TR/epub-a11y-tech-11/#page-navigation) supports `pageBreakSource` and descriptive source information. These sources support the output structure and metadata contract, not a claim that the editor chose the correct print boundaries.

Fourteen sandbox-enabled browser scenarios and six hosted CI jobs remain authored but unrun at this local review stage. Hosted execution, inspection of screenshots and print PDFs, real downloads, browser cancellation, reading systems, devices and assistive technology remain separate release checks.

The tool neither infers print pages nor confirms that all boundaries were supplied. Labels need not be numeric or unique. Exact input/mapping hashes bind artifacts, not reviewer identity or editorial truth. Unsupported block/profile exclusions and bounded refusals remain part of the contract; the app is not a complete EPUB validator or malware scanner. No reader-rendering, pagination-layout, universal compatibility or overall accessibility-conformance claim is established by this review.
