"""Do not normalize away a scientific difference while auditing identity pairs."""
from copy import deepcopy
import json
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT), str(ROOT / 'src')]
from analyze_i1_failures import without_source_ids


class IdentityNormalizationTests(unittest.TestCase):
    def payload(self, identity='opaque-a', value='barbell', revision=8):
        return {'messages': [
            {'role': 'assistant', 'tool_calls': [{'id': 'call', 'function': {'name': 'get_memories'}}]},
            {'role': 'tool', 'tool_call_id': 'call', 'content': json.dumps({'ok': True, 'result': {
                'memories': [{'id': identity, 'field': 'equipment', 'value': [value], 'revision': revision}]}})}],
                'temperature': 0, 'tools': [{'name': 'get_memories'}]}

    def test_ids_may_differ_but_inputs_are_not_mutated(self):
        left = self.payload(); saved = deepcopy(left)
        self.assertEqual(without_source_ids(left), without_source_ids(self.payload('opaque-b')))
        self.assertEqual(left, saved)

    def test_values_revisions_and_other_input_differences_remain_visible(self):
        left = without_source_ids(self.payload())
        self.assertNotEqual(left, without_source_ids(self.payload(value='dumbbell')))
        self.assertNotEqual(left, without_source_ids(self.payload(revision=9)))
        right = self.payload(); right['temperature'] = 1
        self.assertNotEqual(left, without_source_ids(right))


if __name__ == '__main__':
    unittest.main()
