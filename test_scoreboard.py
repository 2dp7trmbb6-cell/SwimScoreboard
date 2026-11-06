import json
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from server import State, Handler, defaults, project, lane_points

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

    def test_pool_perspective_offsets_and_validation(self):
        with tempfile.TemporaryDirectory() as d:
            state=State('unused',d);config=defaults();a=config['alignment']
            a.update(usePool=True,count=4,points=[[-200,40],[1600,200],[1400,1000],[-100,900]],position=0,length=1,height=1)
            first=lane_points(config,1);last=lane_points(config,4)
            self.assertEqual(first[0],a['points'][0])
            for actual,expected in zip(last[2],a['points'][2]):self.assertAlmostEqual(actual,expected)
            self.assertAlmostEqual(first[3][0],lane_points(config,2)[0][0])
            self.assertAlmostEqual(first[3][1],lane_points(config,2)[0][1])
            config['lanes']['1']['offsets']=[[5,7] for _ in range(4)]
            self.assertEqual(lane_points(config,1)[0],[first[0][0]+5,first[0][1]+7])
            state.save(config)
            a['reverse']=True
            self.assertEqual(lane_points(config,4)[0],first[0])
            state.save(config)
            config['lanes']['1']['offsets'][0]=[9000,9000]
            with self.assertRaises(ValueError):state.save(config)

    def test_legacy_alignment_migration_preserves_positions(self):
        from pathlib import Path
        with tempfile.TemporaryDirectory() as d:
            config=defaults();config.pop('alignment')
            for lane in config['lanes'].values():lane.pop('offsets')
            config['lanes']['2']['points']=[[-10,10],[800,30],[750,100],[-30,90]]
            Path(d,'settings.json').write_text(json.dumps(config))
            state=State('unused',d)
            self.assertFalse(state.config['alignment']['usePool'])
            self.assertEqual(state.config['lanes']['2']['points'],config['lanes']['2']['points'])
            self.assertEqual(state.config['lanes']['2']['offsets'],[[0,0]]*4)
            state.save(state.config)

    def test_field_migration_and_independent_defaults(self):
        from pathlib import Path
        with tempfile.TemporaryDirectory() as d:
            legacy=defaults();legacy['fields']=dict(first=False,last=True,team=False,seed=True,split=False,final=True);legacy.pop('finishPopups')
            Path(d,'settings.json').write_text(json.dumps(legacy));state=State('unused',d)
            self.assertFalse(state.config['fields']['board']['first']);self.assertTrue(state.config['fields']['board']['seed'])
            self.assertTrue(state.config['fields']['lanes']['first']);self.assertTrue(state.config['fields']['lanes']['team'])
            self.assertFalse(state.config['fields']['lanes']['seed']);self.assertFalse(state.config['fields']['lanes']['final'])
            state.save(state.config)
            state.config['fields']['board']['team']='yes'
            with self.assertRaises(ValueError):state.save(state.config)

    def test_board_width_validation_and_migration(self):
        from pathlib import Path
        with tempfile.TemporaryDirectory() as d:
            config=defaults();config.pop('boardWidth');Path(d,'settings.json').write_text(json.dumps(config));state=State('unused',d)
            self.assertEqual(state.config['boardWidth'],1760)
            for width in (640,1000,1760):
                state.config['boardWidth']=width;state.save(state.config)
                self.assertEqual(State('unused',d).config['boardWidth'],width)
            for width in (True,639,1761,900.5):
                config=defaults();config['boardWidth']=width
                with self.assertRaises(ValueError):state.save(config)

    def test_compact_migration_defaults_validation_and_persistence(self):
        from pathlib import Path
        with tempfile.TemporaryDirectory() as d:
            legacy=defaults();legacy.pop('compact');legacy['fields'].pop('compact');Path(d,'settings.json').write_text(json.dumps(legacy))
            state=State('unused',d);self.assertEqual(state.config['compact']['resultsWidth'],624)
            self.assertTrue(state.config['fields']['compact']['split']);self.assertFalse(state.config['fields']['compact']['seed'])
            state.config['mode']='compact';state.config['compact']['headerX']=700;state.save(state.config)
            restored=State('unused',d);self.assertEqual(restored.config['mode'],'compact');self.assertEqual(restored.config['compact']['headerX'],700)
            for key,value in [('headerX',1900),('resultsWidth',1000),('rowHeight',1),('headerY',True),('initials','yes')]:
                config=defaults();config['compact'][key]=value
                with self.assertRaises(ValueError):state.save(config)

    def test_lane_phase_migration_and_validation(self):
        from pathlib import Path
        with tempfile.TemporaryDirectory() as d:
            config=defaults();config.pop('lanePhases');config['fields']['lanes']['first']=False
            Path(d,'settings.json').write_text(json.dumps(config));state=State('unused',d)
            self.assertFalse(state.config['fields']['lanes']['first']);self.assertFalse(state.config['lanePhases']['finishFields']['first'])
            self.assertTrue(state.config['lanePhases']['finishFields']['final']);self.assertTrue(state.config['lanePhases']['splitFields']['split'])
            state.save(state.config)
            for key,value in [('splitDuration',0),('finishDelay',-1),('startDuration',601),('finishDuration',float('nan')),('timeSize',17),('startEnabled','yes')]:
                invalid=defaults();invalid['lanePhases'][key]=value
                with self.assertRaises(ValueError):state.save(invalid)
            invalid=defaults();invalid['lanePhases']['finishFields']['final']='yes'
            with self.assertRaises(ValueError):state.save(invalid)

    def test_personal_best_migration_validation_and_persistence(self):
        from pathlib import Path
        with tempfile.TemporaryDirectory() as d:
            config=defaults();config['lanePhases'].pop('personalBest');config.pop('personalBestBoards')
            Path(d,'settings.json').write_text(json.dumps(config))
            state=State('unused',d)
            self.assertFalse(state.config['lanePhases']['personalBest'])
            self.assertEqual(state.config['personalBestBoards'],dict(board=False,compact=False))
            state.config['personalBestBoards']['board']=True
            state.config['lanePhases']['personalBest']=True;state.save(state.config)
            self.assertTrue(State('unused',d).config['lanePhases']['personalBest'])
            self.assertTrue(State('unused',d).config['personalBestBoards']['board'])
            invalid=defaults();invalid['personalBestBoards']['compact']='yes'
            with self.assertRaises(ValueError):state.save(invalid)
            invalid=defaults();invalid['lanePhases']['personalBest']='yes'
            with self.assertRaises(ValueError):state.save(invalid)

    def test_http_controls_and_routes(self):
        with tempfile.TemporaryDirectory() as d:
            server=ThreadingHTTPServer(('127.0.0.1',0),Handler); server.state=State('unused',d)
            thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
            base=f'http://127.0.0.1:{server.server_port}'
            try:
                for path in ['/', '/overlay?format=lanes','/app.js','/style.css','/personal-best.png']:
                    with urllib.request.urlopen(base+path) as r:
                        self.assertEqual(r.status,200)
                        self.assertTrue(r.read())
                with urllib.request.urlopen(base+'/api/state') as r:initial=json.load(r)
                with urllib.request.urlopen(base+'/app.js') as r:
                    self.assertEqual(r.headers['Cache-Control'],'no-store')
                    self.assertIn("const CLIENT_VERSION='"+initial['appVersion']+"';",r.read().decode())
                cfg=defaults();cfg['visible']=False
                req=urllib.request.Request(base+'/api/config',data=json.dumps(cfg).encode(),headers={'Content-Type':'application/json'})
                with urllib.request.urlopen(req) as r:self.assertTrue(json.load(r)['ok'])
                with urllib.request.urlopen(base+'/api/state') as r:updated=json.load(r)
                self.assertFalse(updated['config']['visible']);self.assertNotEqual(initial['configRevision'],updated['configRevision'])
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
