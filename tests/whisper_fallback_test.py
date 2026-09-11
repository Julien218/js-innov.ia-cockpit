import importlib.util
import os
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('analyzer', Path(__file__).parents[1] / 'local-agent/music_motion_analyzer.py')
analyzer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(analyzer)

class WhisperFallbackTest(unittest.TestCase):
    def run_model(self, failure, lazy=False, device='cuda', cpu_failure=False):
        calls = []
        class Model:
            def __init__(self, name, device, compute_type, local_files_only=False):
                assert local_files_only is True
                self.device = device
                calls.append((device, compute_type))
                if device != 'cpu' and not lazy:
                    raise RuntimeError(failure)
                if device == 'cpu' and cpu_failure:
                    raise RuntimeError('invalid audio')
            def transcribe(self, *args, **kwargs):
                def segments():
                    if self.device != 'cpu':
                        yield SimpleNamespace(text='partial GPU output', start=0, end=1, words=[])
                        raise RuntimeError(failure)
                    yield SimpleNamespace(text='Bonjour été', start=0, end=1, words=[])
                return segments(), SimpleNamespace(language='fr', duration=1)
        with patch.dict(sys.modules, {'faster_whisper': SimpleNamespace(WhisperModel=Model)}), patch.dict(os.environ, {'MUSIC_MOTION_WHISPER_DEVICE':device,'MUSIC_MOTION_WHISPER_COMPUTE_TYPE':'float16'}):
            return analyzer.transcribe(Path('test.wav')), calls
    def test_missing_cuda_library_retries_cpu_int8(self):
        result, calls = self.run_model('Library cublas64_12.dll is not found or cannot be loaded')
        self.assertTrue(result['ok'])
        self.assertEqual(calls, [('cuda','float16'),('cpu','int8')])
        self.assertEqual(result['device'],'cpu')
        self.assertTrue(result['fallback_used'])
    def test_lazy_gpu_failure_discards_partial_transcript(self):
        result, calls = self.run_model('cuDNN unavailable', lazy=True)
        self.assertEqual(result['transcript'],'Bonjour été')
        self.assertEqual(len(result['segments']),1)
    def test_non_gpu_error_does_not_retry(self):
        result, calls = self.run_model('invalid audio')
        self.assertFalse(result['ok'])
        self.assertEqual(len(calls),1)
    def test_cpu_failure_is_not_success(self):
        result, calls = self.run_model('CUDA unavailable', cpu_failure=True)
        self.assertFalse(result['ok'])
        self.assertEqual(result['error_code'],'transcription_failed')
        self.assertEqual(len(calls),2)
    def test_explicit_cpu_never_attempts_gpu(self):
        result, calls = self.run_model('unused',device='cpu')
        self.assertTrue(result['ok'])
        self.assertEqual(calls,[('cpu','float16')])

if __name__ == '__main__':
    unittest.main()
