# Trial prototype: tap an element by accessibility label through serve-sim.
# Usage: tap-label.py <helper-port> <udid> <label> <device-set-path>
# Needs a serve-sim helper running for the device. Doesn't handle the unfolded Duo's rotated panel.
import json, sys, urllib.request, subprocess
port, udid, label, sset = sys.argv[1:5]
raw = urllib.request.urlopen(f"http://127.0.0.1:{port}/helper/{udid}/ax", timeout=20).read()
tree = json.loads(raw)
hits=[]
def walk(n):
    if isinstance(n, list):
        for c in n: walk(c); return
    if (n.get("AXLabel") or "").strip() == label: hits.append(n)
    for c in n.get("children", []): walk(c)
walk(tree)
app = tree[0]["frame"] if isinstance(tree, list) and "frame" in tree[0] else None
print("matches:", len(hits), "app frame:", app)
if not hits: sys.exit(1)
f = hits[0]["frame"]; W, H = app["width"], app["height"]
x = (f["x"] + f["width"]/2) / W; y = (f["y"] + f["height"]/2) / H
print(f"tap at {x:.3f},{y:.3f}")
for t in ("begin","end"):
    subprocess.run(["npx","serve-sim","gesture","--device-set",sset,"-d",udid,json.dumps({"type":t,"x":x,"y":y})], check=True, capture_output=True)
