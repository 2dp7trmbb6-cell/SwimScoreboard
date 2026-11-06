"""Local scoreboard controller and read-only SwimDataManager consumer."""
import hashlib
import argparse
import json
import threading
import time
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).parent
APP_VERSION=hashlib.sha256(b''.join((ROOT/'static'/name).read_bytes() for name in ('app.js','style.css','index.html','overlay.html','personal-best.png'))).hexdigest()[:12]

def config_revision(config):
    return hashlib.sha256(json.dumps(config,sort_keys=True).encode()).hexdigest()[:12]

def field_defaults():
    return dict(board=dict(lane=True,first=True,last=True,team=True,seed=True,split=True,final=True,place=True),
                lanes=dict(lane=True,first=True,last=True,team=True,seed=False,split=False,final=False,place=True),
                compact=dict(lane=True,first=True,last=True,team=True,seed=False,split=True,final=True,place=False))

def compact_defaults():
    return dict(headerX=880,headerY=16,headerWidth=1024,resultsX=1280,resultsBottom=16,resultsWidth=624,rowHeight=32,initials=True,showHeader=True,showResults=True)

def lane_phase_defaults(start=None):
    start=dict(start or field_defaults()['lanes'])
    return dict(splitFields=dict(start,seed=False,split=True,final=False,place=False),
                finishFields=dict(start,lane=False,seed=False,split=False,final=True),
                startEnabled=True,splitEnabled=True,startDelay=0,startDuration=0,startHideDelay=.5,
                splitDelay=0,splitDuration=5,finishDelay=0,finishDuration=0,uprightTimes=True,timeSize=36,personalBest=False)

def board_phase_defaults(fields):
    return dict(splitFields=dict(fields),finishFields=dict(fields),finishHold=5)

def defaults():
    return dict(boardPhases={f:board_phase_defaults(field_defaults()[f]) for f in ('board','compact')},personalBestBoards=dict(board=False,compact=False),lanePhases=lane_phase_defaults(),compact=compact_defaults(),boardWidth=1760,alignment=dict(active=False,usePool=False,points=[[180,120],[1740,120],[1740,960],[180,960]],count=8,reverse=False,position=.05,length=.35,height=.8),mode='board', visible=True, autoHide=True, finishPopups=True, fields=field_defaults(), lanes={str(i):dict(points=[[180,120+(i-1)*105],[900,120+(i-1)*105],[900,210+(i-1)*105],[180,210+(i-1)*105]], enabled=True,offsets=[[0,0] for _ in range(4)]) for i in range(1,9)})

