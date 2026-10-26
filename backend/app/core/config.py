from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    secret_key: str = "dev-secret-change-in-production"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 60

    database_url: str = "sqlite:///./data/exam_system.db"

    piston_base_url: str = "http://127.0.0.1:2000"
    piston_request_timeout_seconds: float = 20.0
    piston_compile_timeout_ms: int = 10_000
    piston_run_timeout_ms: int = 3_000
    piston_compile_memory_limit_bytes: int = 536_870_912
    piston_run_memory_limit_bytes: int = 268_435_456

    socket_server_host: str = "127.0.0.1"
    socket_server_port: int = 9000
    socket_server_shared_secret: str | None = None

    cors_origins: str = "http://localhost:3000"

    model_config = {
        "env_file": ".env",
        "env_file_encoding": "utf-8",
        "extra": "ignore",
    }


settings = Settings()
