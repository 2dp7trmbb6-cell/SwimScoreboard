import copy
import json
from pathlib import Path
import tempfile
import threading
import unittest
import urllib.request
import urllib.error
from http.server import ThreadingHTTPServer
from server import State, Handler, defaults, validate_png, ROOT

class AchievementTests(unittest.TestCase):
    def test_migration_validation_and_persistence(self):
        with tempfile.TemporaryDirectory() as folder:
            old=defaults();old.pop('achievements');Path(folder,'settings.json').write_text(json.dumps(old))
            state=State('unused',folder)
            self.assertEqual(state.config['achievements']['standards'],dict(lanes=True,board=False,compact=True))
            cfg=state.config;cfg['achievements']['standards']['lanes']=True;cfg['achievements']['standardLabel']='NYS'
            state.save(cfg);self.assertEqual(State('unused',folder).config,cfg)
            for key,value in [('standardLabel','<img>'),('standardLabel',''),('standards',{'lanes':True}),('images',{'personalBest':'https://example.org/a.png','standard':'/nys-2027.png'}),('images',{'personalBest':'/images/'+'a'*64+'.png','standard':'/nys-2027.png'})]:
                invalid=copy.deepcopy(cfg);invalid['achievements'][key]=value
                with self.subTest(key=key,value=value),self.assertRaises(ValueError):state.save(invalid)
            self.assertEqual(State('unused',folder).config,cfg)

    def test_png_validation(self):
        png=(ROOT/'static'/'nys-2027.png').read_bytes()
        width,height=validate_png(png);self.assertGreater(width,height)
        for bad in [b'<svg/>',png[:50],png+b'trailing',png[:40]+bytes([png[40]^1])+png[41:],b'x'*(3*1024*1024+1)]:
            with self.assertRaises(ValueError):validate_png(bad)

    def test_upload_serve_save_reload_and_origin(self):
        with tempfile.TemporaryDirectory() as folder:
            server=ThreadingHTTPServer(('127.0.0.1',0),Handler);server.state=State('unused',folder)
            thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
            base=f'http://127.0.0.1:{server.server_port}';png=(ROOT/'static'/'personal-best.png').read_bytes()
            try:
                request=urllib.request.Request(base+'/api/images',data=png,headers={'Content-Type':'image/png'})
                with urllib.request.urlopen(request) as response:uploaded=json.load(response)
                with urllib.request.urlopen(base+uploaded['url']) as response:self.assertEqual(response.read(),png)
                cfg=defaults();cfg['achievements']['images']['standard']=uploaded['url'];server.state.save(cfg)
                self.assertEqual(State('unused',folder).config,cfg)
                request=urllib.request.Request(base+'/api/images',data=b'invalid',headers={'Origin':'http://other.example'})
                with self.assertRaises(urllib.error.HTTPError) as error:urllib.request.urlopen(request)
                self.assertEqual(error.exception.code,403)
                with self.assertRaises(urllib.error.HTTPError) as error:urllib.request.urlopen(urllib.request.Request(base+'/api/images',data=b'<svg/>'))
                self.assertEqual(error.exception.code,400)
                with urllib.request.urlopen(base+'/nys-2027.png') as response:self.assertEqual(response.headers['Content-Type'],'image/png')
            finally:server.shutdown();server.server_close();thread.join()
