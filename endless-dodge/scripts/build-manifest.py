"""
Scan assets/items/ and produce assets/items-manifest.json grouping items by biome.

Naming convention: files prefixed with "<biome>__" (double underscore) are
assigned to that biome. Multiple prefixes can be chained:
    "arctic__forest__snowy-tree.png"  -> both arctic and forest

Anything without a known biome prefix falls into the "any" pool, which all
biomes draw from as a fallback when their own pool is empty.

Run:  python scripts/build-manifest.py
"""
import json
import os
import re

BIOMES = ["savannah", "forest", "arctic", "mystic", "genesis", "luna"]
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
ITEMS_DIR = os.path.join(ROOT, "assets", "items")
OUT = os.path.join(ROOT, "assets", "items-manifest.json")
INDEX_JSON = os.path.join(ITEMS_DIR, "_index.json")

# Map _index.json environment strings -> biome keys, for files not renamed yet.
INDEX_ENV_MAP = {
    "Arctic":   "arctic",
    "Savannah": "savannah",
    "Forest":   "forest",
    "Mystic":   "mystic",
    "Genesis":  "genesis",
    "Luna":     "luna",
}

def biomes_from_filename(name: str):
    base = name.lower().rsplit(".", 1)[0]
    parts = re.split(r"__", base)
    if len(parts) < 2:
        return []
    tags = []
    for p in parts[:-1]:
        if p in BIOMES:
            tags.append(p)
    return tags

def main():
    pools = {b: [] for b in BIOMES}
    pools["any"] = []
    index_lookup = {}
    if os.path.exists(INDEX_JSON):
        with open(INDEX_JSON, "r", encoding="utf-8") as f:
            for entry in json.load(f):
                index_lookup[entry["file"]] = entry.get("environments") or []

    seen = 0
    for fn in sorted(os.listdir(ITEMS_DIR)):
        if not fn.lower().endswith(".png"):
            continue
        if fn.startswith("_"):
            continue
        seen += 1
        biomes = biomes_from_filename(fn)
        if not biomes:
            for env in index_lookup.get(fn, []):
                b = INDEX_ENV_MAP.get(env)
                if b and b not in biomes:
                    biomes.append(b)
        if not biomes:
            pools["any"].append(fn)
        else:
            for b in biomes:
                pools[b].append(fn)

    out = {b: pools[b] for b in BIOMES}
    out["any"] = pools["any"]
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=2)
    print(f"Scanned {seen} items.")
    for b in BIOMES + ["any"]:
        print(f"  {b}: {len(pools[b])}")
    print(f"Wrote {OUT}")

if __name__ == "__main__":
    main()
