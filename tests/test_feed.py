"""Quick offline smoke tests: python -m unittest discover -s tests -v"""
import sys
import unittest
from pathlib import Path
from datetime import datetime, timezone
from email.utils import format_datetime
from xml.etree import ElementTree as ET

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from update_news import (parse_feed, normalize_url, detect_region, detect_stage, plain, FEEDS, GOOGLE_QUERIES)

RSS = b'''<?xml version="1.0"?><rss version="2.0"><channel><title>News</title>
<item><title>Architects unveil new library in Cedar Rapids</title>
<link>https://example.org/library?utm_source=rss</link>
<description>&lt;p&gt;A community library in Iowa with 60,000 square feet.&lt;/p&gt;</description>
<pubDate>Wed, 04 Nov 2026 12:00:00 GMT</pubDate></item>
<item><title>Buy tickets for best of design awards party</title>
<link>https://example.org/tickets</link><pubDate>Wed, 04 Nov 2026 12:00:00 GMT</pubDate></item>
</channel></rss>'''

class FeedTests(unittest.TestCase):
    def test_parse_relevant_and_remove_junk(self):
        sample = RSS.replace(b'Wed, 04 Nov 2026 12:00:00 GMT', format_datetime(datetime.now(timezone.utc), usegmt=True).encode())
        rows = parse_feed(ET.fromstring(sample), 'Test Source')
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['category'], '设计发布')
        self.assertEqual(rows[0]['region'], '爱荷华')
        self.assertIn('community library', rows[0]['summary'])
    def test_source_coverage(self):
        self.assertGreaterEqual(len(FEEDS), 8)
        self.assertGreaterEqual(len(GOOGLE_QUERIES), 30)
        self.assertTrue(any('Cedar Rapids' in q for q in GOOGLE_QUERIES))
    def test_normalize_removes_tracking(self):
        self.assertEqual(normalize_url('https://Example.ORG/article/?utm_source=x&ref=1'), 'https://example.org/article?ref=1')
    def test_plain(self):
        self.assertEqual(plain('<p>A &amp; B</p>'), 'A & B')
    def test_stages(self):
        self.assertEqual(detect_stage('Construction begins on new healthcare campus'), '开工建设')
        self.assertEqual(detect_stage('New museum proposal approved by council'), '审批落地')
        self.assertEqual(detect_stage('A studio completes a community center'), '项目竣工')

if __name__ == '__main__':
    unittest.main()
