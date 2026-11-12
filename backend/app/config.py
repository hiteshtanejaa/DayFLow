from functools import lru_cache
from urllib.parse import quote_plus

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # "openai" (default) or "gemini": one model serves every call when "gemini".
    llm_provider: str = "openai"
    openai_api_key: str = ""
    openai_model: str = "gpt-5.6"
    # Cheap/fast tier for latency-insensitive-quality tasks (intake
    # extraction). Confirmed real model id from OpenAI's pricing page, not
    # guessed: $0.20/$1.20 per 1M tokens vs the full gpt-5.6 tier.
    openai_fast_model: str = "gpt-5.6-luna"

    # Used when LLM_PROVIDER=gemini (see app/agents/gemini.py).
    gemini_api_key: str = ""
    gemini_model: str = "gemini-3.6-flash"
    # Explicit override ("postgresql+psycopg://..." or "sqlite:///x.db"). If empty,
    # see `db_url`: Supabase when configured, else a local SQLite file.
    database_url: str = ""
    supabase_url: str = ""  # https://<project-ref>.supabase.co
    supabase_key: str = ""  # publishable key: NOT used by the backend (it talks to Postgres directly)
    supabase_pass: str = ""  # the project's database password
    supabase_region: str = "eu-west-1"  # Ireland: where this project lives (GDPR: EU)
    google_client_id: str = ""
    google_client_secret: str = ""
    google_redirect_uri: str = "http://localhost:8000/calendar/google/callback"
    frontend_url: str = "http://localhost:5173"

    # "react" or "hierarchical" — the experimental condition switch for RQ1.
    orchestration_mode: str = "hierarchical"

    # Execution Monitor: minutes past a block's start (or end, if running) before nudging.
    monitor_grace_minutes: int = 10

    working_hours_start: int = 8
    working_hours_end: int = 20

    # Critical Success Factor from the proposal: P90 end-to-end
    # re-optimization latency at or below 12 seconds.
    reoptimization_latency_target_ms: int = 12000

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    @property
    def db_url(self) -> str:
        """DATABASE_URL, else the Supabase Postgres built from SUPABASE_URL and
        SUPABASE_PASS (so the password is only ever written in .env, once), else SQLite."""
        if self.database_url:
            return self.database_url
        if self.supabase_url and self.supabase_pass:
            # Session pooler, not the direct db.<ref>.supabase.co host: the direct host is
            # IPv6-only and fails to resolve on IPv4-only networks.
            ref = self.supabase_url.split("//", 1)[-1].split(".", 1)[0]
            return (
                f"postgresql+psycopg://postgres.{ref}:{quote_plus(self.supabase_pass)}"
                f"@aws-0-{self.supabase_region}.pooler.supabase.com:5432/postgres?sslmode=require"
            )
        return "sqlite:///dayflow.db"


@lru_cache
def get_settings() -> Settings:
    return Settings()
