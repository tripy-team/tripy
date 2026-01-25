"""
Base classes for the agentic architecture.
"""

from abc import ABC, abstractmethod
from typing import Any, TypeVar, Generic
from pydantic import BaseModel
import openai
import os
import logging

logger = logging.getLogger(__name__)

T = TypeVar("T", bound=BaseModel)
R = TypeVar("R", bound=BaseModel)


class AgentConfig(BaseModel):
    """Configuration for an agent."""
    model: str = "gpt-4o-mini"
    temperature: float = 0.1
    max_retries: int = 3
    timeout_seconds: int = 30


class BaseAgent(ABC, Generic[T, R]):
    """
    Base class for all agents in the system.
    
    Agents are autonomous components that can:
    - Make decisions using LLMs
    - Execute tool calls
    - Handle errors and retries
    """
    
    def __init__(self, config: AgentConfig = None):
        self.config = config or AgentConfig()
        api_key = os.getenv("OPENAI_ADMIN_KEY")
        if api_key:
            self.client = openai.AsyncOpenAI(api_key=api_key)
        else:
            self.client = None
            logger.warning("OPENAI_ADMIN_KEY not set, agent will use fallback logic")
    
    @property
    @abstractmethod
    def name(self) -> str:
        """Name of the agent."""
        pass
    
    @property
    @abstractmethod
    def system_prompt(self) -> str:
        """System prompt for the agent."""
        pass
    
    @property
    def tools(self) -> list[dict] | None:
        """Function tools available to the agent. Override in subclasses."""
        return None
    
    @abstractmethod
    async def execute(self, request: T) -> R:
        """Execute the agent's task."""
        pass
    
    async def _call_llm(
        self, 
        messages: list[dict],
        response_format: dict | None = None,
    ) -> Any:
        """Call the LLM with optional function calling."""
        if not self.client:
            logger.warning(f"[{self.name}] No OpenAI client, returning None")
            return None
        
        try:
            kwargs = {
                "model": self.config.model,
                "messages": messages,
                "temperature": self.config.temperature,
            }
            
            if self.tools:
                kwargs["tools"] = self.tools
            
            if response_format:
                kwargs["response_format"] = response_format
            
            response = await self.client.chat.completions.create(**kwargs)
            return response
        except Exception as e:
            logger.error(f"[{self.name}] LLM call failed: {e}")
            raise
    
    async def _call_llm_json(self, messages: list[dict]) -> dict | None:
        """Call LLM expecting JSON response."""
        response = await self._call_llm(
            messages, 
            response_format={"type": "json_object"}
        )
        
        if response and response.choices:
            import json
            try:
                return json.loads(response.choices[0].message.content)
            except json.JSONDecodeError:
                logger.error(f"[{self.name}] Failed to parse JSON response")
                return None
        return None
    
    def _get_tool_map(self) -> dict[str, callable]:
        """Map tool names to implementations. Override in subclasses."""
        return {}
    
    async def _execute_tool(self, tool_name: str, arguments: dict) -> Any:
        """Execute a tool call."""
        tool_map = self._get_tool_map()
        if tool_name not in tool_map:
            raise ValueError(f"Unknown tool: {tool_name}")
        return await tool_map[tool_name](**arguments)
