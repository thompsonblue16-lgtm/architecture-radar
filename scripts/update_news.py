#!/usr/bin/env python3
"""Architecture Radar: collect public RSS headlines, deduplicate and build JSON.

Uses Python's standard library only. Suitable for GitHub Actions daily cron.
Run: python scripts/update_news.py
"""
import hashlib
import html
import json
import logging
import os
import re
import time
from datetime import datetime, timedelta, timezone
from concurrent.futures import ThreadPoolExecutor, as_completed
from email.utils import parsedate_to_datetime
from html.parser import HTMLParser
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import quote_plus, urlsplit, urlunsplit, parse_qsl, urlencode
from urllib.request import Request, urlopen
import xml.etree.ElementTree as ET

from image_enrich import enrich

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "news.json"
OUT_JS = ROOT / "data" / "news.js"
NOW = datetime.now(timezone.utc)
MAX_ITEMS = 1800
MAX_AGE_DAYS = 120
FEED_LIMIT = 125

# Primary publisher feeds and category-specific feeds.
FEEDS = [
    ("ArchDaily", "https://www.archdaily.com/feed"),
    ("Dezeen", "https://www.dezeen.com/architecture/feed/"),
    ("The Architect's Newspaper", "https://www.archpaper.com/feed"),
    ("designboom", "https://www.designboom.com/architecture/feed/"),
    ("Architectural Record · Civic", "https://www.architecturalrecord.com/rss/topic/2095-civic-architecture"),
    ("Architectural Record · Higher Ed", "https://www.architecturalrecord.com/rss/topic/822-colleges-universities"),
    ("Engineering News-Record", "https://www.enr.com/rss/1"),
    ("ENR · Midwest", "https://www.enr.com/rss/topic/217-midwest-construction-news"),
]

# Domain-targeted searches monitor additional publishers even if they do not
# expose a stable open RSS feed. They still come from Google News search, not
# those publishers' official feeds. Topic searches keep less-famous projects in view.
GOOGLE_QUERIES = [
    '"architecture firm" (unveils OR reveals OR designs) project when:21d',
    '"architecture studio" (completes OR reveals OR proposes) building when:21d',
    '("new building" OR "new development") (approved OR permission OR permit) when:21d',
    '("planning commission" OR "city council") (approves OR approved) (building OR development) when:30d',
    '("breaks ground" OR groundbreaking) (school OR museum OR hospital) when:21d',
    '("breaks ground" OR groundbreaking) (housing OR mixed-use OR library) when:21d',
    '("construction begins" OR "construction starts") (building OR campus) when:21d',
    '("building opens" OR "project completed") (architect OR architecture) when:21d',
    '("architect selected" OR "design competition") (school OR building OR museum) when:30d',
    '("mixed-use development" OR "housing development") (approved OR groundbreaking) when:30d',
    '("adaptive reuse" OR "renovation") (building OR historic) architect when:30d',
    '("new hospital" OR "healthcare campus") (construction OR approved OR designed) when:30d',
    '("new library" OR "community center") (construction OR design OR approved) when:30d',
    '("new school" OR "new university building") (groundbreaking OR designed) when:30d',
    '("sports complex" OR stadium OR "aquatic center") (construction OR approved) when:30d',
    '("affordable housing" OR "residential tower") (approved OR construction) when:30d',
    '("airport terminal" OR "train station") (opens OR construction OR design) when:30d',
    '("Cedar Rapids" OR "Iowa City" OR Coralville OR Marion) (building OR construction OR development) when:45d',
    '("Des Moines" OR Ames OR Davenport) (new development OR groundbreaking OR construction) when:45d',
    '("Iowa" AND "school") (construction OR expansion OR groundbreaking) when:45d',
    '(Chicago OR Illinois OR Wisconsin OR Minnesota) (building OR groundbreaking OR approved development) when:30d',
    '("Milwaukee" OR "Madison" OR "Minneapolis") (architecture OR development OR construction) when:30d',
    '("Europe" OR "UK" OR "London") (architecture OR architects) (unveils OR construction OR completed) when:21d',
    '("Dubai" OR "Saudi Arabia" OR "UAE") (architecture OR building) (design OR construction) when:30d',
    '("China" OR "Japan" OR "Singapore") (architects OR architecture) (new OR completed) when:30d',
    '("Australia" OR "Canada") (architecture OR building) (designed OR completed) when:30d',
    'site:constructiondive.com/news/ (project OR construction OR groundbreaking) when:30d',
    'site:bdcnetwork.com (project OR building OR construction) when:30d',
    'site:archinect.com/news/ (new building OR project OR architect) when:30d',
    'site:worldarchitecture.org (project OR completed OR building) when:30d',
    'site:chicago.urbanize.city/post/ (approved OR groundbreaking OR development) when:30d',
    'site:architecturalrecord.com/articles/ (building OR project OR design) when:30d',
    'site:metropolismag.com (architect OR project OR building) when:30d',
    'site:ctbuh.org (tower OR skyscraper OR building) when:30d',
    'site:aia.org (building OR project OR architecture) when:30d',
    'site:iowacapitaldispatch.com (construction OR school OR building) when:45d',
]

