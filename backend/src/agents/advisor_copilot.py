"""
Advisor Copilot Agent (Feature 10)

Conversational agent that lets advisors iterate on trip recommendations
using natural language. Parses instructions into structured constraint
modifications and triggers targeted re-optimization.
"""
import json
import logging
import os
from typing import Any, Dict, List, Optional

from pydantic import BaseModel

from .base import BaseAgent, AgentConfig

logger = logging.getLogger(__name__)


class CopilotAction(BaseModel):
    action_type: str  # modify_constraint | reoptimize | explain | compare | filter
    parameters: Dict[str, Any] = {}
    description: str = ""
    constraint_changes: Dict[str, Any] = {}


class CopilotRequest(BaseModel):
    message: str
    trip_id: str
    current_constraints: Dict[str, Any] = {}
    current_recommendations: List[Dict[str, Any]] = []
    conversation_history: List[Dict[str, str]] = []


class CopilotResponse(BaseModel):
    reply: str
    action: Optional[CopilotAction] = None
    updated_constraints: Dict[str, Any] = {}
    needs_reoptimize: bool = False
    suggestions: List[str] = []


COPILOT_SYSTEM_PROMPT = """You are an AI copilot for travel advisors. You help them refine trip recommendations by interpreting their natural language instructions into specific constraint modifications.

You have access to the current trip constraints and recommendations. When an advisor gives an instruction, you must:
1. Understand what they want to change
2. Map it to specific constraint modifications
3. Explain what you're changing and why

Common instructions and their mappings:
- "Make this cheaper" → reduce max_budget, prefer economy, increase max_stops tolerance
- "Keep everyone on one routing" → set keep_on_same_flights=true
- "Only use Chase points" → filter loyalty_programs to only chase_ur
- "Show me better business class options" → set flight_class=business, may increase budget
- "Remove self-transfers" → set allow_self_transfers=false
- "Optimize for lowest stress for elderly travelers" → prefer nonstop, increase connection_time_min, prefer daytime flights
- "Avoid red-eye flights" → set departure_time_preference to exclude night
- "Use points first" → set points_preference=points_first
- "Find nonstop only" → set max_stops=1 (nonstop only)
- "Add a day in London" → modify destinations/dates

Return a JSON object with:
{
  "reply": "Human-readable explanation of what you're doing",
  "action_type": "modify_constraint|reoptimize|explain|compare|filter",
  "constraint_changes": { ... specific changes to apply ... },
  "needs_reoptimize": true/false,
  "suggestions": ["follow-up suggestion 1", ...]
}"""


class AdvisorCopilotAgent(BaseAgent):
    """Copilot agent for advisor-driven trip refinement."""

    def __init__(self, config: AgentConfig = None):
        super().__init__(config or AgentConfig(
            model="gpt-4o-mini",
            temperature=0.2,
            timeout_seconds=15,
        ))

    @property
    def name(self) -> str:
        return "AdvisorCopilot"

    @property
    def system_prompt(self) -> str:
        return COPILOT_SYSTEM_PROMPT

    async def execute(self, request: CopilotRequest) -> CopilotResponse:
        """Process an advisor's copilot message."""
        messages = [{"role": "system", "content": self.system_prompt}]

        context = self._build_context(request)
        messages.append({"role": "system", "content": f"Current trip context:\n{context}"})

        for msg in request.conversation_history[-10:]:
            messages.append({"role": msg.get("role", "user"), "content": msg.get("content", "")})

        messages.append({"role": "user", "content": request.message})

        result = await self._call_llm_json(messages)

        if not result:
            return CopilotResponse(
                reply="I couldn't process that request. Could you rephrase it?",
                suggestions=["Try being more specific about what you'd like to change."],
            )

        action = None
        action_type = result.get("action_type", "")
        constraint_changes = result.get("constraint_changes", {})

        if action_type:
            action = CopilotAction(
                action_type=action_type,
                parameters=constraint_changes,
                description=result.get("reply", ""),
                constraint_changes=constraint_changes,
            )

        updated = {**request.current_constraints}
        for key, value in constraint_changes.items():
            updated[key] = value

        return CopilotResponse(
            reply=result.get("reply", "Done."),
            action=action,
            updated_constraints=updated,
            needs_reoptimize=result.get("needs_reoptimize", bool(constraint_changes)),
            suggestions=result.get("suggestions", []),
        )

    def _build_context(self, request: CopilotRequest) -> str:
        parts = []

        c = request.current_constraints
        if c:
            parts.append(f"Origin: {c.get('origin', 'N/A')}")
            parts.append(f"Destinations: {c.get('destinations', [])}")
            parts.append(f"Dates: {c.get('start_date', '?')} to {c.get('end_date', '?')}")
            parts.append(f"Travelers: {c.get('adults', 1)} adults, {c.get('children', 0)} children")
            parts.append(f"Class: {c.get('flight_class', 'economy')}")
            parts.append(f"Budget: ${c.get('max_budget', 'none')}")
            parts.append(f"Max stops: {c.get('max_stops', 'any')}")

            points = c.get("points", {})
            if points:
                pts_str = ", ".join(f"{k}: {v:,}" for k, v in points.items())
                parts.append(f"Points: {pts_str}")

        recs = request.current_recommendations
        if recs:
            parts.append(f"\nCurrent recommendations ({len(recs)} options):")
            for i, rec in enumerate(recs[:3]):
                label = rec.get("label", rec.get("category", f"Option {i+1}"))
                price = rec.get("price_summary", "?")
                route = rec.get("route_summary", "?")
                parts.append(f"  {label}: {price} — {route}")

        return "\n".join(parts)


_copilot_instance: Optional[AdvisorCopilotAgent] = None


def get_copilot() -> AdvisorCopilotAgent:
    global _copilot_instance
    if _copilot_instance is None:
        _copilot_instance = AdvisorCopilotAgent()
    return _copilot_instance
