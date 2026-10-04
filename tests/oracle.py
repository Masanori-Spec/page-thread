#!/usr/bin/env python3
"""Independent, standard-library EPUB addition/preservation verifier.

No production JavaScript imports. See docs/ORACLE.md for the bounded contract.
"""
from __future__ import annotations
import argparse
from datetime import datetime
import hashlib
import json
import posixpath
import re
import sys
import zipfile
from pathlib import Path
from urllib.parse import unquote, urlsplit
from xml.dom import Node, minidom

XHTML = 'http://www.w3.org/1999/xhtml'
EPUB = 'http://www.idpf.org/2007/ops'
OPF = 'http://www.idpf.org/2007/opf'
CONTAINER = 'urn:oasis:names:tc:opendocument:xmlns:container'
XMLNS = 'http://www.w3.org/2000/xmlns/'
META_VOCAB = 'http://idpf.org/epub/vocab/package/meta/#'
ITEM_VOCAB = 'http://idpf.org/epub/vocab/package/item/#'
ITEMREF_VOCAB = 'http://idpf.org/epub/vocab/package/itemref/#'
STRUCTURE_VOCAB = 'http://www.idpf.org/epub/vocab/structure/#'
RENDITION_VOCAB = 'http://www.idpf.org/vocab/rendition/#'
DC_TERMS = 'http://purl.org/dc/terms/'
SCHEMA_VOCAB = 'http://schema.org/'
RESERVED_PREFIXES = {
    'a11y': 'http://www.idpf.org/epub/vocab/package/a11y/#',
    'dcterms': DC_TERMS, 'marc': 'http://id.loc.gov/vocabulary/',
    'media': 'http://www.idpf.org/epub/vocab/overlays/#',
    'onix': 'http://www.editeur.org/ONIX/book/codelists/current.html#',
    'rendition': RENDITION_VOCAB, 'schema': SCHEMA_VOCAB,
    'xsd': 'http://www.w3.org/2001/XMLSchema#',
    'msv': 'http://www.idpf.org/epub/vocab/structure/magazine/#',
    'prism': 'http://www.prismstandard.org/specifications/3.0/PRISM_CV_Spec_3.0.htm#',
}
XML_S = re.compile(r'[\x20\x09\x0a\x0d]+')
BLOCKS = {'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li'}
INLINE = {'a', 'em', 'strong', 'span', 'b', 'i', 'u', 's', 'small', 'sub', 'sup', 'abbr'}
TEXT_TYPES = {Node.TEXT_NODE, Node.CDATA_SECTION_NODE}
IDENTITY_KEYS = ('decisionId', 'label', 'phrase', 'sourcePart', 'spineIdref',
                 'sourcePath', 'textNodeIndex', 'offset', 'markerId')

class Failure(Exception):
    pass

def require(condition, message):
    if not condition:
        raise Failure(message)

def sha(data):
    return hashlib.sha256(data).hexdigest()

def integer(value):
    return isinstance(value, int) and not isinstance(value, bool)

def load_json(path):
    def unique(pairs):
        result = {}
        for key, value in pairs:
            require(key not in result, 'Duplicate JSON key: ' + key)
            result[key] = value
        return result
    return json.loads(Path(path).read_text(encoding='utf-8'), object_pairs_hook=unique)

def package_path(value):
    require(isinstance(value, str) and value and not value.startswith('/'), 'Invalid package part')
    require('\\' not in value and '\x00' not in value, 'Unsafe package part')
    require(all(p not in ('', '.', '..') for p in value.split('/')), 'Noncanonical package part: ' + value)
    return value

def resolve(source, href):
    require(isinstance(href, str), 'Missing URI')
    u = urlsplit(href)
    require(not u.scheme and not u.netloc and not u.query, 'Nonlocal or query-bearing reference')
    raw = unquote(u.path)
    require('\\' not in raw and '\x00' not in raw, 'Unsafe URI')
    result = posixpath.normpath(posixpath.join(posixpath.dirname(source), raw)) if raw else source
    require(not result.startswith('../') and not result.startswith('/'), 'Escaping reference')
    return package_path(result), unquote(u.fragment)

