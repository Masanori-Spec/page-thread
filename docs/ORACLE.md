# Independent EPUB preservation oracle

`tests/oracle.py` uses Python's standard-library `zipfile`, `xml.dom.minidom`, URI resolution, and SHA-256. It imports no production JavaScript and does not call the application's parser, matcher, exporter, or test helpers.

```sh
python3 tests/oracle.py INPUT.epub OUTPUT.epub RECEIPT.json \
  --expected-selection tests/fixtures/expected-selection.json \
  --mapping MAPPING.json
python3 tests/oracle-mutations.py INPUT.epub OUTPUT.epub RECEIPT.json \
  --expected-selection tests/fixtures/expected-selection.json \
  --mapping MAPPING.json
```

The verifier exits nonzero on a mismatch or unsupported input. Its JSON result explicitly says whether a hand-authored expected-selection file and exact exported mapping bytes were supplied. A receipt alone is evidence of the declared transformation, not independent evidence of the editor's intention.

## Frozen receipt contract

The schema is `page-thread-receipt-v1`. Extra informational fields are allowed, but they grant no additional mutation permission.

- `inputSha256`, `outputSha256`, and `mappingSha256` bind the original ZIP, resulting ZIP, and exact exported UTF-8 mapping JSON bytes
- `packagePart` and `navPart` are canonical package-relative names independently recovered through `META-INF/container.xml`, the OPF manifest, and its `nav` property
- `paginationSource` names the print edition or other fixed-pagination source
- `modified: {sourcePath, before, after}` identifies the single original `dcterms:modified` element and its exact old/new text
- `boundaries` is ordered and nonempty. Each entry has `decisionId`, `label`, `phrase`, `sourcePart`, `sourcePartSha256`, `spineIdref`, `sourcePath`, `textNodeIndex`, `offset`, `markerId`, `candidateCount`, and `selectedOccurrence`
- `additions` has `pageListId`, `pageListLabel`, and the exact appended `{property,value}` metadata array
- `changedParts` exhaustively lists `{part,beforeSha256,afterSha256}`
- `unchangedParts` exhaustively lists `{part,sha256}`

Every `sourcePath` is a zero-based element-child path from the original XML document element. Comments and processing instructions do not count as element children. For a boundary, this path identifies the parent of the source text node. `textNodeIndex` counts that parent's direct text and CDATA nodes only, in DOM order. `offset` counts decoded Unicode code points in that original node. Insertion inside CDATA is excluded. The modified metadata path instead identifies the actual `meta` element. All identities describe the input, before any insertion shifts paths or splits text nodes.

Markers use deterministic IDs `pt-page-0001`, `pt-page-0002`, and so on. A marker is an empty XHTML `span` with exactly `id`, `epub:type="pagebreak"`, `role="doc-pagebreak"`, and `aria-label` equal to the page label. Local XHTML/EPUB namespace declarations are permitted on generated elements; original declarations remain unchanged.

The one added navigation element is the last element of the existing nav document's body: XHTML `nav`, `id="pt-page-list"`, `epub:type="page-list"`, `hidden="hidden"`; its children are `h2` with `Pages / ページ` and one flat `ol`. Each `li` contains one `a`, whose label is exact and whose URI independently resolves to the corresponding source part and marker. Formatting whitespace is allowed inside this new subtree, not outside it.

Exactly three OPF metadata elements append after the existing metadata elements, in order:

1. `pageBreakSource`: the exact pagination source
2. `schema:accessibilityFeature`: `pageBreakMarkers`
3. `schema:accessibilityFeature`: `pageNavigation`

Only the declared original `dcterms:modified` text may also change. Its new value must be a real UTC date/time in `YYYY-MM-DDTHH:MM:SSZ` form. When the mapping is supplied, its `modifiedAfter` must agree.

## Independent checks

The oracle checks EPUB ZIP entry uniqueness and safe canonical names, bounded expansion, the physically first uncompressed `mimetype` local record (header offset zero, literal local name, and no local extra field), identical input/output entry sets, package root identity, manifest-to-spine ordering, and the narrow supported profile. No encrypted/signed, scripted, media-overlay, fixed-layout, or pre-paginated input is accepted. Existing pagebreaks, page lists, pagination source, or either pagination feature are rejected.

Phrase candidates are recalculated from the input using a separate Python implementation. Only `p`, `h1`–`h6`, and `li` blocks with ordinary inline descendants (`a`, `em`, `strong`, `span`, `b`, `i`, `u`, `s`, `small`, `sub`, `sup`, `abbr`) qualify. Any CDATA content, unsupported descendants, or hidden/inert/`aria-hidden="true"` ancestors make the block ineligible. Matching skips the navigation document and `linear="no"` spine entries. Matches cannot cross block or `br` boundaries. Case, punctuation, Unicode normalization, NBSP, and ideographic spaces are preserved. Only XML S characters U+0020, U+0009, U+000A, and U+000D collapse to a single ordinary space; matching phrase/block edge spaces are trimmed. Original decoded offsets are retained. Candidate counts and one-based selected occurrences are checked against this independent search, including overlapping matches.

All decisions must be in strict actual spine/text order, with no repeated insertion position. IDs must not collide with original IDs. Generated marker contents/attributes, page-list structure/labels/targets, source metadata, and timestamp are checked directly.

The verifier then checks both directions:

1. Clone the original DOM and perform only the validated additions at the original node/offset identities. Compare the complete expected document with the output
2. Remove only the declared markers, page-list subtree, and three appended metadata elements; restore the single original timestamp. Compare with the complete original document

Comparison includes namespace-expanded element/attribute identities, every original namespace declaration, decoded text, element order, comments, processing instructions, existing CDATA sections, and document type information. Original XML declarations are compared separately. Adjacent ordinary DOM text nodes are coalesced for comparison, as normal XML parsing coalesces them. This permits only the text-node splitting inherent in marker insertion. It does not erase whitespace or normalize prose.

