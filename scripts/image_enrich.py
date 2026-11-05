"""Find article cover images from publisher HTML, without storing image files.

Feed images remain first choice. For Google News RSS links, decoding is best
-effort because Google's undocumented resolver may change or rate-limit us.
Only external HTTPS image URLs are saved for browser display.
"""
import html
import ipaddress
import json
import logging
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from html.parser import HTMLParser
from urllib.parse import urlencode, urljoin, urlsplit
from urllib.request import Request, urlopen

MAX_PER_RUN = 180
MIN_RETRY_HOURS = 72
MAX_WORKERS = 5
AGENT = 'Mozilla/5.0 (compatible; ArchitectureRadar/1.1; metadata preview)'


def public_https(url):
    """Avoid feeding internal URLs and non-web schemes to the fetcher."""
    try:
        parsed = urlsplit(url)
        host = (parsed.hostname or '').lower().rstrip('.')
        if parsed.scheme != 'https' or not host or '.' not in host:
            return False
        if parsed.username or parsed.password or parsed.port not in (None, 443):
            return False
        if host in {'localhost', 'metadata.google.internal'} or host.endswith(('.local', '.internal', '.test')):
            return False
        try:
            ipaddress.ip_address(host)
            return False
        except ValueError:
            pass
        return True
    except (ValueError, TypeError):
        return False


def fetch_html(url, *, limit=650_000):
    if not public_https(url):
        return '', ''
    req = Request(url, headers={
        'User-Agent': AGENT,
        'Accept': 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.6',
        'Accept-Language': 'en-US,en;q=0.9',
    })
    try:
        with urlopen(req, timeout=8) as response:
            final = response.geturl()
            if not public_https(final):
                return '', ''
            content_type = response.headers.get('Content-Type', '').lower()
            if 'text/html' not in content_type and 'application/xhtml+xml' not in content_type:
                return '', ''
            body = response.read(limit)
            return body.decode('utf-8', errors='replace'), final
    except (OSError, ValueError, TimeoutError):
        return '', ''


