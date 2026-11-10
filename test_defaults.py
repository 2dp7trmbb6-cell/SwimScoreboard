import json
from pathlib import Path
import tempfile
import unittest
from server import State, defaults

class RequestedDefaultsTests(unittest.TestCase):
    def test_fresh_configuration_matches_requested_settings_and_saves(self):
        expected=json.loads((Path(__file__).parent/'testdata/requested-default-settings.json').read_text())
        with tempfile.TemporaryDirectory() as folder:
            state=State('unused',folder)
            self.assertEqual(state.config,expected)
            state.save(state.config)
            self.assertEqual(State('unused',folder).config,expected)
        changed=defaults();changed['lanePhases']['finishFields']['lane']=False
        self.assertEqual(defaults(),expected)

    def test_existing_saved_preferences_are_preserved(self):
        with tempfile.TemporaryDirectory() as folder:
            saved=defaults();saved['mode']='board';saved['alignment']['count']=8
            saved['personalBestBoards']['compact']=False;saved['lanePhases']['personalBest']=False
            saved['lanePhases']['startHideDelay']=1.5
            saved['achievements']['standards']['compact']=False
            saved['boardPhases']['compact']['finishFields'].update(seed=False,split=True)
            Path(folder,'settings.json').write_text(json.dumps(saved))
            self.assertEqual(State('unused',folder).config,saved)