PROJECT_SIGNALS = re.compile(
    r'\b(unveil(?:s|ed)?|reveal(?:s|ed)?|design(?:s|ed|ing)?|propos(?:es|ed|al)|'
    r'plan(?:s|ned|ning)?|approved|approval|greenlight|green light|permit(?:ted)?|'
    r'break(?:s|ing)? ground|groundbreak(?:ing)?|construction|build(?:s|ing)?|'
    r'open(?:s|ed|ing)?|complet(?:es|ed|ion)|deliver(?:s|ed)?|finish(?:es|ed)?|'
    r'expansion|extension|renovat(?:es|ed|ion)|redevelop(?:ment|s|ed)?|'
    r'architect(?:s|ure)?|masterplan|development|stadium|library|school|'
    r'university|museum|hospital|tower|housing|mixed.use|headquarters|'
    r'competition|commissioned|selected|contract award|wins? contract)\b', re.I)
NOISE = re.compile(r'\b(for sale|real estate tips|buy tickets|celebrity homes|'
                   r'product roundup|shopping guide|giveaway|internship|job opening|'
                   r'best of design awards|design week events|opinion:|top ten)\b', re.I)

STAGES = [
    ("审批落地", re.compile(r'\b(approv(?:ed|al)|greenlit|green light|planning permission|'
                            r'permit(?:s|ted)?|gets the go.ahead|clears (?:a |the )?hurdle|'
                            r'approved by|zoning approval)\b', re.I)),
    ("开工建设", re.compile(r'\b(break(?:s|ing|ing)? ground|groundbreak(?:ing)?|'
                            r'construction (?:begins?|start(?:s|ed)?)|'
                            r'(?:begins?|starts?) construction|under construction|'
                            r'starts? (?:on )?site|commences? construction)\b', re.I)),
    ("项目竣工", re.compile(r'\b(complet(?:es|ed|ion)|opens?|opened|inaugurat(?:es|ed|ion)|'
                            r'deliver(?:s|ed)?|topped out|tops out)\b', re.I)),
    ("竞赛招标", re.compile(r'\b(competition|shortlist(?:ed)?|wins? (?:the )?competition|'
                            r'architect selected|award(?:ed)? contract|commissioned|'
                            r'request for proposals|RFP)\b', re.I)),
    ("设计发布", re.compile(r'\b(unveil(?:s|ed)?|reveal(?:s|ed)?|propos(?:es|ed|al)|'
                            r'renderings?|announc(?:es|ed)? plans?|design(?:s|ed)?|'
                            r'masterplan|concept|planning|new scheme)\b', re.I)),
]

SECTORS = [
    ("教育", r'\b(school|university|campus|college|kindergarten|education|library)\b'),
    ("医疗", r'\b(hospital|clinic|healthcare|medical|health center)\b'),
    ("文化公共", r'\b(museum|civic|community center|theater|theatre|cultural|gallery|city hall)\b'),
    ("体育", r'\b(stadium|arena|sports|recreation center|aquatic|fieldhouse)\b'),
    ("住宅", r'\b(housing|residential|apartments?|condominiums?|affordable homes?|homes?)\b'),
    ("商业办公", r'\b(office|headquarters|retail|commercial|hotel|hospitality)\b'),
    ("交通基础设施", r'\b(airport|terminal|bridge|transit|train|station|railway|infrastructure)\b'),
    ("城市更新", r'\b(mixed.use|masterplan|district|redevelopment|urban regeneration)\b'),
]
IOWA = re.compile(r'\b(iowa|cedar rapids|iowa city|coralville|des moines|davenport|ames|marion)\b', re.I)
MIDWEST = re.compile(r'\b(chicago|illinois|wisconsin|madison|milwaukee|minnesota|'
                     r'minneapolis|michigan|detroit|ohio|indiana|missouri|st\. louis|'
                     r'nebraska|kansas|north dakota|south dakota|midwest)\b', re.I)
US = re.compile(r'\b(united states|u\.s\.|usa|new york|brooklyn|california|'
                r'los angeles|san francisco|oregon|portland|washington|seattle|'
                r'florida|miami|texas|houston|austin|boston|massachusetts|'
                r'colorado|denver|georgia|atlanta|north carolina|south carolina|'
                r'arizona|philadelphia|pennsylvania|new mexico|virginia|'
                r'utah|new jersey|tennessee)\b', re.I)