class CoverMeta(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.values = {}
        self.ldjson = []
        self.in_jsonld = False
        self.script_parts = []

    def handle_starttag(self, tag, attrs):
        d = {k.lower(): v for k, v in attrs if k}
        if tag == 'meta':
            key = (d.get('property') or d.get('name') or '').lower().strip()
            if key in {'og:image', 'og:image:url', 'og:image:secure_url',
                       'twitter:image', 'twitter:image:src'}:
                self.values.setdefault(key, d.get('content') or '')
        elif tag == 'link' and 'image_src' in (d.get('rel') or '').lower():
            self.values.setdefault('image_src', d.get('href') or '')
        elif tag == 'script' and 'ld+json' in (d.get('type') or '').lower():
            self.in_jsonld = True
            self.script_parts = []

    def handle_data(self, data):
        if self.in_jsonld and sum(map(len, self.script_parts)) < 160_000:
            self.script_parts.append(data)

    def handle_endtag(self, tag):
        if tag == 'script' and self.in_jsonld:
            self.ldjson.append(''.join(self.script_parts))
            self.in_jsonld = False
            self.script_parts = []


def valid_image(base_url, value):
    if not isinstance(value, str) or not value.strip():
        return ''
    url = urljoin(base_url, html.unescape(value.strip()))
    if not public_https(url):
        return ''
    # Reject icons, page logos and tiny tracking images as cover art.
    path = urlsplit(url).path.lower()
    if re.search(r'(?:favicon|logo[._-]|[._/-]avatar|tracking[_-]?pixel|\.svg(?:$|\?))', path):
        return ''
    return url


def find_cover(markup, page_url):
    if not markup:
        return ''
    parser = CoverMeta()
    try:
        parser.feed(markup)
    except (ValueError, TypeError):
        return ''
    for key in ('og:image:secure_url', 'og:image', 'og:image:url',
                'twitter:image', 'twitter:image:src', 'image_src'):
        image = valid_image(page_url, parser.values.get(key))
        if image:
            return image
    # Some publishers only declare the article cover in schema.org JSON-LD.
    def visit(obj):
        if isinstance(obj, list):
            for el in obj:
                cover = visit(el)
                if cover:
                    return cover
        elif isinstance(obj, dict):
            kind = str(obj.get('@type') or '').lower()
            if any(t in kind for t in ('article', 'news', 'posting')):
                im = obj.get('image') or obj.get('thumbnailUrl')
                if isinstance(im, dict):
                    im = im.get('url') or im.get('contentUrl')
                if isinstance(im, list):
                    im = next((e.get('url') if isinstance(e, dict) else e for e in im if e), '')
                result = valid_image(page_url, im)
                if result:
                    return result
            for el in obj.values():
                if isinstance(el, (dict, list)):
                    result = visit(el)
                    if result:
                        return result
        return ''
    for script in parser.ldjson[:3]:
        try:
            result = visit(json.loads(script))
            if result:
                return result
        except (ValueError, TypeError, RecursionError):
            pass
    return ''


def resolve_google_news(url):
    """Try the current, undocumented Google News link decoder; fail closed."""
    try:
        article_id = urlsplit(url).path.rstrip('/').split('/')[-1]
        if not re.fullmatch(r'[A-Za-z0-9_-]{25,1200}', article_id):
            return ''
        html_text, final = fetch_html('https://news.google.com/rss/articles/' + article_id, limit=1_250_000)
        if final and 'news.google.com' not in (urlsplit(final).hostname or ''):
            return final
        if not html_text:
            return ''
        sg = re.search(r'data-n-a-sg="([^"]+)"', html_text)
        ts = re.search(r'data-n-a-ts="([0-9]+)"', html_text)
        if not sg or not ts:
            return ''
        # Google changes this internal endpoint; it is an optional enhancement.
        inner = ['garturlreq',
                 [['X', 'X', ['X', 'X'], None, None, 1, 1, 'US:en', None, 1,
                   None, None, None, None, None, 0, 1],
                  'X', 'X', 1, [1, 1, 1], 1, 1, None, 0, 0, None, 0],
                 article_id, int(ts.group(1)), sg.group(1)]
        body = urlencode({'f.req': json.dumps([[['Fbv4je', json.dumps(inner), None, 'generic']]])}).encode('utf-8')
        req = Request('https://news.google.com/_/DotsSplashUi/data/batchexecute',
                      data=body, headers={
                          'User-Agent': AGENT,
                          'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
                          'Accept-Language': 'en-US,en;q=0.9',
                      })
        with urlopen(req, timeout=8) as response:
            raw = response.read(80_000).decode('utf-8', errors='replace')
        for line in raw.splitlines():
            if not line.startswith('[['):
                continue
            for row in json.loads(line):
                if len(row) > 2 and row[1] == 'Fbv4je' and isinstance(row[2], str):
                    result = json.loads(row[2])
                    publisher_url = result[1] if isinstance(result, list) and len(result) > 1 else ''
                    if public_https(publisher_url) and urlsplit(publisher_url).hostname != 'news.google.com':
                        return publisher_url
    except (OSError, ValueError, TypeError, TimeoutError, IndexError, KeyError, json.JSONDecodeError):
        pass
    return ''


def image_for_article(article_url):
    if not public_https(article_url):
        return ''
    host = (urlsplit(article_url).hostname or '').lower()
    page = article_url
    if host == 'news.google.com':
        page = resolve_google_news(article_url)
        if not page:
            return ''
    markup, final = fetch_html(page)
    return find_cover(markup, final) if markup else ''


def enrich(rows, now=None):
    """Fill missing card images in recent-first order, with retry timestamps.

    This limits external requests and lets old content be backfilled over time.
    Existing working image URLs are never replaced.
    """
    now = now or datetime.now(timezone.utc)
    pending = []
    for row in rows:
        if row.get('image'):
            continue
        last = row.get('image_checked_at')
        if last:
            try:
                when = datetime.fromisoformat(last.replace('Z', '+00:00'))
                if when.tzinfo and now - when < timedelta(hours=MIN_RETRY_HOURS):
                    continue
            except (ValueError, TypeError):
                pass
        if len(pending) >= MAX_PER_RUN:
            break
        if public_https(row.get('url', '')):
            pending.append(row)
    updated = 0
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
        futures = {pool.submit(image_for_article, row['url']): row for row in pending}
        for future in as_completed(futures):
            row = futures[future]
            try:
                found = future.result()
            except Exception as exc:
                logging.debug('Image lookup failed for %s: %s', row.get('url', ''), exc)
                found = ''
            row['image_checked_at'] = now.isoformat(timespec='seconds')
            if found:
                row['image'] = found
                updated += 1
    logging.info('Cover image metadata: %d found from %d attempted; %d / %d articles now have images',
                 updated, len(pending), sum(bool(row.get('image')) for row in rows), len(rows))
    return updated
