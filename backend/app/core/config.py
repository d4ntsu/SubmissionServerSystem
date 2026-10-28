from typing import Literal

from pydantic import model_validator
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    secret_key: str = "dev-secret-change-in-production"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 15
    refresh_session_days: int = 14
    refresh_cookie_secure: bool = False
    refresh_cookie_samesite: Literal["lax", "strict", "none"] = "lax"
    app_environment: str = "development"

    database_url: str = "sqlite:///./data/exam_system.db"

    piston_base_url: str = "http://127.0.0.1:2000"
    piston_request_timeout_seconds: float = 20.0
    piston_compile_timeout_ms: int = 10_000
    piston_run_timeout_ms: int = 3_000
    piston_compile_memory_limit_bytes: int = 536_870_912
    piston_run_memory_limit_bytes: int = 268_435_456
    # Java source-file mode compiles the grader inside Piston's run stage.
    piston_java_method_run_timeout_ms: int = 15_000
    piston_java_method_run_cpu_time_ms: int = 15_000
    piston_java_method_run_memory_limit_bytes: int = 536_870_912

    socket_server_host: str = "127.0.0.1"
    socket_server_port: int = 9000
    socket_server_shared_secret: str | None = None

    cors_origins: str = "http://localhost:3000"

    model_config = {
        "env_file": ".env",
        "env_file_encoding": "utf-8",
        "extra": "ignore",
    }

    @model_validator(mode="after")
    def validate_refresh_cookie_environment(self):
        if self.refresh_session_days <= 0:
            raise ValueError("REFRESH_SESSION_DAYS must be positive")
        if self.access_token_expire_minutes <= 0:
            raise ValueError("ACCESS_TOKEN_EXPIRE_MINUTES must be positive")
        if self.app_environment.lower() != "development" and not self.refresh_cookie_secure:
            raise ValueError("REFRESH_COOKIE_SECURE must be true outside development")
        if self.refresh_cookie_samesite == "none" and not self.refresh_cookie_secure:
            raise ValueError("SameSite=None requires REFRESH_COOKIE_SECURE=true")
        allowed_origins = [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]
        if not allowed_origins or "*" in allowed_origins:
            raise ValueError("CORS_ORIGINS must contain explicit origins and cannot include '*'")
        return self


settings = Settings()
