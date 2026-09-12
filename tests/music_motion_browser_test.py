"""Real Chromium workspace test; mocked auth/chat, no paid/local AI generation.
Run after: pip install playwright && playwright install --with-deps chromium
"""
import hashlib
import json
import math
import os
from pathlib import Path
import struct
import subprocess
import tempfile
import time
import urllib.request
import wave
import zipfile
import zlib
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(os.environ.get('MUSIC_MOTION_TEST_ARTIFACT_DIR', tempfile.mkdtemp(prefix='motion-ui-proof-')))
OUT.mkdir(parents=True, exist_ok=True)

def png():
    def chunk(kind, data):
        return struct.pack('!I',len(data))+kind+data+struct.pack('!I',zlib.crc32(kind+data)&0xffffffff)
    pixels=b''.join(b'\0'+bytes([18,26,46])*320 for _ in range(180))
    return b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('!2I5B',320,180,8,2,0,0,0))+chunk(b'IDAT',zlib.compress(pixels))+chunk(b'IEND',b'')

def main():
    proof={'checks':[], 'react_errors':[], 'generation_requests':[], 'mocked_chat_requests':0}
    html=ROOT/'music-motion-validation.html'; jsx=ROOT/'music-motion-validation.jsx'
    if html.exists() or jsx.exists():
        raise RuntimeError('Temporary validation entry already exists; do not overwrite user files.')
    log=(OUT/'ui-vite.log').open('w'); server=None
    try:
        html.write_text('<!doctype html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/music-motion-validation.jsx"></script></body></html>')
        jsx.write_text("import React from 'react';import{createRoot}from'react-dom/client';import{BrowserRouter}from'react-router-dom';import{AuthProvider}from'./src/lib/AuthContext';import MusicMotionStudio from'./src/pages/MusicMotionStudio';import'./src/index.css';createRoot(document.getElementById('root')).render(<BrowserRouter><AuthProvider><MusicMotionStudio/></AuthProvider></BrowserRouter>);")
        with tempfile.TemporaryDirectory() as temp:
            temp=Path(temp); archive=temp/'Validation Music Motion.zip'; audio=temp/'source.wav'
            with wave.open(str(audio),'wb') as w:
                w.setnchannels(1);w.setsampwidth(2);w.setframerate(22050)
                w.writeframes(b''.join(struct.pack('<h',round(5000*math.sin(2*math.pi*440*i/22050))) for i in range(22050*8)))
            with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED) as z:
                rows=['scene;titre;image;timecode']
                for i in range(1,9):
                    rows.append(f'{i:02};Scène {i};{i:02}_Scene.png;00:{i-1:02} → 00:{i:02}')
                    z.writestr(f'PACK/01_IMAGES/{i:02}_Scene.png',png())
                    z.writestr(f'PACK/02_PROMPTS_SCENES/{i:02}_SCENE.txt','PROMPT IMAGE FIXE\nDécor sobre bleu nuit.\n\nPROMPT VIDÉO / ANIMATION GROK\nTravelling lent, personnage stable.\n\nCAMÉRA\n35 mm\n')
                z.writestr('PACK/03_MONTAGE/01_TABLEAU_MONTAGE.csv','\n'.join(rows))
            server=subprocess.Popen(['npm','run','dev','--','--host','127.0.0.1','--port','5173','--strictPort'],cwd=ROOT,stdout=log,stderr=subprocess.STDOUT)
            for _ in range(80):
                try:
                    urllib.request.urlopen('http://127.0.0.1:5173/music-motion-validation.html',timeout=1);break
                except Exception: time.sleep(.25)
            with sync_playwright() as p:
                browser=p.chromium.launch(headless=True)
                ctx=browser.new_context(viewport={'width':1440,'height':1000},accept_downloads=True)
                page=ctx.new_page();page.set_default_timeout(15000)
                page.on('pageerror',lambda e:proof['react_errors'].append(str(e)))
                def api(route):
                    if '/api/auth/session' in route.request.url:
                        route.fulfill(json={'valid':True,'user':{'id':'test-user','name':'Validation locale','role':'admin'}})
                    elif route.request.url.endswith('/api/music-motion/production/chat') and route.request.method=='POST':
                        proof['mocked_chat_requests']+=1
                        body=route.request.post_data_json
                        scene_id=body['context']['scenes'][0]['id']
                        route.fulfill(json={'message':'Proposition de test à valider.', 'actions':[{'type':'update_scene','scene_id':scene_id,'patch':{'image_prompt':'Plan proposé dans le test navigateur.'}}]})
                    else:
                        if route.request.method=='POST':proof['generation_requests'].append(route.request.url)
                        route.fulfill(status=503,json={'error':'No AI provider connected during this test.'})
                page.route('**/api/**',api)
                page.route('https://fonts.googleapis.com/**',lambda r:r.abort())
                page.route('https://fonts.gstatic.com/**',lambda r:r.abort())
                try:
                    page.goto('http://127.0.0.1:5173/music-motion-validation.html',wait_until='networkidle')
                    page.get_by_role('heading',name='Elynea Music Motion Studio').wait_for()
                    proof['checks'].append('Workspace mounted without React errors')
                    page.locator('input[type=file][accept=".zip"]').set_input_files(str(archive))
                    dialog=page.get_by_role('dialog');dialog.wait_for();assert '8 scènes' in dialog.inner_text() and '8 médias' in dialog.inner_text()
                    page.get_by_role('button',name='Importer ce projet',exact=True).click();dialog.wait_for(state='hidden')
                    image_prompt=page.get_by_label('Prompt de l’image-clé',exact=True)
                    expect(image_prompt).to_have_value('Décor sobre bleu nuit.')
                    proof['checks'].append('8 scenes, images and prompts imported through real browser ZIP decoding')
                    page.get_by_role('button',name='Verrouiller la scène',exact=True).click()
                    expect(image_prompt).to_be_disabled()
                    # The actual scene button is labelled "Déverrouiller", not "Déverrouiller la scène".
                    page.get_by_role('button',name='Déverrouiller',exact=True).click()
                    expect(image_prompt).to_be_enabled()
                    proof['checks'].append('Scene lock and unlock enforced in UI')
                    page.get_by_label('Message à Elynea',exact=True).fill('Propose une image différente.')
                    page.get_by_role('button',name='Envoyer à Elynea locale',exact=True).click()
                    action=page.get_by_role('button',name='Appliquer : update scene',exact=True)
                    action.last.click()
                    expect(image_prompt).to_have_value('Plan proposé dans le test navigateur.')
                    proof['checks'].append('Fresh mocked director proposal applies after explicit click')
                    page.get_by_label('Message à Elynea',exact=True).fill('Propose une seconde version.')
                    page.get_by_role('button',name='Envoyer à Elynea locale',exact=True).click()
                    expect(action).to_have_count(2)
                    image_prompt.fill('Modification manuelle à préserver.')
                    action.last.click()
                    page.get_by_role('status').filter(has_text='périmée').first.wait_for()
                    expect(image_prompt).to_have_value('Modification manuelle à préserver.')
                    proof['checks'].append('Stale director proposal rejected; manual prompt preserved')
                    page.get_by_role('button',name='Fermer le message',exact=True).click()
                    page.locator('input[type=file][accept="audio/*,.m4a,.flac"]').set_input_files(str(audio))
                    with page.expect_download() as d:
                        page.get_by_role('button',name='Télécharger la source audio originale',exact=True).click()
                    source=Path(d.value.path());assert hashlib.sha256(source.read_bytes()).digest()==hashlib.sha256(audio.read_bytes()).digest()
                    proof['checks'].append('Downloaded audio bytes identical to imported original')
                    page.get_by_role('button',name='Rendre le clip vidéo final',exact=True).click()
                    page.get_by_role('status').filter(has_text='Analyse').first.wait_for()
                    proof['checks'].append('Final render blocked without complete audio analysis')
                    page.get_by_role('button',name='Enregistrer',exact=True).click()
                    page.wait_for_timeout(2100)
                    with page.expect_download() as d:page.get_by_role('button',name='Exporter le projet ZIP',exact=True).click()
                    with zipfile.ZipFile(d.value.path()) as z:
                        assert any(n.endswith('project.elynea.json') for n in z.namelist())
                        assert len([n for n in z.namelist() if n.startswith('media/')])==9
                    proof['checks'].append('Native project ZIP contains manifest and all nine media')
                    page.reload(wait_until='networkidle')
                    project=page.get_by_label('Mes projets locaux',exact=True)
                    project.locator('option').filter(has_text='Validation Music Motion').wait_for(state='attached')
                    project.select_option(label='Validation Music Motion')
                    page.get_by_role('button',name='Télécharger la source audio originale',exact=True).wait_for()
                    expect(page.get_by_label('Prompt de l’image-clé',exact=True)).to_have_value('Modification manuelle à préserver.')
                    proof['checks'].append('Project, prompts and media restored after reload from IndexedDB')
                    page.screenshot(path=str(OUT/'workspace-desktop.png'),full_page=True)
                    page.set_viewport_size({'width':390,'height':844});page.wait_for_timeout(300)
                    dimensions=page.evaluate('({viewport:innerWidth,content:document.documentElement.scrollWidth})');assert dimensions['content']<=400,dimensions
                    page.screenshot(path=str(OUT/'workspace-mobile.png'),full_page=True)
                    proof['checks'].append('Mobile 390px layout without horizontal overflow')
                    assert not proof['react_errors'],proof['react_errors']
                    assert not proof['generation_requests'],proof['generation_requests']
                    assert proof['mocked_chat_requests']==2
                finally:
                    page.screenshot(path=str(OUT/'ui-last-state.png'),full_page=True)
                    (OUT/'ui-last-state.html').write_text(page.content(),encoding='utf-8')
                    browser.close()
    finally:
        if server:
            server.terminate()
            try:server.wait(timeout=5)
            except subprocess.TimeoutExpired:server.kill()
        log.close();html.unlink(missing_ok=True);jsx.unlink(missing_ok=True)
        (OUT/'browser-proof.json').write_text(json.dumps(proof,ensure_ascii=False,indent=2))
    print(json.dumps(proof,ensure_ascii=False,indent=2))

if __name__=='__main__':main()
