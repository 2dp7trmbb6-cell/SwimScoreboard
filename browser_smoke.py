"""Optional real-browser smoke test with disposable manager data/settings."""
import importlib.util
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
from http.server import ThreadingHTTPServer

ROOT=Path(__file__).parent
sys.path.insert(0,str(ROOT.parent/'SwimDataManager'))
def load(name,path):
    spec=importlib.util.spec_from_file_location(name,path)
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    return module

manager=load('smoke_manager',ROOT.parent/'SwimDataManager'/'server.py')
score=load('smoke_scoreboard',ROOT/'server.py')
with tempfile.TemporaryDirectory() as data,tempfile.TemporaryDirectory() as settings:
    hub=manager.Hub(data)
    hub.command(dict(action='upload',html='Demo Meet - 10/25/2026\nEvent 3 Girls 100 Yard Freestyle\nHeat 2 of 2 Starts at 09:00 AM\n  2  Smith, Jamie  10  WAVES  1:02.45\n  3  Jones, Taylor  11  SHARKS  NT'))
    hub.command(dict(action='source',mode='demo',interval=600))
    ms=ThreadingHTTPServer(('127.0.0.1',0),manager.Handler);ms.hub=hub;ms.commands=threading.Lock()
    state=score.State(f'http://127.0.0.1:{ms.server_port}',settings)
    ss=ThreadingHTTPServer(('127.0.0.1',0),score.Handler);ss.state=state
    threads=[threading.Thread(target=f,daemon=True) for f in (ms.serve_forever,ss.serve_forever,state.poll)]
    for thread in threads:thread.start()
    try:
        result=subprocess.run(['node',os.environ.get('SMOKE_SCRIPT','test_browser.cjs')],cwd=ROOT,env={**os.environ,'SCOREBOARD_URL':f'http://127.0.0.1:{ss.server_port}','MANAGER_URL':f'http://127.0.0.1:{ms.server_port}'})
    finally:
        state.stop.set();hub.stop.set();ss.shutdown();ms.shutdown();ss.server_close();ms.server_close()
        for thread in threads:thread.join(3)
    sys.exit(result.returncode)
