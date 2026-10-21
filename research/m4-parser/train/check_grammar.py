import ctypes
import json
import math
import llama_cpp as native
from closed_decode import label_grammar


def accepts(llm, grammar, text):
    sampler = native.llama_sampler_init_grammar(llm._model.vocab, grammar.encode(), b"root")
    if not sampler:
        raise ValueError("native grammar initialization failed")
    try:
        for token in [*llm.tokenize(text.encode(), add_bos=False, special=False), llm.token_eos()]:
            data = (native.llama_token_data * 1)(native.llama_token_data(token, 0.0, 0.0))
            candidates = native.llama_token_data_array(data, 1, -1, False)
            native.llama_sampler_apply(sampler, ctypes.byref(candidates))
            if not math.isfinite(data[0].logit):
                return False
            native.llama_sampler_accept(sampler, token)
        return True
    finally:
        native.llama_sampler_free(sampler)


def boundaries(llm):
    names = ['卧推', 'Squat', '哑铃 "推" \\ squat']
    grammar = label_grammar(names)
    s = dict(weight=60, unit='kg', reps=8, rpe=None)
    record = lambda sets=[s], name='卧推': dict(intent='record', exercise=name, sets=sets)
    positives = [record(), record([dict(weight=None, unit=None, reps=0, rpe=None)], None),
        record([s] * 16), record([s], names[2]),
        dict(intent='repeat', exercise=None, count=16), dict(intent='end'),
        dict(intent='skip', exercise='Squat', target='next'), dict(intent='skip', exercise=None, target=100),
        dict(intent='correct', exercise=None, target='last', changes=dict(weight=0, unit='lb', reps=0, rpe=10)),
        dict(intent='correct', exercise=None, target=1, changes=dict(rpe=1.5)),
        dict(intent='clarify', reason='missing_unit')]
    negatives = [record([dict(s, unit=None)]), record([dict(s, weight=None)]), record([dict(s, reps=1.5)]),
        record([dict(s, rpe=10.5)]), record([dict(s, weight=2205.1)]), record([]), record([s]*17), record(name='Unknown'),
        dict(record(), command='write'), dict(intent='repeat', exercise=None, count=0),
        dict(intent='repeat', exercise=None, count=17), dict(intent='skip', exercise=None, target=0),
        dict(intent='correct', exercise=None, target='next', changes=dict(reps=8)),
        dict(intent='correct', exercise=None, target=1, changes={}),
        dict(intent='correct', exercise=None, target=1, changes=dict(weight=60)),
        dict(intent='correct', exercise=None, target=1, changes=dict(unit='kg')),
        dict(intent='clarify', reason='target_not_actual'), dict(intent='end', exercise=None)]
    for expected, rows in ((True, positives), (False, negatives)):
        for value in rows:
            text = json.dumps(value, ensure_ascii=False, separators=(',', ':'))
            assert accepts(llm, grammar, text) is expected, (expected, text)
    # Structural constraints intentionally cannot detect a numeric-role swap.
    assert accepts(llm, grammar, json.dumps(record([dict(s, weight=8, reps=60)]), ensure_ascii=False))
    return dict(validAccepted=len(positives), invalidRejected=len(negatives), semanticCounterexampleAccepted=1,
                method='native grammar token mask + EOS; no model inference for boundary checks')
