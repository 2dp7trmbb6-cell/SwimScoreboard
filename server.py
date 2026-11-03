"""Local scoreboard controller and read-only SwimDataManager consumer."""
import argparse
import json
import threading
import time
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).parent

def defaults():
    return dict(mode='board', visible=True, autoHide=True, fields=dict(first=True,last=True,team=True,seed=True,split=True,final=True), lanes={str(i):dict(points=[[180,120+(i-1)*105],[900,120+(i-1)*105],[900,210+(i-1)*105],[180,210+(i-1)*105]], enabled=True) for i in range(1,9)})

class State:
    def __init__(self, manager, folder):
        self.manager = manager.rstrip('/')
        self.path = Path(folder)/'settings.json'
        self.lock = threading.Lock()
        self.config = json.loads(self.path.read_text()) if self.path.exists() else defaults()
        self.snapshot = None
        self.received = 0
        self.error = 'Waiting for SwimDataManager'
        self.stop = threading.Event()
    def poll(self):
        while not self.stop.is_set():
            try:
                with urllib.request.urlopen(self.manager+'/api/v1/state?consumer=swim-scoreboard',timeout=2) as r:
                    data = json.load(r)
                if data.get('version') != 1: raise ValueError('Unsupported manager API version')
                with self.lock:
                    self.snapshot, self.received, self.error = data, time.time(), None
            except Exception as e:
                with self.lock: self.error = 'SwimDataManager unavailable: '+str(e)
            self.stop.wait(.4)
    def get(self):
        with self.lock:
            return dict(config=self.config, state=self.snapshot, received=self.received, error=self.error, now=time.time())
    def save(self, config):
        if set(config) != set(defaults()) or config['mode'] not in ('board','lanes'): raise ValueError('Invalid configuration')
        if type(config['visible']) is not bool or type(config['autoHide']) is not bool: raise ValueError('Invalid visibility')
        if set(config['fields']) != set(defaults()['fields']) or any(type(v) is not bool for v in config['fields'].values()): raise ValueError('Invalid fields')
        if set(config['lanes']) != set(defaults()['lanes']): raise ValueError('Expected lanes 1–8')
        for lane in config['lanes'].values():
            if type(lane.get('enabled')) is not bool: raise ValueError('Invalid lane')
            points=lane.get('points')
            if not isinstance(points,list) or len(points)!=4: raise ValueError('Four corners required')
            for p in points:
                if not isinstance(p,list) or len(p)!=2 or any(type(n) not in (int,float) or not -10000<=n<=10000 for n in p): raise ValueError('Invalid corner coordinate')
            cross=[]
            for i in range(4):
                a,b,c=points[i],points[(i+1)%4],points[(i+2)%4]
                cross.append((b[0]-a[0])*(c[1]-b[1])-(b[1]-a[1])*(c[0]-b[0]))
            if not (all(x>1 for x in cross) or all(x< -1 for x in cross)): raise ValueError('Corners must form a convex quadrilateral in perimeter order')
        with self.lock:
            self.path.parent.mkdir(parents=True,exist_ok=True)
            tmp=self.path.with_suffix('.tmp'); tmp.write_text(json.dumps(config)); tmp.replace(self.path)
            self.config=config

class Handler(BaseHTTPRequestHandler):
    def log_message(self,*a): pass
    def send(self,status,body,kind='application/json'):
        if kind=='application/json': body=json.dumps(body).encode()
        self.send_response(status); self.send_header('Content-Type',kind); self.send_header('Cache-Control','no-store'); self.send_header('Content-Length',str(len(body))); self.end_headers(); self.wfile.write(body)
    def do_GET(self):
        path=urlsplit(self.path).path
        if path=='/api/state': return self.send(200,self.server.state.get())
        files={'/':'index.html','/overlay':'overlay.html','/app.js':'app.js','/style.css':'style.css'}
        if path not in files: return self.send(404,dict(error='Not found'))
        file=ROOT/'static'/files[path]
        kind={'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript'}[file.suffix]
        self.send(200,file.read_bytes(),kind)
    def do_POST(self):
        if self.path!='/api/config': return self.send(404,dict(error='Not found'))
        if self.client_address[0] not in ('127.0.0.1','::1'): return self.send(403,dict(error='Control this scoreboard on its own computer'))
        if self.headers.get('Origin') and urlsplit(self.headers['Origin']).netloc!=self.headers.get('Host'): return self.send(403,dict(error='Origin rejected'))
        try:
            size=int(self.headers.get('Content-Length',0))
            if not 0<size<50000: raise ValueError('Invalid request size')
            config=json.loads(self.rfile.read(size)); self.server.state.save(config); self.send(200,dict(ok=True))
        except (ValueError,TypeError,KeyError,AttributeError) as e: self.send(400,dict(error=str(e)))

def main():
    p=argparse.ArgumentParser(); p.add_argument('--manager-url',default='http://127.0.0.1:8770'); p.add_argument('--port',type=int,default=8780); p.add_argument('--host',default='127.0.0.1'); p.add_argument('--data-dir',default=str(ROOT/'data')); a=p.parse_args()
    state=State(a.manager_url,a.data_dir); server=ThreadingHTTPServer((a.host,a.port),Handler); server.state=state
    threading.Thread(target=state.poll,daemon=True).start()
    print(f'Swim Scoreboard: http://{a.host}:{a.port}',flush=True)
    try: server.serve_forever()
    except KeyboardInterrupt: pass
    finally: state.stop.set(); server.server_close()
if __name__=='__main__': main()
