import copy
import json
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

import hq

DATA = json.loads((Path(__file__).resolve().parents[1] / 'data/demo.json').read_text())


class HeadquartersTests(unittest.TestCase):
    def test_end_to_end_offline(self):
        with patch.object(socket, 'socket', side_effect=AssertionError('ネットワーク禁止')), patch.object(socket, 'getaddrinfo', side_effect=AssertionError('DNS禁止')):
            result = hq.run(DATA)
            self.assertIn('アオギリ', hq.render(result))
        self.assertEqual([x['stage'] for x in result['audit']], ['リサーチ', '営業', '経理財務'])
        self.assertEqual([x['output_count'] for x in result['audit']], [4, 3, 3])
        self.assertEqual([x['id'] for x in result['sales']], ['DEMO-001', 'DEMO-004', 'DEMO-002'])
        d = {x['id']:x for x in result['finance']}
        self.assertEqual(d['DEMO-001']['profit_yen'], 600000)
        self.assertEqual(d['DEMO-001']['margin_percent'], 50)
        self.assertEqual(d['DEMO-001']['finance_status'], '社内審査通過・人間確認待ち')
        self.assertIn('粗利益率が基準未満', d['DEMO-002']['finance_reasons'])
        self.assertIn('先行支出後の手元資金が基準未満', d['DEMO-004']['finance_reasons'])
        self.assertIn('入金条件が60日を超過', d['DEMO-004']['finance_reasons'])
        self.assertEqual([x['balance_yen'] for x in result['cash_timeline']], [900000, 2100000])

    def test_reproducible_and_no_mutation(self):
        source = copy.deepcopy(DATA)
        self.assertEqual(hq.run(source), hq.run(source))
        self.assertEqual(source, DATA)

    def test_validation(self):
        for field, value in [('budget_yen',0), ('cost_yen',-1), ('fit',101), ('payment_days',True), ('evidence','')]:
            with self.subTest(field=field):
                data = copy.deepcopy(DATA)
                data['leads'][0][field] = value
                with self.assertRaises(ValueError):
                    hq.run(data)
        for modify in (lambda d: d.update(fictional=False),
                       lambda d: d['leads'].append(d['leads'][0]),
                       lambda d: d.update(minimum_margin_percent=101)):
            data = copy.deepcopy(DATA)
            modify(data)
            with self.assertRaises(ValueError):
                hq.run(data)

    def test_invalid_top_level(self):
        for data in (None, [], 1, 'invalid'):
            with self.subTest(data=data), self.assertRaises(ValueError):
                hq.run(data)

    def test_empty(self):
        data = dict(DATA, leads=[])
        result = hq.run(data)
        self.assertEqual(result['finance'], [])
        self.assertEqual(result['cash_timeline'], [])

    def test_thresholds(self):
        data = copy.deepcopy(DATA)
        data['leads'] = [dict(data['leads'][0], fit=70, budget_yen=1000000, cost_yen=700000, payment_days=60)]
        data.update(opening_cash_yen=1200000)
        result = hq.run(data)
        self.assertEqual(result['finance'][0]['finance_status'], '社内審査通過・人間確認待ち')
        self.assertEqual(result['finance'][0]['cash_after_reservation_yen'], 500000)

    def test_no_double_spending(self):
        data = copy.deepcopy(DATA)
        data['leads'] = [dict(data['leads'][0], id=str(i)) for i in range(2)]
        result = hq.run(data)
        self.assertEqual(result['finance'][1]['finance_status'], '条件見直し')
        self.assertEqual(len(result['cash_timeline']), 2)

    def test_html_escaping(self):
        data = copy.deepcopy(DATA)
        data['leads'][0]['company'] = '<script>alert(1)</script>'
        page = hq.render(hq.run(data))
        self.assertNotIn('<script>', page)
        self.assertIn('&lt;script&gt;', page)
        self.assertIn("default-src 'none'", page)

    def test_cli_files_and_invalid_input(self):
        script = Path(hq.__file__).resolve()
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / 'results'
            process = subprocess.run([sys.executable, str(script), '--out', str(out)], capture_output=True)
            self.assertEqual(process.returncode, 0, process.stderr)
            self.assertEqual(json.loads((out/'result.json').read_text()), hq.run(DATA))
            self.assertTrue((out/'dashboard.html').exists())
            invalid = Path(tmp)/'invalid.json'
            invalid.write_text('{}')
            process = subprocess.run([sys.executable, str(script), '--input', str(invalid), '--out', str(Path(tmp)/'bad')], capture_output=True)
            self.assertEqual(process.returncode, 2)
            self.assertFalse((Path(tmp)/'bad').exists())


if __name__ == '__main__':
    unittest.main()
