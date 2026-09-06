"""
Reorder sections in index.html for a professional AI platform flow.

Target order (body sections only — nav, hero, CTA, footer stay anchored):
  HERO
  STATS
  CAPABILITIES
  ORCHESTRATOR (Multi-AI)
  THINK (Think Modes)
  CHAT (AI Assistant)
  WORKFLOW
  ENGINE (Idea Engine)
  GITHUB (GitHub Direct Push)
  PPT (PPT Studio)
  CTA
  FOOTER

Strategy:
  1. Read the file
  2. Locate the body region between </section> (end of HERO) and <!-- ===== CTA ===== -->
  3. Split it into named section blocks by the <!-- ===== NAME ===== --> comment markers
  4. Reassemble in the new order
  5. Write back
"""
import re
from pathlib import Path

HTML_PATH = Path('/home/z/my-project/index.html')
html = HTML_PATH.read_text()

# Markers that delineate each top-level body section.
# Each section starts with `<!-- ===== NAME ===== -->` and ends right before
# the next `<!-- ===== ... ===== -->` marker (or the CTA marker).
SECTION_MARKERS = [
    'AI ASSISTANT',
    'WORKFLOW',
    'CAPABILITIES',
    'IDEA ENGINE',
    'STATS',
    'GITHUB DIRECT PUSH',
    'PPT STUDIO',
    'MULTI-AI ORCHESTRATOR',
    'THINK MODES',
]

# Find the start of the first section after HERO and the start of CTA.
# We use the comment markers as anchors.
def find_marker(name):
    return html.index(f'<!-- ===== {name} ===== -->')

# The region we'll reshape starts after the HERO section closes.
# HERO ends with </section> right before <!-- ===== AI ASSISTANT ===== -->.
# So our work region starts at `<!-- ===== AI ASSISTANT ===== -->`
# and ends right before `<!-- ===== CTA ===== -->`.
start = find_marker('AI ASSISTANT')
cta_start = find_marker('CTA')
region = html[start:cta_start]

# Split region into blocks. Each block = comment + content up to next comment.
# Use a regex that finds all `<!-- ===== NAME ===== -->` markers.
marker_re = re.compile(r'<!-- ===== ([A-Z][A-Z \-]+) ===== -->')
matches = list(marker_re.finditer(region))

blocks = {}
for i, m in enumerate(matches):
    name = m.group(1).strip()
    block_start = m.start()
    block_end = matches[i + 1].start() if i + 1 < len(matches) else len(region)
    blocks[name] = region[block_start:block_end].rstrip() + '\n\n'

# Verify we captured all expected sections
print('Captured sections:', list(blocks.keys()))

# New professional order
NEW_ORDER = [
    'STATS',
    'CAPABILITIES',
    'MULTI-AI ORCHESTRATOR',
    'THINK MODES',
    'AI ASSISTANT',
    'WORKFLOW',
    'IDEA ENGINE',
    'GITHUB DIRECT PUSH',
    'PPT STUDIO',
]

# Build new region
new_region = ''
for name in NEW_ORDER:
    if name not in blocks:
        raise SystemExit(f'Missing section: {name}')
    new_region += blocks[name]

# Reassemble the full HTML
new_html = html[:start] + new_region + html[cta_start:]

HTML_PATH.write_text(new_html)
print('Reordered sections. New file size:', len(new_html), 'chars')
