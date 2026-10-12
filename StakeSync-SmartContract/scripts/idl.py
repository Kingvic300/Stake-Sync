"""Assembles idl/stake_sync.json from the IDL pieces Anchor's idl-build prints (no Anchor CLI needed)."""
import json, re, sys

text = sys.stdin.read()

def blocks(kind):
    return re.findall(r'--- IDL begin ' + kind + r' ---\n(.*?)\n--- IDL end ' + kind + r' ---', text, re.S)

idl = json.loads(blocks('program')[0])
idl['errors'] = json.loads(blocks('errors')[0])
types = idl.setdefault('types', [])
seen = {t['name'] for t in types}
events = []
for block in blocks('event'):
    e = json.loads(block)
    events.append(e['event'])
    for t in e.get('types', []):
        if t['name'] not in seen:
            types.append(t)
            seen.add(t['name'])
idl['events'] = sorted(events, key=lambda e: e['name'])
idl['types'] = sorted(types, key=lambda t: t['name'])

# Shorten module paths (stake_sync::state::Challenge -> Challenge) like the Anchor CLI does.
raw = json.dumps(idl)
full = sorted(set(re.findall(r'"((?:[a-z_]+::)+[A-Za-z_][A-Za-z0-9_]*)"', raw)), key=len, reverse=True)
short = {f: f.split('::')[-1] for f in full}
assert len(set(short.values())) == len(short), 'two types share a short name'
for f in full:
    raw = raw.replace('"' + f + '"', '"' + short[f] + '"')
idl = json.loads(raw)
# The address arrives in its own section, wrapped in escaped quotes.
idl['address'] = re.search(r'[1-9A-HJ-NP-Za-km-z]{32,44}', blocks('address')[0]).group(0)

json.dump(idl, open('idl/stake_sync.json', 'w'), indent=2)
print(f"idl/stake_sync.json: {len(idl['instructions'])} instructions, {len(idl['accounts'])} accounts, {len(idl['events'])} events, {len(idl['errors'])} errors")
