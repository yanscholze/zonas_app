from __future__ import annotations

import os

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, Header, HTTPException, Query
from pydantic import BaseModel, Field

from garmin_client import (
    GarminNotConnectedError,
    connect_with_credentials,
    create_test_running_workout,
    get_activities,
    get_profile,
    schedule_garmin_workout,
)


# ---------------------------------------------------------------------------
# Configuração
# ---------------------------------------------------------------------------

load_dotenv()

GARMIN_BRIDGE_SECRET = os.getenv("GARMIN_BRIDGE_SECRET", "")


# ---------------------------------------------------------------------------
# Aplicação
# ---------------------------------------------------------------------------

app = FastAPI(
    title="ZonasApp Garmin Bridge",
    description="Bridge privado entre ZonasApp e Garmin Connect.",
    version="0.2.0",
)


# ---------------------------------------------------------------------------
# Modelos
# ---------------------------------------------------------------------------

class GarminConnectRequest(BaseModel):
    student_id: str = Field(
        min_length=1,
        max_length=100,
    )

    email: str = Field(
        min_length=3,
        max_length=320,
    )

    password: str = Field(
        min_length=1,
        max_length=500,
    )

    mfa_code: str | None = Field(
        default=None,
        max_length=20,
    )


class GarminScheduleWorkoutRequest(BaseModel):
    workout_id: int = Field(gt=0)

    date: str = Field(
        min_length=10,
        max_length=10,
        description="Data no formato YYYY-MM-DD",
    )


# ---------------------------------------------------------------------------
# Autenticação interna Worker -> Garmin Bridge
# ---------------------------------------------------------------------------

def require_bridge_auth(
    authorization: str | None = Header(default=None),
) -> None:
    if not GARMIN_BRIDGE_SECRET:
        raise HTTPException(
            status_code=500,
            detail="GARMIN_BRIDGE_SECRET não configurado.",
        )

    expected = f"Bearer {GARMIN_BRIDGE_SECRET}"

    if authorization != expected:
        raise HTTPException(
            status_code=401,
            detail="Não autorizado.",
        )


# ---------------------------------------------------------------------------
# Health check
# ---------------------------------------------------------------------------

@app.get("/health")
def health():
    return {
        "status": "ok",
        "service": "zonasapp-garmin-bridge",
        "version": "0.2.0",
    }


# ---------------------------------------------------------------------------
# Conectar conta Garmin
# ---------------------------------------------------------------------------

@app.post("/garmin/connect")
def connect_garmin(
    payload: GarminConnectRequest,
    _: None = Depends(require_bridge_auth),
):
    try:
        connect_with_credentials(
            student_id=payload.student_id,
            email=payload.email,
            password=payload.password,
            mfa_code=payload.mfa_code,
        )

        profile = get_profile(payload.student_id)

        return {
            "ok": True,
            "connected": True,
            "profile": profile,
        }

    except Exception as exc:
        raise HTTPException(
            status_code=401,
            detail=(
                "Não foi possível autenticar no Garmin Connect: "
                f"{type(exc).__name__}"
            ),
        ) from exc


# ---------------------------------------------------------------------------
# Perfil Garmin
# ---------------------------------------------------------------------------

@app.get("/garmin/{student_id}/profile")
def garmin_profile(
    student_id: str,
    _: None = Depends(require_bridge_auth),
):
    try:
        return {
            "ok": True,
            "profile": get_profile(student_id),
        }

    except GarminNotConnectedError as exc:
        raise HTTPException(
            status_code=404,
            detail=str(exc),
        ) from exc

    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=(
                "Falha ao consultar Garmin Connect: "
                f"{type(exc).__name__}"
            ),
        ) from exc


# ---------------------------------------------------------------------------
# Atividades Garmin
# ---------------------------------------------------------------------------

@app.get("/garmin/{student_id}/activities")
def garmin_activities(
    student_id: str,
    days: int = Query(
        default=30,
        ge=1,
        le=365,
    ),
    limit: int = Query(
        default=100,
        ge=1,
        le=200,
    ),
    _: None = Depends(require_bridge_auth),
):
    try:
        activities = get_activities(
            student_id=student_id,
            days=days,
            limit=limit,
        )

        return {
            "ok": True,
            "studentId": student_id,
            "count": len(activities),
            "activities": activities,
        }

    except GarminNotConnectedError as exc:
        raise HTTPException(
            status_code=404,
            detail=str(exc),
        ) from exc

    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=(
                "Falha ao buscar atividades Garmin: "
                f"{type(exc).__name__}"
            ),
        ) from exc


# ---------------------------------------------------------------------------
# Criar treino de teste Garmin
# ---------------------------------------------------------------------------

@app.post("/garmin/{student_id}/workouts/test")
def create_garmin_test_workout(
    student_id: str,
    _: None = Depends(require_bridge_auth),
):
    try:
        result = create_test_running_workout(
            student_id
        )

        return {
            "ok": True,
            "message": "Treino de teste enviado ao Garmin Connect.",
            "result": result,
        }

    except GarminNotConnectedError as exc:
        raise HTTPException(
            status_code=404,
            detail=str(exc),
        ) from exc

    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=(
                "Falha ao criar treino no Garmin Connect: "
                f"{type(exc).__name__}: {exc}"
            ),
        ) from exc


# ---------------------------------------------------------------------------
# Agendar treino Garmin
# ---------------------------------------------------------------------------

@app.post("/garmin/{student_id}/workouts/schedule")
def schedule_garmin_workout_endpoint(
    student_id: str,
    payload: GarminScheduleWorkoutRequest,
    _: None = Depends(require_bridge_auth),
):
    try:
        result = schedule_garmin_workout(
            student_id=student_id,
            workout_id=payload.workout_id,
            workout_date=payload.date,
        )

        return {
            "ok": True,
            "message": "Treino agendado no Garmin Connect.",
            "result": result,
        }

    except GarminNotConnectedError as exc:
        raise HTTPException(
            status_code=404,
            detail=str(exc),
        ) from exc

    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=(
                "Falha ao agendar treino no Garmin Connect: "
                f"{type(exc).__name__}: {exc}"
            ),
        ) from exc