class Stripper(HTMLParser):
    def __init__(self):
        super().__init__()
        self.parts = []
        self.image = ""
    def handle_data(self, data):
        self.parts.append(data)
    def handle_starttag(self, tag, attrs):
        if tag == 'img' and not self.image:
            self.image = dict(attrs).get('src', '')

def plain(raw):
    p = Stripper()
    try:
        p.feed(html.unescape(raw or ''))
    except Exception:
        return re.sub(r'\s+', ' ', html.unescape(re.sub('<[^>]*>', ' ', raw or ''))).strip()
    return re.sub(r'\s+', ' ', html.unescape(' '.join(p.parts))).strip()

def fetch(url):
    for attempt in range(2):
        try:
            req = Request(url, headers={
                'User-Agent': 'Mozilla/5.0 (compatible; ArchitectureRadar/1.0; RSS digest)',
                'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
            })
            with urlopen(req, timeout=19) as response:
                body = response.read(3_000_000)
            return ET.fromstring(body)
        except (OSError, ET.ParseError, TimeoutError, ValueError) as exc:
            if attempt == 1:
                logging.warning('Feed unavailable: %s (%s)', url[:115], exc)
            else:
                time.sleep(1)
    return None

def val(item, key):
    node = item.find(key)
    return (node.text or '').strip() if node is not None and node.text else ''

def child_local(item, names):
    for child in item:
        if child.tag.rsplit('}', 1)[-1] in names:
            if child.text:
                return child.text.strip()
    return ''

def get_image(item, description):
    # Images are only displayed as linked thumbnails, never stored/republished.
    for child in item.iter():
        name = child.tag.rsplit('}', 1)[-1].lower()
        if name in ('thumbnail', 'content', 'enclosure'):
            url = child.attrib.get('url', '')
            typ = child.attrib.get('type', '')
            if url.startswith('https://') and (name == 'thumbnail' or typ.startswith('image/') or re.search(r'\.(?:jpg|jpeg|png|webp)(?:\?|$)', url, re.I)):
                return url
    p = Stripper()
    p.feed(html.unescape(description or ''))
    return p.image if p.image.startswith('https://') else ''

def parse_dt(value):
    if not value:
        return None
    try:
        dt = parsedate_to_datetime(value)
    except (TypeError, ValueError):
        try:
            dt = datetime.fromisoformat(value.replace('Z', '+00:00'))
        except ValueError:
            return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)

def normalize_url(value):
    value = value.strip()
    if not value.startswith(('https://', 'http://')):
        return ''
    parts = urlsplit(value)
    if not parts.netloc:
        return ''
    clean_params = [(k, v) for k, v in parse_qsl(parts.query)
                    if not k.lower().startswith('utm_') and k.lower() not in
                    {'fbclid', 'gclid', 'mc_cid', 'mc_eid', 'amp'}]
    return urlunsplit((parts.scheme, parts.netloc.lower(), parts.path.rstrip('/'), urlencode(clean_params), ''))

def detect_stage(title):
    for name, pattern in STAGES:
        if pattern.search(title):
            return name
    return '行业动态'

def detect_region(text):
    if IOWA.search(text): return '爱荷华'
    if MIDWEST.search(text): return '美国中西部'
    if US.search(text): return '美国其他'
    return '国际 / 未识别'

def detect_sector(text):
    for name, pat in SECTORS:
        if re.search(pat, text, re.I):
            return name
    return '综合项目'

def parse_feed(root, feed_name):
    if root is None: return []
    entries = root.findall('.//item')
    atom = not entries
    if atom:
        entries = [x for x in root.iter() if x.tag.rsplit('}', 1)[-1] == 'entry']
    results = []
    for entry in entries[:FEED_LIMIT]:
        title = plain(val(entry, 'title') or child_local(entry, {'title'}))
        if not title or len(title) < 16: continue
        summary_html = val(entry, 'description') or child_local(entry, {'summary', 'content', 'encoded'})
        summary = plain(summary_html)[:280]
        if NOISE.search(title) or not PROJECT_SIGNALS.search(title): continue
        if atom:
            links = [x for x in entry if x.tag.rsplit('}', 1)[-1] == 'link']
            link = next((x.attrib.get('href', '') for x in links
                         if x.attrib.get('rel', 'alternate') == 'alternate'), '')
        else:
            link = val(entry, 'link')
        url = normalize_url(link)
        if not url: continue
        date_raw = (val(entry, 'pubDate') or child_local(entry, {'published', 'updated', 'date'}))
        pub = parse_dt(date_raw)
        if pub is None or pub < NOW - timedelta(days=MAX_AGE_DAYS) or pub > NOW + timedelta(days=2):
            continue
        publisher = feed_name
        if feed_name == 'Google News':
            source_el = entry.find('source')
            if source_el is not None and source_el.text:
                publisher = source_el.text.strip()[:65]
            # Google News results commonly append source suffix to the article title.
            title = re.sub(r'\s+[-–]\s+' + re.escape(publisher) + r'$', '', title, flags=re.I)
        stage = detect_stage(title)
        text_for_classify = title + ' ' + summary[:150]
        results.append({
            'id': hashlib.sha1(url.encode('utf-8')).hexdigest()[:16],
            'title': title[:190],
            'summary': summary[:230],
            'url': url,
            'source': publisher,
            'feed': feed_name,
            'published': pub.isoformat(timespec='seconds'),
            'category': stage,
            'region': detect_region(text_for_classify),
            'sector': detect_sector(text_for_classify),
            'image': get_image(entry, summary_html),
        })
    return results

