from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # Primary LLM — pipeline.py currently calls OpenAI's Responses API.
    openai_api_key: str = ""
    openai_model: str = "gpt-5.6"
    # Cheap/fast tier for latency-insensitive-quality tasks (intake
    # extraction). Confirmed real model id from OpenAI's pricing page, not
    # guessed: $0.20/$1.20 per 1M tokens vs the full gpt-5.6 tier.
    openai_fast_model: str = "gpt-5.6-luna"

    # Kept for the cross-model comparison the proposal's evaluation
    # framework calls for; not wired into pipeline.py right now.
    gemini_api_key: str = ""
    gemini_model: str = "gemini-3.6-flash"
    # SQLite file for local dev. For the Supabase (EU) Postgres instance use
    # "postgresql+psycopg://user:pass@host:5432/postgres" in .env.
    database_url: str = "sqlite:///dayflow.db"
    supabase_url: str = ""
    supabase_key: str = ""
    google_client_id: str = ""
    google_client_secret: str = ""
    google_redirect_uri: str = "http://localhost:8000/calendar/google/callback"
    frontend_url: str = "http://localhost:5173"

    # "react" or "hierarchical" — the experimental condition switch for RQ1.
    orchestration_mode: str = "hierarchical"

    working_hours_start: int = 8
    working_hours_end: int = 20

    # Critical Success Factor from the proposal: P90 end-to-end
    # re-optimization latency at or below 12 seconds.
    reoptimization_latency_target_ms: int = 12000

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


@lru_cache
def get_settings() -> Settings:
    return Settings()
