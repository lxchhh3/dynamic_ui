from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", case_sensitive=False, extra="ignore")

    database_url: str
    jwt_secret: str
    jwt_algorithm: str = "HS256"
    jwt_expire_days: int = 7
    cors_origins: str = "http://localhost:5173"
    log_level: str = "INFO"
    # Unset = hybrid LLM feature off; executor uses deterministic text only.
    # Set (e.g. http://127.0.0.1:8001/render on the VPS) to embellish the
    # AssistantMessage with LLM-authored prose. Data-bearing blocks stay
    # deterministic regardless.
    llm_render_url: str | None = None

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


settings = Settings()  # type: ignore[call-arg]
