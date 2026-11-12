"""Shared loader sender boundaries; no device access."""
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'tools'))
import send_app


class SenderTests(unittest.TestCase):
    def test_upload_boundaries_and_non_bmp(self):
        for size in (send_app.LIMIT-1, send_app.LIMIT, send_app.LIMIT+1):
            stages,final=send_app.plan_upload(b' '*(size-1)+b'1')
            self.assertEqual(bool(stages),size>=send_app.LIMIT)
            self.assertTrue(all(len(x)<send_app.LIMIT for x in stages+[final]))
        stages,final=send_app.plan_upload(('/*'+'😀'*150000+'*/\n(async()=>42)();').encode())
        self.assertTrue(stages)
        self.assertTrue(all(len(x)<send_app.LIMIT for x in stages+[final]))
        self.assertIn(b'await eval(source)',final)


if __name__ == '__main__':
    unittest.main()