def archive(path):
    raw = Path(path).read_bytes()
    require(len(raw) <= 30 * 1024 * 1024, 'Compressed archive exceeds oracle cap')
    with zipfile.ZipFile(path) as z:
        infos = z.infolist()
        names = [i.filename for i in infos]
        require(len(names) == len(set(names)), 'Duplicate ZIP entry')
        require('mimetype' in names, 'Missing EPUB mimetype entry')
        mimetype = z.getinfo('mimetype')
        require(mimetype.header_offset == 0, 'mimetype must be the first physical ZIP local record')
        require(mimetype.compress_type == zipfile.ZIP_STORED, 'mimetype must be uncompressed')
        require(len(raw) >= 30 and raw[:4] == b'PK\x03\x04', 'Missing initial ZIP local header')
        name_length = int.from_bytes(raw[26:28], 'little')
        extra_length = int.from_bytes(raw[28:30], 'little')
        require(raw[30:30 + name_length] == b'mimetype', 'Initial local header name must be mimetype')
        require(int.from_bytes(raw[8:10], 'little') == zipfile.ZIP_STORED, 'Local mimetype compression must be stored')
        require(extra_length == 0, 'Local mimetype header must not contain an extra field')
        require(sum(i.file_size for i in infos) <= 100 * 1024 * 1024, 'Expanded archive exceeds oracle cap')
        require(len(infos) <= 10000, 'Too many ZIP entries')
        for i in infos:
            require(not i.flag_bits & 1, 'Encrypted ZIP member')
            package_path(i.filename.rstrip('/'))
        data = {i.filename: z.read(i) for i in infos}
    require(data.get('mimetype') == b'application/epub+zip', 'Incorrect EPUB mimetype')
    require('META-INF/encryption.xml' not in data and 'META-INF/signatures.xml' not in data,
            'Encrypted/signed package is outside the profile')
    return raw, data

def xml(data):
    require(len(data) <= 8 * 1024 * 1024, 'XML part exceeds oracle cap')
    require(not re.search(br'<!ENTITY\s', data, re.I), 'Entity declarations are outside the profile')
    try:
        return minidom.parseString(data)
    except Exception as exc:
        raise Failure('Invalid XML: ' + str(exc)) from exc

def elements(node):
    return [n for n in node.childNodes if n.nodeType == Node.ELEMENT_NODE]

def descendants(node, ns=None, local=None):
    for child in elements(node):
        if (ns is None or child.namespaceURI == ns) and (local is None or child.localName == local):
            yield child
        yield from descendants(child, ns, local)

def one(items, message):
    items = list(items)
    require(len(items) == 1, message)
    return items[0]

def child(node, ns, local):
    return one((e for e in elements(node) if e.namespaceURI == ns and e.localName == local),
               'Expected one direct ' + local)

def at_path(root, path):
    require(isinstance(path, list) and all(integer(i) and i >= 0 for i in path), 'Invalid element path')
    node = root
    for index in path:
        kids = elements(node)
        require(index < len(kids), 'Element path does not exist')
        node = kids[index]
    return node

def path_of(node):
    path = []
    while node.parentNode and node.parentNode.nodeType == Node.ELEMENT_NODE:
        path.append(elements(node.parentNode).index(node))
        node = node.parentNode
    return list(reversed(path))

def text_nodes(node):
    return [n for n in node.childNodes if n.nodeType in TEXT_TYPES]

def text_content(node):
    if node.nodeType in TEXT_TYPES:
        return node.data
    return ''.join(text_content(n) for n in node.childNodes)

def normalized(text):
    return XML_S.sub(' ', text).strip(' ')

def attrs(node, exclude_xmlns=False):
    return {(a.namespaceURI or '', a.localName or a.name): a.value
            for a in node.attributes.values()
            if not (exclude_xmlns and a.namespaceURI == XMLNS)}

def exact_attrs(node, expected):
    require(attrs(node, True) == expected, 'Unexpected attributes on generated ' + node.tagName)
    for a in node.attributes.values():
        if a.namespaceURI == XMLNS:
            require(a.value in (XHTML, EPUB), 'Unexpected namespace declaration on addition')

