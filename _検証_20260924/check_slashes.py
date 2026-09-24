# -*- coding: utf-8 -*-
"""GAS配信で消える「文字列リテラル内の //」を探す。"""
import re, sys, os
sys.stdout.reconfigure(encoding='utf-8')

STR = re.compile(r'"(?:[^"\\]|\\.)*"' + r"|'(?:[^'\\]|\\.)*'" + r'|`(?:[^`\\]|\\.)*`')

for f in sys.argv[1:]:
    s = open(f, encoding='utf-8-sig').read()
    bad = []
    for i, line in enumerate(s.split('\n'), 1):
        for m in STR.finditer(line):
            if '//' in m.group(0):
                bad.append((i, m.group(0)[:80]))
    print('%-16s 文字列内の // : %d件' % (os.path.basename(f), len(bad)))
    for ln, txt in bad[:8]:
        print('    行%d: %s' % (ln, txt))
