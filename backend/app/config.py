"""
Environment configuration for AgentGate.

Loaded once via pydantic-settings. Nothing here does I/O beyond reading
the environment / .env file.
"""
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict

# A.14 — SKU / scope taxonomy. Deliberately small and hardcoded.
VALID_SKU_CATEGORIES = ["groceries", "food", "electronics", "subscriptions"]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    DATABASE_URL: str = "sqlite:///./agentgate.db"
    RAZORPAY_KEY_ID: str = "rzp_test_placeholder"
    RAZORPAY_KEY_SECRET: str = "placeholder_secret"
    RAZORPAY_WEBHOOK_SECRET: str = "placeholder_webhook_secret"
    AGENTGATE_HMAC_SECRET: str = "dev-only-change-me"
    DEMO_MODE: bool = False

    # Phase 4 — Failure Path
    FAILURE_RETRY_DELAY_SECONDS: float = 2.0
    FAILURE_MAX_ATTEMPTS: int = 2
    MERCHANT_NOTIFICATION_WEBHOOK_URL: str = "http://localhost:9999/dummy-merchant-webhook"

    GROQ_API_KEY: str = ""
    GROQ_MODEL: str = "openai/gpt-oss-20b"


@lru_cache
def get_settings() -> Settings:
    return Settings()