def fingerprint(node):
    """Preserves all original namespace bindings, comments, PIs and text order.
    Only adjacent ordinary Text nodes are merged, as XML parsing does implicitly.
    CDATA remains distinct so existing CDATA rewrites are detected.
    """
    t = node.nodeType
    if t == Node.ELEMENT_NODE:
        head = ('element', node.namespaceURI or '', node.localName, tuple(sorted(attrs(node).items())))
    elif t == Node.DOCUMENT_NODE:
        head = ('document',)
    elif t == Node.DOCUMENT_TYPE_NODE:
        return ('doctype', node.name, node.publicId, node.systemId, node.internalSubset)
    elif t == Node.PROCESSING_INSTRUCTION_NODE:
        return ('pi', node.target, node.data)
    elif t == Node.COMMENT_NODE:
        return ('comment', node.data)
    elif t in TEXT_TYPES:
        return ('text' if t == Node.TEXT_NODE else 'cdata', node.data)
    else:
        raise Failure('Unsupported XML node type ' + str(t))
    out = []
    for n in node.childNodes:
        value = fingerprint(n)
        if value[0] == 'text' and not value[1]:
            continue
        if value[0] == 'text' and out and out[-1][0] == 'text':
            out[-1] = ('text', out[-1][1] + value[1])
        else:
            out.append(value)
    return head + (tuple(out),)

def declaration(data):
    return re.match(br'(?:\xef\xbb\xbf)?\s*(<\?xml\s.*?\?>)', data, re.S).group(1) if re.match(br'(?:\xef\xbb\xbf)?\s*<\?xml\s', data) else None

def blocked(node):
    while node and node.nodeType == Node.ELEMENT_NODE:
        if node.hasAttribute('hidden') or node.hasAttribute('inert') or node.getAttribute('aria-hidden').lower() == 'true':
            return True
        node = node.parentNode
    return False

def candidate_stream(block):
    require(block.namespaceURI == XHTML, 'Non-XHTML block')
    if blocked(block):
        return None
    if any(e.namespaceURI != XHTML or e.localName not in INLINE or blocked(e)
           for e in descendants(block)):
        return None
    def contains_cdata(node):
        return any(n.nodeType == Node.CDATA_SECTION_NODE or contains_cdata(n) for n in node.childNodes)
    if contains_cdata(block):
        return None
    pairs = []
    def visit(node):
        for n in node.childNodes:
            if n.nodeType in TEXT_TYPES:
                for offset, ch in enumerate(n.data):
                    pairs.append((ch, n, offset))
            elif n.nodeType == Node.ELEMENT_NODE:
                visit(n)
    visit(block)
    out, locs = [], []
    was_space = False
    for ch, n, offset in pairs:
        is_space = ch in ' \t\n\r'
        if not (is_space and was_space):
            out.append(' ' if is_space else ch)
            locs.append((n, offset))
        was_space = is_space
    if out and out[0] == ' ':
        out.pop(0); locs.pop(0)
    if out and out[-1] == ' ':
        out.pop(); locs.pop()
    return ''.join(out), locs

def find_candidates(docs, spine, phrase):
    phrase = normalized(phrase)
    require(phrase, 'Empty normalized phrase')
    found = []
    for idref, part in spine:
        for block in descendants(docs[part], XHTML):
            if block.localName not in BLOCKS:
                continue
            stream = candidate_stream(block)
            if stream is None:
                continue
            content, locs = stream
            start = 0
            while True:
                index = content.find(phrase, start)
                if index < 0:
                    break
                n, offset = locs[index]
                if n.nodeType == Node.TEXT_NODE:
                    found.append({'sourcePart': part, 'spineIdref': idref,
                                  'sourcePath': path_of(n.parentNode),
                                  'textNodeIndex': text_nodes(n.parentNode).index(n), 'offset': offset})
                start = index + 1
    return found