def read_existing():
    try:
        data = json.loads(OUT.read_text(encoding='utf-8'))
        return data.get('articles', [])
    except (FileNotFoundError, ValueError, OSError):
        return []

def main():
    logging.basicConfig(level=logging.INFO, format='%(levelname)s %(message)s')
    previous = read_existing()
    feeds = list(FEEDS)
    for query in GOOGLE_QUERIES:
        url = 'https://news.google.com/rss/search?q=' + quote_plus(query) + '&hl=en-US&gl=US&ceid=US%3Aen'
        feeds.append(('Google News', url))
    collected = []
    successful = 0
    status = []
    # Parallelize network I/O to keep 44 independent searches within the
    # workflow timeout; individual failures never wipe previous data.
    def pull(entry):
        name, url = entry
        root = fetch(url)
        return name, root, parse_feed(root, name) if root is not None else []

    with ThreadPoolExecutor(max_workers=6) as pool:
        futures = [pool.submit(pull, entry) for entry in feeds]
        for future in as_completed(futures):
            name, root, incoming = future.result()
            if root is not None:
                successful += 1
                collected.extend(incoming)
            status.append({'name': name, 'ok': root is not None, 'matched': len(incoming)})
            logging.info('%-30s %3d relevant articles %s', name[:30], len(incoming), 'OK' if root is not None else 'FAIL')
    if not successful:
        logging.error('All sources failed. Leaving previous dataset untouched.')
        raise SystemExit(1)

    # Keep images and image-check timestamps from earlier successful runs.
    previous_by_url = {normalize_url(a.get('url', '')): a for a in previous if a.get('url')}
    seen = set()
    rows = []
    # New data first, keeping the existing curated data from previous runs.
    for row in sorted(collected + previous, key=lambda a: a.get('published', ''), reverse=True):
        url = normalize_url(row.get('url', ''))
        if not url or not row.get('title'): continue
        norm_title = re.sub(r'[^a-z0-9]+', '', row['title'].lower())[:100]
        key = (urlsplit(url).netloc, urlsplit(url).path)
        if key in seen or norm_title in seen: continue
        pub = parse_dt(row.get('published'))
        if not pub or pub < NOW - timedelta(days=MAX_AGE_DAYS): continue
        seen.add(key)
        seen.add(norm_title)
        cached = previous_by_url.get(url, {})
        if not row.get('image') and cached.get('image'):
            row['image'] = cached['image']
        if cached.get('image_checked_at') and not row.get('image_checked_at'):
            row['image_checked_at'] = cached['image_checked_at']
        rows.append(row)
        if len(rows) >= MAX_ITEMS: break

    # If scraping succeeds but has zero matches, avoid wiping a useful older dataset.
    if not rows and previous:
        logging.warning('No matching articles; preserving previous file.')
        return
    # Extract publisher cover image metadata for a bounded number of cards.
    # Missing image URLs from older articles are backfilled over later runs.
    enrich(rows, NOW)
    payload = {
        'updated_at': NOW.isoformat(timespec='seconds'),
        'total': len(rows),
        'feed_count': successful,
        'feed_attempted': len(feeds),
        'source_count': len({row.get('source') for row in rows if row.get('source')}),
        'articles': rows,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    json_content = json.dumps(payload, ensure_ascii=False, indent=2)
    OUT.write_text(json_content + '\n', encoding='utf-8')
    OUT_JS.write_text('window.ARCH_RADAR_DATA = ' + json_content.replace('</', '<\\/') + ';\n', encoding='utf-8')
    logging.info('Saved %d records to %s', len(rows), OUT)

if __name__ == '__main__':
    main()
