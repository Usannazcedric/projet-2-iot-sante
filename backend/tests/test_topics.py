from __future__ import annotations
from app.ingest import topics


def test_parse_vitals_topic_extracts_resident_id():
    fam, key = topics.parse("ehpad/vitals/resident/R007")
    assert fam == "vitals"
    assert key == "R007"


def test_parse_motion_topic_extracts_resident_id():
    fam, key = topics.parse("ehpad/motion/resident/R012")
    assert fam == "motion"
    assert key == "R012"


def test_parse_ambient_topic_extracts_room_id():
    fam, key = topics.parse("ehpad/ambient/room/101")
    assert fam == "ambient"
    assert key == "101"


def test_parse_door_topic_extracts_room_id():
    fam, key = topics.parse("ehpad/door/room/101")
    assert fam == "door"
    assert key == "101"


def test_parse_unknown_topic_returns_other():
    fam, key = topics.parse("ehpad/garbage/foo/bar")
    assert fam == "other"
    assert key is None
