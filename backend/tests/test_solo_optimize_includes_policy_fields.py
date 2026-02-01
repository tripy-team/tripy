from types import SimpleNamespace


def test_transform_itineraries_preserves_policy_fields():
    from src.routes.solo import _transform_itineraries

    class DummyPolicyEval:
        def model_dump(self):
            return {"blocks": [], "warnings": [], "info": [], "requires_ack": [], "is_blocked": False, "risk_score": 0, "explanations": []}

    agent_it = SimpleNamespace(
        id="it_1",
        rank=1,
        name="Test",
        segments=[],
        transfers=[],
        oop_metrics=SimpleNamespace(
            total_cash_price=100.0,
            total_out_of_pocket=10.0,
            cash_saved=90.0,
            savings_percentage=90.0,
            total_points_used=50000,
            average_cpp=1.8,
        ),
        policy_evaluation=DummyPolicyEval(),
        disabled=True,
        disable_reason="Too risky",
    )

    out = _transform_itineraries([agent_it])
    assert len(out) == 1
    assert out[0].policy_evaluation is not None
    assert out[0].disabled is True
    assert out[0].disable_reason == "Too risky"