def property_prefixes(node, content=False):
    """Resolve vocabulary declarations separately from XML namespace bindings."""
    mappings = dict(RESERVED_PREFIXES)
    chain = []
    current = node
    while current and current.nodeType == Node.ELEMENT_NODE:
        chain.append(current)
        current = current.parentNode
    for element in reversed(chain):
        if content:
            require(not element.hasAttributeNS(EPUB, 'prefix') or element is element.ownerDocument.documentElement, 'EPUB vocabulary prefixes must be declared on the root')
        else:
            require(not element.hasAttribute('prefix') or element is element.ownerDocument.documentElement, 'Package vocabulary prefixes must be declared on the root')
        declaration = element.getAttributeNS(EPUB, 'prefix') if content else (
            element.getAttribute('prefix') if element is element.ownerDocument.documentElement else '')
        fields = XML_S.split(declaration.strip(' \t\r\n')) if declaration else []
        require(len(fields) % 2 == 0, 'Malformed vocabulary prefix declaration')
        used = set()
        for index in range(0, len(fields), 2):
            key, uri = fields[index], fields[index + 1]
            require(re.fullmatch(r'[A-Za-z_][A-Za-z0-9_.-]*:', key), 'Invalid vocabulary prefix name')
            name = key[:-1]
            require(name not in used and name != '_', 'Duplicate/reserved vocabulary prefix name')
            require(re.match(r'[A-Za-z][A-Za-z0-9+.-]*:', uri), 'Vocabulary URI must be absolute')
            require(name not in RESERVED_PREFIXES or RESERVED_PREFIXES[name] == uri,
                    'Reserved vocabulary prefix rebound outside profile')
            require(uri not in {META_VOCAB, ITEM_VOCAB, ITEMREF_VOCAB, STRUCTURE_VOCAB, 'http://idpf.org/epub/vocab/package/link/#'}, 'Default vocabulary cannot have an alias')
            require(uri != 'http://purl.org/dc/elements/1.1/', 'Dublin Core elements vocabulary alias is forbidden')
            mappings[name] = uri
            used.add(name)
    return mappings


def property_iri(token, node, default, content=False):
    require(token and not XML_S.search(token), 'Empty or whitespace-containing vocabulary token')
    if ':' not in token:
        return default + token
    require(token.count(':') == 1, 'Invalid vocabulary property token')
    prefix, term = token.split(':')
    mappings = property_prefixes(node, content)
    require(prefix and term and prefix in mappings, 'Undeclared vocabulary prefix')
    return mappings[prefix] + term


def property_iris(value, node, default, content=False):
    return {property_iri(t, node, default, content)
            for t in XML_S.split(value.strip(' \t\r\n')) if t}


def meta_iri(node):
    raw = node.getAttribute('property')
    return property_iri(raw, node, META_VOCAB) if raw else ''


def inspect_package(data):
    container = xml(data['META-INF/container.xml'])
    rootfile = one(descendants(container, CONTAINER, 'rootfile'), 'Expected one package rootfile')
    part = package_path(rootfile.getAttribute('full-path'))
    require(rootfile.getAttribute('media-type') == 'application/oebps-package+xml', 'Unexpected rootfile type')
    pkg = xml(data[part]); root = pkg.documentElement
    require(root.namespaceURI == OPF and root.localName == 'package' and root.getAttribute('version') == '3.0', 'Expected EPUB3 package')
    property_prefixes(root)
    require(all(not e.hasAttribute('prefix') for e in descendants(root)), 'Package vocabulary prefixes must be declared on the root')
    manifest = child(root, OPF, 'manifest')
    items = {}
    nav_parts = []
    for item in elements(manifest):
        require(item.namespaceURI == OPF and item.localName == 'item', 'Unsupported manifest child')
        item_id = item.getAttribute('id')
        require(item_id and item_id not in items, 'Duplicate/empty manifest ID')
        target, fragment = resolve(part, item.getAttribute('href'))
        require(not fragment and target in data, 'Missing or fragmented manifest resource')
        props = property_iris(item.getAttribute('properties'), item, ITEM_VOCAB)
        require(not ({ITEM_VOCAB + 'scripted', ITEM_VOCAB + 'remote-resources'} & props) and not item.hasAttribute('media-overlay'), 'Script/remote resource/media overlay outside profile')
        items[item_id] = (target, item.getAttribute('media-type'))
        if ITEM_VOCAB + 'nav' in props:
            nav_parts.append(target)
    nav = one(nav_parts, 'Expected one nav manifest resource')
    spine = []
    for itemref in elements(child(root, OPF, 'spine')):
        require(itemref.namespaceURI == OPF and itemref.localName == 'itemref', 'Unexpected spine child')
        ref = itemref.getAttribute('idref')
        require(ref in items, 'Unknown spine reference')
        require(RENDITION_VOCAB + 'layout-pre-paginated' not in property_iris(itemref.getAttribute('properties'), itemref, ITEMREF_VOCAB), 'Fixed layout outside profile')
        target, media = items[ref]
        require(media == 'application/xhtml+xml', 'Non-XHTML spine outside profile')
        # Navigation is not a page-boundary matching surface.
        if target != nav and itemref.getAttribute('linear') != 'no':
            spine.append((ref, target))
    require(spine and len(spine) <= 200 and len({p for _, p in spine}) == len(spine), 'Invalid or repeated spine entries')
    docs = {p: xml(data[p]) for p, media in items.values() if media == 'application/xhtml+xml'}
    require(nav in docs, 'Nav is not XHTML')
    metadata = child(root, OPF, 'metadata')
    for m in elements(metadata):
        if m.namespaceURI == OPF and m.localName == 'meta':
            prop, value = meta_iri(m), text_content(m).strip()
            require(not (prop == RENDITION_VOCAB + 'layout' and value == 'pre-paginated'), 'Fixed layout outside profile')
            require(prop != META_VOCAB + 'pageBreakSource' and not (prop == SCHEMA_VOCAB + 'accessibilityFeature' and value in ('pageBreakMarkers', 'pageNavigation')),
                    'Existing pagination metadata outside profile')
    for doc in docs.values():
        require(doc.documentElement.namespaceURI == XHTML and doc.documentElement.localName == 'html', 'Expected XHTML document')
        for e in descendants(doc):
            property_prefixes(e, True)
            types = property_iris(e.getAttributeNS(EPUB, 'type'), e, STRUCTURE_VOCAB, True)
            require(STRUCTURE_VOCAB + 'pagebreak' not in types and 'doc-pagebreak' not in e.getAttribute('role').split(), 'Existing pagebreak')
            require(STRUCTURE_VOCAB + 'page-list' not in types, 'Existing page list')
            require(not (e.namespaceURI == XHTML and e.localName == 'script'), 'Script outside profile')
    return part, nav, pkg, docs, spine

