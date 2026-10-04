#!/usr/bin/env python3
"""Exercise the independent verifier after refreshing all claimed output hashes."""
from __future__ import annotations
import argparse
import copy
import json
import re
import sys
import tempfile
import zipfile
from pathlib import Path
from xml.dom import Node
import oracle as o


def serialize(doc, original):
    result = doc.toxml(encoding='utf-8')
    result = re.sub(br'^<\?xml\s.*?\?>', b'', result, count=1, flags=re.S)
    decl = o.declaration(original)
    return (decl or b'') + result


def edit_xml(data, part, callback):
    doc = o.xml(data[part])
    callback(doc)
    data[part] = serialize(doc, data[part])


def by_id(doc, value):
    return o.one((e for e in o.descendants(doc) if e.getAttribute('id') == value), 'Mutation target ID missing')


def write_zip(path, data, stored_mimetype=True):
    with zipfile.ZipFile(path, 'w') as z:
        z.writestr('mimetype', data['mimetype'], compress_type=zipfile.ZIP_STORED if stored_mimetype else zipfile.ZIP_DEFLATED)
        for part, value in data.items():
            if part != 'mimetype':
                z.writestr(part, value, compress_type=zipfile.ZIP_DEFLATED)


def refresh(receipt, before, data, output):
    receipt['outputSha256'] = o.sha(output.read_bytes())
    changed = sorted(p for p in data if p not in before or data[p] != before[p])
    receipt['changedParts'] = [{'part': p, 'beforeSha256': o.sha(before[p]) if p in before else None,
                               'afterSha256': o.sha(data[p])} for p in changed]
    receipt['unchangedParts'] = [{'part': p, 'sha256': o.sha(before[p])}
                                 for p in sorted(set(before) & set(data)) if before[p] == data[p]]



