import re, sys

with open('/home/z/my-project/index.html') as f:
    html = f.read()

print('File size:', len(html), 'chars')
print('')

# Tag balance check
def count(s, t):
    o = len(re.findall(r'<' + t + r'(?=[\s>])', s))
    c = len(re.findall(r'</' + t + r'>', s))
    return o, c

for tag in ['section', 'div', 'ul', 'li', 'aside', 'footer', 'nav', 'button', 'textarea', 'pre']:
    o, c = count(html, tag)
    flag = 'OK' if o == c else '*** MISMATCH ***'
    print(f'  <{tag:9}> open={o:4} close={c:4}  {flag}')

print('')
print('Sections (id):')
for m in re.finditer(r'<section[^>]*id="([^"]+)"', html):
    print(f'  #{m.group(1)}')

print('')
# Extract script block and check JS syntax via node
script_match = re.search(r'<script>([\s\S]*?)</script>', html)
if script_match:
    js = script_match.group(1)
    with open('/tmp/check.js', 'w') as f:
        f.write(js)
    print(f'Script length: {len(js)} chars, written to /tmp/check.js')