def migrate(config):
    if 'board' not in config.get('fields',{}):
        legacy=config.get('fields',{})
        config['fields']=field_defaults()
        config['fields']['board'].update(legacy)
    config['fields'].setdefault('compact',field_defaults()['compact'])
    config.setdefault('boardPhases',{f:board_phase_defaults(config['fields'][f]) for f in ('board','compact')})
    for format,options in config['boardPhases'].items():
        config['boardPhases'][format]={key:options.get(key,value) for key,value in board_phase_defaults(config['fields'][format]).items()}
    config.setdefault('compact',compact_defaults())
    config.setdefault('lanePhases',lane_phase_defaults(config['fields']['lanes']))
    config['lanePhases'].setdefault('personalBest',False)
    config.setdefault('personalBestBoards',dict(board=False,compact=False))
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
            return dict(appVersion=APP_VERSION,configRevision=config_revision(self.config),config=self.config, state=self.snapshot, received=self.received, error=self.error, now=time.time())
    def save(self, config):
        if set(config) != set(defaults()) or config['mode'] not in ('board','lanes','compact'): raise ValueError('Invalid configuration')
        if any(type(config[k]) is not bool for k in ('visible','autoHide','finishPopups')): raise ValueError('Invalid visibility')
        if type(config['boardWidth']) is not int or not 640<=config['boardWidth']<=1760: raise ValueError('Traditional scoreboard width must be 640–1760 pixels')
        if set(config['fields']) != {'board','lanes','compact'}: raise ValueError('Invalid scoreboard fields')
        for format,fields in config['fields'].items():
            if not isinstance(fields,dict) or set(fields)!=set(field_defaults()[format]) or any(type(v) is not bool for v in fields.values()): raise ValueError('Invalid fields')
        pb=config['personalBestBoards']
        if not isinstance(pb,dict) or set(pb)!={'board','compact'} or any(type(v) is not bool for v in pb.values()): raise ValueError('Invalid scoreboard Personal Best options')
        phases=config['lanePhases']
        if not isinstance(phases,dict) or set(phases)!=set(lane_phase_defaults()): raise ValueError('Invalid lane phase settings')
        for key in ('splitFields','finishFields'):
            fields=phases[key]
            if not isinstance(fields,dict) or set(fields)!=set(field_defaults()['lanes']) or any(type(v) is not bool for v in fields.values()): raise ValueError('Invalid lane phase fields')
        for key in ('startEnabled','splitEnabled','uprightTimes','personalBest'):
            if type(phases[key]) is not bool: raise ValueError('Invalid lane phase flag')
        for key in ('startDelay','startDuration','startHideDelay','splitDelay','splitDuration','finishDelay','finishDuration'):
            if type(phases[key]) not in (int,float) or not 0<=phases[key]<=600: raise ValueError('Lane overlay timing must be 0–600 seconds')
        if phases['splitDuration']<=0: raise ValueError('Split duration must be greater than zero')
        if type(phases['timeSize']) is not int or not 18<=phases['timeSize']<=64: raise ValueError('Time size must be 18–64 pixels before alignment')
        boards=config['boardPhases']
        if not isinstance(boards,dict) or set(boards)!={'board','compact'}: raise ValueError('Invalid scoreboard phases')
        for format,options in boards.items():
            if not isinstance(options,dict) or set(options)!=set(board_phase_defaults(config['fields'][format])): raise ValueError('Invalid scoreboard phase settings')
            for key in ('splitFields','finishFields'):
                fields=options[key]
                if not isinstance(fields,dict) or set(fields)!=set(field_defaults()[format]) or any(type(v) is not bool for v in fields.values()): raise ValueError('Invalid scoreboard phase fields')
            if type(options['finishHold']) not in (int,float) or not 5<=options['finishHold']<=600: raise ValueError('Finish hold must be 5–600 seconds')
        compact=config['compact']
        if not isinstance(compact,dict) or set(compact)!=set(compact_defaults()): raise ValueError('Invalid condensed layout')
        for k in ('initials','showHeader','showResults'):
            if type(compact[k]) is not bool: raise ValueError('Invalid condensed display flag')
        for k in ('headerX','headerY','resultsX','resultsBottom','headerWidth','resultsWidth','rowHeight'):
            if type(compact[k]) is not int: raise ValueError('Condensed layout coordinates must be integers')
        if not 0<=compact['headerX']<=1920 or not 0<=compact['resultsX']<=1920 or not 0<=compact['headerY']<=900 or not 0<=compact['resultsBottom']<=500: raise ValueError('Condensed panels must fit the video canvas')
        for prefix in ('header','results'):
            if not 320<=compact[prefix+'Width']<=1920 or compact[prefix+'X']+compact[prefix+'Width']>1920: raise ValueError('Panel width extends beyond the 1920 pixel canvas')
        if not 24<=compact['rowHeight']<=48: raise ValueError('Condensed rows must be 24–48 pixels tall')
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
        files={'/':'index.html','/overlay':'overlay.html','/app.js':'app.js','/style.css':'style.css','/personal-best.png':'personal-best.png'}
        if path not in files: return self.send(404,dict(error='Not found'))
        file=ROOT/'static'/files[path]
        kind={'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.png':'image/png'}[file.suffix]
        body=file.read_bytes()
        if path=='/app.js':body=body.replace(b'__APP_VERSION__',APP_VERSION.encode())
        self.send(200,body,kind)
    def do_POST(self):
        if self.path!='/api/config': return self.send(404,dict(error='Not found'))
        if self.client_address[0] not in ('127.0.0.1','::1'): return self.send(403,dict(error='Control this scoreboard on its own computer'))
        if self.headers.get('Origin') and urlsplit(self.headers['Origin']).netloc!=self.headers.get('Host'): return self.send(403,dict(error='Origin rejected'))
        try:
            size=int(self.headers.get('Content-Length',0))
            if not 0<size<50000: raise ValueError('Invalid request size')
            config=json.loads(self.rfile.read(size)); self.server.state.save(config); self.send(200,dict(ok=True,configRevision=config_revision(config)))
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
