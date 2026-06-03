"""
Re-download all item images listed in assets/items/_index.json into
assets/items/<file>. Skips files that already exist (use --force to overwrite).

Run:  python scripts/download-items.py
      python scripts/download-items.py --force
"""
import json
import os
import sys
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
ITEMS_DIR = os.path.join(ROOT, "assets", "items")
INDEX = os.path.join(ITEMS_DIR, "_index.json")

FORCE = "--force" in sys.argv

def main():
    with open(INDEX, "r", encoding="utf-8") as f:
        items = json.load(f)

    total = len(items)
    ok = skipped = failed = 0
    fails = []
    for i, it in enumerate(items, 1):
        fn = it["file"]
        url = it["src"]
        dest = os.path.join(ITEMS_DIR, fn)
        if os.path.exists(dest) and not FORCE:
            skipped += 1
            continue
        data = None
        last_err = None
        for attempt in range(5):
            try:
                req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
                with urllib.request.urlopen(req, timeout=30) as resp:
                    data = resp.read()
                break
            except Exception as e:
                last_err = e
                time.sleep(0.5 * (attempt + 1))  # backoff: 0.5,1,1.5,2s
        if data is not None:
            with open(dest, "wb") as out:
                out.write(data)
            ok += 1
            if i % 20 == 0 or ok <= 3:
                print(f"[{i}/{total}] {fn} ({len(data)} bytes)")
        else:
            failed += 1
            fails.append((fn, str(last_err)))
            print(f"[{i}/{total}] FAILED {fn}: {last_err}")
        time.sleep(0.25)

    print(f"\nDone. downloaded={ok} skipped={skipped} failed={failed} of {total}")
    if fails:
        print("Failures:")
        for fn, err in fails:
            print(f"  {fn}: {err}")

if __name__ == "__main__":
    main()
