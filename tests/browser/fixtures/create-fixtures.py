"""Build small, deterministic books containing only original test prose.

These fixtures never contain a user's books, library data, or credentials.
Run from any directory: python3 tests/browser/fixtures/create-fixtures.py
"""
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parent
TITLES = ["Первая глава", "Вторая глава", "Третья глава"]
INTRO = (
    "Изумрудный фонарь освещал стол. На столе лежали карта, тетрадь и ключ. "
    "Лена открыла окно и услышала тихий шум дождя. Она решила записать "
    "увиденное, чтобы вечером рассказать друзьям о маленьком путешествии."
)
PARAGRAPH = (
    "По дороге к библиотеке путник замечал знакомые дома и новые вывески. "
    "У моста росла старая ива, а рядом стояла скамья. Он остановился, "
    "прочитал короткую записку и аккуратно сложил её в карман. "
    "За рекой начинался сад, где можно было спокойно подумать о прочитанном. "
    "Вечером друзья обсудят события дня и выберут следующую книгу."
)


def paragraphs(chapter):
    lead = INTRO if chapter == 0 else (
        "Янтарный рассвет встретил путешественников." if chapter == 1
        else "Лазурный вечер завершил прогулку."
    )
    return [lead] + [PARAGRAPH for _ in range(18)] + [
        "Рубежпервой. Здесь рассказ продолжается." if chapter == 0 else
        "Рубежвторой. Начинается новая часть." if chapter == 1 else
        "Рубежтретьей. История закончилась."
    ]


description = """<description><title-info><genre>prose</genre>
<author><first-name>Тестовый</first-name><last-name>Автор</last-name></author>
<book-title>Путешествие по библиотеке — FB2</book-title><lang>ru</lang>
</title-info><document-info><author><nickname>Glava tests</nickname></author>
<date value="2026-01-01">2026-01-01</date><id>glava-rsvp-fixture</id><version>1.0</version>
</document-info></description>"""
sections = "".join(
    f'<section id="chapter{i + 1}"><title><p>{title}</p></title>'
    + "".join(f"<p>{p}</p>" for p in paragraphs(i)) + "</section>"
    for i, title in enumerate(TITLES)
)
(ROOT / "reading.fb2").write_text(
    '<?xml version="1.0" encoding="utf-8"?>\n'
    '<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" '
    'xmlns:l="http://www.w3.org/1999/xlink">' + description +
    "<body>" + sections + "</body></FictionBook>\n", encoding="utf-8"
)

container = '''<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles><rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/>
</rootfiles></container>'''
manifest = "".join(
    f'<item id="c{i}" href="chapter{i}.xhtml" media-type="application/xhtml+xml"/>'
    for i in range(1, 4)
)
spine = "".join(f'<itemref idref="c{i}"/>' for i in range(1, 4))
opf = f'''<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="book-id" version="3.0">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="book-id">urn:glava:rsvp-fixture</dc:identifier>
<dc:title>Путешествие по библиотеке — EPUB</dc:title><dc:creator>Тестовый Автор</dc:creator>
<dc:language>ru</dc:language><meta property="dcterms:modified">2026-01-01T00:00:00Z</meta>
</metadata><manifest><item id="nav" href="nav.xhtml" properties="nav" media-type="application/xhtml+xml"/>
{manifest}</manifest><spine>{spine}</spine></package>'''
nav_items = "".join(
    f'<li><a href="chapter{i + 1}.xhtml">{title}</a></li>' for i, title in enumerate(TITLES)
)
nav = f'''<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="ru">
<head><title>Оглавление</title></head><body><nav epub:type="toc"><ol>{nav_items}</ol></nav></body></html>'''


def write_entry(archive, name, text, compressed=True):
    item = zipfile.ZipInfo(name, (2026, 1, 1, 0, 0, 0))
    item.compress_type = zipfile.ZIP_DEFLATED if compressed else zipfile.ZIP_STORED
    archive.writestr(item, text.encode("utf-8"))


with zipfile.ZipFile(ROOT / "reading.epub", "w") as archive:
    write_entry(archive, "mimetype", "application/epub+zip", compressed=False)
    write_entry(archive, "META-INF/container.xml", container)
    write_entry(archive, "EPUB/package.opf", opf)
    write_entry(archive, "EPUB/nav.xhtml", nav)
    for i, title in enumerate(TITLES):
        body = "".join(f"<p>{p}</p>" for p in paragraphs(i))
        xhtml = f'''<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" lang="ru"><head><title>{title}</title></head>
<body><h1>{title}</h1>{body}</body></html>'''
        write_entry(archive, f"EPUB/chapter{i + 1}.xhtml", xhtml)
