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

def field_defaults():
    return dict(board=dict(lane=True,first=True,last=True,team=True,seed=True,split=True,final=True,place=True),
                lanes=dict(lane=True,first=True,last=True,team=True,seed=False,split=False,final=False,place=True))

def defaults():
    return dict(boardWidth=1760,alignment=dict(active=False,usePool=False,points=[[180,120],[1740,120],[1740,960],[180,960]],count=8,reverse=False,position=.05,length=.35,height=.8),mode='board', visible=True, autoHide=True, finishPopups=True, fields=field_defaults(), lanes={str(i):dict(points=[[180,120+(i-1)*105],[900,120+(i-1)*105],[900,210+(i-1)*105],[180,210+(i-1)*105]], enabled=True,offsets=[[0,0] for _ in range(4)]) for i in range(1,9)})

def migrate(config):
    if 'board' not in config.get('fields',{}):
        legacy=config.get('fields',{})
        config['fields']=field_defaults()
        config['fields']['board'].update(legacy)
    config.setdefault('finishPopups',True)
    config.setdefault('boardWidth',1760)
    config.setdefault('alignment',defaults()['alignment'])
    for lane in config.get('lanes',{}).values(): lane.setdefault('offsets',[[0,0] for _ in range(4)])
    return config

def validate_coordinates(points):
    if not isinstance(points,list) or len(points)!=4: raise ValueError('Four corners required')
    for p in points:
        if not isinstance(p,list) or len(p)!=2 or any(type(n) not in (int,float) or not -10000<=n<=10000 for n in p): raise ValueError('Invalid corner coordinate')

def validate_quad(points):
    validate_coordinates(points)
    cross=[]
    for i in range(4):
        a,b,c=points[i],points[(i+1)%4],points[(i+2)%4]
        cross.append((b[0]-a[0])*(c[1]-b[1])-(b[1]-a[1])*(c[0]-b[0]))
    if not (all(x>1 for x in cross) or all(x< -1 for x in cross)): raise ValueError('Corners must form a convex quadrilateral in perimeter order')

def project(points,u,v):
    a,b,c,d=points
    dx1,dx2=b[0]-c[0],d[0]-c[0]; dy1,dy2=b[1]-c[1],d[1]-c[1]
    sx,sy=a[0]-b[0]+c[0]-d[0],a[1]-b[1]+c[1]-d[1]
    det=dx1*dy2-dx2*dy1
    if abs(det)<1e-8: raise ValueError('Degenerate pool')
    g,h=(sx*dy2-dx2*sy)/det,(dx1*sy-sx*dy1)/det
    w=g*u+h*v+1
    if abs(w)<1e-8: raise ValueError('Invalid pool perspective')
    return [((b[j]-a[j]+g*b[j])*u+(d[j]-a[j]+h*d[j])*v+a[j])/w for j in range(2)]

def lane_points(config,lane):
    a=config['alignment']; n=a['count']; index=n-lane if a['reverse'] else lane-1
    v=(index+(1-a['height'])/2)/n; bottom=v+a['height']/n
    u=a['position']; end=u+a['length']
    base=[project(a['points'],x,y) for x,y in [(u,v),(end,v),(end,bottom),(u,bottom)]]
    return [[value+config['lanes'][str(lane)]['offsets'][i][j] for j,value in enumerate(p)] for i,p in enumerate(base)]

class State:
    def __init__(self, manager, folder):
        self.manager = manager.rstrip('/')
        self.path = Path(folder)/'settings.json'
        self.lock = threading.Lock()
        self.config = migrate(json.loads(self.path.read_text())) if self.path.exists() else defaults()
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
        if any(type(config[k]) is not bool for k in ('visible','autoHide','finishPopups')): raise ValueError('Invalid visibility')
        if type(config['boardWidth']) is not int or not 640<=config['boardWidth']<=1760: raise ValueError('Traditional scoreboard width must be 640–1760 pixels')
        if set(config['fields']) != {'board','lanes'}: raise ValueError('Invalid scoreboard fields')
        for format,fields in config['fields'].items():
            if not isinstance(fields,dict) or set(fields)!=set(field_defaults()[format]) or any(type(v) is not bool for v in fields.values()): raise ValueError('Invalid fields')
        if set(config['lanes']) != set(defaults()['lanes']): raise ValueError('Expected lanes 1–8')
        a=config['alignment']
        if set(a)!=set(defaults()['alignment']): raise ValueError('Invalid alignment settings')
        if any(type(a[k]) is not bool for k in ('active','usePool','reverse')): raise ValueError('Invalid alignment flags')
        if type(a['count']) is not int or not 1<=a['count']<=8: raise ValueError('Pool must have 1–8 lanes')
        for k in ('position','length','height'):
            if type(a[k]) not in (int,float) or not 0<=a[k]<=1: raise ValueError('Invalid card placement')
        if a['length']<.02 or a['height']<.1 or a['position']+a['length']>1: raise ValueError('Card must fit within pool length')
        validate_quad(a['points'])
        for key,lane in config['lanes'].items():
            if type(lane.get('enabled')) is not bool: raise ValueError('Invalid lane')
            validate_quad(lane.get('points'))
            validate_coordinates(lane.get('offsets'))
            if a['usePool'] and int(key)<=a['count']: validate_quad(lane_points(config,int(key)))
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