Every other archive member, including CSS, fonts, images, NCX, and opaque resources, must have identical uncompressed bytes. ZIP compression streams and central-directory timestamps are not promised to remain identical.

## Independent intention fixture

`--expected-selection` accepts an array of literal boundary objects or an object with `boundaries`, plus optional `paginationSource` and `modifiedAfter`. The expected file must be hand-authored from the synthetic input, not copied from production receipt output. Every field present in each expected boundary must match the corresponding receipt boundary. Include at least the decision ID, label, phrase, source part, spine ID, source path, text node index, offset, and marker ID.

The mutation harness refreshes receipt ZIP/part hashes after changing outputs, so a passing rejection must depend on the constrained semantics or independent intention, not just stale checksums. It also checks a semantically unchanged XML reserialization positive case before applying negative mutations.

## Standards and limits

The [EPUB 3.3 page-list rules](https://www.w3.org/TR/epub-33/#sec-nav-pagelist) define the navigation structure. The [W3C EPUB Accessibility Techniques pagination guidance](https://www.w3.org/TR/epub-a11y-tech-11/#page-navigation) supplies the marker and pagination-source approach. That guidance recommends `pageBreakSource` and says EPUBCheck accepts it, while explaining its relationship to the older `source-of` mechanism. This application uses the EPUB 3.3 profile with that current pagination-source guidance; it does not claim final EPUB 3.4 conformance.

Run the official [EPUBCheck 5.4.0 release](https://github.com/w3c/epubcheck/releases/tag/v5.4.0) separately on both fixture input and output. This Python oracle does not substitute for EPUBCheck, a real EPUB reader, or accessibility testing. Reader rendering and assistive-technology behavior are separate checks. Neither the oracle nor EPUBCheck can prove that a human-entered phrase is the correct print-page boundary, that all print pages were supplied, or that the publication meets accessibility conformance requirements. No original layout, PDF, image, or OCR source is processed.

## Observed fixture result

On 2026-10-04, the production export of `tests/fixtures/field-notes.epub` passed the independent oracle with `tests/fixtures/expected-selection.json` and the exact `tests/generated/mapping.json` bytes supplied:

- 8 intended boundaries across 3 spine documents whose filenames deliberately sort differently from reading order
- 5 changed XML members, with all original XML content recovered after removing only declared additions and restoring the timestamp
- 4 untouched package members with identical bytes, including CSS and SVG witnesses
- Correct repeated-phrase occurrence, cross-emphasis/entity matching, NBSP, Japanese, combining characters, a code-point offset after emoji, and a direct text node following a comment
- 33 negative mutations rejected after output and part hashes were refreshed, plus successful verification of a harmless XML reserialization

All semantic mutation cases were also rejected without the intended-selection fixture. The decision-ID-only mutation used the independent fixture, since a new arbitrary editor decision ID is not itself a malformed EPUB operation. This result concerns the generated synthetic fixture, not customer publications or universal reader behavior.

The builder's final EPUBCheck 5.4.0 JSON reports for the same input/output were also inspected: both have empty message arrays and zero fatal errors, errors, and warnings. Version 5.4.0 reports `ePubVersion: "3.4"` for its current validation profile. This identifies the validator's profile and does not turn the EPUB 3.4 Candidate Recommendation Draft into a final standard or prove full publication accessibility.

## Vocabulary-prefix checks

OPF property tokens and XHTML `epub:type` values are compared by their independently expanded vocabulary IRIs. XML namespace declarations and EPUB vocabulary-prefix declarations are separate mechanisms. The oracle recognizes canonical reserved prefixes and valid root-declared aliases for non-default vocabularies, including `dcterms:modified`, rendition layout, and schema accessibility features. Thus an alias cannot hide a fixed-layout declaration or existing pagination metadata. Scripted and remote-resource manifest flags are checked in the item vocabulary; spine layout flags use the rendition vocabulary.

[EPUB 3.3 Appendix D.1](https://www.w3.org/TR/epub-33/#sec-vocab-assoc) forbids aliases for default vocabularies and requires vocabulary-prefix declarations on the document root. Accordingly, prefixed `nav`/`pagebreak` aliases to the default item/structural vocabularies are rejected, not treated as conforming alternative spellings. Non-root declarations, undeclared prefixes, duplicate declarations, the reserved `_` prefix, aliases for the Dublin Core elements vocabulary, and reserved-prefix rebinding are outside this profile. The last restriction is a conservative application rule; the specification discourages reserved-prefix overrides rather than universally prohibiting them.

The mutation harness adds 11 independent input-profile checks for these cases. It also creates an input/output pair with a valid root-declared alias for `dcterms:modified`, refreshes the bound mapping and receipt hashes, and verifies the full 8-boundary preservation result against the same hand-authored expected selections. This positive alias check, all 11 negative input checks, the original 33 refreshed-hash output mutations, and the baseline export passed on 2026-10-04. No production parser or exporter is imported by either Python script.


## Physical ZIP order and central-directory order

ZIP central-directory records may have a different order from physical local-file records. The EPUB `mimetype` constraint is therefore checked against its physical local-header offset, not its position in Python `ZipFile.infolist()`. Both the central entry and local header must report stored compression; the initial local filename must be `mimetype`, with no local extra field.

Three positive mutation cases reverse only the central records in the input, output, or both. Every local record and offset remains unchanged, and the full 8-boundary preservation verification passes after refreshing archive/mapping hashes. Two negative cases verify rejection when `mimetype` is physically late despite being first in the central directory, and when its local header contains an extra field. The baseline, 33 output mutations, and 11 vocabulary-profile cases continue to pass.