def exact_leaf(node, local, text, expected_attrs=None):
    require(node.namespaceURI == XHTML and node.localName == local, 'Incorrect generated ' + local)
    exact_attrs(node, expected_attrs or {})
    require(all(n.nodeType == Node.TEXT_NODE for n in node.childNodes), 'Non-text generated label')
    require(text_content(node) == text, 'Generated label differs')

def verify(input_path, output_path, receipt_path, expected_path=None, mapping_path=None):
    receipt = load_json(receipt_path)
    require(receipt.get('schema') == 'page-thread-receipt-v1', 'Wrong receipt schema')
    in_raw, before = archive(input_path); out_raw, after = archive(output_path)
    require(receipt.get('inputSha256') == sha(in_raw), 'Input hash mismatch')
    require(receipt.get('outputSha256') == sha(out_raw), 'Output hash mismatch')
    require(set(before) == set(after), 'Package entry set changed')
    require(re.fullmatch('[0-9a-f]{64}', receipt.get('mappingSha256', '')), 'Invalid mapping hash')
    if mapping_path:
        require(receipt['mappingSha256'] == sha(Path(mapping_path).read_bytes()), 'Mapping hash mismatch')
    package, nav_part, pkg, docs, spine = inspect_package(before)
    require(receipt.get('packagePart') == package and receipt.get('navPart') == nav_part, 'Receipt package/nav identity mismatch')
    boundaries = receipt.get('boundaries')
    require(isinstance(boundaries, list) and 0 < len(boundaries) <= 500, 'Expected 1–500 boundaries')
    require(isinstance(receipt.get('paginationSource'), str) and normalized(receipt['paginationSource']), 'Missing pagination source')
    expected = load_json(expected_path) if expected_path else None
    if expected is not None:
        expected = {'boundaries': expected} if isinstance(expected, list) else expected
        wanted = expected['boundaries']
        require(isinstance(wanted, list) and all(isinstance(b, dict) and all(k in b for k in IDENTITY_KEYS) for b in wanted), 'Incomplete independent selection fixture')
        require(len(wanted) == len(boundaries), 'Intended boundary count differs')
        for actual, intended in zip(boundaries, wanted):
            require(all(actual.get(k) == v for k, v in intended.items()), 'Boundary differs from hand-authored intention')
        if 'paginationSource' in expected:
            require(expected['paginationSource'] == receipt['paginationSource'], 'Intended edition differs')
        if 'modifiedAfter' in expected:
            require(expected['modifiedAfter'] == receipt['modified']['after'], 'Intended timestamp differs')
    changed = {p for p in before if before[p] != after[p]}
    permitted = {package, nav_part} | {b['sourcePart'] for b in boundaries}
    require(changed == permitted, 'Changed parts differ from declared operation surface')
    rows = receipt.get('changedParts', [])
    require(len(rows) == len(changed) and {r['part'] for r in rows} == changed, 'Incomplete/duplicate changedParts')
    for r in rows:
        require(r['beforeSha256'] == sha(before[r['part']]) and r['afterSha256'] == sha(after[r['part']]), 'Changed-part hash mismatch')
    unchanged = set(before) - changed
    rows = receipt.get('unchangedParts', [])
    require(len(rows) == len(unchanged) and {r['part'] for r in rows} == unchanged, 'Incomplete/duplicate unchangedParts')
    for r in rows:
        require(r['sha256'] == sha(before[r['part']]) and after[r['part']] == before[r['part']], 'Unchanged member bytes differ')
    out_docs = {p: xml(after[p]) for p in permitted}
    for p in permitted:
        require(declaration(before[p]) == declaration(after[p]), 'Original XML declaration changed')
    originals = dict(docs); originals[package] = pkg
    expected_docs = {p: originals[p].cloneNode(True) for p in permitted}
    # Full document text order gives a position independent of block matching.
    ranks = {}
    for spine_index, (_, p) in enumerate(spine):
        index = [0]
        def walk(n):
            if n.nodeType in TEXT_TYPES:
                ranks[(p, tuple(path_of(n.parentNode)), text_nodes(n.parentNode).index(n))] = (spine_index, index[0])
                index[0] += 1
            for c in n.childNodes:
                walk(c)
        walk(docs[p])
    previous = None
    decisions = set()
    marker_nodes = {}
    source_nodes = []
    candidate_cache = {}
    for i, b in enumerate(boundaries):
        require(all(k in b for k in IDENTITY_KEYS), 'Incomplete boundary')
        p = b['sourcePart']
        require(p in dict((p, r) for r, p in spine), 'Boundary not in supported linear spine')
        require(isinstance(b['label'], str) and normalized(b['label']), 'Empty page label')
        require(isinstance(b['phrase'], str) and len(b['phrase']) <= 256, 'Invalid phrase')
        require(isinstance(b['decisionId'], str) and b['decisionId'] and b['decisionId'] not in decisions, 'Duplicate/empty decision ID')
        decisions.add(b['decisionId'])
        require(b.get('sourcePartSha256') == sha(before[p]), 'Source part hash mismatch')
        require(b['markerId'] == f'pt-page-{i+1:04}', 'Marker ID/order differs')
        require(not any(e.getAttribute('id') == b['markerId'] for e in descendants(docs[p])), 'Original marker ID collision')
        require(integer(b['textNodeIndex']) and b['textNodeIndex'] >= 0 and integer(b['offset']), 'Invalid text position')
        original_parent = at_path(docs[p].documentElement, b['sourcePath'])
        original_texts = text_nodes(original_parent)
        require(b['textNodeIndex'] < len(original_texts), 'Text node index missing')
        original_text = original_texts[b['textNodeIndex']]
        require(original_text.nodeType == Node.TEXT_NODE and 0 <= b['offset'] < len(original_text.data), 'Unsupported text insertion')
        key = normalized(b['phrase'])
        if key not in candidate_cache:
            candidate_cache[key] = find_candidates(docs, spine, b['phrase'])
        candidates = candidate_cache[key]
        occurrence = b.get('selectedOccurrence')
        require(integer(occurrence) and 1 <= occurrence <= len(candidates), 'Invalid selected occurrence')
        require(integer(b.get('candidateCount')) and b['candidateCount'] == len(candidates), 'Candidate count differs from independent search')
        candidate = candidates[occurrence - 1]
        require(all(b.get(k) == v for k, v in candidate.items()), 'Chosen occurrence/location differs')
        rank = ranks[(p, tuple(b['sourcePath']), b['textNodeIndex'])] + (b['offset'],)
        require(previous is None or previous < rank, 'Boundaries are not strictly increasing')
        previous = rank
        marker = one((e for e in descendants(out_docs[p]) if e.getAttribute('id') == b['markerId']), 'Missing/duplicate page marker')
        require(marker.namespaceURI == XHTML and marker.localName == 'span' and not marker.childNodes, 'Marker must be empty XHTML span')
        exact_attrs(marker, {('', 'id'): b['markerId'], (EPUB, 'type'): 'pagebreak', ('', 'role'): 'doc-pagebreak', ('', 'aria-label'): b['label']})
        marker_nodes[(p, b['markerId'])] = marker
        parent = at_path(expected_docs[p].documentElement, b['sourcePath'])
        source_nodes.append((b, text_nodes(parent)[b['textNodeIndex']]))
    # Insert from the end: input paths and offsets never shift.
    for b, text in reversed(source_nodes):
        parent = text.parentNode
        trailing = text.splitText(b['offset'])
        addition = expected_docs[b['sourcePart']].importNode(marker_nodes[(b['sourcePart'], b['markerId'])], True)
        parent.insertBefore(addition, trailing)
    additions = receipt.get('additions', {})
    require(additions.get('pageListId') == 'pt-page-list' and additions.get('pageListLabel') == 'Pages / ページ', 'Unexpected page-list identity/label')
    require(not any(e.getAttribute('id') == 'pt-page-list' for e in descendants(docs[nav_part])), 'Existing page-list ID collision')
    out_nav = one((e for e in descendants(out_docs[nav_part], XHTML, 'nav') if STRUCTURE_VOCAB + 'page-list' in property_iris(e.getAttributeNS(EPUB, 'type'), e, STRUCTURE_VOCAB, True)), 'Expected one output page-list')
    exact_attrs(out_nav, {('', 'id'): 'pt-page-list', (EPUB, 'type'): 'page-list', ('', 'hidden'): 'hidden'})
    require(out_nav.parentNode is child(out_docs[nav_part].documentElement, XHTML, 'body'), 'Page-list is not direct body child')
    require(all(n.nodeType == Node.ELEMENT_NODE or (n.nodeType == Node.TEXT_NODE and not n.data.strip()) for n in out_nav.childNodes), 'Unexpected nav node')
    nav_children = elements(out_nav)
    require(len(nav_children) == 2, 'Expected heading and list')
    exact_leaf(nav_children[0], 'h2', 'Pages / ページ')
    ol = nav_children[1]
    require(ol.namespaceURI == XHTML and ol.localName == 'ol', 'Expected ol')
    exact_attrs(ol, {})
    require(all(n.nodeType == Node.ELEMENT_NODE or (n.nodeType == Node.TEXT_NODE and not n.data.strip()) for n in ol.childNodes), 'Unexpected list node')
    lis = elements(ol)
    require(len(lis) == len(boundaries), 'Page-list count differs')
    for li, b in zip(lis, boundaries):
        require(li.namespaceURI == XHTML and li.localName == 'li', 'Expected li')
        exact_attrs(li, {})
        require(all(n.nodeType == Node.ELEMENT_NODE or (n.nodeType == Node.TEXT_NODE and not n.data.strip()) for n in li.childNodes), 'Unexpected li content')
        link = one(elements(li), 'Expected one a in li')
        require(link.hasAttribute('href'), 'Missing page link')
        exact_leaf(link, 'a', b['label'], {('', 'href'): link.getAttribute('href')})
        require(resolve(nav_part, link.getAttribute('href')) == (b['sourcePart'], b['markerId']), 'Page link target differs')
    require(elements(out_nav.parentNode)[-1] is out_nav, 'Page-list must append after existing body elements')
    child(expected_docs[nav_part].documentElement, XHTML, 'body').appendChild(expected_docs[nav_part].importNode(out_nav, True))
    metadata_expected = [{'property': 'pageBreakSource', 'value': receipt['paginationSource']},
                         {'property': 'schema:accessibilityFeature', 'value': 'pageBreakMarkers'},
                         {'property': 'schema:accessibilityFeature', 'value': 'pageNavigation'}]
    require(additions.get('metadata') == metadata_expected, 'Unexpected declared metadata additions')
    out_metadata = child(out_docs[package].documentElement, OPF, 'metadata')
    old_metadata = child(pkg.documentElement, OPF, 'metadata')
    new_metas = elements(out_metadata)[len(elements(old_metadata)):]
    require(len(new_metas) == 3, 'Expected exactly three appended metadata nodes')
    for m, expected_meta in zip(new_metas, metadata_expected):
        require(m.namespaceURI == OPF and m.localName == 'meta', 'Expected OPF meta')
        require(attrs(m, True) == {('', 'property'): expected_meta['property']}, 'Unexpected metadata attrs')
        require(all(a.namespaceURI != XMLNS or a.value == OPF for a in m.attributes.values()), 'Unexpected metadata namespace')
        require(all(n.nodeType == Node.TEXT_NODE for n in m.childNodes) and text_content(m) == expected_meta['value'], 'Unexpected metadata value')
        child(expected_docs[package].documentElement, OPF, 'metadata').appendChild(expected_docs[package].importNode(m, True))
    modified = receipt.get('modified', {})
    before_mod = at_path(pkg.documentElement, modified.get('sourcePath'))
    require(before_mod.namespaceURI == OPF and before_mod.localName == 'meta' and meta_iri(before_mod) == DC_TERMS + 'modified', 'Modified path differs')
    require(len([e for e in elements(old_metadata) if meta_iri(e) == DC_TERMS + 'modified']) == 1, 'Expected one original modified metadata')
    require(len(before_mod.childNodes) == 1 and before_mod.firstChild.nodeType == Node.TEXT_NODE, 'Unsupported modified metadata structure')
    require(before_mod.firstChild.data == modified.get('before'), 'Original modified timestamp differs')
    require(isinstance(modified.get('after'), str) and re.fullmatch(r'\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ', modified['after']), 'Invalid new timestamp')
    datetime.strptime(modified['after'], '%Y-%m-%dT%H:%M:%SZ')
    if mapping_path:
        mapping = load_json(mapping_path)
        require(mapping.get('modifiedAfter') == modified['after'], 'Mapping timestamp differs')
    expected_mod = at_path(expected_docs[package].documentElement, modified['sourcePath'])
    expected_mod.firstChild.data = modified['after']
    for part in permitted:
        require(fingerprint(expected_docs[part]) == fingerprint(out_docs[part]), 'Output XML differs beyond exact allowed additions: ' + part)
    # Second direction: remove only declared additions and undo the declared timestamp.
    recovered = {p: d.cloneNode(True) for p, d in out_docs.items()}
    for b in boundaries:
        marker = one((e for e in descendants(recovered[b['sourcePart']]) if e.getAttribute('id') == b['markerId']), 'Recovery marker missing')
        marker.parentNode.removeChild(marker)
    recovered_nav = one((e for e in descendants(recovered[nav_part], XHTML, 'nav') if e.getAttribute('id') == 'pt-page-list'), 'Recovery page-list missing')
    recovered_nav.parentNode.removeChild(recovered_nav)
    recovered_metadata = child(recovered[package].documentElement, OPF, 'metadata')
    for m in elements(recovered_metadata)[-3:]:
        recovered_metadata.removeChild(m)
    at_path(recovered[package].documentElement, modified['sourcePath']).firstChild.data = modified['before']
    for part in permitted:
        require(fingerprint(recovered[part]) == fingerprint(originals[part]), 'Removing additions did not recover original XML: ' + part)
    return {'verified': True, 'boundaries': len(boundaries), 'spineDocuments': len(spine),
            'changedParts': len(changed), 'byteIdenticalMembers': len(unchanged),
            'expectedSelectionChecked': bool(expected_path), 'mappingBytesChecked': bool(mapping_path)}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('input'); parser.add_argument('output'); parser.add_argument('receipt')
    parser.add_argument('--expected-selection'); parser.add_argument('--mapping')
    args = parser.parse_args()
    try:
        result = verify(args.input, args.output, args.receipt, args.expected_selection, args.mapping)
    except (Failure, OSError, ValueError, KeyError, TypeError, IndexError, AttributeError, zipfile.BadZipFile) as exc:
        print('FAIL: ' + str(exc), file=sys.stderr)
        return 1
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0

if __name__ == '__main__':
    sys.exit(main())
