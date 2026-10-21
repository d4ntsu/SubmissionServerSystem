from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    secret_key: str = "dev-secret-change-in-production"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 60

    database_url: str = "sqlite:///./data/exam_system.db"

    judge0_base_url: str = "http://localhost:2358"
    judge0_auth_token: str | None = None

    socket_server_host: str = "127.0.0.1"
    socket_server_port: int = 9000

    cors_origins: str = "http://localhost:3000"

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


settings = Settings()