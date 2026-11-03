import json
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from server import State, Handler, defaults

class ScoreboardTests(unittest.TestCase):
    def test_configuration_validation_and_persistence(self):
        with tempfile.TemporaryDirectory() as d:
            state=State('http://127.0.0.1:8770',d)
            config=defaults(); config['lanes']['1']['points']=[[-200,-100],[800,20],[700,180],[-300,80]]
            state.save(config)
            self.assertEqual(State('unused',d).config,config)
            invalid=defaults(); invalid['lanes']['1']['points']=[[0,0]]*4
            with self.assertRaises(ValueError):state.save(invalid)
            self.assertEqual(state.config,config)

    def test_http_controls_and_routes(self):
        with tempfile.TemporaryDirectory() as d:
            server=ThreadingHTTPServer(('127.0.0.1',0),Handler); server.state=State('unused',d)
            thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
            base=f'http://127.0.0.1:{server.server_port}'
            try:
                for path in ['/', '/overlay?format=lanes','/app.js','/style.css']:
                    with urllib.request.urlopen(base+path) as r:self.assertEqual(r.status,200)
                cfg=defaults();cfg['visible']=False
                req=urllib.request.Request(base+'/api/config',data=json.dumps(cfg).encode(),headers={'Content-Type':'application/json'})
                with urllib.request.urlopen(req) as r:self.assertTrue(json.load(r)['ok'])
                with urllib.request.urlopen(base+'/api/state') as r:self.assertFalse(json.load(r)['config']['visible'])
                req.add_header('Origin','http://other.example')
                with self.assertRaises(urllib.error.HTTPError) as caught:urllib.request.urlopen(req)
                self.assertEqual(caught.exception.code,403)
            finally:server.shutdown();server.server_close();thread.join()

    def test_real_manager_polling_and_outage(self):
        # Exercise the actual sibling application's API, simulation decoder and heartbeat.
        import importlib.util
        import sys
        from pathlib import Path
        manager=Path(__file__).resolve().parent.parent/'SwimDataManager'
        if not (manager/'server.py').exists():self.skipTest('Sibling SwimDataManager checkout required')
        sys.path.insert(0,str(manager))
        spec=importlib.util.spec_from_file_location('manager_server',manager/'server.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
        with tempfile.TemporaryDirectory() as d, tempfile.TemporaryDirectory() as settings:
            hub=module.Hub(d)
            hub.command(dict(action='upload',html='Event 3 Girls 100 Yard Freestyle\nHeat 2 of 2 Starts at 09:00 AM\n  2  Smith, Jamie  10  WAVES  1:02.45Y  ______'))
            hub.command(dict(action='source',mode='demo'))
            server=ThreadingHTTPServer(('127.0.0.1',0),module.Handler);server.hub=hub;server.commands=threading.Lock()
            t=threading.Thread(target=server.serve_forever,daemon=True);t.start()
            state=State(f'http://127.0.0.1:{server.server_port}',settings)
            worker=threading.Thread(target=state.poll,daemon=True);worker.start()
            try:
                deadline=time.monotonic()+5
                while (not state.snapshot or not state.snapshot['feed'].get('connected')) and time.monotonic()<deadline:time.sleep(.05)
                data=state.get();self.assertIsNone(data['error']);self.assertEqual(data['state']['feed']['event'],3)
                self.assertEqual(data['state']['program']['heats'][0]['swimmers'][0]['name'],'Smith, Jamie')
                self.assertEqual(data['state']['program']['heats'][0]['swimmers'][0]['seedTime'],'1:02.45')
                self.assertIn('swim-scoreboard',data['state']['consumers'])
                self.assertTrue(data['state']['feed']['simulated'])
                hub.command(dict(action='source',mode='off'))
                deadline=time.monotonic()+3
                while state.get()['state']['feed'].get('connected') and time.monotonic()<deadline:time.sleep(.05)
                self.assertFalse(state.get()['state']['feed']['connected'])
                server.shutdown();server.server_close();t.join()
                deadline=time.monotonic()+4
                while not state.get()['error'] and time.monotonic()<deadline:time.sleep(.05)
                self.assertIn('unavailable',state.get()['error'])
            finally:
                state.stop.set();worker.join(3);hub.stop.set()
                server.shutdown();server.server_close()

if __name__=='__main__':unittest.main()
