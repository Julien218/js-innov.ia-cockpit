"""Synthetic audio only. No real song, downloaded model or paid provider is used."""
import importlib.util
import json
import subprocess
import tempfile
import unittest
from pathlib import Path
import numpy as np
import soundfile as sf

spec = importlib.util.spec_from_file_location('analyzer', Path(__file__).parents[1] / 'local-agent/music_motion_analyzer.py')
analyzer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(analyzer)

class WholeAudioTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.root = Path(cls.temp.name)
        cls.sr = 22050
        cls.length = 66.25
        y = np.zeros(int(cls.sr * cls.length), dtype=np.float32)
        for t in np.arange(.25,cls.length,.5):
            i=int(t*cls.sr);n=min(int(.07*cls.sr),len(y)-i);tt=np.arange(n)/cls.sr
            y[i:i+n]=.5*np.sin(2*np.pi*100*tt)*np.exp(-tt*50)
        cls.file=cls.root/'pulses.wav';sf.write(cls.file,y,cls.sr)
        cls.result=analyzer.acoustic_summary(cls.file)
        if not cls.result.get('available'):
            raise RuntimeError('Analyse acoustique de test indisponible : ' + ' ; '.join(cls.result.get('warnings', [])))
    @classmethod
    def tearDownClass(cls): cls.temp.cleanup()
    def test_entire_file_including_last_window_is_processed(self):
        c=self.result['coverage'];self.assertTrue(c['complete']);self.assertAlmostEqual(c['decoded_seconds'],self.length,places=3);self.assertEqual(c['samples_decoded'],int(self.sr*self.length));self.assertGreater(self.result['beat_times'][-1],65)
    def test_bpm_is_estimate_not_fixed_default(self):
        self.assertTrue(110 < self.result['bpm'] < 130)
        self.assertIn('estimations',' '.join(self.result['warnings']))
    def test_all_sections_cover_source_without_gaps(self):
        cursor=0
        for s in self.result['sections']:
            self.assertEqual(s['start'],cursor);self.assertGreater(s['end'],s['start']);cursor=s['end'];self.assertEqual(s['type'],'section')
        self.assertAlmostEqual(cursor,self.length,places=3)
    def test_no_false_kick_or_bass_instrument_labels(self):
        self.assertIn('not-isolated-instruments',self.result['band_events']['interpretation']);self.assertNotIn('kicks',self.result)
    def test_silence_has_no_invented_bpm(self):
        file=self.root/'silence.wav';sf.write(file,np.zeros(self.sr*2),self.sr);r=analyzer.acoustic_summary(file);self.assertTrue(r['coverage']['complete']);self.assertIsNone(r['bpm']);self.assertEqual(r['beat_times'],[])
    def test_undecodable_audio_never_becomes_complete(self):
        file=self.root/'invalid.wav';file.write_bytes(b'not audio');r=analyzer.acoustic_summary(file);self.assertFalse(r['coverage']['complete']);self.assertFalse(r['available'])
    def test_small_json_curves_do_not_truncate_audio_coverage(self):
        self.assertLessEqual(len(self.result['curves']),3000);self.assertLessEqual(len(self.result['waveform']),1800);self.assertGreater(self.result['waveform'][-1]['t'],65);json.dumps(self.result,allow_nan=False)
    def test_original_stream_metadata_retained(self):
        self.assertEqual(self.result['source']['sample_rate'],self.sr);self.assertEqual(self.result['source']['channels'],1)

if __name__=='__main__':unittest.main()