def vocabulary_checks(before, original, receipt0, args, temp):
    """Hand-authored semantic aliases; no production matcher/exporter is imported."""
    package, nav = receipt0['packagePart'], receipt0['navPart']
    part = receipt0['boundaries'][0]['sourcePart']
    cases = []
    def package_mutator(prefix, callback=None):
        def change(data):
            def edit(doc):
                root = doc.documentElement
                root.setAttribute('prefix', (root.getAttribute('prefix') + ' ' + prefix).strip())
                if callback:
                    callback(doc)
            edit_xml(data, package, edit)
        return change
    def append_meta(doc, prop, value):
        m = doc.createElementNS(o.OPF, 'meta')
        m.setAttribute('property', prop)
        m.appendChild(doc.createTextNode(value))
        o.child(doc.documentElement, o.OPF, 'metadata').appendChild(m)
    cases.append(('aliased rendition fixed layout', package_mutator('r: ' + o.RENDITION_VOCAB,
                 lambda d: append_meta(d, 'r:layout', 'pre-paginated'))))
    cases.append(('aliased schema page feature', package_mutator('s: ' + o.SCHEMA_VOCAB,
                 lambda d: append_meta(d, 's:accessibilityFeature', 'pageBreakMarkers'))))
    cases.append(('default item vocabulary alias', package_mutator('f: ' + o.ITEM_VOCAB)))
    cases.append(('default metadata vocabulary alias', package_mutator('m: ' + o.META_VOCAB)))
    cases.append(('reserved prefix rebound', package_mutator('schema: https://invalid.example/vocab/')))
    cases.append(('reserved underscore prefix', package_mutator('_: https://invalid.example/vocab/')))
    cases.append(('Dublin Core elements vocabulary alias', package_mutator('dc: http://purl.org/dc/elements/1.1/')))
    cases.append(('undeclared metadata prefix', package_mutator('', lambda d: append_meta(d, 'undeclared:value', 'x'))))
    def content_prefix(data, root, value):
        def edit(doc):
            node = doc.documentElement if root else o.child(doc.documentElement, o.XHTML, 'body')
            node.setAttributeNS(o.XMLNS, 'xmlns:epub', o.EPUB)
            node.setAttributeNS(o.EPUB, 'epub:prefix', value)
        edit_xml(data, part, edit)
    cases.append(('default structural vocabulary alias', lambda data: content_prefix(data, True, 's: ' + o.STRUCTURE_VOCAB)))
    cases.append(('non-root EPUB prefix declaration', lambda data: content_prefix(data, False, 'z: https://invalid.example/vocab/')))
    def nonroot_package(data):
        edit_xml(data, package, lambda d: o.child(d.documentElement, o.OPF, 'metadata').setAttribute('prefix', 'd: ' + o.DC_TERMS))
    cases.append(('non-root OPF prefix declaration', nonroot_package))
    rejected = []
    for name, mutate in cases:
        data = copy.deepcopy(before)
        mutate(data)
        try:
            o.inspect_package(data)
        except o.Failure as exc:
            rejected.append({'name': name, 'rejectedBecause': str(exc)})
        else:
            raise o.Failure('Vocabulary profile mutation accepted: ' + name)
    # A real non-default vocabulary alias is supported and remains byte-preserved.
    input_data, output_data = copy.deepcopy(before), copy.deepcopy(original)
    def alias_modified(doc):
        root = doc.documentElement
        root.setAttribute('prefix', (root.getAttribute('prefix') + ' ocheckd: ' + o.DC_TERMS + ' ocheckr: ' + o.RENDITION_VOCAB).strip())
        m = o.one((e for e in o.descendants(doc, o.OPF, 'meta') if o.meta_iri(e) == o.DC_TERMS + 'modified'), 'Missing original modified metadata')
        m.setAttribute('property', 'ocheckd:modified')
    edit_xml(input_data, package, alias_modified)
    edit_xml(output_data, package, alias_modified)
    source = Path(temp) / 'alias-input.epub'; output = Path(temp) / 'alias-output.epub'
    receipt_path = Path(temp) / 'alias-receipt.json'; mapping_path = Path(temp) / 'alias-mapping.json'
    write_zip(source, input_data); write_zip(output, output_data)
    receipt = copy.deepcopy(receipt0)
    receipt['inputSha256'] = o.sha(source.read_bytes())
    mapping = o.load_json(args.mapping)
    mapping['inputSha256'] = receipt['inputSha256']
    mapping_path.write_text(json.dumps(mapping, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    receipt['mappingSha256'] = o.sha(mapping_path.read_bytes())
    refresh(receipt, input_data, output_data, output)
    receipt_path.write_text(json.dumps(receipt, ensure_ascii=False), encoding='utf-8')
    result = o.verify(source, output, receipt_path, args.expected_selection, mapping_path)
    return {'negativeCasesRejected': rejected, 'positiveModifiedAlias': result}



def reverse_central_directory(raw):
    """Reorder central records only; retain every local record and offset byte."""
    eocd = raw.rfind(b'PK\x05\x06')
    o.require(eocd >= 0, 'Mutation fixture needs a classic ZIP end record')
    count = int.from_bytes(raw[eocd + 10:eocd + 12], 'little')
    size = int.from_bytes(raw[eocd + 12:eocd + 16], 'little')
    start = int.from_bytes(raw[eocd + 16:eocd + 20], 'little')
    cursor, records = start, []
    for _ in range(count):
        o.require(raw[cursor:cursor + 4] == b'PK\x01\x02', 'Invalid central record in test fixture')
        length = 46 + sum(int.from_bytes(raw[cursor + i:cursor + i + 2], 'little') for i in (28, 30, 32))
        records.append(raw[cursor:cursor + length])
        cursor += length
    o.require(cursor == start + size == eocd, 'Unexpected central-directory layout in test fixture')
    return raw[:start] + b''.join(reversed(records)) + raw[cursor:]


def zip_order_checks(before, original, receipt0, args, temp):
    input_raw, output_raw = Path(args.input).read_bytes(), Path(args.output).read_bytes()
    result = []
    for reverse_input, reverse_output in ((True, False), (False, True), (True, True)):
        source, output = Path(temp) / 'zip-order-input.epub', Path(temp) / 'zip-order-output.epub'
        mapping_path, receipt_path = Path(temp) / 'zip-order-mapping.json', Path(temp) / 'zip-order-receipt.json'
        source.write_bytes(reverse_central_directory(input_raw) if reverse_input else input_raw)
        output.write_bytes(reverse_central_directory(output_raw) if reverse_output else output_raw)
        for path, reversed_order in ((source, reverse_input), (output, reverse_output)):
            with zipfile.ZipFile(path) as z:
                o.require(z.getinfo('mimetype').header_offset == 0, 'Positive case accidentally moved local mimetype')
                if reversed_order:
                    o.require(z.infolist()[0].filename != 'mimetype', 'Positive case did not reorder central records')
        receipt = copy.deepcopy(receipt0)
        receipt['inputSha256'] = o.sha(source.read_bytes())
        mapping = o.load_json(args.mapping)
        mapping['inputSha256'] = receipt['inputSha256']
        mapping_path.write_text(json.dumps(mapping, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        receipt['mappingSha256'] = o.sha(mapping_path.read_bytes())
        refresh(receipt, before, original, output)
        receipt_path.write_text(json.dumps(receipt, ensure_ascii=False), encoding='utf-8')
        checked = o.verify(source, output, receipt_path, args.expected_selection, mapping_path)
        result.append({'reversedInputCentralRecords': reverse_input, 'reversedOutputCentralRecords': reverse_output, 'verification': checked})
    bad = Path(temp) / 'mimetype-physically-last.epub'
    with zipfile.ZipFile(bad, 'w') as z:
        for part, data in before.items():
            if part != 'mimetype':
                z.writestr(part, data, compress_type=zipfile.ZIP_DEFLATED)
        z.writestr('mimetype', before['mimetype'], compress_type=zipfile.ZIP_STORED)
    bad.write_bytes(reverse_central_directory(bad.read_bytes()))
    with zipfile.ZipFile(bad) as z:
        o.require(z.infolist()[0].filename == 'mimetype' and z.getinfo('mimetype').header_offset > 0, 'Negative physical-order fixture incorrect')
    try:
        o.archive(bad)
    except o.Failure as exc:
        rejected_physical = str(exc)
    else:
        raise o.Failure('Non-first physical mimetype accepted because central order looked correct')
    extra = Path(temp) / 'mimetype-local-extra.epub'
    with zipfile.ZipFile(extra, 'w') as z:
        info = zipfile.ZipInfo('mimetype')
        info.extra = b'\xfe\xca\x00\x00'
        z.writestr(info, before['mimetype'], compress_type=zipfile.ZIP_STORED)
        for part, data in before.items():
            if part != 'mimetype':
                z.writestr(part, data, compress_type=zipfile.ZIP_DEFLATED)
    try:
        o.archive(extra)
    except o.Failure as exc:
        rejected_extra = str(exc)
    else:
        raise o.Failure('Local mimetype extra field accepted')
    return {'positivePermutations': result, 'negativePhysicalOrder': rejected_physical, 'negativeLocalExtra': rejected_extra}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('input'); parser.add_argument('output'); parser.add_argument('receipt')
    parser.add_argument('--expected-selection', required=True)
    parser.add_argument('--mapping', required=True)
    args = parser.parse_args()
    baseline = o.verify(args.input, args.output, args.receipt, args.expected_selection, args.mapping)
    _, before = o.archive(args.input)
    _, original = o.archive(args.output)
    receipt0 = o.load_json(args.receipt)
    first = receipt0['boundaries'][0]
    part = first['sourcePart']; marker_id = first['markerId']
    nav = receipt0['navPart']; package = receipt0['packagePart']
    tests = []

    def add(name, callback):
        tests.append((name, callback))

    def marker_edit(callback):
        return lambda data, r: edit_xml(data, part, lambda doc: callback(doc, by_id(doc, marker_id)))

    add('page marker label changed', marker_edit(lambda doc, m: m.setAttribute('aria-label', 'WRONG')))
    add('page marker role changed', marker_edit(lambda doc, m: m.setAttribute('role', 'note')))
    add('page marker EPUB type changed', marker_edit(lambda doc, m: m.setAttributeNS(o.EPUB, 'epub:type', 'chapter')))
    add('page marker acquired content', marker_edit(lambda doc, m: m.appendChild(doc.createTextNode('extra'))))
    add('page marker acquired class', marker_edit(lambda doc, m: m.setAttribute('class', 'extra')))
    add('page marker removed', marker_edit(lambda doc, m: m.parentNode.removeChild(m)))
    add('duplicate page marker ID', marker_edit(lambda doc, m: m.parentNode.insertBefore(m.cloneNode(True), m)))

    def move_marker(doc, m):
        suffix = m.nextSibling
        o.require(suffix and suffix.nodeType == Node.TEXT_NODE and suffix.data, 'Fixture needs marker followed by text')
        char = suffix.data[0]
        suffix.data = suffix.data[1:]
        m.parentNode.insertBefore(doc.createTextNode(char), m)
    add('marker moved one code point with prose preserved', marker_edit(move_marker))

    def original_prose(doc):
        body = o.child(doc.documentElement, o.XHTML, 'body')
        candidates = []
        def visit(n):
            if n.nodeType == Node.TEXT_NODE and o.normalized(n.data):
                candidates.append(n)
            for c in n.childNodes:
                visit(c)
        visit(body)
        o.require(candidates, 'Fixture needs prose')
        candidates[0].data += ' altered'
    add('original prose changed', lambda data, r: edit_xml(data, part, original_prose))
    add('original attribute changed', lambda data, r: edit_xml(data, part, lambda doc: o.child(doc.documentElement, o.XHTML, 'body').setAttribute('title', 'unauthorized')))
    add('original namespace binding added', lambda data, r: edit_xml(data, part, lambda doc: doc.documentElement.setAttributeNS(o.XMLNS, 'xmlns:unapproved', 'urn:unexpected')))

    def mutate_witness(node_type, label):
        for p in {b['sourcePart'] for b in receipt0['boundaries']} | {package, nav}:
            doc = o.xml(original[p])
            nodes = []
            def walk(n):
                if n.nodeType == node_type:
                    nodes.append(n)
                for c in n.childNodes:
                    walk(c)
            walk(doc)
            if nodes:
                def mutation(data, r, p=p):
                    def edit(d):
                        found = []
                        def seek(n):
                            if n.nodeType == node_type:
                                found.append(n)
                            for c in n.childNodes:
                                seek(c)
                        seek(d)
                        found[0].data += ' changed'
                    edit_xml(data, p, edit)
                add(label, mutation)
                return
        raise o.Failure('Fixture needs a ' + label + ' witness')
    mutate_witness(Node.COMMENT_NODE, 'original comment changed')
    mutate_witness(Node.PROCESSING_INSTRUCTION_NODE, 'original processing instruction changed')

    def nav_edit(callback):
        return lambda data, r: edit_xml(data, nav, lambda doc: callback(doc, by_id(doc, 'pt-page-list')))
    def first_link(n):
        return next(o.descendants(n, o.XHTML, 'a'))
    add('page-list label changed', nav_edit(lambda doc, n: setattr(first_link(n).firstChild, 'data', 'WRONG')))
    add('page-list target changed', nav_edit(lambda doc, n: first_link(n).setAttribute('href', 'missing.xhtml#absent')))
    add('page-list link removed', nav_edit(lambda doc, n: o.child(n, o.XHTML, 'ol').removeChild(o.elements(o.child(n, o.XHTML, 'ol'))[0])))
    add('page-list heading changed', nav_edit(lambda doc, n: setattr(o.child(n, o.XHTML, 'h2').firstChild, 'data', 'Changed')))
    add('page-list made visible', nav_edit(lambda doc, n: n.removeAttribute('hidden')))

    def edit_meta(prop, value):
        def mutate(data, r):
            def edit(doc):
                m = next(e for e in o.descendants(doc, o.OPF, 'meta') if e.getAttribute('property') == prop)
                m.firstChild.data = value
            edit_xml(data, package, edit)
        return mutate
    add('pagination source changed', edit_meta('pageBreakSource', 'Wrong edition'))
    add('accessibility feature changed', edit_meta('schema:accessibilityFeature', 'unknown'))
    add('modified timestamp changed without receipt', edit_meta('dcterms:modified', '2040-01-01T00:00:00Z'))

    def title_change(data, r):
        def edit(doc):
            title = next(e for e in o.descendants(doc) if e.localName == 'title')
            title.appendChild(doc.createTextNode(' unauthorized'))
        edit_xml(data, package, edit)
    add('original publication title changed', title_change)
    add('declared candidate count changed', lambda data, r: r['boundaries'][0].__setitem__('candidateCount', first['candidateCount'] + 1))
    add('declared occurrence changed', lambda data, r: r['boundaries'][0].__setitem__('selectedOccurrence', 999))
    add('declared original offset changed', lambda data, r: r['boundaries'][0].__setitem__('offset', first['offset'] + 1))
    add('source member hash changed', lambda data, r: r['boundaries'][0].__setitem__('sourcePartSha256', '0' * 64))
    add('mapping hash changed', lambda data, r: r.__setitem__('mappingSha256', '0' * 64))
    add('decision identity changed', lambda data, r: r['boundaries'][0].__setitem__('decisionId', 'unintended-decision'))
    if len(receipt0['boundaries']) > 1:
        add('boundary receipt order reversed', lambda data, r: r['boundaries'].reverse())
    untouched = sorted(set(original) - {x['part'] for x in receipt0['changedParts']} - {'mimetype'})
    o.require(untouched, 'Fixture needs unaffected binary/resource member')
    witness = next((p for p in untouched if not p.endswith(('.xml', '.xhtml', '.opf', '/'))), untouched[0])
    add('unaffected member bytes changed with refreshed hashes', lambda data, r: data.__setitem__(witness, data[witness] + b'\x00mutation'))
    add('extra package member added', lambda data, r: data.__setitem__('unexpected.bin', b'extra'))
    add('original member removed', lambda data, r: data.pop(witness))

    passed = []
    with tempfile.TemporaryDirectory(prefix='page-thread-oracle-') as temp:
        vocabulary = vocabulary_checks(before, original, receipt0, args, temp)
        zip_order = zip_order_checks(before, original, receipt0, args, temp)
        out = Path(temp) / 'mutated.epub'; receipt_file = Path(temp) / 'receipt.json'
        # Ensure XML mutation serialization itself is harmless to this oracle.
        data = copy.deepcopy(original); r = copy.deepcopy(receipt0)
        for p in [x['part'] for x in r['changedParts']]:
            data[p] = serialize(o.xml(data[p]), data[p])
        write_zip(out, data); refresh(r, before, data, out)
        receipt_file.write_text(json.dumps(r, ensure_ascii=False), encoding='utf-8')
        o.verify(args.input, out, receipt_file, args.expected_selection, args.mapping)
        for name, mutation in tests:
            data = copy.deepcopy(original); r = copy.deepcopy(receipt0)
            mutation(data, r)
            write_zip(out, data); refresh(r, before, data, out)
            receipt_file.write_text(json.dumps(r, ensure_ascii=False), encoding='utf-8')
            try:
                o.verify(args.input, out, receipt_file, args.expected_selection, args.mapping)
            except (o.Failure, ValueError, KeyError, TypeError, IndexError, AttributeError) as exc:
                result = {'name': name, 'rejectedBecause': str(exc)}
                if name != 'decision identity changed':
                    try:
                        o.verify(args.input, out, receipt_file, None, args.mapping)
                    except (o.Failure, ValueError, KeyError, TypeError, IndexError, AttributeError) as intrinsic:
                        result['alsoRejectedWithoutExpectedFixture'] = str(intrinsic)
                    else:
                        raise o.Failure('Semantic mutation needs more than the intended-selection fixture: ' + name)
                passed.append(result)
            else:
                raise o.Failure('Mutation was incorrectly accepted: ' + name)
        data = copy.deepcopy(original); r = copy.deepcopy(receipt0)
        write_zip(out, data, stored_mimetype=False); refresh(r, before, data, out)
        receipt_file.write_text(json.dumps(r, ensure_ascii=False), encoding='utf-8')
        try:
            o.verify(args.input, out, receipt_file, args.expected_selection, args.mapping)
        except o.Failure as exc:
            passed.append({'name': 'compressed mimetype', 'rejectedBecause': str(exc)})
        else:
            raise o.Failure('Compressed mimetype was incorrectly accepted')
    print(json.dumps({'baseline': baseline, 'positiveXmlReserialization': True,
                      'negativeMutationsRejected': len(passed), 'mutations': passed, 'vocabularyProfileChecks': vocabulary, 'zipOrderChecks': zip_order}, ensure_ascii=False, indent=2))
    return 0

if __name__ == '__main__':
    try:
        sys.exit(main())
    except (o.Failure, OSError, ValueError, KeyError, TypeError, IndexError, AttributeError) as exc:
        print('FAIL: ' + str(exc), file=sys.stderr)
        sys.exit(1)
