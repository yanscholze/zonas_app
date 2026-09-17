from __future__ import annotations

from datetime import date, timedelta
from pathlib import Path
from typing import Any

from garminconnect import Garmin

from garminconnect.workout import (
    RunningWorkout,
    WorkoutSegment,
    create_warmup_step,
    create_interval_step,
    create_recovery_step,
    create_cooldown_step,
    create_repeat_group,
)


TOKEN_ROOT = Path(__file__).parent / "tokenstore"


class GarminNotConnectedError(Exception):
    """A conta Garmin ainda não possui uma sessão salva."""


def _safe_student_id(student_id: str) -> str:
    """
    Evita que um ID recebido pela API consiga escapar da pasta tokenstore.
    """
    cleaned = "".join(
        char for char in str(student_id)
        if char.isalnum() or char in ("-", "_")
    )

    if not cleaned:
        raise ValueError("student_id inválido")

    return cleaned


def get_token_path(student_id: str) -> Path:
    student_id = _safe_student_id(student_id)

    path = TOKEN_ROOT / student_id
    path.mkdir(parents=True, exist_ok=True)

    return path


def connect_with_credentials(
    student_id: str,
    email: str,
    password: str,
    mfa_code: str | None = None,
) -> Garmin:
    """
    Faz o primeiro login da conta Garmin.

    Depois do login, os tokens ficam armazenados na pasta correspondente
    ao aluno. A senha não é persistida pelo ZonasApp.
    """

    token_path = get_token_path(student_id)

    def prompt_mfa() -> str:
        if mfa_code:
            return mfa_code

        return input("Código MFA Garmin: ")

    client = Garmin(
        email,
        password,
        prompt_mfa=prompt_mfa,
    )

    client.login(str(token_path))

    return client


def connect_with_tokens(student_id: str) -> Garmin:
    """
    Abre uma sessão Garmin utilizando os tokens previamente armazenados.
    """

    token_path = get_token_path(student_id)

    # Não queremos criar a impressão de que existe conexão só porque
    # get_token_path criou o diretório.
    if not any(token_path.iterdir()):
        raise GarminNotConnectedError(
            f"Nenhuma sessão Garmin encontrada para o aluno {student_id}"
        )

    client = Garmin()
    client.login(str(token_path))

    return client


def get_activities(
    student_id: str,
    days: int = 30,
    limit: int = 100,
) -> list[dict[str, Any]]:
    """
    Recupera as atividades recentes da conta Garmin.
    """

    client = connect_with_tokens(student_id)

    days = max(1, min(days, 365))
    limit = max(1, min(limit, 200))

    end_date = date.today()
    start_date = end_date - timedelta(days=days)

    activities = client.get_activities_by_date(
        start_date.isoformat(),
        end_date.isoformat(),
    )

    if not isinstance(activities, list):
        return []

    return activities[:limit]


def get_profile(student_id: str) -> dict[str, Any]:
    """
    Retorna informações básicas da conta conectada.
    Útil para validar se os tokens ainda funcionam.
    """

    client = connect_with_tokens(student_id)

    profile = client.get_full_name()

    return {
        "studentId": student_id,
        "name": profile,
        "connected": True,
    }


def create_test_running_workout(student_id: str) -> dict[str, Any]:
    """
    Cria um treino estruturado de teste no Garmin Connect.

    Estrutura:
    - 10 min aquecimento
    - 5x:
        - 1 min intervalo
        - 1 min recuperação
    - 10 min desaquecimento

    Duração total: 30 minutos.
    """

    client = connect_with_tokens(student_id)

    running_sport = {
        "sportTypeId": 1,
        "sportTypeKey": "running",
    }

    steps = [
        create_warmup_step(
            duration_seconds=600.0,
            step_order=1,
        ),

        create_repeat_group(
            iterations=5,
            workout_steps=[
                create_interval_step(
                    duration_seconds=60.0,
                    step_order=3,
                ),
                create_recovery_step(
                    duration_seconds=60.0,
                    step_order=4,
                ),
            ],
            step_order=2,
        ),

        create_cooldown_step(
            duration_seconds=600.0,
            step_order=5,
        ),
    ]

    segment = WorkoutSegment(
        segmentOrder=1,
        sportType=running_sport,
        workoutSteps=steps,
    )

    workout = RunningWorkout(
        workoutName="ZonasApp - Teste Integracao",
        sportType=running_sport,
        estimatedDurationInSecs=1800,
        workoutSegments=[segment],
        description="Treino criado automaticamente pelo ZonasApp.",
    )

    result = client.upload_running_workout(workout)

    return {
        "studentId": student_id,
        "workout": result,
    }

def schedule_garmin_workout(
    student_id: str,
    workout_id: int,
    workout_date: str,
) -> dict[str, Any]:
    """
    Agenda um workout existente no Garmin Connect para uma data.

    workout_date:
    YYYY-MM-DD
    """

    client = connect_with_tokens(student_id)

    result = client.schedule_workout(
        workout_id,
        workout_date,
    )

    return {
        "studentId": student_id,
        "workoutId": workout_id,
        "date": workout_date,
        "scheduled": True,
        "garmin": result,
    }