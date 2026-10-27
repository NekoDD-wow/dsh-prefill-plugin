import json,collections
R=collections.defaultdict(list)
for l in open('results.jsonl'):
  r=json.loads(l); R[r['v']].append(r)
def f(x): return 'n/a' if x is None else f'{x:.2f}'
print('| 变体 | n | 首轮通过 | 首轮平均 | 第2轮通过 | 第2轮平均 | 首轮明细 |')
print('|---|---|---|---|---|---|---|')
for v in sorted(R):
  rs=sorted(R[v],key=lambda r:r['i'])
  t1=[r['t1'] for r in rs]; t2=[r['t2'] for r in rs]
  def stat(t):
    vals=[x if x is not None else 0 for x in t]
    return sum(x>=0.8 for x in vals), sum(vals)/len(vals)
  p1,a1=stat(t1); p2,a2=stat(t2)
  print(f'| {v} | {len(rs)} | {p1}/{len(rs)} | {a1:.2f} | {p2}/{len(rs)} | {a2:.2f} | {" ".join(f(x) for x in t1)} |')
