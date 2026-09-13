#!/usr/bin/env python3
"""PDF text is preserved as source material, never executed or silently corrected."""
import json
import sys
from pathlib import Path

def main():
    try:
        from pypdf import PdfReader
        source = Path(sys.argv[1])
        if source.stat().st_size > 20 * 1024 * 1024:
            raise ValueError('PDF supérieur à 20 Mo.')
        reader = PdfReader(str(source))
        if reader.is_encrypted or len(reader.pages) > 100:
            raise ValueError('PDF chiffré ou supérieur à 100 pages.')
        pages = []
        for i, page in enumerate(reader.pages):
            text = page.extract_text() or ''
            if len(text) > 30000:
                raise ValueError('Page trop volumineuse : aucune troncature silencieuse.')
            pages.append({'page': i + 1, 'text': text})
            if sum(len(p['text']) for p in pages) > 200000:
                raise ValueError('Extraction trop volumineuse : importer une sélection de pages.')
        print(json.dumps({'pages': pages, 'text': '\n\n'.join(f"PAGE {p['page']}\n{p['text']}" for p in pages),
                          'warning': ('Document conservé comme source non validée. Aucun OCR ni correction automatique.' if all(p['text'].strip() for p in pages) else 'Certaines pages sont sans texte extractible. Document conservé, contenu visuel à vérifier manuellement ; aucun OCR automatique.')}, ensure_ascii=True))
    except Exception as error:
        print(json.dumps({'text': '', 'warning': str(error)}, ensure_ascii=True))
    return 0
if __name__ == '__main__':
    raise SystemExit(main())
