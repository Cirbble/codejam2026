"""Generate example find photos for the landing page tier ladder (prompt: something red). Clearly examples, not real players."""
import base64, json, os, urllib.request
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
KEY = open(os.path.join(HERE, '..', '..', '.secrets', 'GEMINI_API_KEY')).read().strip()
STYLE = ("A casual smartphone photo taken outdoors on a sunny afternoon in a Canadian city neighbourhood, natural light, "
         "slightly imperfect handheld framing, realistic, no people, no text, no logos, no watermark. Subject: ")
SUBJECTS = {
    'common': 'a red fire hydrant on a concrete sidewalk next to grass.',
    'uncommon': 'a red bicycle locked to a black metal rack.',
    'rare': 'a single bright red maple leaf lying on a wooden park bench.',
    'epic': 'a male northern cardinal perched on a bare branch, close enough to see clearly.',
    'one': 'a weathered red rotary payphone mounted on an old brick wall.',
}

def gen(name):
    body = {'contents': [{'parts': [{'text': STYLE + SUBJECTS[name]}]}],
            'generationConfig': {'responseModalities': ['IMAGE'], 'imageConfig': {'aspectRatio': '1:1'}}}
    req = urllib.request.Request('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image:generateContent',
        data=json.dumps(body).encode(), headers={'content-type': 'application/json', 'x-goog-api-key': KEY})
    d = json.load(urllib.request.urlopen(req, timeout=120))
    for p in d['candidates'][0]['content']['parts']:
        if 'inlineData' in p:
            open(os.path.join(HERE, f'ex_{name}.jpg'), 'wb').write(base64.b64decode(p['inlineData']['data']))
            return name + ' ok'
    return name + ' no image'

with ThreadPoolExecutor(5) as ex:
    for r in ex.map(gen, SUBJECTS):
        print(r)
