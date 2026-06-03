"""
Scan assets/items/ and produce assets/items-manifest.json grouping items by
ENVIRONMENT and CLASSIFICATION.

Naming convention (double-underscore separators):
    <classification>__<environment>__<name>.png
e.g.
    fullobstacle__savannah__cactus.png
    design__forest__pine-tree.png
    moving__arctic__snowball.png
    obstacle__genesis__blue-crystal.png

Classifications:
    design       - decorative, placed outside the track, never hits the player
    moving       - slides left<->right inside the run; lethal
    obstacle     - single literal obstacle in a lane; lethal
    fullobstacle - spawns as a row/line across lanes (leaving a gap); lethal

Backward compatibility:
    <environment>__<name>.png   -> classification defaults to "obstacle"
    <name>.png (untagged)       -> classification "obstacle", environment falls
                                   back to _index.json, else the shared "any" pool

Output shape:
    {
      "savannah": { "design": [...], "moving": [...], "obstacle": [...], "fullobstacle": [...] },
      ...,
      "any":      { "design": [...], "moving": [...], "obstacle": [...], "fullobstacle": [...] }
    }

Run:  python scripts/build-manifest.py
"""
import json
import os
import re

BIOMES = ["savannah", "forest", "arctic", "mystic", "genesis", "luna"]
CLASSES = ["design", "moving", "obstacle", "fullobstacle"]
DEFAULT_CLASS = "obstacle"

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
ITEMS_DIR = os.path.join(ROOT, "assets", "items")
OUT = os.path.join(ROOT, "assets", "items-manifest.json")
INDEX_JSON = os.path.join(ITEMS_DIR, "_index.json")

INDEX_ENV_MAP = {
    "Arctic": "arctic", "Savannah": "savannah", "Forest": "forest",
    "Mystic": "mystic", "Genesis": "genesis", "Luna": "luna",
}


def classify(fn, index_envs):
    """Return (classification, environment) for a filename."""
    base = fn.lower().rsplit(".", 1)[0]
    parts = re.split(r"__", base)

    cls = None
    env = None
    if len(parts) >= 2 and parts[0] in CLASSES:
        cls = parts[0]
        if len(parts) >= 3 and parts[1] in BIOMES:
            env = parts[1]
    elif len(parts) >= 2 and parts[0] in BIOMES:
        # legacy env__name -> obstacle
        env = parts[0]
        cls = DEFAULT_CLASS

    if cls is None:
        cls = DEFAULT_CLASS
    if env is None:
        # fall back to _index.json environment tag if present
        for e in index_envs:
            mapped = INDEX_ENV_MAP.get(e)
            if mapped:
                env = mapped
                break
    if env is None:
        env = "any"
    return cls, env


def empty_pools():
    return {c: [] for c in CLASSES}


def main():
    index_lookup = {}
    if os.path.exists(INDEX_JSON):
        with open(INDEX_JSON, "r", encoding="utf-8") as f:
            for entry in json.load(f):
                index_lookup[entry["file"]] = entry.get("environments") or []

    out = {b: empty_pools() for b in BIOMES}
    out["any"] = empty_pools()

    seen = 0
    for fn in sorted(os.listdir(ITEMS_DIR)):
        if not fn.lower().endswith(".png") or fn.startswith("_"):
            continue
        seen += 1
        cls, env = classify(fn, index_lookup.get(fn, []))
        out[env][cls].append(fn)

    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=2)

    print(f"Scanned {seen} items.")
    for env in BIOMES + ["any"]:
        counts = ", ".join(f"{c}:{len(out[env][c])}" for c in CLASSES)
        print(f"  {env:9s} {counts}")
    print(f"Wrote {OUT}")


if __name__ == "__main__":
    main()
