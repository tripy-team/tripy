"""
Base classes for the agentic architecture.
"""

from abc import ABC, abstractmethod
from typing import Any, TypeVar, Generic
from pydantic import BaseModel
import openai
import os
import logging
import asyncio
from functools import wraps

logger = logging.getLogger(__name__)

T = TypeVar("T", bound=BaseModel)
R = TypeVar("R", bound=BaseModel)


class AgentConfig(BaseModel):
    """Configuration for an agent."""
    model: str = "gpt-4o-mini"
    temperature: float = 0.1
    max_retries: int = 3
    retry_delay_seconds: float = 1.0
    timeout_seconds: int = 30


def with_retry(max_retries: int = 3, delay: float = 1.0):
    """Decorator to add retry logic to async functions."""
    def decorator(func):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            last_exception = None
            for attempt in range(max_retries):
                try:
                    return await func(*args, **kwargs)
                except Exception as e:
                    last_exception = e
                    if attempt < max_retries - 1:
                        wait_time = delay * (2 ** attempt)  # Exponential backoff
                        logger.warning(
                            f"[Retry {attempt + 1}/{max_retries}] {func.__name__} failed: {e}, "
                            f"retrying in {wait_time:.1f}s"
                        )
                        await asyncio.sleep(wait_time)
                    else:
                        logger.error(f"[Retry {max_retries}/{max_retries}] {func.__name__} failed permanently: {e}")
            raise last_exception
        return wrapper
    return decorator


class RateLimiter:
    """Simple async rate limiter."""
    
    def __init__(self, calls_per_minute: int = 60):
        self.calls_per_minute = calls_per_minute
        self.min_interval = 60.0 / calls_per_minute
        self._last_call = 0.0
        self._lock = asyncio.Lock()
    
    async def acquire(self):
        """Wait until rate limit allows another call."""
        async with self._lock:
            import time
            now = time.time()
            elapsed = now - self._last_call
            if elapsed < self.min_interval:
                await asyncio.sleep(self.min_interval - elapsed)
            self._last_call = time.time()


# Global rate limiters
_openai_limiter = RateLimiter(calls_per_minute=50)  # Conservative for GPT-4
_api_limiter = RateLimiter(calls_per_minute=30)  # For external APIs


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
        api_key = os.getenv("OPENAI_ADMIN_KEY") or os.getenv("OPENAI_API_KEY")
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
        """Call the LLM with optional function calling and retry logic."""
        if not self.client:
            logger.warning(f"[{self.name}] No OpenAI client, returning None")
            return None
        
        # Apply rate limiting
        await _openai_limiter.acquire()
        
        last_error = None
        for attempt in range(self.config.max_retries):
            try:
                kwargs = {
                    "model": self.config.model,
                    "messages": messages,
                    "temperature": self.config.temperature,
                    "timeout": self.config.timeout_seconds,
                }
                
                if self.tools:
                    kwargs["tools"] = self.tools
                
                if response_format:
                    kwargs["response_format"] = response_format
                
                response = await self.client.chat.completions.create(**kwargs)
                return response
                
            except openai.RateLimitError as e:
                last_error = e
                wait_time = self.config.retry_delay_seconds * (2 ** attempt)
                logger.warning(f"[{self.name}] Rate limited, waiting {wait_time:.1f}s")
                await asyncio.sleep(wait_time)
                
            except openai.APITimeoutError as e:
                last_error = e
                if attempt < self.config.max_retries - 1:
                    logger.warning(f"[{self.name}] Timeout, retrying...")
                    await asyncio.sleep(self.config.retry_delay_seconds)
                    
            except Exception as e:
                logger.error(f"[{self.name}] LLM call failed: {e}")
                raise
        
        if last_error:
            raise last_error
        return None
    
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


# Export rate limiter for use in agents
def get_api_rate_limiter() -> RateLimiter:
    """Get the shared API rate limiter."""
    return _api_limiter
