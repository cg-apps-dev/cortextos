import unittest

from engine import VID_RE


def parse_name(name):
    """Mirror of engine.py intake_video_card's per-file parse (VID_RE + None->"AI" actor)."""
    m = VID_RE.search(name)
    assert m, f"failed to parse {name!r}"
    v = int(m.group(1))
    actor = m.group(2).strip() if m.group(2) is not None else "AI"
    hook = int(m.group(3))
    ratio = m.group(4).lower()
    return {"v": v, "actor": actor, "hook": hook, "ratio": ratio}


class AiVoActorlessTests(unittest.TestCase):
    """AI-VO actor-less naming: 'AI #<n> - V<vv> - Hook <h> - <ratio>(_<dupe>)?.mp4' -> actor 'AI'."""

    def test_ai_9x16_no_suffix_parses_as_ai(self):
        self.assertEqual(parse_name("AI #203 - V01 - Hook 1 - 9x16.mp4"),
                         {"v": 1, "actor": "AI", "hook": 1, "ratio": "9x16"})

    def test_ai_4x5_no_suffix_parses_as_ai(self):
        self.assertEqual(parse_name("AI #204 - V02 - Hook 3 - 4x5.mp4"),
                         {"v": 2, "actor": "AI", "hook": 3, "ratio": "4x5"})

    def test_ai_4x5_dupe_suffix_parses_as_ai(self):
        self.assertEqual(parse_name("AI #206 - V01 - Hook 5 - 4x5_1.mp4"),
                         {"v": 1, "actor": "AI", "hook": 5, "ratio": "4x5"})


class HumanActorNoRegressionTests(unittest.TestCase):
    """Existing human-actor convention must keep working unchanged."""

    def test_single_actor_still_parses(self):
        self.assertEqual(parse_name("UGC-12 - V03 - Thomas - Hook 2 - 9x16.mp4"),
                         {"v": 3, "actor": "Thomas", "hook": 2, "ratio": "9x16"})

    def test_multiword_actor_still_parses(self):
        self.assertEqual(parse_name("UGC-7 - V01 - Mia K - Hook 4 - 4x5.mp4"),
                         {"v": 1, "actor": "Mia K", "hook": 4, "ratio": "4x5"})

    def test_raw_clip_does_not_parse(self):
        self.assertIsNone(VID_RE.search("Broll_sunset.mov"))
        self.assertIsNone(VID_RE.search("Hook3.mov"))


if __name__ == "__main__":
    unittest.main()
