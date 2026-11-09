# Trial prototype: save the first JPEG frame from a serve-sim MJPEG stream.
# Usage: grab.py <stream-url> <out.jpg>
import sys, urllib.request
url, out = sys.argv[1], sys.argv[2]
buf=b''; r=urllib.request.urlopen(url, timeout=20)
while True:
    buf+=r.read(65536)
    s=buf.find(b'\xff\xd8'); e=buf.find(b'\xff\xd9', s+2)
    if s!=-1 and e!=-1:
        open(out,'wb').write(buf[s:e+2]); print(out, e+2-s, 'bytes'); break
    if len(buf)>30_000_000: print('no frame'); break
